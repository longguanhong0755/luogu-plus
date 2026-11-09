/* 登录页 DOM 操作工具：填表、读验证码、存验证码、等人工答案、读错误提示。 */
const fs = require("node:fs");
const path = require("node:path");

function createLoginHelpers(ctx, wait, outDir) {
  const fillAndSubmit = (body) =>
    `(() => {
      const setVal = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        d.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      ${body}
    })()`;

  const captchaInfo = (wc) =>
    wc.executeJavaScript(
      `(() => {
        const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
        const input = [...document.querySelectorAll("input")].find((i) => /captcha|验证码/i.test(i.placeholder || ""));
        const iframe = [...document.querySelectorAll("iframe")].find((f) => /captcha|geetest|verify/i.test(f.src || ""));
        return { img: img ? String(img.src).slice(0, 140) : "", input: input ? input.placeholder : "", iframe: iframe ? String(iframe.src).slice(0, 140) : "" };
      })()`
    );

  const saveCaptcha = async (wc) => {
    const data = await wc.executeJavaScript(
      `(async () => {
        const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
        if (!img) return null;
        const src = img.src;
        if (src.startsWith("data:")) return src;
        try {
          const r = await fetch(src, { credentials: "include" });
          const b = await r.blob();
          return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        } catch (e) { return null; }
      })()`
    );
    if (!data) return false;
    fs.writeFileSync(path.join(outDir, "login-captcha.png"), Buffer.from(String(data).split(",").pop(), "base64"));
    console.log("LGTEST_CAPTCHA " + path.join(outDir, "login-captcha.png"));
    return true;
  };

  const waitAnswer = async (seconds) => {
    const answerFile = path.join(outDir, "captcha-answer.txt");
    fs.rmSync(answerFile, { force: true });
    console.log("LGTEST 等待验证码答案：写入 " + answerFile);
    for (let i = 0; i < seconds; i++) {
      if (fs.existsSync(answerFile)) return fs.readFileSync(answerFile, "utf8").trim();
      await wait(1000);
    }
    return null;
  };

  const readError = (wc) =>
    wc.executeJavaScript(
      `(() => {
        const nodes = [...document.querySelectorAll(".swal2-toast, .swal2-container, [class*=error], [class*=alert], [class*=toast]")];
        return nodes.map((n) => (n.innerText || "")).join(" | ").replace(/\s+/g, " ").slice(0, 300);
      })()`
    );

  return { fillAndSubmit, captchaInfo, saveCaptcha, waitAnswer, readError };
}

module.exports = { createLoginHelpers };
