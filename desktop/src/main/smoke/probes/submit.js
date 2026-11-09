const fs = require("node:fs");
const path = require("node:path");
const ocr = require("../../ocr");
const { STATUS_TEXT } = require("../../luogu");
const { findRecord } = require("../shared");

/* 仅测试用：提交验证码机制探针——绕过产品自动识别，人工读图写答案，
   打印服务器完整响应，用来区分“识别错误”和“提交机制错误”。 */
async function submitProbe(ctx, outDir, wait) {
  const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
  let result = await ctx.luogu.submitOnce("P1001", code, "C++14");
  console.log("LGPROBE first=" + JSON.stringify(result));
  if (!result.captchaRequired) {
    if (result.ok && result.rid) await pollProbeJudge(ctx, result.rid, wait);
    return;
  }
  const png = await ctx.luogu.fetchCaptchaPng();
  if (!png) {
    console.log("LGPROBE captcha=fetch-fail");
    return;
  }
  const capFile = path.join(outDir, "probe-captcha.png");
  fs.writeFileSync(capFile, png);
  const ocrRead = await ocr.recognize(png);
  console.log("LGPROBE_CAPTCHA " + capFile + " ocrRead=" + (ocrRead.ok ? ocrRead.text : "FAIL:" + ocrRead.reason));
  const answerFile = path.join(outDir, "probe-answer.txt");
  fs.rmSync(answerFile, { force: true });
  console.log("LGPROBE 等待人工答案：写入 " + answerFile);
  let answer = null;
  for (let i = 0; i < 240; i++) {
    if (fs.existsSync(answerFile)) {
      answer = fs.readFileSync(answerFile, "utf8").trim();
      break;
    }
    await wait(1000);
  }
  if (!answer) {
    console.log("LGPROBE 答案等待超时");
    return;
  }
  result = await ctx.luogu.submitOnce("P1001", code, "C++14", answer);
  console.log("LGPROBE verify=" + JSON.stringify(result));
  if (result.ok && result.rid) await pollProbeJudge(ctx, result.rid, wait);
}

async function pollProbeJudge(ctx, rid, wait) {
  for (let i = 0; i < 30; i++) {
    await wait(2000);
    const recordCtx = await ctx.luogu.fetchContext("/record/" + rid);
    const record = findRecord(recordCtx);
    if (!record) continue;
    const status = Number(record.status);
    if (status === 0 || status === 1) continue;
    console.log("LGPROBE judge=" + JSON.stringify({ status, statusText: STATUS_TEXT[status] || String(status), score: Number(record.score) || 0 }));
    return;
  }
  console.log("LGPROBE judge=timeout");
}

module.exports = { submitProbe, pollProbeJudge };
