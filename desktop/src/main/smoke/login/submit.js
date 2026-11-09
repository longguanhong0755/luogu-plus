/* 登录态提交链路：真实提交弹窗 / 验证码 / 评测结果 / 结构探针。 */
const fs = require("node:fs");
const path = require("node:path");
const { STATUS_TEXT } = require("../../luogu");
const { captureWC } = require("../capture");
const { findRecord } = require("../shared");
const { bundleProbe } = require("../probes/bundle");
const { langProbe } = require("../probes/lang");
const { langVueProbe } = require("../probes/lang-vue");
const { langSubmitProbe } = require("../probes/lang-submit");
const { captchaFetchProbe } = require("../probes/captcha-fetch");
const { uiSubmitProbe } = require("../probes/ui-submit");
const { interactiveProbe } = require("../probes/interactive");
const { shapeProbe } = require("../probes/shape");
const { submitProbe } = require("../probes/submit");

async function submitDiagnostics(ctx, wait, outDir) {
  if (process.env.LG_SMOKE_SUBMIT !== "0") {
    if (process.env.LG_SMOKE_BUNDLE === "1") {
      await bundleProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "2") {
      await langProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "4") {
      await langVueProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "5") {
      await langSubmitProbe(ctx, wait, outDir);
    } else if (process.env.LG_SMOKE_BUNDLE === "6") {
      await captchaFetchProbe(ctx);
    } else if (process.env.LG_SMOKE_BUNDLE === "7") {
      await uiSubmitProbe(ctx, wait, outDir);
    } else if (process.env.LG_SMOKE_BUNDLE === "8") {
      await interactiveProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "3") {
      await shapeProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_SUBMIT_PROBE === "1") {
      await submitProbe(ctx, outDir, wait);
    } else {
    // 打开真实提交弹窗，看验证码图的真实端点
    await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001"; })()`);
    await wait(4000);
    const dlgClick = await ctx.luogu.exec(`(() => {
      const btn = [...document.querySelectorAll("button, a")].find((b) => /提交代码/.test(b.textContent || ""));
      if (btn) { btn.click(); return "clicked"; }
      return "no-btn";
    })()`);
    await wait(2500);
    const dlgInfo = await ctx.luogu.exec(`(() => {
      const imgs = [...document.querySelectorAll("img")].map((i) => String(i.src).slice(0, 110)).filter((s) => /captcha|verify/i.test(s));
      const inputs = [...document.querySelectorAll("input")].map((i) => i.placeholder || i.type).slice(0, 14);
      const ta = !!document.querySelector("textarea");
      return { imgs, inputs, ta };
    })()`);
    console.log("LGTEST_DIALOG " + JSON.stringify({ dlgClick, dlgInfo }));
    const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
    let result = await ctx.luogu.submit("P1001", code, "C++14");
    if (result.captchaRequired && result.interactive) {
      // 洛谷对提交启用的是易盾交互式滑块（反自动化设计），不自动破解：
      // 验证“页面内提交辅助”链路（打开提交区 + 填代码）后跳过人工答题。
      console.log("LGTEST submit-captcha=interactive(" + result.interactive + ") 转页面内提交辅助");
      const assisted = await ctx.views.openSubmitAssist("P1001", code);
      console.log("LGTEST submit-assist=" + assisted + "（编辑器已填代码）");
      // 提交页页面级证据：编辑器可见 + 代码已填 + 截图
      try {
        const submitWc = ctx.views.currentWebContents();
        if (submitWc) {
          const submitDom = await submitWc.executeJavaScript(`(() => {
            const eds = [...document.querySelectorAll("[contenteditable=true]")].filter((e) => e.offsetParent);
            const ed = eds[0];
            const buttons = [...document.querySelectorAll("button, a")].map((b) => (b.textContent || "").trim()).filter((t) => /提交/.test(t));
            return {
              href: location.href.slice(0, 120),
              editors: eds.length,
              codeLen: ed ? String(ed.innerText || "").length : 0,
              submitButtons: buttons.slice(0, 5),
              hasCaptcha: /验证码|滑动|滑块/.test(String(document.body.innerText || "").slice(0, 4000))
            };
          })()`);
          console.log("LGTEST_SUBMIT_PAGE " + JSON.stringify(submitDom));
          const submitImage = await captureWC(submitWc, wait);
          const submitPng = submitImage ? submitImage.toPNG() : Buffer.alloc(0);
          if (submitPng.length > 5000) {
            const submitFile = path.join(outDir, "login-submit.png");
            fs.writeFileSync(submitFile, submitPng);
            console.log("SMOKE_SHOT login-submit " + submitFile);
          } else {
            console.log("LGTEST_SHOT_SMALL login-submit " + submitPng.length);
          }
        }
      } catch (err) {
        console.log("LGTEST_SUBMIT_PAGE_FAIL " + String((err && err.message) || err).slice(0, 120));
      }
    } else if (result.captchaRequired) {
      // 走到这里说明产品内自动识别没过（本机没装 ddddocr，或连错 3 次），转人工答题兜底
      const data = await ctx.luogu.exec(
        `(async () => {
          const r = await fetch("/lg4/captcha?_t=" + Date.now(), { credentials: "include" });
          const b = await r.blob();
          return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        })()`
      );
      if (data) {
        const capFile = path.join(outDir, "submit-captcha.png");
        fs.writeFileSync(capFile, Buffer.from(String(data).split(",").pop(), "base64"));
        console.log("LGTEST_SUBMIT_CAPTCHA " + capFile);
        const answerFile = path.join(outDir, "submit-captcha-answer.txt");
        fs.rmSync(answerFile, { force: true });
        let answer = null;
        for (let i = 0; i < 150; i++) {
          if (fs.existsSync(answerFile)) {
            answer = fs.readFileSync(answerFile, "utf8").trim();
            break;
          }
          await wait(1000);
        }
        if (answer) {
          console.log("LGTEST submit captcha answered");
          result = await ctx.luogu.submit("P1001", code, "C++14", answer);
        }
      }
    }
    console.log(
      "LGTEST submit=" +
        JSON.stringify({
          ok: result.ok,
          rid: result.rid,
          fallback: result.fallback,
          message: result.message || "",
          status: result.status || 0,
          detail: String(result.detail || "").slice(0, 200),
        })
    );
    if (result.ok && result.rid) {
      let finalRecord = null;
      for (let i = 0; i < 40; i++) {
        await wait(2000);
        const recordCtx = await ctx.luogu.fetchContext("/record/" + result.rid);
        const record = findRecord(recordCtx);
        if (!record) continue;
        const status = Number(record.status);
        if (status === 0 || status === 1) continue;
        finalRecord = { status, statusText: STATUS_TEXT[status] || String(status), score: Number(record.score) || 0 };
        break;
      }
      console.log("LGTEST judge=" + JSON.stringify(finalRecord));
    }
    }
  }
}

module.exports = { submitDiagnostics };
