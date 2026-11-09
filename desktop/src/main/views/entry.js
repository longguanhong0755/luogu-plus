/* 页面条目创建：WebContentsView、加载状态机、通行密钥守卫与首次导航。 */
const path = require("node:path");
const { WebContentsView } = require("electron");
const { PRELOAD } = require("../paths");
const { TITLE_H, TOOLBAR_H } = require("../window");
const { PageReadinessController } = require("../page-readiness");
const { attachToWebContents: attachPasskeyGuard } = require("../passkey-guard");

module.exports = {
  ensureEntry({ key, kind, title, url, pid, section, railId }) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = ++this.clock;
      if (title) existing.title = title;
      if (railId !== undefined) existing.railId = String(railId || "");
      if (url) existing.requestedUrl = url;
      if (existing.sleeping) this.wakeEntry(existing, url);
      return existing;
    }
    const t = this.ctx.theme;
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    const features = this.ctx.cfg && this.ctx.cfg.get().features ? this.ctx.cfg.get().features : {};
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD, "page.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.ctx.session,
        spellcheck: false,
        backgroundThrottling: !this.ctx.smoke,
        additionalArguments: [
          "--lg-boot-bg=" + encodeURIComponent(t.colors.bg),
          "--lg-boot-surface=" + encodeURIComponent(t.colors.surface),
          "--lg-view-x=" + this.railWidth(),
          "--lg-view-y=" + (TITLE_H + TOOLBAR_H),
          "--lg-motion=0",
          "--lg-zoom=0",
          "--lg-adblock=" + (this.ctx.cfg.get().general.adBlock ? "1" : "0"),
          "--lg-features=" + encodeURIComponent(JSON.stringify(features)),
          "--lg-boot-mode=" + (t.isDark ? "dark" : "light"),
          // 首帧就给链接正确的主题色,否则皮肤变量落地前链接是官方灰、再扫成主题色
          "--lg-boot-accent=" + encodeURIComponent(t.colors.accentText + "," + t.colors.accent),
        ],
      },
    });
    view.setBackgroundColor("#00000000");

    const entry = {
      key,
      kind,
      title: title || "",
      pid: pid || "",
      section: section || "",
      railId: railId === undefined ? undefined : String(railId || ""),
      view,
      lastUsed: ++this.clock,
      skinKey: null,
      skinPending: false,
      skinMtime: 0,
      varsKey: null,
      varsSig: "",
      varsPending: false,
      varsDirty: false,
      guardReady: null,
      guardPreDoc: false,
      guardRetry: false,
      attached: false,
      lastRect: "",
      booted: false,
      requestedUrl: url || "",
      blankRetries: 0,
      sleeping: false,
      sleepPending: false,
      sleepTimer: null,
      lifecycleToken: 0,
      resumeUrl: url || "",
      resumeScroll: 0,
    };
    const wc = view.webContents;
    // Chromium 会为带 iframe 的页面在其内部加载流程中临时注册多个
    // did-stop-loading 监听（通知页实测 8-12 个）。业务代码始终只注册 1 个；
    // 给内部实现留出有限空间，并由 smoke 对“业务监听数 + 总数上限”双重门禁。
    wc.setMaxListeners(24);
    entry.readiness = new PageReadinessController(
      wc,
      () => ({
        kind: entry.kind,
        section: entry.section,
        requestedUrl: entry.requestedUrl,
        url: entry.sleeping ? entry.resumeUrl : wc.getURL(),
      }),
      (loadState) => {
        entry.loadState = loadState;
        if (this.currentEntry() === entry) this.emit();
      }
    );
    entry.loadState = entry.readiness.state;
    this.entries.set(key, entry);
    this.wire(entry);
    // 所有页面视图都在首个真实文档创建前安装通行密钥守卫；不能只保护登录视图，
    // 否则站点后续跳到登录页时仍可能拉起 Windows 安全中心。
    // 守卫不再阻塞导航：Electron 39 在“还没有已提交文档”的目标上执行 Page 域命令会
    // 一直挂起，若等它超时，每次开页要多等 1 秒多；首个文档由 dom-ready 兜底，
    // 文档就绪后再补装 pre-document 注入（见下方 dom-ready）。
    entry.guardReady = this.attachGuard(wc);
    entry.guardReady.then((guarded) => {
      entry.guardPreDoc = !!guarded;
    }).catch(() => {});
    if (url) {
      entry.readiness.begin(url, "open");
      this.loadEntryURL(entry, url).catch((err) => {
        // 页面还没加载完就被切走/重载时，Chromium 以 ERR_ABORTED 结束旧请求；
        // 这不是打开失败，弹出来只会吓人。
        if (/ERR_ABORTED|\(-3\)/.test(String((err && err.message) || ""))) return;
        entry.readiness.fail(err.message, "open-failed");
        this.ctx.toast && this.ctx.toast("页面打开失败", err.message);
      });
    }
    return entry;
  },

  async attachGuard(wc) {
    return attachPasskeyGuard(wc);
  },

  reinstallGuard(wc) {
    if (!wc || wc.isDestroyed()) return;
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      /* ignore */
    }
    this.attachGuard(wc).catch(() => {});
  },

  /* 页面导航统一走 CDP 的 Page.navigate。这样既和普通浏览器导航语义一致，
     又不会让 Electron 的 loadURL Promise 为同一 WebContents 挂上一组内部
     did-stop-loading 监听器；带 iframe 的洛谷页面尤其容易触发这些假泄漏告警。
     CDP 不可用时仍回退到 loadURL，并用 did-fail-load 统一呈现错误。 */
  async loadEntryURL(entry, url) {
    const wc = entry && entry.view && entry.view.webContents;
    const target = String(url || "");
    if (!wc || wc.isDestroyed() || !target) return false;
    if (wc.debugger.isAttached()) {
      try {
        const result = await Promise.race([
          wc.debugger.sendCommand("Page.navigate", { url: target }),
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Page.navigate timeout")), 10000)),
        ]);
        if (result && result.errorText) throw new Error(result.errorText);
        return true;
      } catch (err) {
        console.warn("[views] Page.navigate fallback:", err.message);
      }
    }
    await wc.loadURL(target);
    return true;
  },
};
