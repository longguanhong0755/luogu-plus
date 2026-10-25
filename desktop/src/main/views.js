/* 页面视图管理：原生列表 + 网页详情。
   - 原生列表（题库/训练/比赛/记录/讨论/文章）不创建 WebContentsView，由渲染层直接画；
   - 网页页面（课程/聊天/通知、题面、文章详情等）各自一个 WebContentsView；
   - 题目多开（LRU 上限 8），详情页上限 10；
   - 站外链接一律交给系统浏览器。
   玻璃化：页面内注入一个与窗口同坐标的壁纸复刻层，卡片/输入框按材质半透明。 */
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView, shell } = require("electron");
const { PRELOAD, SKIN_DIR } = require("./paths");
const { TITLE_H, RAIL_W, TOOLBAR_H } = require("./window");
const { NAV, LIBRARY_IDS, WEB_URLS, FALLBACK_URLS } = require("./sections");
const { SOURCE: PASSKEY_GUARD } = require("./passkey-guard");

const MAX_PROBLEMS = 8;
const MAX_DETAILS = 10;

function isLuoguHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "luogu.com.cn" || host.endsWith(".luogu.com.cn") || host === "luogu.org" || host.endsWith(".luogu.org");
}

function isLuoguUrl(raw) {
  try {
    return isLuoguHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s*-\s*洛谷\s*$/, "")
    .trim();
}

function pidFromUrl(raw) {
  try {
    const url = new URL(raw);
    const m = url.pathname.match(/^\/problem\/([A-Za-z]{1,4}\d+[A-Za-z0-9]*)/);
    return m ? m[1].toUpperCase() : "";
  } catch {
    return "";
  }
}

function sectionOfUrl(raw) {
  try {
    const pathname = new URL(raw).pathname;
    if (pathname.startsWith("/problem/list") || pathname.startsWith("/problem/")) return "problems";
    if (pathname.startsWith("/training")) return "training";
    if (pathname.startsWith("/contest")) return "contest";
    if (pathname.startsWith("/record")) return "record";
    if (pathname.startsWith("/discuss")) return "discuss";
    if (pathname.startsWith("/article")) return "article";
    return "";
  } catch {
    return "";
  }
}

class ViewManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.entries = new Map();
    this.currentKey = null;
    this.library = null;
    this.returnLib = null;
    this.ideOn = false;
    this.overlayOpen = false;
    this.skinSource = "";
    this.skinMtime = 0;
    this.clock = 0;
    this.skinTimer = null;
  }

  setWindow(win) {
    this.win = win;
  }

  /* ---------- 入口 ---------- */

  openSection(kind) {
    const def = NAV[kind];
    if (!def) return;
    if (LIBRARY_IDS.has(kind)) {
      this.showLibrary(kind);
      return;
    }
    if (def.kind === "web") {
      this.openWeb(kind);
    }
  }

  showLibrary(kind) {
    if (!LIBRARY_IDS.has(kind)) return;
    this.library = kind;
    this.returnLib = null;
    this.currentKey = null;
    this.ideOn = false;
    this.overlayOpen = false;
    this.hideAll();
    this.emit();
  }

  openWeb(kind) {
    const def = NAV[kind];
    if (!def) return;
    let url = WEB_URLS[kind] || "";
    if (kind === "record") {
      const uid = this.ctx.luogu && this.ctx.luogu.user ? this.ctx.luogu.user.uid : null;
      url = uid ? `/record/list?user=${encodeURIComponent(uid)}` : "/record/list";
    }
    if (!url) return;
    const key = "web:" + kind;
    const entry = this.ensureEntry({ key, kind: "web", title: def.label, url, section: kind });
    this.library = null;
    this.returnLib = null;
    this.showEntry(entry);
  }

  openWebFallback(kind) {
    const url = FALLBACK_URLS[kind];
    if (!url) return;
    const def = NAV[kind];
    const key = "web:" + kind;
    const entry = this.ensureEntry({
      key,
      kind: "web",
      title: def ? def.label : "网页",
      url,
      section: kind,
    });
    this.library = null;
    this.returnLib = null;
    this.showEntry(entry);
  }

  openProblem(rawPid) {
    const pid = String(rawPid || "").toUpperCase();
    if (!/^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid)) return;
    if (this.library) this.returnLib = this.library;
    this.library = null;
    const entry = this.ensureEntry({
      key: "problem:" + pid,
      kind: "problem",
      title: pid,
      url: "https://www.luogu.com.cn/problem/" + pid,
      pid,
      section: "problems",
    });
    this.evictKind("problem", MAX_PROBLEMS, entry.key);
    this.ideOn = false;
    this.showEntry(entry);
  }

  openDetail(rawUrl, title, key) {
    let url = String(rawUrl || "");
    if (!url) return;
    if (url.startsWith("/")) url = "https://www.luogu.com.cn" + url;
    if (!isLuoguUrl(url)) {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return;
    }
    const pid = pidFromUrl(url);
    if (pid) {
      this.openProblem(pid);
      return;
    }
    const entry = this.ensureEntry({
      key: key || "detail:" + url,
      kind: "detail",
      title: title || "",
      url,
      section: sectionOfUrl(url),
    });
    if (entry.view.webContents.getURL() !== url) {
      entry.view.webContents.loadURL(url);
    }
    this.evictKind("detail", MAX_DETAILS, entry.key);
    this.library = null;
    this.showEntry(entry);
  }

  openCustom(url, label) {
    if (!/^https?:\/\//i.test(String(url || ""))) return;
    if (isLuoguUrl(url)) this.openDetail(url, label || "自定义页面");
    else shell.openExternal(url);
  }

  openLogin() {
    this.library = null;
    this.returnLib = null;
    const entry = this.ensureEntry({
      key: "login",
      kind: "login",
      title: "登录洛谷",
      url: "https://www.luogu.com.cn/auth/login",
      section: "home",
    });
    this.showEntry(entry);
  }

  openProfile(uid) {
    const id = Number(uid);
    if (!Number.isFinite(id) || id <= 0) {
      this.openLogin();
      return;
    }
    const entry = this.ensureEntry({
      key: "profile:" + id,
      kind: "profile",
      title: "个人主页",
      url: "https://www.luogu.com.cn/user/" + id,
      section: "home",
    });
    this.library = null;
    this.showEntry(entry);
  }

  showHome() {
    this.currentKey = null;
    this.library = null;
    this.returnLib = null;
    this.ideOn = false;
    this.hideAll();
    this.emit();
  }

  back() {
    const entry = this.currentEntry();
    if (entry) {
      const wc = entry.view.webContents;
      if (wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack();
        return;
      }
    }
    if (this.returnLib) {
      const lib = this.returnLib;
      this.returnLib = null;
      this.showLibrary(lib);
    }
  }

  forward() {
    const wc = this.currentWebContents();
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload() {
    const entry = this.currentEntry();
    if (entry) {
      entry.view.webContents.reload();
    } else if (this.library) {
      this.emit();
    }
  }

  openExternal() {
    const entry = this.currentEntry();
    if (entry) shell.openExternal(entry.view.webContents.getURL());
  }

  navigate(pathname) {
    const url = String(pathname || "").startsWith("http")
      ? String(pathname)
      : "https://www.luogu.com.cn" + pathname;
    const entry = this.currentEntry();
    if (entry) entry.view.webContents.loadURL(url);
    else this.openDetail(url, "");
  }

  setIde(on) {
    const entry = this.currentEntry();
    if (!entry || entry.kind !== "problem") return;
    this.ideOn = !!on;
    this.layout();
    this.emit();
  }

  setOverlay(open) {
    this.overlayOpen = !!open;
    if (this.overlayOpen) this.hideAll();
    else this.restoreCurrent();
  }

  switchTo(key) {
    if (key.startsWith("library:")) {
      this.showLibrary(key.slice("library:".length));
      return;
    }
    const entry = this.entries.get(key);
    if (!entry) return;
    this.ideOn = false;
    this.showEntry(entry);
  }

  listOpen() {
    const out = [];
    if (this.library) {
      out.push({
        key: "library:" + this.library,
        kind: "library",
        title: (NAV[this.library] || {}).label || this.library,
      });
    }
    const sections = [...this.entries.values()]
      .filter((entry) => entry.kind === "web")
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of sections) out.push({ key: entry.key, kind: "section", title: entry.title });
    const others = [...this.entries.values()]
      .filter((entry) => entry.kind === "problem" || entry.kind === "profile" || entry.kind === "detail")
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of others) {
      out.push({
        key: entry.key,
        kind: entry.kind === "detail" ? "section" : entry.kind,
        title: entry.title,
        pid: entry.pid,
      });
    }
    return out;
  }

  currentInfo() {
    if (this.library) {
      return {
        home: false,
        library: this.library,
        section: this.library,
        key: "library:" + this.library,
        kind: "library",
        title: (NAV[this.library] || {}).label || this.library,
        url: "",
        canBack: false,
        canForward: false,
        isProblem: false,
        pid: "",
        ide: false,
        layout: { titleH: TITLE_H, railW: RAIL_W, toolbarH: TOOLBAR_H },
      };
    }
    const entry = this.currentEntry();
    if (!entry) {
      return {
        home: true,
        library: null,
        section: "home",
        key: null,
        kind: "home",
        title: "主页",
        url: "",
        canBack: false,
        canForward: false,
        isProblem: false,
        pid: "",
        ide: false,
        layout: { titleH: TITLE_H, railW: RAIL_W, toolbarH: TOOLBAR_H },
      };
    }
    const wc = entry.view.webContents;
    let canBack = false;
    let canForward = false;
    try {
      canBack = wc.navigationHistory.canGoBack();
      canForward = wc.navigationHistory.canGoForward();
    } catch {
      /* ignore */
    }
    return {
      home: false,
      library: null,
      section: entry.section || sectionOfUrl(wc.getURL()),
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      url: wc.getURL(),
      canBack: canBack || !!this.returnLib,
      canForward,
      isProblem: entry.kind === "problem",
      pid: entry.pid || pidFromUrl(wc.getURL()),
      ide: this.ideOn,
      layout: { titleH: TITLE_H, railW: RAIL_W, toolbarH: TOOLBAR_H },
    };
  }

  /* ---------- 视图生命周期 ---------- */

  ensureEntry({ key, kind, title, url, pid, section }) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = ++this.clock;
      if (title) existing.title = title;
      return existing;
    }
    const t = this.ctx.theme;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD, "page.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        session: this.ctx.session,
        spellcheck: false,
        additionalArguments: [
          "--lg-boot-bg=" + encodeURIComponent(t.colors.bg),
          "--lg-view-x=" + RAIL_W,
          "--lg-view-y=" + (TITLE_H + TOOLBAR_H),
          "--lg-motion=" + (this.ctx.cfg.get().appearance.wallpaperMotion ? "1" : "0"),
          "--lg-zoom=" + (this.ctx.cfg.get().appearance.wallpaperZoom ? "1" : "0"),
        ],
      },
    });
    view.setBackgroundColor(t.colors.bg);

    const entry = {
      key,
      kind,
      title: title || "",
      pid: pid || "",
      section: section || "",
      view,
      lastUsed: ++this.clock,
      skinKey: null,
      attached: false,
      lastRect: "",
      booted: false,
    };
    this.entries.set(key, entry);
    this.wire(entry);
    const wc = view.webContents;
    // 先在空白页上装好主世界守卫，再进真实页面：登录页首帧就受保护。
    wc.once("dom-ready", async () => {
      if (entry.booted) return;
      entry.booted = true;
      await this.attachGuard(wc);
      if (!wc.isDestroyed() && url) {
        wc.loadURL(url).catch((err) => {
          this.ctx.toast && this.ctx.toast("页面打开失败", err.message);
        });
      }
    });
    wc.loadURL("about:blank").catch(() => {});
    return entry;
  }

  async attachGuard(wc) {
    if (!wc || wc.isDestroyed()) return false;
    try {
      if (wc.debugger.isAttached()) return true;
      wc.debugger.attach("1.3");
      await Promise.race([
        wc.debugger.sendCommand("Page.enable"),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Page.enable timeout")), 5000)),
      ]);
      await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: PASSKEY_GUARD,
        runImmediately: true,
      });
      return true;
    } catch (err) {
      console.error("[views] passkey guard:", err.message);
      return false;
    }
  }

  reinstallGuard(wc) {
    if (!wc || wc.isDestroyed()) return;
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      /* ignore */
    }
    this.attachGuard(wc).catch(() => {});
  }

  wire(entry) {
    const wc = entry.view.webContents;

    wc.on("page-title-updated", (_event, title) => {
      if (!title || title === "about:blank") return;
      const cleaned = cleanTitle(title);
      if (cleaned) entry.title = cleaned;
      this.emit();
    });

    const onNavigate = (_event, url) => {
      if (!url || url === "about:blank") return;
      const pid = pidFromUrl(url);
      if (pid && entry.kind === "problem") entry.pid = pid;
      if (pid) entry.title = pid;
      const section = sectionOfUrl(url);
      if (section) entry.section = section;
      this.emit();
      this.ctx.onNavigate && this.ctx.onNavigate(url);
    };
    wc.on("did-navigate", onNavigate);
    wc.on("did-navigate-in-page", onNavigate);

    wc.on("dom-ready", () => {
      const current = wc.getURL();
      if (current === "about:blank") return;
      if (!wc.debugger.isAttached()) this.attachGuard(wc);
      this.injectSkin(entry);
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
    });

    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url === "about:blank") return;
      this.ctx.toast && this.ctx.toast("页面加载失败", `${description}（${code}）`);
      console.error("[views] did-fail-load", url, code, description);
    });

    wc.on("render-process-gone", () => {
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload();
      }, 600);
    });

    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      let command = "";
      if (ctrl && !input.shift && input.key.toLowerCase() === "k") command = "palette";
      else if (ctrl && !input.shift && input.key.toLowerCase() === "l") command = "jump";
      else if (ctrl && input.key === "Tab") command = "switcher";
      else if (ctrl && (input.key === "," || input.key === "，")) command = "settings";
      else if (input.key === "F11") command = "fullscreen";
      else if (input.key === "F12") command = "devtools";
      if (!command) return;
      event.preventDefault();
      this.ctx.command && this.ctx.command(command);
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isLuoguUrl(url)) {
        this.openDetail(url, "", "detail:" + url);
      } else {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      if (url.startsWith("devtools://") || url.startsWith("about:")) return;
      if (!isLuoguUrl(url)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
  }

  showEntry(entry) {
    if (!this.win || this.win.isDestroyed()) return;
    this.currentKey = entry.key;
    this.library = null;
    this.overlayOpen = false;
    for (const other of this.entries.values()) {
      if (other !== entry) other.view.setVisible(false);
    }
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    entry.lastUsed = ++this.clock;
    this.layout();
    this.injectSkin(entry);
    entry.view.webContents.focus();
    this.emit();
  }

  hideAll() {
    for (const entry of this.entries.values()) entry.view.setVisible(false);
  }

  restoreCurrent() {
    if (this.library) {
      this.hideAll();
      return;
    }
    const entry = this.currentEntry();
    if (!entry || !this.win || this.win.isDestroyed()) return;
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    this.layout();
    this.injectSkin(entry);
  }

  currentEntry() {
    return this.currentKey ? this.entries.get(this.currentKey) || null : null;
  }

  currentWebContents() {
    const entry = this.currentEntry();
    return entry ? entry.view.webContents : null;
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const entry = this.currentEntry();
    if (!entry || this.overlayOpen || this.library) {
      this.hideAll();
      return;
    }
    const bounds = this.win.getContentBounds();
    const x = RAIL_W;
    const y = TITLE_H + TOOLBAR_H;
    let width = Math.max(320, bounds.width - RAIL_W);
    const height = Math.max(240, bounds.height - TITLE_H - TOOLBAR_H);
    if (this.ideOn && entry.kind === "problem") {
      width = Math.max(320, Math.floor(width / 2));
    }
    const rect = { x, y, width, height };
    const serialized = JSON.stringify(rect);
    if (entry.lastRect !== serialized) {
      entry.lastRect = serialized;
      entry.view.setBounds(rect);
      this.scheduleSkin(entry);
    }
  }

  scheduleSkin(entry) {
    if (this.skinTimer) clearTimeout(this.skinTimer);
    this.skinTimer = setTimeout(() => {
      if (this.currentEntry() === entry) this.injectSkin(entry);
    }, 140);
  }

  evictKind(kind, max, keepKey) {
    const list = [...this.entries.values()].filter((entry) => entry.kind === kind);
    if (list.length <= max) return;
    list.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of list) {
      if (list.length <= max) break;
      if (entry.key === keepKey) continue;
      this.destroyEntry(entry);
      list.splice(list.indexOf(entry), 1);
    }
  }

  destroyEntry(entry) {
    try {
      if (entry.attached) {
        this.win.contentView.removeChildView(entry.view);
        entry.attached = false;
      }
      entry.view.webContents.close();
    } catch {
      /* ignore */
    }
    this.entries.delete(entry.key);
    if (this.currentKey === entry.key) this.currentKey = null;
  }

  updateTheme() {
    if (!this.win || this.win.isDestroyed()) return;
    const wall = this.ctx.wallpaper || {};
    for (const entry of this.entries.values()) {
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
      try {
        entry.view.webContents.send("lg:motion", { motion: !!wall.motion, zoom: !!wall.zoom });
      } catch {
        /* ignore */
      }
      this.injectSkin(entry);
    }
    this.layout();
  }

  /* ---------- 统一皮肤 + 壁纸复刻 ---------- */

  skinCss(entry) {
    const file = path.join(SKIN_DIR, "luogu-skin.css");
    try {
      const stat = fs.statSync(file);
      if (!this.skinSource || stat.mtimeMs !== this.skinMtime) {
        this.skinSource = fs.readFileSync(file, "utf8");
        this.skinMtime = stat.mtimeMs;
      }
    } catch {
      this.skinSource = "";
    }
    const t = this.ctx.theme;
    const c = t.colors;
    const wall = this.ctx.wallpaper || {};
    const winBounds = this.win.getContentBounds();
    const rect = entry.view.getBounds();
    const backdrop = wall.backdrop || "none";
    const vars = [
      `--lg-bg:${c.bg}`,
      `--lg-rail:${c.rail}`,
      `--lg-title:${c.title}`,
      `--lg-surface:${c.surface}`,
      `--lg-surface-2:${c.surface2}`,
      `--lg-border:${c.border}`,
      `--lg-text:${c.text}`,
      `--lg-text-2:${c.text2}`,
      `--lg-text-3:${c.text3}`,
      `--lg-accent:${c.accent}`,
      `--lg-accent-soft:${c.accentSoft}`,
      `--lg-accent-fill:${c.accentFill}`,
      `--lg-on-accent:${c.onAccent}`,
      `--lg-green:${c.green}`,
      `--lg-red:${c.red}`,
      `--lg-orange:${c.orange}`,
      `--lg-material:${t.material}`,
      `--lg-panel-alpha:${t.panelAlpha}%`,
      `--lg-card-alpha:${t.cardAlpha}%`,
      `--lg-scrim:${t.pageScrim}%`,
      `--lg-blur:${t.blurPx}px`,
      `--lg-wall-image:${backdrop}`,
      `--lg-wall-left:-${rect.x}px`,
      `--lg-wall-top:-${rect.y}px`,
      `--lg-wall-w:${winBounds.width}px`,
      `--lg-wall-h:${winBounds.height}px`,
      `--lg-color-scheme:${t.isDark ? "dark" : "light"}`,
      `--lg-motion:${wall.motion ? 1 : 0}`,
      `--lg-zoom-on:${wall.zoom ? 1 : 0}`,
    ].join(";");
    return `:root{${vars}}\n` + this.skinSource;
  }

  injectSkin(entry) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    let css = "";
    try {
      css = this.skinCss(entry);
    } catch {
      return;
    }
    if (!css.trim()) return;
    try {
      if (entry.skinKey) wc.removeInsertedCSS(entry.skinKey).catch(() => {});
      wc.insertCSS(css).then((key) => {
        entry.skinKey = key;
      }).catch(() => {});
    } catch {
      /* 页面还在加载中，dom-ready 会再试 */
    }
  }

  emit() {
    if (this.ctx.emitPage) this.ctx.emitPage();
  }
}

module.exports = {
  ViewManager,
  NAV,
  LIBRARY_IDS,
  isLuoguUrl,
  pidFromUrl,
  cleanTitle,
  sectionOfUrl,
};
