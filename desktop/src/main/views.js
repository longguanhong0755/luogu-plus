/* 页面视图管理：板块单例 + 题目多开（LRU 上限 8），无标签条。
   - 板块：题库/训练/比赛/讨论/记录/登录，各自一个 WebContentsView，切走不销毁，
     回来零加载。
   - 题目：点开一道题生成一个独立视图，Ctrl+Tab 切换；超出上限淘汰最久未用的。
   - 站外链接一律交给系统浏览器。 */
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView, shell } = require("electron");
const { PRELOAD, SKIN_DIR } = require("./paths");
const { TITLE_H, RAIL_W, TOOLBAR_H } = require("./window");

const LUOGU_HOSTS = new Set(["www.luogu.com.cn", "luogu.com.cn", "luogu.org", "www.luogu.org"]);
const MAX_PROBLEMS = 8;

const SECTIONS = {
  problems: { title: "题库", url: "https://www.luogu.com.cn/problem/list" },
  training: { title: "训练", url: "https://www.luogu.com.cn/training/list" },
  contest: { title: "比赛", url: "https://www.luogu.com.cn/contest/list" },
  discuss: { title: "讨论", url: "https://www.luogu.com.cn/discuss/latest" },
  record: { title: "记录", url: "https://www.luogu.com.cn/record/list" },
};
const SECTION_ORDER = ["problems", "training", "contest", "discuss", "record"];
const LOGIN_URL = "https://www.luogu.com.cn/auth/login";

function isLuoguUrl(raw) {
  try {
    return LUOGU_HOSTS.has(new URL(raw).hostname);
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

class ViewManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.entries = new Map();
    this.currentKey = null;
    this.ideOn = false;
    this.overlayOpen = false;
    this.skinSource = "";
    this.skinMtime = 0;
    this.clock = 0;
  }

  setWindow(win) {
    this.win = win;
  }

  /* ---------- 入口 ---------- */

  openSection(kind) {
    const def = SECTIONS[kind];
    if (!def) return;
    const entry = this.ensureEntry({
      key: "section:" + kind,
      kind: "section",
      title: def.title,
      url: def.url,
    });
    this.showEntry(entry);
  }

  openProblem(rawPid) {
    const pid = String(rawPid || "").toUpperCase();
    if (!/^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid)) return;
    const entry = this.ensureEntry({
      key: "problem:" + pid,
      kind: "problem",
      title: pid,
      url: "https://www.luogu.com.cn/problem/" + pid,
      pid,
    });
    this.evictProblems(entry.key);
    this.ideOn = false;
    this.showEntry(entry);
  }

  openLogin() {
    const entry = this.ensureEntry({ key: "login", kind: "login", title: "登录洛谷", url: LOGIN_URL });
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
    });
    this.showEntry(entry);
  }

  showHome() {
    this.currentKey = null;
    this.ideOn = false;
    this.hideAll();
    this.emit();
  }

  back() {
    const wc = this.currentWebContents();
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward() {
    const wc = this.currentWebContents();
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload() {
    const wc = this.currentWebContents();
    if (wc) wc.reload();
  }

  openExternal() {
    const entry = this.currentEntry();
    if (entry) shell.openExternal(entry.view.webContents.getURL());
  }

  navigate(pathname) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.view.webContents.loadURL("https://www.luogu.com.cn" + pathname);
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
    const entry = this.entries.get(key);
    if (!entry) return;
    this.ideOn = false;
    this.showEntry(entry);
  }

  listOpen() {
    const out = [];
    for (const kind of SECTION_ORDER) {
      const entry = this.entries.get("section:" + kind);
      if (entry) out.push({ key: entry.key, kind: entry.kind, title: entry.title });
    }
    const others = [...this.entries.values()]
      .filter((e) => e.kind === "problem" || e.kind === "profile")
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of others) out.push({ key: entry.key, kind: entry.kind, title: entry.title, pid: entry.pid });
    return out;
  }

  currentInfo() {
    const entry = this.currentEntry();
    if (!entry) {
      return {
        home: true,
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
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      url: wc.getURL(),
      canBack,
      canForward,
      isProblem: entry.kind === "problem",
      pid: entry.pid || pidFromUrl(wc.getURL()),
      ide: this.ideOn,
      layout: { titleH: TITLE_H, railW: RAIL_W, toolbarH: TOOLBAR_H },
    };
  }

  /* ---------- 视图生命周期 ---------- */

  ensureEntry({ key, kind, title, url, pid }) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = ++this.clock;
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
        additionalArguments: ["--lg-boot-bg=" + encodeURIComponent(t.colors.bg)],
      },
    });
    view.setBackgroundColor(t.colors.bg);

    const entry = { key, kind, title, pid: pid || "", view, lastUsed: ++this.clock, skinKey: null, attached: false };
    this.entries.set(key, entry);
    this.wire(entry);
    view.webContents.loadURL(url);
    return entry;
  }

  wire(entry) {
    const wc = entry.view.webContents;

    wc.on("page-title-updated", (_event, title) => {
      const cleaned = cleanTitle(title);
      if (cleaned) entry.title = cleaned;
      this.emit();
    });

    const onNavigate = (_event, url) => {
      const pid = pidFromUrl(url);
      if (pid && entry.kind === "problem") entry.pid = pid;
      if (pid && entry.kind === "section") {
        // 板块页里通过站内链接进了题目页：仍然更新标题即可，不强制拆视图
        entry.title = pid;
      }
      this.emit();
      this.ctx.onNavigate && this.ctx.onNavigate(url);
    };
    wc.on("did-navigate", onNavigate);
    wc.on("did-navigate-in-page", onNavigate);

    wc.on("dom-ready", () => {
      this.injectSkin(entry);
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
    });

    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
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
        wc.loadURL(url);
      } else {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      if (url.startsWith("devtools://")) return;
      if (!isLuoguUrl(url)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
  }

  showEntry(entry) {
    if (!this.win || this.win.isDestroyed()) return;
    this.currentKey = entry.key;
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
    entry.view.webContents.focus();
    this.emit();
  }

  hideAll() {
    for (const entry of this.entries.values()) entry.view.setVisible(false);
  }

  restoreCurrent() {
    const entry = this.currentEntry();
    if (!entry || !this.win || this.win.isDestroyed()) return;
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    this.layout();
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
    if (!entry || this.overlayOpen) return;
    const bounds = this.win.getContentBounds();
    const x = RAIL_W;
    const y = TITLE_H + TOOLBAR_H;
    let width = Math.max(320, bounds.width - RAIL_W);
    const height = Math.max(240, bounds.height - TITLE_H - TOOLBAR_H);
    if (this.ideOn && entry.kind === "problem") {
      width = Math.max(320, Math.floor(width / 2));
    }
    entry.view.setBounds({ x, y, width, height });
  }

  evictProblems(keepKey) {
    const problems = [...this.entries.values()].filter((e) => e.kind === "problem");
    if (problems.length <= MAX_PROBLEMS) return;
    problems.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of problems) {
      if (problems.length <= MAX_PROBLEMS) break;
      if (entry.key === keepKey) continue;
      this.destroyEntry(entry);
      problems.splice(problems.indexOf(entry), 1);
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
    for (const entry of this.entries.values()) {
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
      this.injectSkin(entry);
    }
    this.layout();
  }

  /* ---------- 统一皮肤 ---------- */

  skinCss() {
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
    const c = this.ctx.theme.colors;
    const vars = [
      `--lg-bg:${c.bg}`,
      `--lg-rail:${c.rail}`,
      `--lg-surface:${c.surface}`,
      `--lg-surface-2:${c.surface2}`,
      `--lg-border:${c.border}`,
      `--lg-text:${c.text}`,
      `--lg-text-2:${c.text2}`,
      `--lg-text-3:${c.text3}`,
      `--lg-accent:${c.accent}`,
      `--lg-accent-soft:${c.accentSoft}`,
      `--lg-green:${c.green}`,
      `--lg-red:${c.red}`,
      `--lg-orange:${c.orange}`,
      `--lg-material:${this.ctx.cfg.get().appearance.material}`,
    ].join(";");
    return `:root{${vars}}\n` + this.skinSource;
  }

  injectSkin(entry) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    const css = this.skinCss();
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

module.exports = { ViewManager, SECTIONS, isLuoguUrl, pidFromUrl, cleanTitle };
