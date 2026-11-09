/* 登录态页面级证据：记录页 / 通知页 DOM 指标 + 截图。 */
const fs = require("node:fs");
const path = require("node:path");
const { captureWC } = require("../capture");

async function captureLoginPageEvidence(ctx, wait, outDir, state) {
  // 记录页页面级证据（登录态真实渲染）：打开记录页 → DOM 指标 + 截图
  try {
    ctx.views.openDetail("https://www.luogu.com.cn/record/list?user=" + state.uid, "记录");
    const recordWc = ctx.views.currentWebContents();
    if (recordWc) {
      for (let i = 0; i < 40 && recordWc.isLoading(); i++) await wait(300);
      await wait(1200);
      const recordDom = await recordWc.executeJavaScript(`(() => {
        const txt = String(document.body.innerText || "").slice(0, 400);
        return {
          href: location.href.slice(0, 120),
          title: document.title,
          recordLinks: document.querySelectorAll('a[href*="/record/"]').length,
          textLen: txt.length,
          head: txt.slice(0, 160)
        };
      })()`);
      console.log("LGTEST_RECORD_PAGE " + JSON.stringify(recordDom));
      const recordImage = await captureWC(recordWc, wait);
      const recordPng = recordImage ? recordImage.toPNG() : Buffer.alloc(0);
      if (recordPng.length > 5000) {
        const recordFile = path.join(outDir, "login-record.png");
        fs.writeFileSync(recordFile, recordPng);
        console.log("SMOKE_SHOT login-record " + recordFile);
      } else {
        console.log("LGTEST_SHOT_SMALL login-record " + recordPng.length);
      }
    }
  } catch (err) {
    console.log("LGTEST_RECORD_PAGE_FAIL " + String((err && err.message) || err).slice(0, 120));
  }

  // 通知页页面级证据（登录态）：打开通知页 → DOM 指标 + 截图
  try {
    ctx.views.openDetail("https://www.luogu.com.cn/user/notification", "通知");
    const notifyWc = ctx.views.currentWebContents();
    if (notifyWc) {
      for (let i = 0; i < 40 && notifyWc.isLoading(); i++) await wait(300);
      await wait(1000);
      const notifyDom = await notifyWc.executeJavaScript(`(() => {
        const txt = String(document.body.innerText || "").slice(0, 400);
        return { href: location.href.slice(0, 120), title: document.title, textLen: txt.length, head: txt.slice(0, 160) };
      })()`);
      console.log("LGTEST_NOTIFY_PAGE " + JSON.stringify(notifyDom));
      const notifyImage = await captureWC(notifyWc, wait);
      const notifyPng = notifyImage ? notifyImage.toPNG() : Buffer.alloc(0);
      if (notifyPng.length > 5000) {
        const notifyFile = path.join(outDir, "login-notify.png");
        fs.writeFileSync(notifyFile, notifyPng);
        console.log("SMOKE_SHOT login-notify " + notifyFile);
      } else {
        console.log("LGTEST_SHOT_SMALL login-notify " + notifyPng.length);
      }
    }
  } catch (err) {
    console.log("LGTEST_NOTIFY_PAGE_FAIL " + String((err && err.message) || err).slice(0, 120));
  }
}

module.exports = { captureLoginPageEvidence };
