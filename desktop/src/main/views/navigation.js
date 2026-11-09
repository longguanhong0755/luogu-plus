/* 入口导航：侧栏板块、网页页、题目、详情、登录、个人主页与前进/后退。 */
const { safeOpenExternal } = require("../external");
const { NAV, LIBRARY_IDS, WEB_URLS, FALLBACK_URLS, canonicalPid } = require("../sections");
const {
  MAX_PROBLEMS,
  MAX_DETAILS,
  MAX_TOTAL_ENTRIES,
  isLuoguUrl,
  isOfflineUrl,
  pidFromUrl,
  sectionOfUrl,
} = require("./util");

module.exports = {
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
  },

  showLibrary(kind) {
    if (!LIBRARY_IDS.has(kind)) return;
    this.library = kind;
    this.returnLib = null;
    this.currentKey = null;
    this.ideOn = false;
    this.overlayOpen = false;
    this.hideAll();
    this.emit();
  },

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
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.showEntry(entry);
  },

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
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.showEntry(entry);
  },

  openProblem(rawPid) {
    const pid = canonicalPid(rawPid);
    if (!pid) return;
    if (this.library) this.returnLib = this.library;
    this.library = null;
    const luogu = this.ctx.luogu;
    const onlineUrl = "https://www.luogu.com.cn/problem/" + pid;
    // 断网时一律开本地 lgoff 页：有快照出题面，没快照出「离线无缓存」提示页（不再是空白+报错）
    const offline = !!(luogu && luogu.online === false);
    const offlineUrl = offline ? "lgoff://problem/" + encodeURIComponent(pid) : "";
    const entry = this.ensureEntry({
      key: "problem:" + pid,
      kind: "problem",
      title: pid,
      url: offlineUrl || onlineUrl,
      pid,
      section: "problems",
    });
    // 已存在的条目不强制重载（页面里可能有正在编辑的提交代码）；
    // 只在「网络状态和当前页面不一致」时切换：离线→线上页切快照，恢复在线→快照切回线上页。
    const current = entry.view.webContents.getURL();
    if (offline && current.startsWith("https://") && !current.includes("#")) {
      entry.view.webContents.loadURL(offlineUrl).catch(() => {});
    } else if (!offline && isOfflineUrl(current)) {
      entry.view.webContents.loadURL(onlineUrl).catch(() => {});
    }
    this.evictKind("problem", MAX_PROBLEMS, entry.key);
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.ideOn = false;
    this.showEntry(entry);
  },

  openDetail(rawUrl, title, key, railId) {
    let url = String(rawUrl || "");
    if (!url) return;
    if (isOfflineUrl(url)) {
      const pid = pidFromUrl(url);
      if (pid) this.openProblem(pid);
      return;
    }
    if (url.startsWith("/")) url = "https://www.luogu.com.cn" + url;
    if (!isLuoguUrl(url)) {
      safeOpenExternal(url);
      return;
    }
    const pid = pidFromUrl(url);
    if (pid) {
      this.openProblem(pid);
      return;
    }
    // 从列表点进详情/比赛/讨论/文章：记住来路，back 能回列表
    if (this.library) this.returnLib = this.library;
    const entry = this.ensureEntry({
      key: key || "detail:" + url,
      kind: "detail",
      title: title || "",
      url,
      section: sectionOfUrl(url),
      railId,
    });
    entry.requestedUrl = url;
    // 新 entry 的 about:blank -> dom-ready -> 首次 loadURL 由 ensureEntry 独占。
    // 这里再次 loadURL 会与 training/117 的 302 自跳转竞态，导致偶发空壳。
    if (entry.booted && entry.view.webContents.getURL() !== url) {
      entry.view.webContents.loadURL(url).catch(() => {});
    }
    this.evictKind("detail", MAX_DETAILS, entry.key);
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.library = null;
    this.showEntry(entry);
  },

  openCustom(url, label, id) {
    if (!/^https?:\/\//i.test(String(url || ""))) return;
    if (isLuoguUrl(url)) this.openDetail(url, label || "自定义页面", "", String(id || ""));
    else safeOpenExternal(url);
  },

  openLogin() {
    this.library = null;
    this.returnLib = null;
    const entry = this.ensureEntry({
      key: "login",
      kind: "login",
      title: "登录洛谷",
      url: "https://www.luogu.com.cn/auth/login",
      section: "home",
      railId: "",
    });
    // 复用登录页时页面可能已经跳走（上次登录成功重定向回首页）：
    // 不在登录页就重新加载，否则用户看到的是旧页面、登录按钮像坏了
    try {
      const current = entry.view.webContents.getURL();
      if (current && current !== "about:blank" && !current.includes("auth/login")) {
        entry.view.webContents.loadURL("https://www.luogu.com.cn/auth/login").catch(() => {});
      }
    } catch {
      /* ignore */
    }
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.showEntry(entry);
  },

  openProfile(uid) {
    const id = Number(uid);
    if (!Number.isFinite(id) || id <= 0) {
      this.openLogin();
      return;
    }
    if (this.library) this.returnLib = this.library;
    const entry = this.ensureEntry({
      key: "profile:" + id,
      kind: "profile",
      title: "个人主页",
      url: "https://www.luogu.com.cn/user/" + id,
      section: "home",
      railId: "",
    });
    this.library = null;
    this.showEntry(entry);
  },

  showHome() {
    this.currentKey = null;
    this.library = null;
    this.returnLib = null;
    this.ideOn = false;
    this.hideAll();
    this.emit();
  },

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
  },

  forward() {
    const wc = this.currentWebContents();
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  },

  reload() {
    const entry = this.currentEntry();
    if (entry) {
      entry.view.webContents.reload();
    } else if (this.library) {
      this.emit();
    }
  },

  /* 关闭当前页面：页本身销毁（进最近关闭栈，可 Ctrl+Shift+T 找回），
     有来源列表回列表，否则回主页。不会像浏览器关标签那样退出应用。 */
  closePage() {
    const entry = this.currentEntry();
    if (!entry) {
      this.showHome();
      return;
    }
    const from = this.returnLib;
    this.destroyEntry(entry);
    if (from) {
      this.returnLib = null;
      this.showLibrary(from);
    } else {
      this.showHome();
    }
  },

  openExternal() {
    const entry = this.currentEntry();
    if (entry) safeOpenExternal(entry.view.webContents.getURL());
  },

  navigate(pathname) {
    const url = String(pathname || "").startsWith("http")
      ? String(pathname)
      : "https://www.luogu.com.cn" + pathname;
    const entry = this.currentEntry();
    if (entry) entry.view.webContents.loadURL(url);
    else this.openDetail(url, "");
  },
};
