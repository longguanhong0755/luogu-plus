/* 页面视图管理：原生列表 + 网页详情。
   - 原生列表（题库/训练/比赛/记录/讨论/文章）不创建 WebContentsView，由渲染层直接画；
   - 网页页面（聊天/通知、题面、文章详情等）各自一个 WebContentsView；
   - 题目多开（LRU 上限 8），详情页上限 10；
   - 站外链接一律交给系统浏览器。
   玻璃化：页面内注入一个与窗口同坐标的壁纸复刻层，卡片/输入框按材质半透明。 */
const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView, nativeTheme, Menu, clipboard } = require("electron");
const { PRELOAD, SKIN_DIR } = require("./paths");
const { TITLE_H, RAIL_W, RAIL_COLLAPSED_W, TOOLBAR_H } = require("./window");
const { safeOpenExternal } = require("./external");
const { NAV, LIBRARY_IDS, WEB_URLS, FALLBACK_URLS } = require("./sections");
const { canonicalPid } = require("./sections");
const { PageReadinessController } = require("./page-readiness");
const { attachToWebContents: attachPasskeyGuard, injectIntoCurrentDocument: injectPasskeyGuard } = require("./passkey-guard");

const MAX_PROBLEMS = 2;
const MAX_DETAILS = 3;
const MAX_TOTAL_ENTRIES = 4;
const IDE_VERTICAL_BREAKPOINT = 720;
const IDLE_VIEW_MS = Math.max(5000, Number(process.env.LG_VIEW_IDLE_MS) || 90000);

function acceleratorMatches(input, accelerator) {
  const parts = String(accelerator || "").split("+");
  const key = String(parts.pop() || "").toLowerCase();
  const has = (name) => parts.some((part) => part.toLowerCase() === name);
  const ctrl = !!(input.control || input.meta);
  return (
    key === String(input.key || "").toLowerCase() &&
    ctrl === has("ctrl") &&
    !!input.alt === has("alt") &&
    !!input.shift === has("shift")
  );
}

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
      const m = url.pathname.match(/^\/(?:problem\/)?([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)\/?$/);
      return m ? canonicalPid(m[1]) : "";
    }
    const m = url.pathname.match(/^\/problem\/([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)/);
    return m ? canonicalPid(m[1]) : "";
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

  /* ---------- 侧栏宽度（单一状态源） ----------
     外壳 DOM 与所有页面 WebContentsView 都消费同一个 railCurrentW。
     悬停不展开；只有显式固定/收起会触发一次 160ms 宽度补间。 */

  railWidth() {
    return this.railCurrentW;
  }

  railTargetWidth() {
    return this.railPinned ? RAIL_W : RAIL_COLLAPSED_W;
  }

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
  }

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
  }

  applyRailWidth(width, boundsOverride) {
    this.railCurrentW = Math.max(RAIL_COLLAPSED_W, Math.min(RAIL_W, Math.round(Number(width) || 0)));
    const entry = this.currentEntry();
    if (this.win && !this.win.isDestroyed()) {
      const bounds = boundsOverride || this.win.getContentBounds();
      const metrics = this.workspaceMetrics(entry, this.railCurrentW, bounds);
      this.win.webContents.send("rail:layout", { width: this.railCurrentW, ideVertical: metrics.vertical });
    }
    if (this.overlayOpen || this.library) return;
    if (entry) this.layoutRailEntry(entry, this.railCurrentW, boundsOverride);
  }

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
  }

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
  }

  applyFeatures() {
    const features = this.ctx.cfg ? this.ctx.cfg.get().features : {};
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents;
      if (wc && !wc.isDestroyed()) wc.send("lg:features", features);
    }
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
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
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
    this.evictTotal(MAX_TOTAL_ENTRIES, entry.key);
    this.showEntry(entry);
  }

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
  }

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
  }

  openCustom(url, label, id) {
    if (!/^https?:\/\//i.test(String(url || ""))) return;
    if (isLuoguUrl(url)) this.openDetail(url, label || "自定义页面", "", String(id || ""));
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
      railId: "",
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
    if (process.env.LG_NO_SNAPSHOT === "1") return;
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
    if (this.disposed || !entry || !this.win || this.win.isDestroyed()) return;
    const wc = entry.view.webContents;
    if (wc.isDestroyed() || round > 4) return;
    const url = wc.getURL();
    const pid = entry.pid || pidFromUrl(url);
    if (!pid || url.includes("#") || isOfflineUrl(url)) return;
    if (this.ctx.luogu && this.ctx.luogu.online === false) return;
    let probe = null;
    try {
      probe = await wc.executeJavaScript(`(() => {
       try {
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
            const isSafeData = name === "src" && /^data:(image|font)\\//i.test(attr.value);
            if (name.startsWith("on") || (isUrlAttr && !isSafeData && /^\\s*(javascript|data|vbscript):/i.test(attr.value))) {
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
       } catch (err) {
         // 抓取脚本自身的异常必须在页面内捕获并带回来，否则它会和
         // “文档已销毁/正在导航”的传输层拒绝共用同一句话术，日志无法区分。
         return { ok: false, reason: "script-throw", message: String((err && err.message) || err), stack: String((err && err.stack) || "") };
       }
      })()`);
    } catch (err) {
      const msg = String((err && err.message) || err || "");
      // 能走到这里只剩传输层拒绝：文档已销毁、正在导航、渲染上下文被替换。
      // 隐藏窗口在 smoke 快速切题/重载时必然命中，属于预期竞态，默认静默；
      // 排查时设 LG_DEBUG_CAPTURE=1 留一行现场。
      const ctxGone = /Script failed to execute|Render frame was disposed|WebContents was destroyed|Execution context was destroyed|Cannot find context|ERR_ABORTED/i.test(msg) ||
        wc.isDestroyed() ||
        this.disposed;
      if (process.env.LG_DEBUG_CAPTURE) {
        console.log("[views] 快照抓取竞态跳过 round=" + round + " " + msg.slice(0, 80));
      }
      if (!ctxGone) {
        console.log("[views] 快照抓取失败 " + msg.slice(0, 100) + " url=" + (wc.isDestroyed() ? "(destroyed)" : wc.getURL().slice(0, 90)));
      }
      // 导航竞态等瞬时错误也给一次机会（round 上限复用，防循环）
      setTimeout(() => this.captureProblem(entry, round + 1).catch(() => {}), 2500);
      return;
    }
    if (probe && probe.reason === "script-throw") {
      // 页内脚本真的抛错：这才是需要修的 bug，重试没有意义
      console.log("[views] 快照抓取脚本异常 " + String(probe.message || "").slice(0, 120));
      if (process.env.LG_DEBUG_CAPTURE && probe.stack) {
        console.log("[views] 快照抓取脚本异常栈 " + String(probe.stack).slice(0, 800));
      }
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
  }

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
  }

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
        railId: this.library,
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
        loading: null,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
      };
    }
    const entry = this.currentEntry();
    if (!entry) {
      return {
        home: true,
        library: null,
        section: "home",
        railId: "home",
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
        loading: null,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
      };
    }
    const wc = entry.view.webContents;
    const pageUrl = entry.sleeping ? entry.resumeUrl || entry.requestedUrl || "" : wc.getURL();
    let canBack = false;
    let canForward = false;
    try {
      canBack = wc.navigationHistory.canGoBack();
      canForward = wc.navigationHistory.canGoForward();
    } catch {
      /* ignore */
    }
    const liveSection = sectionOfUrl(pageUrl) || entry.section || "";
    const railId = entry.railId !== undefined ? entry.railId : NAV[liveSection] ? liveSection : "";
    return {
      home: false,
      library: null,
      section: liveSection,
      railId,
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      url: pageUrl,
      canBack: canBack || !!this.returnLib,
      canForward,
      canReopen,
      isProblem: entry.kind === "problem",
      pid: entry.pid || pidFromUrl(pageUrl),
      ide: this.ideOn,
      loading: entry.readiness ? entry.readiness.state : null,
      layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
    };
  }

  /* ---------- 视图生命周期 ---------- */

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
  }

  async attachGuard(wc) {
    return attachPasskeyGuard(wc);
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
    wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      onNavigate(_event, url);
      if (isMainFrame !== false) entry.readiness.didNavigate(url);
    });
    wc.on("did-start-navigation", (details, deprecatedUrl, deprecatedInPlace, deprecatedMainFrame) => {
      // Electron 39 把导航信息放在第一个 details 参数里；旧签名仍保留，
      // 两种形式都要兼容，否则所有导航都会漏掉 readiness.begin。
      const target = (details && details.url) || (typeof deprecatedUrl === "string" ? deprecatedUrl : "");
      const sameDocument = details && details.isSameDocument !== undefined
        ? !!details.isSameDocument
        : !!deprecatedInPlace;
      const mainFrame = details && details.isMainFrame !== undefined
        ? details.isMainFrame !== false
        : deprecatedMainFrame !== false;
      if (!mainFrame || !target || target === "about:blank") return;
      entry.readiness.begin(target, sameDocument ? "in-page" : "document");
    });

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
      if (!entry.guardPreDoc && !entry.guardRetry) {
        // Page 域只能在文档提交之后启用；首个文档到达时补装一次，成功后同一视图
        // 之后的所有导航（含站点自己跳登录页）都在文档脚本执行前就带守卫。
        entry.guardRetry = true;
        this.attachGuard(wc).then((guarded) => {
          entry.guardPreDoc = !!guarded;
        }).catch(() => {});
      } else if (!wc.debugger.isAttached()) {
        this.attachGuard(wc).catch(() => {});
      }
      if (!isOfflineUrl(current)) this.injectSkin(entry);
      // CDP 预注入在某些首次 renderer 上会超时；当前文档必须在主世界再兜底一次，
      // 否则隔离世界 preload 无法覆盖站点自己的 navigator.credentials。
      injectPasskeyGuard(wc).then((injected) => {
        entry.passkeyFallback = injected;
      }).catch(() => {});
      entry.view.setBackgroundColor("#00000000");
      entry.readiness.markDomReady(current);
    });

    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url === "about:blank") return;
      // 线上题目页加载失败（断网/网络抖动）：有本地快照就切过去，别给用户一个错误页
      const pid = pidFromUrl(url) || entry.pid;
      if (entry.kind === "problem" && pid && !isOfflineUrl(url)) {
        const offlineUrl = this.ctx.luogu ? this.ctx.luogu.problemSnapshotUrl(pid) : "";
        if (offlineUrl) {
          console.log("[views] 题目加载失败，回退离线快照 " + pid);
          entry.readiness.begin(offlineUrl, "offline-fallback");
          wc.loadURL(offlineUrl).catch(() => {});
          return;
        }
      }
      // 题单详情是站点 SPA，偶发首包/路由数据都成功但正文未渲染。
      // 对训练详情做一次静默重载，不把用户留在空白的 l-card 里。
      if (entry.section === "training" && entry.requestedUrl && (entry.blankRetries || 0) < 1) {
        entry.blankRetries = (entry.blankRetries || 0) + 1;
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.loadURL(entry.requestedUrl).catch(() => {});
        }, 450);
        return;
      }
      entry.readiness.fail(`${description}（${code}）`, "did-fail-load");
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
      entry.readiness.markDomReady(wc.getURL());
      if (entry.section !== "training" || !entry.requestedUrl) return;
      setTimeout(async () => {
        if (wc.isDestroyed() || wc.getURL() !== entry.requestedUrl) return;
        let probe = null;
        try {
          probe = await wc.executeJavaScript(`(() => {
            const app = document.querySelector("#app");
            const text = String((app && app.innerText) || "").replace(/\s+/g, " ").trim();
            return { ok: !!app && !!app.firstElementChild && text.length >= 20, length: text.length };
          })()`);
        } catch {
          return;
        }
        if (probe && probe.ok) {
          entry.blankRetries = 0;
          return;
        }
        if ((entry.blankRetries || 0) < 1) {
          entry.blankRetries = (entry.blankRetries || 0) + 1;
          wc.reload();
          return;
        }
        this.ctx.toast && this.ctx.toast("题单加载失败", "页面没有返回正文，请检查登录状态后重试。");
      }, 700);
    });

    wc.on("did-stop-loading", () => {
      entry.readiness.markDomReady(wc.getURL());
    });

    wc.on("render-process-gone", () => {
      entry.readiness.fail("页面渲染进程已退出", "render-process-gone");
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
      else if (ctrl && !input.shift && key === "b") command = "railPin";
      else if (ctrl && !input.shift && key === "u" && this.ctx.cfg.get().features.userSearch) command = "userSearch";
      else if (ctrl && input.key === "Tab") command = "switcher";
      else if (ctrl && input.shift && key === "t") command = "reopen";
      else if (ctrl && (input.key === "," || input.key === "，")) command = "settings";
      else if (input.key === "F11") command = "fullscreen";
      else if (input.key === "F12") command = "devtools";
      else if (input.key === "F6") command = input.shift ? "focusPage" : "focusRail";
      // 浏览器基本键：刷新 / 后退 / 前进 / 关页面（与浏览器同键位）
      else if (input.key === "F5" || (ctrl && !input.shift && key === "r")) command = "reload";
      else if (input.alt && input.key === "ArrowLeft") command = "back";
      else if (input.alt && input.key === "ArrowRight") command = "forward";
      else if (this.ctx.cfg.get().features.shortcuts && acceleratorMatches(input, this.ctx.cfg.get().general.shortcutOpenProblems)) command = "problems";
      else if (ctrl && !input.shift && key === "w") command = "closepage";
      else if (ctrl && !input.shift && key === "f") command = "find";
      else if (ctrl && !input.shift && (input.key === "=" || input.key === "+")) command = "zoomin";
      else if (ctrl && !input.shift && input.key === "-") command = "zoomout";
      else if (ctrl && !input.shift && input.key === "0") command = "zoomreset";
      if (!command) return;
      if (command === "railPin" && input.isAutoRepeat) return;
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

  viewStats() {
    const entries = [...this.entries.values()];
    return {
      entries: entries.length,
      live: entries.filter((entry) => entry.view && !entry.sleeping).length,
      sleeping: entries.filter((entry) => entry.sleeping).length,
      idleMs: IDLE_VIEW_MS,
      limits: { problems: MAX_PROBLEMS, details: MAX_DETAILS, total: MAX_TOTAL_ENTRIES },
    };
  }

  cancelSleep(entry) {
    if (!entry) return;
    if (entry.sleepTimer) clearTimeout(entry.sleepTimer);
    entry.sleepTimer = null;
  }

  cancelAllSleep() {
    for (const entry of this.entries.values()) this.cancelSleep(entry);
  }

  scheduleSleep(entry) {
    if (!entry || this.disposed || entry.sleeping || entry.kind === "login" || entry.key === this.currentKey) return;
    this.cancelSleep(entry);
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    const delay = perf ? Math.min(IDLE_VIEW_MS, 30000) : IDLE_VIEW_MS;
    entry.sleepTimer = setTimeout(() => {
      entry.sleepTimer = null;
      if (entry.key === this.currentKey || entry.kind === "login") return;
      this.sleepEntry(entry).catch(() => {});
    }, delay);
  }

  async sleepEntry(entry, force = false) {
    if (!entry || entry.sleeping || entry.sleepPending || entry.kind === "login") return false;
    if (!force && entry.key === this.currentKey) return false;
    if (this.disposed) return false;
    const wc = entry.view && entry.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const url = wc.getURL();
    if (!url || url === "about:blank") return false;

    entry.sleepPending = true;
    entry.lastSleep = { at: Date.now(), state: "checking" };
    const token = entry.lifecycleToken;
    let checkpoint = { scroll: 0, dirty: false, timedOut: false };
    let probeTimer = null;
    try {
      checkpoint = await Promise.race([
        wc.executeJavaScript(`(() => {
          const fields = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
          const dirty = fields.some((node) => {
            if (!node || node.disabled || node.readOnly) return false;
            if (node.matches && node.matches('[contenteditable="true"]')) {
              return String(node.innerText || '').trim().length > 0;
            }
            return String(node.value || '').trim().length > 0;
          });
          return {
            scroll: Number(window.scrollY || document.documentElement.scrollTop || 0) || 0,
            dirty,
            timedOut: false,
          };
        })()`, true),
        new Promise((resolve) => {
          probeTimer = setTimeout(() => resolve({ scroll: 0, dirty: false, timedOut: true }), 1200);
        }),
      ]);
    } catch {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "probe-failed", loading: wc.isLoading() };
      if (wc.isLoading()) {
        this.scheduleSleep(entry);
        return false;
      }
    } finally {
      if (probeTimer) clearTimeout(probeTimer);
    }
    if (checkpoint.timedOut && wc.isLoading()) {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "probe-timeout-loading" };
      this.scheduleSleep(entry);
      return false;
    }
    if (token !== entry.lifecycleToken || (!force && entry.key === this.currentKey) || this.disposed) {
      entry.sleepPending = false;
      return false;
    }
    if (checkpoint.dirty) {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "dirty" };
      this.scheduleSleep(entry);
      return false;
    }

    entry.sleepPending = false;
    entry.sleeping = true;
    entry.lastSleep = { at: Date.now(), state: "sleeping", url };
    entry.resumeUrl = url;
    entry.resumeScroll = checkpoint.scroll || 0;
    entry.lastRect = "";
    if (entry.attached) {
      try {
        this.win.contentView.removeChildView(entry.view);
      } catch {
        /* ignore */
      }
      entry.attached = false;
    }
    entry.view.setVisible(false);
    wc.loadURL("about:blank").catch(() => {});
    return true;
  }

  wakeEntry(entry, targetUrl) {
    if (!entry || !entry.sleeping) return false;
    const wc = entry.view && entry.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    this.cancelSleep(entry);
    entry.lifecycleToken += 1;
    entry.sleepPending = false;
    entry.sleeping = false;
    const target = String(targetUrl || entry.resumeUrl || entry.requestedUrl || "").trim();
    if (!target || target === "about:blank") return false;
    entry.resumeUrl = target;
    const scroll = Number(entry.resumeScroll) || 0;
    const token = entry.lifecycleToken;
    wc.loadURL(target)
      .then(() => {
        if (token !== entry.lifecycleToken || wc.isDestroyed()) return;
        if (scroll > 0) wc.executeJavaScript(`window.scrollTo(0, ${Math.max(0, Math.round(scroll))});`, true).catch(() => {});
        try {
          const history = wc.navigationHistory;
          const active = history.getActiveIndex();
          for (let i = history.length() - 1; i >= 0; i--) {
            const item = history.getEntryAtIndex(i);
            if (i !== active && item && item.url === "about:blank") history.removeEntryAtIndex(i);
          }
        } catch {
          /* history is best-effort */
        }
      })
      .catch(() => {});
    return true;
  }

  async suspendBackground() {
    const tasks = [];
    for (const entry of this.entries.values()) {
      this.cancelSleep(entry);
      tasks.push(this.sleepEntry(entry, true).catch(() => false));
    }
    return Promise.all(tasks);
  }

  showEntry(entry) {
    if (!this.win || this.win.isDestroyed()) return;
    if (entry.sleeping) this.wakeEntry(entry, entry.resumeUrl || entry.requestedUrl);
    this.cancelSleep(entry);
    this.currentKey = entry.key;
    this.library = null;
    this.overlayOpen = false;
    for (const other of this.entries.values()) {
      if (other === entry) continue;
      other.view.setVisible(false);
      if (!other.view.webContents.isDestroyed()) {
        other.view.webContents.setAudioMuted(true);
        other.view.webContents.setBackgroundThrottling(true);
      }
      this.scheduleSleep(other);
    }
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    entry.lastUsed = ++this.clock;
    entry.lastUsedAt = Date.now();
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(false);
      entry.view.webContents.setBackgroundThrottling(true);
    }
    this.layout();
    this.injectSkin(entry);
    entry.readiness.replay();
    entry.view.webContents.focus();
    this.emit();
  }

  hideAll() {
    for (const entry of this.entries.values()) {
      entry.view.setVisible(false);
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.setAudioMuted(true);
        entry.view.webContents.setBackgroundThrottling(true);
      }
      this.scheduleSleep(entry);
    }
  }

  restoreCurrent() {
    if (this.library) {
      this.hideAll();
      return;
    }
    const entry = this.currentEntry();
    if (!entry || !this.win || this.win.isDestroyed()) return;
    if (entry.sleeping) this.wakeEntry(entry, entry.resumeUrl || entry.requestedUrl);
    this.cancelSleep(entry);
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(false);
      entry.view.webContents.focus();
    }
    this.layout();
    this.injectSkin(entry);
    entry.readiness.replay();
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
    this.railAnimToken = (this.railAnimToken || 0) + 1;
    clearTimeout(this.railAnimTimer);
    this.railAnimTimer = null;
    this.railCurrentW = this.railTargetWidth();
    const entry = this.currentEntry();
    const metrics = this.workspaceMetrics(entry, this.railCurrentW, this.win.getContentBounds());
    this.win.webContents.send("rail:layout", { width: this.railCurrentW, ideVertical: metrics.vertical });
    if (!entry || this.overlayOpen || this.library) {
      this.hideAll();
      return;
    }
    this.layoutRailEntry(entry, this.railCurrentW);
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

  evictTotal(max, keepKey) {
    if (this.entries.size <= max) return;
    const list = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.entries.size > max && list.length) {
      const entry = list.shift();
      if (!entry || entry.key === keepKey) continue;
      this.destroyEntry(entry);
    }
  }
  destroyEntry(entry) {
    entry.lifecycleToken += 1;
    this.cancelSleep(entry);
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
      entry.view.setBackgroundColor("#00000000");
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
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
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
      `--lg-glass-tint:${c.glassTint || c.accent}`,
      `--lg-glass-tint-soft:${c.glassTintSoft || c.accentSoft}`,
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
      `--lg-text-shadow:none`,
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
      `--lg-wall-image:none`,
      `--lg-color-scheme:${t.isDark ? "dark" : "light"}`,
      `--lg-motion:0`,
      `--lg-zoom-on:0`,
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
        // 保留最后一次主题值；当前 insertCSS 完成后补注入，避免连续拖滑杆
        // 时页面停在旧透明度而后台窗口已经更新。
        entry.varsDirty = true;
        if (process.env.LG_SKIN_DEBUG) console.log("[skin] varsPending blocked, url=" + wc.getURL());
        return;
      }
      if (entry.varsKey && entry.varsSig === vars) return;
      const seq = ++this.skinSeq;
      entry.varsPending = true;
      entry.varsDirty = false;
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
          if (entry.varsDirty && !wc.isDestroyed()) {
            entry.varsDirty = false;
            queueMicrotask(() => this.injectSkin(entry));
          }
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
