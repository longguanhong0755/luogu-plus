/* ViewManager 类骨架：状态字段、销毁、窗口绑定与页面状态广播。
   其余方法按域拆在同目录的实现文件里，由入口 views.js 装配到原型上。 */
const { RAIL_W, RAIL_COLLAPSED_W } = require("../window");

class ViewManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.entries = new Map();
    this.currentKey = null;
    this.library = null;
    this.returnLib = null;
    this.closedStack = [];
    this.ideOn = false;
    this.ideSplit = 0.5;
    this.overlayOpen = false;
    this.overlayToken = 0;
    this.overlayQueue = Promise.resolve();
    this.lastOverlayBackdrop = null;
    this.railPinned = !!(ctx.cfg && ctx.cfg.get().rail && ctx.cfg.get().rail.pinned);
    this.railCurrentW = this.railPinned ? RAIL_W : RAIL_COLLAPSED_W;
    this.railAnimToken = 0;
    this.railAnimTimer = null;
    this.skinSource = "";
    this.skinMtime = 0;
    this.clock = 0;
    this.skinTimer = null;
    this.skinSeq = 0;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.overlayToken++;
    clearTimeout(this.railAnimTimer);
    clearTimeout(this.skinTimer);
    this.railAnimTimer = null;
    this.skinTimer = null;
    for (const entry of this.entries.values()) {
      clearTimeout(entry.captureTimer);
      clearTimeout(entry.sleepTimer);
      if (entry.readiness) entry.readiness.dispose();
      if (!entry.view || entry.view.webContents.isDestroyed()) continue;
      entry.view.webContents.setAudioMuted(true);
      entry.view.setVisible(false);
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
    }
  }

  setWindow(win) {
    this.win = win;
  }

  emit() {
    if (this.ctx.emitPage) this.ctx.emitPage();
  }
}

module.exports = { ViewManager };
