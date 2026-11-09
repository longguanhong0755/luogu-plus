const fs = require("node:fs");
const path = require("node:path");
const ocr = require("../../ocr");
const { STATUS_TEXT } = require("../../luogu");
const { findRecord } = require("../shared");

/* 仅测试用：对候选语言 id 真实提交（OCR 验证码），从评测记录反查语言名，
   同时验证 提交→验证码→评测 全链路。 */
async function langSubmitProbe(ctx, wait, outDir) {
  const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
  const rawSubmit = (langId, captcha) =>
    ctx.luogu.exec(
      `(async () => {
        const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
        const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest", "x-csrf-token": csrf };
        const body = ${JSON.stringify(captcha)} ? { code: ${JSON.stringify(code)}, lang: ${langId}, enableO2: 0, captcha: ${JSON.stringify(captcha)} } : { code: ${JSON.stringify(code)}, lang: ${langId}, enableO2: 0 };
        const r = await fetch("/fe/api/problem/submit/P1001", { method: "POST", headers, credentials: "include", body: JSON.stringify(body) });
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch {}
        const rid = j && (j.rid || (j.data && j.data.rid) || (j.currentData && j.currentData.rid));
        return { status: r.status, rid: rid || null, captcha: /Captcha|验证码/.test(text), error: (j && (j.errorMessage || j.errorType)) || text.slice(0, 120) };
      })()`
    );
  const candidates = [28, 34, 33, 30, 3];
  for (const id of candidates) {
    let r = await rawSubmit(id, "");
    let rounds = 0;
    while (r.captcha && rounds < 3) {
      const png = await ctx.luogu.fetchCaptchaPng();
      if (!png) break;
      const got = await ocr.recognize(png);
      if (!got.ok) {
        console.log("LGPROBE-SUBMIT lang=" + id + " ocr 不可用 " + got.reason);
        break;
      }
      fs.writeFileSync(path.join(outDir, "probe-captcha.png"), png);
      r = await rawSubmit(id, got.text);
      console.log("LGPROBE-SUBMIT lang=" + id + " ocr=" + got.text + " → status=" + r.status + " captcha=" + r.captcha);
      rounds++;
    }
    console.log("LGPROBE-SUBMIT lang=" + id + " final=" + JSON.stringify(r).slice(0, 260));
    if (r.ok && r.rid) {
      await wait(2000);
      const recCtx = await ctx.luogu.fetchContext("/record/" + r.rid);
      const s = JSON.stringify(recCtx || {});
      const names = [...s.matchAll(/"(?:language|lang)"\s*:\s*("?)[A-Za-z0-9+# ()\/\.]{2,30}\1/g)].map((m) => m[0]);
      console.log("LGPROBE-SUBMIT lang=" + id + " rid=" + r.rid + " recLangHits=" + JSON.stringify(names).slice(0, 400));
      let status = null;
      for (let i = 0; i < 30; i++) {
        await wait(2000);
        const rc = await ctx.luogu.fetchContext("/record/" + r.rid);
        const rec = findRecord(rc);
        if (rec && Number(rec.status) > 1) {
          status = { status: Number(rec.status), text: STATUS_TEXT[Number(rec.status)] || String(rec.status), score: Number(rec.score) || 0 };
          break;
        }
      }
      console.log("LGPROBE-SUBMIT lang=" + id + " judge=" + JSON.stringify(status));
      if (status && status.score === 100) {
        console.log("LGPROBE-SUBMIT AC-CHAIN-OK id=" + id);
        return;
      }
    }
  }
}

module.exports = { langSubmitProbe };
