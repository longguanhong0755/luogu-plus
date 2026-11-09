/* 隐藏窗口里的页面视图截图：capturePage 在从未 show 过的窗口上可能拿不到合成层
   （Windows 上偶发，与 GPU/DWM 状态有关），重试三次后用 CDP 强制出一帧兜底。 */

async function captureWC(wc, wait) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const image = await wc.capturePage(undefined, { stayHidden: true });
      if (image && !image.isEmpty()) return image;
    } catch {
      /* 空/失败继续重试，最后走 CDP 兜底 */
    }
    await wait(600);
    if (wc.isDestroyed()) return null;
  }
  try {
    const dbg = wc.debugger;
    if (!dbg.isAttached()) dbg.attach();
    const res = await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    dbg.detach();
    return require("electron").nativeImage.createFromBuffer(Buffer.from(res.data, "base64"));
  } catch (err) {
    console.log("SMOKE_CAPTURE_CDP_FAIL " + err.message);
    return null;
  }
}

module.exports = { captureWC };
