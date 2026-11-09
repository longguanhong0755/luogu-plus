/* 覆盖层：用当前页面冻结帧作背景，开关串行执行避免旧 close 覆盖新 open。 */

module.exports = {
  async captureOverlayBackdrop() {
    const entry = this.currentEntry();
    if (!entry || !this.win || this.win.isDestroyed() || entry.view.webContents.isDestroyed()) return "";
    const bounds = entry.view.getBounds();
    const fingerprint = [
      entry.key,
      entry.view.webContents.getURL(),
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ].join("|");
    const cached = this.lastOverlayBackdrop && this.lastOverlayBackdrop.fingerprint === fingerprint
      ? this.lastOverlayBackdrop.dataUrl
      : "";
    let lastError = null;
    // 隐藏/透明窗口偶尔会在首帧合成前返回空图；连续重试三次，
    // 比直接清空覆盖层背景稳定得多。
    for (let attempt = 0; attempt < 3; attempt++) {
      let timeout = null;
      try {
        entry.view.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 30 + attempt * 35));
        let image = await Promise.race([
          entry.view.webContents.capturePage(undefined, { stayHidden: true }),
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(null), 1500);
          }),
        ]);
        if (!image || image.isEmpty()) continue;
        const size = image.getSize();
        if (bounds.width > 0 && bounds.height > 0 && size.width > bounds.width + 1) {
          image = image.resize({ width: Math.round(bounds.width), height: Math.round(bounds.height), quality: "good" });
        }
        const dataUrl = image.toDataURL();
        this.lastOverlayBackdrop = { fingerprint, dataUrl };
        return dataUrl;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError) console.warn("[views] overlay backdrop:", lastError.message);
    // 页面刚切换/仍在首帧合成时可能暂时抓不到图；保留最近一张冻结帧，
    // 也远好于把覆盖层背景直接清空。下一次成功抓图会替换它。
    return cached || (this.lastOverlayBackdrop && this.lastOverlayBackdrop.dataUrl) || "";
  },

  /* 覆盖层开关来自渲染进程的异步 IPC。快速关闭再打开时，两个 IPC 会并发抵达；
     必须串行执行，否则旧的 close 可能在新 open 之后落地并把页面藏掉。 */
  setOverlay(open) {
    const next = !!open;
    if (!next) {
      // Esc/返回是用户可见的即时操作，不能被仍在抓图的 open 排队拖住。
      // 先失效旧代次并恢复页面；排队的 close 随后只会做幂等收尾。
      this.overlayToken++;
      if (this.overlayOpen) {
        this.overlayOpen = false;
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send("page:freeze", { clear: true });
        }
        this.restoreCurrent();
      }
    }
    const operation = this.overlayQueue.then(() => this.applyOverlay(next));
    this.overlayQueue = operation.catch(() => {});
    return operation;
  },

  async applyOverlay(next) {
    if (next) {
      if (this.overlayOpen) return;
      this.overlayOpen = true;
      const token = ++this.overlayToken;
      const dataUrl = await this.captureOverlayBackdrop();
      if (this.ctx.smoke) console.log("SMOKE_OVERLAY_BACKDROP " + JSON.stringify({ bytes: dataUrl.length }));
      // 抓图期间用户可能已经按 Esc；旧代次不能把刚恢复的页面再次隐藏。
      if (token !== this.overlayToken || !this.overlayOpen) return;
      if (dataUrl && this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("page:freeze", { dataUrl });
        // 让外壳先收到冻结帧，再撤掉 WebContentsView，避免覆盖层打开时内容闪空。
        await new Promise((resolve) => setTimeout(resolve, 16));
      } else if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("page:freeze", { clear: true });
      }
      if (token !== this.overlayToken || !this.overlayOpen) return;
      this.hideAll();
      if (this.win && !this.win.isDestroyed()) this.win.webContents.focus();
      return;
    }
    if (!this.overlayOpen) return;
    this.overlayOpen = false;
    this.overlayToken++;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send("page:freeze", { clear: true });
    this.restoreCurrent();
  },
};
