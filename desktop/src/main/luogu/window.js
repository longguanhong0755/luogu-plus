/* 洛谷数据服务 · 隐藏数据窗的加载等待、复用与空闲回收（拆分自 src/main/luogu.js）。 */
const { BrowserWindow } = require("electron");
const { attachToWebContents: attachPasskeyGuard } = require("../passkey-guard");

const LOAD_WAIT_KEY = Symbol("lg.loadWait");
/* 隐藏数据窗会被多轮请求复用。等待加载时必须同时解除 did-stop-loading /
   did-fail-load / destroyed 监听，否则超时后的 once 监听会跨请求累积。 */
function waitForLoadStop(webContents, timeoutMs = 12000) {
  if (!webContents || webContents.isDestroyed()) return Promise.resolve();
  // 同一个隐藏 WebContents 上可能并发多个 exec。共享一个等待 Promise，
  // 避免每个请求都往 EventEmitter 上挂一对 did-stop/did-fail 监听。
  if (webContents[LOAD_WAIT_KEY]) return webContents[LOAD_WAIT_KEY];
  const pending = new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.removeListener("did-stop-loading", done);
      webContents.removeListener("did-fail-load", done);
      webContents.removeListener("destroyed", done);
      if (webContents[LOAD_WAIT_KEY] === pending) delete webContents[LOAD_WAIT_KEY];
      resolve();
    };
    webContents.once("did-stop-loading", done);
    webContents.once("did-fail-load", done);
    webContents.once("destroyed", done);
    timer = setTimeout(done, timeoutMs);
  });
  webContents[LOAD_WAIT_KEY] = pending;
  return pending;
}
const windowMethods = {
  /* ---------- 隐藏窗口 ---------- */

  ensureWindow() {
    if (this.winIdleTimer) {
      clearTimeout(this.winIdleTimer);
      this.winIdleTimer = null;
    }
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      width: 520,
      height: 400,
      skipTaskbar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        session: this.ctx.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
      },
    });
    // 隐藏数据窗也锁导航：站内可跳，站外拒绝（不 openExternal——它没有用户可见面）；
    // window.open 一律拒绝，防止站内内容弹可见原生窗（继承登录会话）。
    this.win.webContents.on("will-navigate", (event, url) => {
      try {
        const host = new URL(url).hostname;
        const okHost =
          host === "luogu.com.cn" ||
          host === "www.luogu.com.cn" ||
          host.endsWith(".luogu.com.cn") ||
          host === "luogu.org" ||
          host.endsWith(".luogu.org");
        if (!okHost) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    const wc = this.win.webContents;
    this.loadPromise = (async () => {
      // 隐藏窗口没有可见登录页，但站点仍可能自动调用 WebAuthn；在所有文档
      // 创建前拦住它，确保不会弹出 Windows 安全中心。
      await attachPasskeyGuard(wc);
      try {
        await wc.loadURL("https://www.luogu.com.cn/");
      } catch (err) {
        console.error("[luogu] hidden window load:", err.message);
      }
    })();
    return this.win;
  },

  async exec(script) {
    this.ensureWindow();
    await this.loadPromise;
    if (!this.win || this.win.isDestroyed()) return null;
    // reload/导航期间 executeJavaScript 会失败，这里统一等待
    try {
      const wc = this.win.webContents;
      if (wc.isLoading()) await waitForLoadStop(wc, 10000);
    } catch {
      /* ignore */
    }
    try {
      return await this.win.webContents.executeJavaScript(script, true);
    } catch (err) {
      console.error("[luogu] exec:", err.message);
      return null;
    } finally {
      this.scheduleWindowIdle();
    }
  },

  scheduleWindowIdle() {
    if (this.winIdleTimer) clearTimeout(this.winIdleTimer);
    this.winIdleTimer = setTimeout(() => {
      this.winIdleTimer = null;
      if (!this.win || this.win.isDestroyed()) return;
      this.win.destroy();
      this.win = null;
      this.loadPromise = null;
    }, Math.max(5000, Number(process.env.LG_DATA_WINDOW_IDLE_MS) || 15000));
  },

  reloadHidden() {
    if (!this.win || this.win.isDestroyed()) return;
    this.loadPromise = waitForLoadStop(this.win.webContents, 12000);
    this.win.webContents.reload();
  }
};

module.exports = { waitForLoadStop, windowMethods };
