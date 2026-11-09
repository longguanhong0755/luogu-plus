/* 侧栏宽度与工作区几何：外壳 DOM 与所有页面视图消费同一个 railCurrentW。 */
const { nativeTheme } = require("electron");
const { TITLE_H, RAIL_W, RAIL_COLLAPSED_W, TOOLBAR_H } = require("../window");
const { IDE_VERTICAL_BREAKPOINT } = require("./util");

const RAIL_LAYOUT_CHANNEL = "rail:layout";

/* 全仓唯一的侧栏宽度推送点：外壳（渲染层）只消费这一份宽度。 */
function sendRailLayout(win, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(RAIL_LAYOUT_CHANNEL, payload);
}

module.exports = {
  /* ---------- 侧栏宽度（单一状态源） ----------
     外壳 DOM 与所有页面 WebContentsView 都消费同一个 railCurrentW。
     悬停不展开；只有显式固定/收起会触发一次 160ms 宽度补间。 */

  railWidth() {
    return this.railCurrentW;
  },

  railTargetWidth() {
    return this.railPinned ? RAIL_W : RAIL_COLLAPSED_W;
  },

  workspaceMetrics(entry, railW, bounds) {
    const availableWidth = Math.max(1, Math.round(bounds.width - railW));
    const availableHeight = Math.max(1, Math.round(bounds.height - TITLE_H - TOOLBAR_H));
    const ide = !!(this.ideOn && entry && entry.kind === "problem");
    const vertical = ide && availableWidth < IDE_VERTICAL_BREAKPOINT;
    let width = availableWidth;
    let height = availableHeight;
    if (ide && vertical) {
      height = Math.max(1, Math.floor(availableHeight * (1 - this.ideSplit)));
    } else if (ide) {
      width = Math.max(1, Math.floor(availableWidth * (1 - this.ideSplit)));
    }
    return { availableWidth, availableHeight, width, height, vertical };
  },

  layoutRailEntry(entry, railW, boundsOverride) {
    if (!entry || !this.win || this.win.isDestroyed()) return;
    if (entry.view.webContents.isDestroyed()) return;
    const bounds = boundsOverride || this.win.getContentBounds();
    const metrics = this.workspaceMetrics(entry, railW, bounds);
    const rect = { x: railW, y: TITLE_H + TOOLBAR_H, width: metrics.width, height: metrics.height };
    entry.ideVertical = metrics.vertical;
    const serialized = JSON.stringify(rect);
    if (entry.lastRect === serialized) return;
    entry.lastRect = serialized;
    entry.view.setBounds(rect);
    this.scheduleSkin(entry);
  },

  applyRailWidth(width, boundsOverride) {
    this.railCurrentW = Math.max(RAIL_COLLAPSED_W, Math.min(RAIL_W, Math.round(Number(width) || 0)));
    const entry = this.currentEntry();
    if (this.win && !this.win.isDestroyed()) {
      const bounds = boundsOverride || this.win.getContentBounds();
      const metrics = this.workspaceMetrics(entry, this.railCurrentW, bounds);
      sendRailLayout(this.win, { width: this.railCurrentW, ideVertical: metrics.vertical });
    }
    if (this.overlayOpen || this.library) return;
    if (entry) this.layoutRailEntry(entry, this.railCurrentW, boundsOverride);
  },

  animateRailLayout(fromW, toW) {
    if (!this.win || this.win.isDestroyed()) return;
    clearTimeout(this.railAnimTimer);
    const token = (this.railAnimToken = (this.railAnimToken || 0) + 1);
    const start = performance.now();
    const dur = 160;
    const bounds = this.win.getContentBounds();
    const easeOut = (t) => 1 - Math.pow(1 - t, 4);
    const step = () => {
      if (token !== this.railAnimToken || !this.win || this.win.isDestroyed()) return;
      const t = Math.min(1, (performance.now() - start) / dur);
      this.applyRailWidth(fromW + (toW - fromW) * easeOut(t), bounds);
      if (t < 1) {
        this.railAnimTimer = setTimeout(step, 16);
      } else {
        this.railAnimTimer = null;
        this.applyRailWidth(toW, bounds);
        this.emit();
      }
    };
    step();
  },

  setRailPinned(pinned) {
    const next = !!pinned;
    if (this.railPinned === next) {
      this.emit();
      return;
    }
    const fromW = this.railWidth();
    if (this.ctx.cfg) this.ctx.cfg.setRail({ pinned: next });
    this.railPinned = next;
    this.emit();
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    const reduced = !!(nativeTheme && nativeTheme.shouldUseReducedMotion);
    if (perf || reduced || fromW === this.railTargetWidth()) {
      this.railAnimToken = (this.railAnimToken || 0) + 1;
      clearTimeout(this.railAnimTimer);
      this.railAnimTimer = null;
      this.layout();
    } else {
      this.animateRailLayout(fromW, this.railTargetWidth());
    }
  },

  applyFeatures() {
    const features = this.ctx.cfg ? this.ctx.cfg.get().features : {};
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents;
      if (wc && !wc.isDestroyed()) wc.send("lg:features", features);
    }
  },

  setIde(on) {
    const entry = this.currentEntry();
    if (!entry || entry.kind !== "problem") return;
    this.ideOn = !!on;
    this.layout();
    this.emit();
  },

  setIdeSplit(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return;
    this.ideSplit = Math.min(0.7, Math.max(0.35, ratio));
    if (this.ideOn) this.layout();
  },

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    this.railAnimToken = (this.railAnimToken || 0) + 1;
    clearTimeout(this.railAnimTimer);
    this.railAnimTimer = null;
    this.railCurrentW = this.railTargetWidth();
    const entry = this.currentEntry();
    const metrics = this.workspaceMetrics(entry, this.railCurrentW, this.win.getContentBounds());
    sendRailLayout(this.win, { width: this.railCurrentW, ideVertical: metrics.vertical });
    if (!entry || this.overlayOpen || this.library) {
      this.hideAll();
      return;
    }
    this.layoutRailEntry(entry, this.railCurrentW);
  },
};
