/* 登录尝试循环：账号轮换 / 验证码 OCR / 人工兜底 / 失败原因分流。 */
const fs = require("node:fs");
const path = require("node:path");
const ocr = require("../../ocr");

async function runLoginAttempts(ctx, wait, outDir, accounts, helpers) {
  const { fillAndSubmit, captchaInfo, saveCaptcha, waitAnswer, readError } = helpers;
  let loggedInState = null;
  let accountIndex = 0;
  const MAX_ATTEMPTS = 12;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !loggedInState; attempt++) {
    if (accountIndex >= accounts.length) break;
    const account = accounts[accountIndex];
    console.log("LGTEST account#" + (accountIndex + 1) + "=" + account.user.slice(0, 3) + "***");

    ctx.views.openLogin();
    const wc = ctx.views.currentWebContents();
    if (!wc) {
      console.log("LGTEST_FAIL 登录视图未创建");
      return null;
    }
    await wc.loadURL("https://www.luogu.com.cn/auth/login").catch(() => {});
    for (let i = 0; i < 60 && wc.isLoading(); i++) await wait(500);
    await wait(1000);

    let step1 = null;
    for (let i = 0; i < 10; i++) {
      step1 = await wc.executeJavaScript(
        fillAndSubmit(`
        const inputs = [...document.querySelectorAll("input")].filter(
          (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && !i.disabled && i.offsetParent
        );
        const input = inputs[0];
        if (!input) return { ok: false, reason: "no-account-input" };
        setVal(input, ${JSON.stringify(account.user)});
        const btn = [...document.querySelectorAll("button")].find((b) => /下一步|登录/.test(b.textContent || ""));
        if (!btn) return { ok: false, reason: "no-next-btn" };
        btn.click();
        return { ok: true };`)
      );
      if (step1 && step1.ok) break;
      await wait(700);
    }
    if (!step1 || !step1.ok) {
      console.log("LGTEST_FAIL 找不到登录输入框/按钮");
      return null;
    }

    let sawPassword = false;
    for (let i = 0; i < 24 && !sawPassword; i++) {
      sawPassword = await wc.executeJavaScript(
        `(() => { const el = document.querySelector("input[type=password]"); return !!(el && el.offsetParent); })()`
      );
      if (!sawPassword) await wait(500);
    }
    if (!sawPassword) {
      console.log("LGTEST_FAIL 没有出现密码输入框");
      return null;
    }

    let captcha = null;
    for (let i = 0; i < 10 && !captcha; i++) {
      captcha = await captchaInfo(wc);
      if (captcha && (captcha.img || captcha.input || captcha.iframe)) break;
      captcha = null;
      await wait(500);
    }

    await wc.executeJavaScript(
      fillAndSubmit(`
      const input = document.querySelector("input[type=password]");
      if (!input) return { ok: false };
      setVal(input, ${JSON.stringify(account.pass)});
      return { ok: true };`)
    );

    if (captcha && (captcha.img || captcha.input)) {
      const saved = await saveCaptcha(wc);
      if (!saved) {
        console.log("LGTEST_FAIL 验证码图获取失败");
        return null;
      }
      let answer = null;
      if (process.env.LG_SMOKE_CAPTCHA_MANUAL !== "1") {
        const got = await ocr.recognize(fs.readFileSync(path.join(outDir, "login-captcha.png")));
        if (got.ok) {
          answer = got.text;
          console.log("LGTEST captcha ocr=" + answer + " (attempt " + attempt + ")");
        } else {
          console.log("LGTEST captcha ocr 不可用 " + got.reason + "，转人工答题");
        }
      }
      if (!answer) {
        answer = await waitAnswer(240);
        if (!answer) {
          console.log("LGTEST_FAIL 等待验证码答案超时");
          return null;
        }
        console.log("LGTEST captcha answered (attempt " + attempt + ")");
      }
      await wc.executeJavaScript(
        fillAndSubmit(`
        const inputs = [...document.querySelectorAll("input")].filter(
          (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && i.offsetParent
        );
        const input = inputs.find((i) => /captcha|验证码/i.test(i.placeholder || "")) || inputs[inputs.length - 1];
        if (!input) return { ok: false };
        setVal(input, ${JSON.stringify(answer)});
        return { ok: true };`)
      );
    }

    await wc.executeJavaScript(
      fillAndSubmit(`
      const btn = [...document.querySelectorAll("button")].find((b) => /^登录$/.test((b.textContent || "").trim())) ||
        [...document.querySelectorAll("button")].find((b) => /登录/.test(b.textContent || ""));
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };`)
    );

    for (let i = 0; i < 10; i++) {
      await wait(1000);
      const st = await ctx.luogu.loginState();
      if (st.loggedIn) {
        loggedInState = st;
        break;
      }
    }
    if (loggedInState) break;

    const error = await readError(wc);
    console.log("LGTEST account#" + (accountIndex + 1) + " failed, error=" + JSON.stringify(error));
    if (/用户名或密码/.test(error)) {
      accountIndex++;
      continue;
    }
    if (/验证码/.test(error)) {
      continue; // 同一账号换一张验证码重试
    }
    if (/频繁|稍后|尝试/.test(error)) {
      await wait(30000);
      continue;
    }
    break;
  }

  if (!loggedInState) {
    console.log("LGTEST_FAIL 所有尝试均未登录成功");
    return null;
  }
  return loggedInState;
}

module.exports = { runLoginAttempts };
