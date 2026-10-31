/* 页面视图管理：原生列表 + 网页详情。
   - 原生列表（题库/训练/比赛/记录/讨论/文章）不创建 WebContentsView，由渲染层直接画；
   - 网页页面（聊天/通知、题面、文章详情等）各自一个 WebContentsView；
   - 题目多开（LRU 上限 8），详情页上限 10；
   - 站外链接一律交给系统浏览器。
   玻璃化：页面内注入一个与窗口同坐标的壁纸复刻层，卡片/输入框按材质半透明。 */
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView, screen, Menu, clipboard } = require("electron");
const { PRELOAD, SKIN_DIR, RENDERER } = require("./paths");
const { TITLE_H, RAIL_W, RAIL_COLLAPSED_W, TOOLBAR_H } = require("./window");
const { safeOpenExternal } = require("./external");
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

function isOfflineUrl(raw) {
  return String(raw || "").startsWith("lgoff://");
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s*-\s*洛谷\s*$/, "")
    .trim();
}

function pidFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "lgoff:") {
      const m = url.pathname.match(/^\/(?:problem\/)?([A-Za-z]{1,4}\d+[A-Za-z0-9]*)\/?$/);
      return m ? m[1].toUpperCase() : "";
    }
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
    this.closedStack = [];
    this.ideOn = false;
    this.ideSplit = 0.5;
    this.overlayOpen = false;
    this.railPinned = !!(ctx.cfg && ctx.cfg.get().rail && ctx.cfg.get().rail.pinned);
    this.railOverlay = null;
    this.railOverlayAttached = false;
    this.railHoverOpen = false;
    this.railHideTimer = null;
    this.skinSource = "";
    this.skinMtime = 0;
    this.clock = 0;
    this.skinTimer = null;
    this.skinSeq = 0;
  }

  setWindow(win) {
    this.win = win;
  }

  /* ---------- 侧栏折叠 / 悬停浮层 ----------
     折叠时页面 view 从 56px 开始；悬停展开的 208px 侧栏画在独立的
     WebContentsView 里，盖在页面 view 之上，不改变页面宽度、不触发回流。
     点钉子后进入常驻展开：view 才真正让到 208px。 */

  railWidth() {
    return this.railPinned ? RAIL_W : RAIL_COLLAPSED_W;
  }

  railWebContents() {
    if (!this.railOverlay || this.railOverlay.webContents.isDestroyed()) return null;
    return this.railOverlay.webContents;
  }

  ensureRailOverlay() {
    if (this.railOverlay && !this.railOverlay.webContents.isDestroyed()) return this.railOverlay;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD, "rail.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        // 浮层只在悬停时出现，隐藏时也不能被节流，否则第一次悬停会慢半拍
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    // 浮层是纯本地页（持有 lgRail 特权桥），永不导航；拖入链接/文件一律拒绝
    view.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    view.webContents.loadFile(path.join(RENDERER, "rail", "index.html")).catch((err) => {
      console.error("[rail] load failed:", err.message);
    });
    this.railOverlay = view;
    return view;
  }

  layoutRailOverlay() {
    if (!this.railOverlay || this.railOverlay.webContents.isDestroyed()) return;
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getContentBounds();
    this.railOverlay.setBounds({
      x: 0,
      y: TITLE_H,
      width: Math.max(RAIL_COLLAPSED_W, Math.min(RAIL_W, this.railDrawerW || RAIL_W)),
      height: Math.max(0, bounds.height - TITLE_H),
    });
  }

  setRailHover(open, focus = "", force = false) {
    if (open) {
      if (this.railPinned || !this.win || this.win.isDestroyed()) return;
      clearTimeout(this.railHideTimer);
      this.railHideTimer = null;
      this.railSeq = (this.railSeq || 0) + 1; // 作废还在等待淡出的 hide
      this.railHoverOpen = true;
      const view = this.ensureRailOverlay();
      const wc = view.webContents;
      const reveal = () => {
        if (!this.railHoverOpen || this.railPinned || wc.isDestroyed()) return;
        if (!this.win || this.win.isDestroyed()) return;
        // 每次都重新挂到最上层：之后新建的页面 view 不能盖住浮层
        if (this.railOverlayAttached) this.win.contentView.removeChildView(view);
        this.win.contentView.addChildView(view);
        this.railOverlayAttached = true;
        // 抽屉从当前宽度起步（首次 56，折返悬停从半开宽度反向），再滑向 208
        this.railDrawerW = Math.min(RAIL_W, Math.max(RAIL_COLLAPSED_W, this.railDrawerW || RAIL_COLLAPSED_W));
        this.layoutRailOverlay();
        view.setVisible(true);
        // 内容快速淡入（几何由主进程宽度补间驱动）
        wc.executeJavaScript("document.documentElement.classList.add('rail-revealed')", true).catch(() => {});
        this.animateRailDrawer(true);
        if (this.ctx.broadcastState) this.ctx.broadcastState();
        if (focus) wc.send("rail:focus", focus);
      };
      if (wc.isLoadingMainFrame()) wc.once("dom-ready", reveal);
      else reveal();
      return;
    }
    if (!this.railHoverOpen) return;
    // 鼠标从外壳窄条移进浮层时，外壳会先收到 mouseleave。用真实光标位置
    // 判断它是否仍在 208px 的浮层区域内，避免第二/第三次悬停被误收起。
    if (!force && this.cursorInRail()) return;
    clearTimeout(this.railHideTimer);
    // 给鼠标从外壳窄条移进浮层留出交接时间
    this.railHideTimer = setTimeout(() => this.hideRailOverlay(), 220);
  }

  cursorInRail() {
    if (!this.win || this.win.isDestroyed()) return false;
    try {
      const point = screen.getCursorScreenPoint();
      const b = this.win.getContentBounds();
      return (
        point.x >= b.x &&
        point.x < b.x + RAIL_W &&
        point.y >= b.y + TITLE_H &&
        point.y < b.y + b.height
      );
    } catch {
      return false;
    }
  }

  hideRailOverlay() {
    clearTimeout(this.railHideTimer);
    this.railHideTimer = null;
    this.railHoverOpen = false;
    if (!this.railOverlay || this.railOverlay.webContents.isDestroyed()) return;
    const hadFocus = this.railOverlay.webContents.isFocused();
    const view = this.railOverlay;
    const seq = (this.railSeq = (this.railSeq || 0) + 1);
    const wc = view.webContents;
    try {
      // 内容先快速淡出(90ms)；几何由宽度补间收回，补间完成才把视图藏起 ——
      // 开/关时序对称，替换掉 executeJavaScript 往返+固定 130ms 的腰斩链路
      wc.executeJavaScript("document.documentElement.classList.remove('rail-revealed')", true).catch(() => {});
    } catch {
      // 页面可能还没加载好，直接收
    }
    this.animateRailDrawer(false, () => {
      if (seq !== this.railSeq || view.webContents.isDestroyed()) return;
      view.setVisible(false);
      if (hadFocus && this.win && !this.win.isDestroyed() && this.win.isFocused()) this.win.webContents.focus();
    });
  }

  /* 0.7.2 抽屉化：打开 56→208 / 关闭 208→56 的宽度补间。
     token 作废旧补间——折返悬停从当前宽度反向，动画天然连续；
     性能模式瞬切。关闭在补间完成后才 setVisible(false)，与打开对称。 */
  animateRailDrawer(open, onDone) {
    const view = this.railOverlay;
    if (!view || view.webContents.isDestroyed()) return;
    if (this.ctx.cfg && this.ctx.cfg.get().general.performanceMode) {
      this.railDrawerW = open ? RAIL_W : RAIL_COLLAPSED_W;
      this.layoutRailOverlay();
      if (!open) {
        view.setVisible(false);
        if (onDone) onDone();
      }
      return;
    }
    const token = (this.railDrawerToken = (this.railDrawerToken || 0) + 1);
    const from = Math.min(RAIL_W, Math.max(RAIL_COLLAPSED_W, this.railDrawerW || (open ? RAIL_COLLAPSED_W : RAIL_W)));
    const to = open ? RAIL_W : RAIL_COLLAPSED_W;
    const dur = open ? 170 : 150;
    const start = Date.now();
    const easeOut = (t) => 1 - (1 - t) * (1 - t);
    const step = () => {
      if (token !== this.railDrawerToken || view.webContents.isDestroyed()) return;
      const t = Math.min(1, (Date.now() - start) / dur);
      this.railDrawerW = Math.round(from + (to - from) * easeOut(t));
      this.layoutRailOverlay();
      if (t < 1) {
        this.railDrawerTimer = setTimeout(step, 16);
      } else {
        this.railDrawerTimer = null;
        if (!open && onDone) onDone();
      }
    };
    step();
  }

  /* 0.7.2 钉住/取消钉住：外壳 grid（CSS 过渡）与页面 view（主进程补间）
     同步 180ms 滑动；layout()/resize 作废补间并直接落定。 */
  animateRailLayout(fromW, toW) {
    const entry = this.currentEntry();
    if (!entry) return;
    const view = entry.view;
    const bounds = this.win.getContentBounds();
    const y = TITLE_H + TOOLBAR_H;
    const height = Math.max(240, bounds.height - TITLE_H - TOOLBAR_H);
    const ideOn = this.ideOn && entry.kind === "problem";
    const token = (this.railLayoutToken = (this.railLayoutToken || 0) + 1);
    const start = Date.now();
    const dur = 180;
    const easeOut = (t) => 1 - (1 - t) * (1 - t);
    const step = () => {
      if (token !== this.railLayoutToken) return;
      if (!this.win || this.win.isDestroyed() || view.webContents.isDestroyed()) return;
      const t = Math.min(1, (Date.now() - start) / dur);
      const w = Math.round(fromW + (toW - fromW) * easeOut(t));
      let width = Math.max(320, bounds.width - w);
      if (ideOn) width = Math.max(320, Math.floor(width * (1 - this.ideSplit)));
      view.setBounds({ x: w, y, width, height });
      if (t < 1) {
        setTimeout(step, 12);
      } else {
        this.layout();
      }
    };
    step();
  }

  setRailPinned(pinned) {
    const next = !!pinned;
    const prevW = this.railWidth();
    if (this.ctx.cfg) this.ctx.cfg.setRail({ pinned: next });
    this.railPinned = next;
    if (next) this.hideRailOverlay();
    const entry = this.currentEntry();
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    if (entry && !this.overlayOpen && !this.library && !perf) {
      this.animateRailLayout(prevW, this.railWidth());
    } else {
      this.layout();
    }
    this.emit();
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
    this.hideRailOverlay();
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
    this.ideOn = false;
    this.showEntry(entry);
  }

  openDetail(rawUrl, title, key) {
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
    else safeOpenExternal(url);
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
    // 复用登录页时页面可能已经跳走（上次登录成功重定向回首页）：
    // 不在登录页就重新加载，否则用户看到的是旧页面、登录按钮像坏了
    try {
      const current = entry.view.webContents.getURL();
      if (current && !current.includes("auth/login")) {
        entry.view.webContents.loadURL("https://www.luogu.com.cn/auth/login").catch(() => {});
      }
    } catch {
      /* ignore */
    }
    this.showEntry(entry);
  }

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
    });
    this.library = null;
    this.showEntry(entry);
  }

  showHome() {
    this.hideRailOverlay();
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
  }

  openExternal() {
    const entry = this.currentEntry();
    if (entry) safeOpenExternal(entry.view.webContents.getURL());
  }

  navigate(pathname) {
    const url = String(pathname || "").startsWith("http")
      ? String(pathname)
      : "https://www.luogu.com.cn" + pathname;
    const entry = this.currentEntry();
    if (entry) entry.view.webContents.loadURL(url);
    else this.openDetail(url, "");
  }

  /* 页面内提交辅助：打开题目页提交区并把代码填进洛谷的 CodeMirror 编辑器，
     用户只需在页面里完成验证码（易盾滑块）后点“提交评测”。
     导航用页内 location.href/location.hash（loadURL 全量加载会丢 #submit 哈希，
     SPA 停在阅读模式渲染不出编辑器）。 */
  async openSubmitAssist(pid, code) {
    const pageUrl = `https://www.luogu.com.cn/problem/${encodeURIComponent(pid)}`;
    let entry = this.currentEntry();
    if (entry) {
      try {
        await entry.view.webContents.executeJavaScript(
          `(async () => { location.href = ${JSON.stringify(pageUrl + "#submit")}; })()`
        );
      } catch (e) {
        console.log("[luogu] 提交辅助导航失败 " + String(e).slice(0, 120));
        return false;
      }
    } else {
      this.openDetail(pageUrl, `${pid} 提交`);
      entry = this.currentEntry();
      if (!entry) return false;
    }
    const wc = entry.view.webContents;
    for (let i = 0; i < 30 && wc.isLoading(); i++) await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 600));
    try {
      await wc.executeJavaScript(`(() => { if (location.hash !== "#submit") location.hash = "submit"; return location.href.slice(0, 90); })()`);
    } catch {
      /* 页面还在加载也没关系，下面轮询会等 */
    }
    await new Promise((r) => setTimeout(r, 500));
    // 提交区是 SPA 懒渲染的，轮询等编辑器出现
    let lastProbe = null;
    for (let i = 0; i < 16; i++) {
      try {
        lastProbe = await wc.executeJavaScript(
          `(() => {
            const eds = [...document.querySelectorAll("[contenteditable=true]")];
            return { href: location.href.slice(0, 90), n: eds.length, vis: eds.filter((e) => e.offsetParent).length, ready: document.readyState };
          })()`
        );
        if (lastProbe.vis > 0) {
          await wc.executeJavaScript(
            `(() => {
              const ed = [...document.querySelectorAll("[contenteditable=true]")].find((t) => t.offsetParent);
              if (ed && !window.__lgAssistFilled) {
                ed.focus();
                document.execCommand("selectAll", false, null);
                document.execCommand("insertText", false, ${JSON.stringify(String(code || ""))});
                window.__lgAssistFilled = true;
              }
              return true;
            })()`
          );
          return true;
        }
      } catch (e) {
        console.log("[luogu] 提交辅助执行失败 " + String(e).slice(0, 120));
        return false;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("[luogu] 提交辅助未找到编辑器 " + JSON.stringify(lastProbe));
    return false;
  }

  /* 题面快照：题目页导航停稳后延迟抓取已渲染 DOM（洛谷自己渲染的公式/代码高亮原样保留）。
     SPA 水合慢于首次 paint，抓到空壳时再等一轮；#submit 提交区和离线页不抓。 */
  scheduleProblemCapture(entry, url) {
    if (!entry || entry.kind !== "problem") return;
    if (entry.captureTimer) clearTimeout(entry.captureTimer);
    if (!url || url.includes("#") || isOfflineUrl(url)) return;
    const luogu = this.ctx.luogu;
    if (!luogu || luogu.online === false) return;
    entry.captureTimer = setTimeout(() => {
      entry.captureTimer = null;
      this.captureProblem(entry, 0).catch(() => {});
    }, 4500);
  }

  async captureProblem(entry, round) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed() || round > 4) return;
    const url = wc.getURL();
    const pid = entry.pid || pidFromUrl(url);
    if (!pid || url.includes("#") || isOfflineUrl(url)) return;
    if (this.ctx.luogu && this.ctx.luogu.online === false) return;
    let probe = null;
    try {
      probe = await wc.executeJavaScript(`(() => {
        const pick =
          document.querySelector(".main-container") ||
          document.querySelector("main") ||
          document.querySelector("#app") ||
          document.body;
        if (!pick) return { ok: false, reason: "no-dom" };
        const text = (pick.textContent || "").replace(/\\s+/g, " ").trim();
        if (text.length < 200) return { ok: false, reason: "thin", len: text.length };
        // 站点 SPA 水合前会把 markdown 源文本直接放在 DOM 里；抓到这种状态就继续等，
        // 否则离线快照会显示满屏 ** 和 $。正文类不存在也说明还没水合。
        const marked = pick.querySelector(".lfe-marked");
        if (!marked) return { ok: false, reason: "no-marked" };
        const markedText = (marked.textContent || "").slice(0, 8000);
        if (markedText.replace(/\\s+/g, " ").trim().length < 120) {
          return { ok: false, reason: "thin-marked" };
        }
        if (/\\*\\*[^*\\n]{1,120}\\*\\*/.test(markedText) && !marked.querySelector("strong, em, .katex")) {
          return { ok: false, reason: "raw-markdown" };
        }
        const clone = pick.cloneNode(true);
        clone.querySelectorAll("script, noscript, iframe, #lg-boot").forEach((node) => node.remove());
        // 深度防御：剥 on* 事件属性、javascript: 等危险 URL 属性（离线页 CSP 之外的第二道闸）
        for (const node of [clone, ...clone.querySelectorAll("*")]) {
          for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const isUrlAttr = name === "href" || name === "src" || name === "formaction" || name === "action" || name === "xlink:href";
            const isSafeData = name === "src" && /^data:(image|font)\//i.test(attr.value);
            if (name.startsWith("on") || (isUrlAttr && !isSafeData && /^\s*(javascript|data|vbscript):/i.test(attr.value))) {
              node.removeAttribute(attr.name);
            }
          }
        }
        const html = clone.innerHTML;
        if (html.length < 200) return { ok: false, reason: "thin-html" };
        return {
          ok: true,
          title: (document.title || "").split(" - 洛谷")[0],
          html: html.length > 600000 ? html.slice(0, 600000) : html,
        };
      })()`);
    } catch (err) {
      console.log("[views] 快照抓取失败 " + String(err && err.message).slice(0, 100));
      // 导航竞态等瞬时错误也给一次机会（round 上限复用，防循环）
      setTimeout(() => this.captureProblem(entry, round + 1).catch(() => {}), 2500);
      return;
    }
    if (probe && probe.ok && this.ctx.luogu) {
      this.ctx.luogu.saveProblemSnapshot(pid, probe.title, probe.html);
      return;
    }
    // 页面还在水合：5 秒后重试
    if (
      probe &&
      (probe.reason === "thin" ||
        probe.reason === "thin-html" ||
        probe.reason === "no-dom" ||
        probe.reason === "no-marked" ||
        probe.reason === "thin-marked" ||
        probe.reason === "raw-markdown")
    ) {
      setTimeout(() => this.captureProblem(entry, round + 1).catch(() => {}), 5000);
    }
  }

  setIde(on) {
    const entry = this.currentEntry();
    if (!entry || entry.kind !== "problem") return;
    this.ideOn = !!on;
    this.layout();
    this.emit();
  }

  setIdeSplit(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return;
    this.ideSplit = Math.min(0.7, Math.max(0.35, ratio));
    if (this.ideOn) this.layout();
  }

  setOverlay(open) {
    this.overlayOpen = !!open;
    if (this.overlayOpen) {
      this.hideRailOverlay();
      this.hideAll();
    } else this.restoreCurrent();
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
    const canReopen = this.closedStack.length > 0;
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
        canReopen,
        isProblem: false,
        pid: "",
        ide: false,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
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
        canReopen,
        isProblem: false,
        pid: "",
        ide: false,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
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
      canReopen,
      isProblem: entry.kind === "problem",
      pid: entry.pid || pidFromUrl(wc.getURL()),
      ide: this.ideOn,
      layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
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
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
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
          "--lg-view-x=" + this.railWidth(),
          "--lg-view-y=" + (TITLE_H + TOOLBAR_H),
          "--lg-motion=" + (!perf && this.ctx.cfg.get().appearance.wallpaperMotion ? "1" : "0"),
          "--lg-zoom=" + (!perf && this.ctx.cfg.get().appearance.wallpaperZoom ? "1" : "0"),
          "--lg-adblock=" + (this.ctx.cfg.get().general.adBlock ? "1" : "0"),
          "--lg-boot-mode=" + (t.isDark ? "dark" : "light"),
          // 首帧就给链接正确的主题色,否则皮肤变量落地前链接是官方灰、再扫成主题色
          "--lg-boot-accent=" + encodeURIComponent(t.colors.accentText + "," + t.colors.accent),
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
      skinPending: false,
      skinMtime: 0,
      varsKey: null,
      varsSig: "",
      varsPending: false,
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
        // 真实页提交后把守卫用的 about:blank 从历史里摘掉：否则第一次
        // 「后退」会退到空白页而不是应用内的来源列表
        wc.once("did-navigate", () => {
          try {
            const history = wc.navigationHistory;
            const first = history.getEntryAtIndex(0);
            if (history.length() > 1 && first && first.url === "about:blank") {
              history.removeEntryAtIndex(0);
            }
          } catch {
            /* ignore */
          }
        });
        wc.loadURL(url).catch((err) => {
          // 页面还没加载完就被切走/重载时，Chromium 以 ERR_ABORTED 结束旧请求；
          // 这不是打开失败，弹出来只会吓人。
          if (/ERR_ABORTED|\(-3\)/.test(String((err && err.message) || ""))) return;
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
      if (entry.kind === "problem") this.scheduleProblemCapture(entry, url);
    };
    wc.on("did-navigate", onNavigate);
    wc.on("did-navigate-in-page", onNavigate);

    wc.on("dom-ready", () => {
      const current = wc.getURL();
      if (current === "about:blank") return;
      // 插入的 CSS 随文档销毁；新文档必须重新注入静态规则
      entry.skinKey = null;
      entry.varsKey = null;
      entry.varsSig = "";
      entry.varsPending = false;
      entry.skinMtime = 0;
      entry.skinPending = false;
      if (!wc.debugger.isAttached()) this.attachGuard(wc);
      if (!isOfflineUrl(current)) this.injectSkin(entry);
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
    });

    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url === "about:blank") return;
      // 线上题目页加载失败（断网/网络抖动）：有本地快照就切过去，别给用户一个错误页
      const pid = pidFromUrl(url) || entry.pid;
      if (entry.kind === "problem" && pid && !isOfflineUrl(url)) {
        const offlineUrl = this.ctx.luogu ? this.ctx.luogu.problemSnapshotUrl(pid) : "";
        if (offlineUrl) {
          console.log("[views] 题目加载失败，回退离线快照 " + pid);
          wc.loadURL(offlineUrl).catch(() => {});
          return;
        }
      }
      this.ctx.toast && this.ctx.toast("页面加载失败", `${description}（${code}）`);
      console.error("[views] did-fail-load", url, code, description);
    });

    wc.on("found-in-page", (_event, result) => {
      try {
        wc.send("app:find-result", { matches: result.matches, active: result.activeMatchOrdinal });
      } catch {
        /* ignore */
      }
    });

    // 加载成功即清零崩溃重载计数（「连续 3 次」语义）
    wc.on("did-finish-load", () => {
      wc.__lgReloadCount = 0;
    });

    wc.on("render-process-gone", () => {
      // 重载上限：确定性崩溃页不能无限循环；连续 3 次后停止并提示
      wc.__lgReloadCount = (wc.__lgReloadCount || 0) + 1;
      if (wc.__lgReloadCount > 3) {
        this.ctx.toast && this.ctx.toast("页面崩溃", "该页面连续崩溃，已停止自动恢复。");
        return;
      }
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload();
      }, 600);
    });

    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      const key = input.key.toLowerCase();
      let command = "";
      if (ctrl && !input.shift && key === "k") command = "palette";
      else if (ctrl && !input.shift && key === "l") command = "jump";
      else if (ctrl && input.key === "Tab") command = "switcher";
      else if (ctrl && input.shift && key === "t") command = "reopen";
      else if (ctrl && (input.key === "," || input.key === "，")) command = "settings";
      else if (input.key === "F11") command = "fullscreen";
      else if (input.key === "F12") command = "devtools";
      // 浏览器基本键：刷新 / 后退 / 前进 / 关页面（与浏览器同键位）
      else if (input.key === "F5" || (ctrl && !input.shift && key === "r")) command = "reload";
      else if (input.alt && input.key === "ArrowLeft") command = "back";
      else if (input.alt && input.key === "ArrowRight") command = "forward";
      else if (ctrl && !input.shift && key === "w") command = "closepage";
      else if (ctrl && !input.shift && key === "f") command = "find";
      else if (ctrl && !input.shift && (input.key === "=" || input.key === "+")) command = "zoomin";
      else if (ctrl && !input.shift && input.key === "-") command = "zoomout";
      else if (ctrl && !input.shift && input.key === "0") command = "zoomreset";
      if (!command) return;
      event.preventDefault();
      // 查找/缩放是页面级能力，直接操作当前页面视图，不走全局命令路由
      if (command === "find") {
        const entry = this.currentEntry();
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          entry.view.webContents.send("app:find-open");
        }
        return;
      }
      if (command === "zoomin" || command === "zoomout" || command === "zoomreset") {
        const entry = this.currentEntry();
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          const wc = entry.view.webContents;
          entry.zoom =
            command === "zoomreset" ? 0 : Math.max(-3.5, Math.min(3, (entry.zoom || 0) + (command === "zoomin" ? 0.2 : -0.2)));
          wc.setZoomLevel(entry.zoom);
          const pct = Math.round(Math.pow(1.2, entry.zoom) * 100);
          wc.send("app:zoom-hud", pct + "%");
        }
        return;
      }
      this.ctx.command && this.ctx.command(command);
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isOfflineUrl(url)) {
        const pid = pidFromUrl(url);
        if (pid) this.openProblem(pid);
      } else if (isLuoguUrl(url)) {
        this.openDetail(url, "", "detail:" + url);
      } else {
        safeOpenExternal(url);
      }
      return { action: "deny" };
    });

    /* 页面右键菜单：链接/编辑/导航/外部打开/检查 */
    wc.on("context-menu", (_event, params) => {
      const items = [];
      if (params.linkURL) {
        items.push({ label: "打开链接", click: () => this.openDetail(params.linkURL, "") });
        items.push({ label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) });
        items.push({ type: "separator" });
      }
      if (params.selectionText && params.editFlags.canCopy) items.push({ role: "copy", label: "复制" });
      if (params.isEditable) {
        if (params.editFlags.canPaste) items.push({ role: "paste", label: "粘贴" });
        if (params.editFlags.canSelectAll) items.push({ role: "selectAll", label: "全选" });
      }
      if (items.length && items[items.length - 1].type !== "separator") items.push({ type: "separator" });
      try {
        items.push({ label: "后退", enabled: wc.navigationHistory.canGoBack(), click: () => this.back() });
        items.push({ label: "前进", enabled: wc.navigationHistory.canGoForward(), click: () => this.forward() });
      } catch {
        /* ignore */
      }
      items.push({ label: "刷新", click: () => wc.reload() });
      items.push({ type: "separator" });
      items.push({
        label: "在浏览器打开此页",
        click: () => {
          try {
            safeOpenExternal(wc.getURL());
          } catch {
            /* ignore */
          }
        },
      });
      items.push({ label: "检查", click: () => this.ctx.command && this.ctx.command("devtools") });
      try {
        Menu.buildFromTemplate(items).popup({ window: this.win });
      } catch {
        /* ignore */
      }
    });

    wc.on("will-navigate", (event, url) => {
      if (url.startsWith("devtools://") || url.startsWith("about:") || isOfflineUrl(url)) return;
      if (!isLuoguUrl(url)) {
        event.preventDefault();
        safeOpenExternal(url);
      }
    });
  }

  sendMotion(entry, active) {
    if (!entry || !entry.view || entry.view.webContents.isDestroyed()) return;
    const wall = this.ctx.wallpaper || {};
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    try {
      entry.view.webContents.send("lg:motion", {
        motion: !!(active && !perf && wall.motion),
        zoom: !!(active && !perf && wall.zoom),
      });
    } catch {
      /* 页面正在销毁 */
    }
  }

  setWindowActive(active) {
    const current = this.currentEntry();
    for (const entry of this.entries.values()) this.sendMotion(entry, !!active && entry === current);
  }

  showEntry(entry) {
    if (!this.win || this.win.isDestroyed()) return;
    this.hideRailOverlay();
    this.currentKey = entry.key;
    this.library = null;
    this.overlayOpen = false;
    for (const other of this.entries.values()) {
      if (other !== entry) {
        other.view.setVisible(false);
        this.sendMotion(other, false);
      }
    }
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    entry.lastUsed = ++this.clock;
    this.layout();
    this.injectSkin(entry);
    this.sendMotion(entry, true);
    entry.view.webContents.focus();
    this.emit();
  }

  hideAll() {
    for (const entry of this.entries.values()) {
      entry.view.setVisible(false);
      this.sendMotion(entry, false);
    }
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
    this.railLayoutToken = (this.railLayoutToken || 0) + 1; // 作废钉住补间
    if (this.railHoverOpen) this.layoutRailOverlay();
    const entry = this.currentEntry();
    if (!entry || this.overlayOpen || this.library) {
      this.hideAll();
      return;
    }
    const bounds = this.win.getContentBounds();
    const railW = this.railWidth();
    const x = railW;
    const y = TITLE_H + TOOLBAR_H;
    let width = Math.max(320, bounds.width - railW);
    const height = Math.max(240, bounds.height - TITLE_H - TOOLBAR_H);
    if (this.ideOn && entry.kind === "problem") {
      width = Math.max(320, Math.floor(width * (1 - this.ideSplit)));
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
    if (entry.captureTimer) {
      clearTimeout(entry.captureTimer);
      entry.captureTimer = null;
    }
    // 关闭前抓 URL 进「最近关闭」栈（LRU 挤掉的页面也能一键找回）
    let lastUrl = "";
    try {
      lastUrl = entry.view.webContents.getURL();
    } catch {
      /* ignore */
    }
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
    if (
      entry.kind !== "login" &&
      (entry.pid || (/^https:\/\//i.test(lastUrl) && isLuoguUrl(lastUrl)))
    ) {
      this.closedStack.push({
        kind: entry.kind,
        pid: entry.pid || pidFromUrl(lastUrl) || "",
        section: entry.section || "",
        title: entry.title || "",
        url: lastUrl,
      });
      if (this.closedStack.length > 12) this.closedStack.shift();
    }
  }

  /* 恢复最近一次关闭的页面（Ctrl+Shift+T / 工具条按钮）。 */
  reopenClosed() {
    const item = this.closedStack.pop();
    if (!item) return null;
    if (item.kind === "problem" && item.pid) this.openProblem(item.pid);
    else if (item.kind === "profile") {
      const uid = Number((item.url.match(/\/user\/(\d+)/) || [])[1]);
      if (Number.isFinite(uid) && uid > 0) this.openProfile(uid);
      else this.openDetail(item.url, item.title);
    } else if (item.kind === "web" && item.section) this.openWeb(item.section);
    else this.openDetail(item.url, item.title);
    return item;
  }

  canReopen() {
    return this.closedStack.length > 0;
  }

  updateTheme() {
    if (!this.win || this.win.isDestroyed()) return;
    for (const entry of this.entries.values()) {
      entry.view.setBackgroundColor(this.ctx.theme.colors.bg);
      this.sendMotion(entry, entry === this.currentEntry());
      this.injectSkin(entry);
    }
    this.layout();
  }

  /* 广告开关：页面 CSS 由 data-lg-adblock 控制，新文档由 page preload 在
     document-start 置位；已打开的页面在这里即时切换，不需要重载。 */
  applyAdBlock() {
    const on = !!(this.ctx.cfg && this.ctx.cfg.get().general.adBlock);
    const value = on ? "1" : "0";
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      const url = wc.getURL();
      if (!url || url === "about:blank" || isOfflineUrl(url)) continue;
      wc.executeJavaScript(`document.documentElement.dataset.lgAdblock="${value}";`, true).catch(() => {});
    }
  }

  /* ---------- 统一皮肤 + 壁纸复刻 ---------- */

  skinStatic() {
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
    return this.skinSource;
  }

  skinVars(entry) {
    const t = this.ctx.theme;
    const c = t.colors;
    const wall = this.ctx.wallpaper || {};
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
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
      `--lg-border-strong:${c.borderStrong}`,
      `--lg-divider:${c.divider}`,
      `--lg-text:${c.text}`,
      `--lg-text-2:${c.text2}`,
      `--lg-text-3:${c.text3}`,
      `--lg-accent:${c.accent}`,
      `--lg-accent-text:${c.accentText}`,
      `--lg-accent-soft:${c.accentSoft}`,
      `--lg-accent-fill:${c.accentFill}`,
      `--lg-accent-hover:${c.accentHover}`,
      `--lg-accent-line:${c.accentLine}`,
      `--lg-on-accent:${c.onAccent}`,
      `--lg-hover:${c.hover}`,
      `--lg-pressed:${c.pressed}`,
      `--lg-shadow:${c.shadow}`,
      `--lg-highlight:${c.highlight}`,
      `--lg-green:${c.green}`,
      `--lg-red:${c.red}`,
      `--lg-orange:${c.orange}`,
      `--lg-material:${t.material}`,
      `--lg-panel-alpha:${t.panelAlpha}%`,
      `--lg-raise:${t.raiseAlpha}%`,
      `--lg-code-alpha:${t.codeAlpha}%`,
      `--lg-overlay-alpha:${t.overlayAlpha}%`,
      `--lg-scrim:${t.pageScrim}%`,
      `--lg-text-shadow:${t.pageScrim <= 40 ? "0 1px 2px rgba(0,0,0,.35)" : "none"}`,
      `--lg-blur:${perf ? 0 : t.blurPx}px`,
      `--lg-font-mono:"Cascadia Mono","Cascadia Code",Consolas,monospace`,
      `--lg-radius-sm:6px`,
      `--lg-radius-md:8px`,
      `--lg-radius-lg:12px`,
      `--lg-fs-xs:12px`,
      `--lg-fs-sm:13px`,
      `--lg-fs-md:14px`,
      `--lg-fs-lg:16px`,
      `--lg-fs-xl:20px`,
      `--lg-dur:120ms`,
      `--lg-ease:cubic-bezier(.2,0,0,1)`,
      /* 曾被消费却从未定义、永远走 fallback 的变量补上定义 */
      `--lg-gutter-top:20px`,
      `--lg-focus-w:2px`,
      `--lg-scrollbar-w:10px`,
      `--lg-wall-image:${backdrop}`,
      `--lg-wall-left:-${rect.x}px`,
      `--lg-wall-top:-${rect.y}px`,
      `--lg-wall-w:${winBounds.width}px`,
      `--lg-wall-h:${winBounds.height}px`,
      `--lg-color-scheme:${t.isDark ? "dark" : "light"}`,
      `--lg-motion:${!perf && wall.motion ? 1 : 0}`,
      `--lg-zoom-on:${!perf && wall.zoom ? 1 : 0}`,
      `--lg-perf:${perf ? 1 : 0}`,
    ].join(";");
    return `:root{${vars}}`;
  }

  injectSkin(entry) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    // 离线快照页有自己的排版与主题，不套洛谷皮肤变量
    if (isOfflineUrl(wc.getURL())) return;
    let vars = "";
    try {
      vars = this.skinVars(entry);
    } catch {
      return;
    }
    if (!vars.trim()) return;
    let source = "";
    try {
      source = this.skinStatic();
    } catch {
      source = "";
    }
    try {
      // 静态规则只在首次或文件变更时注入；主题/材质变化只替换变量表。
      if (source.trim() && !entry.skinPending && (!entry.skinKey || entry.skinMtime !== this.skinMtime)) {
        entry.skinPending = true;
        const oldKey = entry.skinKey;
        entry.skinKey = null;
        if (oldKey) wc.removeInsertedCSS(oldKey).catch(() => {});
        wc.insertCSS(source)
          .then((key) => {
            entry.skinPending = false;
            entry.skinKey = key;
            entry.skinMtime = this.skinMtime;
          })
          .catch(() => {
            entry.skinPending = false;
          });
      }
      if (entry.varsPending) {
        if (process.env.LG_SKIN_DEBUG) console.log("[skin] varsPending blocked, url=" + wc.getURL());
        return;
      }
      if (entry.varsKey && entry.varsSig === vars) return;
      const seq = ++this.skinSeq;
      entry.varsPending = true;
      const oldVars = entry.varsKey;
      entry.varsKey = null;
      if (oldVars) wc.removeInsertedCSS(oldVars).catch(() => {});
      // 皮肤里的主题条件规则(代码高亮等)挂在 html[data-lg-mode] 上,
      // 变量换套时同步刷新;新文档由 page preload 按 --lg-boot-mode 在 document-start 置位。
      wc.executeJavaScript(
        `document.documentElement.dataset.lgMode=${JSON.stringify(this.ctx.theme.isDark ? "dark" : "light")};`,
        true
      ).catch(() => {});
      if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars start #" + seq + " url=" + wc.getURL());
      wc.insertCSS(vars)
        .then((key) => {
          entry.varsKey = key;
          entry.varsSig = vars;
          if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars ok #" + seq + " url=" + wc.getURL());
        })
        .catch((err) => {
          if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars REJECT #" + seq + " " + err.message);
        })
        .finally(() => {
          entry.varsPending = false;
        });
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
