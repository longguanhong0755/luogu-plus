/* 洛谷数据服务。
   登录态用 cookie（__client_id / _uid）判断；页面数据在隐藏窗口的页面上下文里
   fetch 真实页面，解析 #lentille-context 的 JSON（洛谷新前端把服务端直出数据放在
   这个 script 里），不依赖易变的私有 API。
   签到用页面内点击（洛谷的打卡本身是前端行为），提交先尝试接口、失败则回退。 */
const { BrowserWindow, Notification } = require("electron");
const { attachToWebContents: attachPasskeyGuard } = require("./passkey-guard");
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

/* 验证码识别是可选能力（本机装了 python + ddddocr 才有），懒加载。 */
let ocrMod = null;
function captchaOcr(png) {
  if (!ocrMod) ocrMod = require("./ocr");
  return ocrMod.recognize(png).catch(() => ({ ok: false, reason: "ocr-crash" }));
}


const QUOTES = [
  "把每一道题，都当成一次新的开始。",
  "慢慢来，比较快。",
  "今天多写一行，明天少坑一次。",
  "代码不会骗人，编译器更不会。",
  "先想清楚，再敲键盘。",
  "题是做不完的，但今天这道可以。",
  "看题解不丢人，抄题解才丢人。",
  "模拟只能骗过样例，骗不过数据。",
  "边界条件，是强者的分水岭。",
  "每一次 WA，都是在指出你还差的那一点。",
  "复杂度先算，再动手。",
  "写完先自己出三组数据。",
  "读题三遍，胜过调试三小时。",
  "状态定义清楚，转移自然就来了。",
  "别怕推倒重来，怕的是不敢开始。",
  "刷题不是为了数字，是为了下次不慌。",
  "把不会的题讲给别人听，你就真会了。",
  "先保证正确，再谈优化。",
  "比赛的第一题，往往是心态题。",
  "稳住，你比想象中更强。",
];

const STATUS_TEXT = {
  0: "等待",
  1: "评测中",
  2: "CE",
  3: "RE",
  4: "MLE",
  5: "TLE",
  6: "WA",
  7: "未通过",
  8: "OLE",
  12: "AC",
  14: "UC",
};

/* 与网页版题库难度口径一致（2026-10 实测 luogu.com.cn 题目列表） */
const DIFFICULTY = {
  0: { name: "暂无评定", color: "#9aa0aa" },
  1: { name: "入门", color: "#fe4c61" },
  2: { name: "普及−", color: "#f39c11" },
  3: { name: "普及", color: "#ffc116" },
  4: { name: "普及+/提高−", color: "#52c41a" },
  5: { name: "提高", color: "#13c2c2" },
  6: { name: "提高+/省选−", color: "#3498db" },
  7: { name: "省选/NOI−", color: "#9d3dcf" },
  8: { name: "NOI/NOI+/CTS", color: "#0e1d69" },
};

/* 题库分区：luogu = 洛谷（主题库 + 入门与面试） */
const PROBLEM_TYPES = new Set(["luogu", "P", "B", "CF", "SP", "AT", "UVA"]);

/* 标签筛选编码：组内逗号=或，组间竖线=与（与网页版 URL 完全一致） */
function normalizeTagGroups(value) {
  const groups = [];
  for (const raw of Array.isArray(value) ? value : String(value || "").split("|")) {
    const ids = (Array.isArray(raw) ? raw : String(raw).split(","))
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    if (unique.length) groups.push(unique);
  }
  const seen = new Set();
  return groups.filter((group) => {
    const key = group.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tagQuery(groups) {
  return groups.map((group) => group.join(",")).join("|");
}

/* /_lfe/tags 精简：只保留前端需要的字段，避免把几百个无关字段带进渲染进程 */
function normalizeTagCatalog(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => ({
          id: Number(tag.id) || 0,
          name: String(tag.name || ""),
          type: Number(tag.type) || 0,
          parent: Number(tag.parent) || 0,
        }))
        .filter((tag) => tag.id && tag.name)
    : [];
  const types = Array.isArray(raw.types)
    ? raw.types
        .map((type) => ({
          id: Number(type.id) || 0,
          type: String(type.type || ""),
          name: String(type.name || ""),
          color: String(type.color || ""),
          order: Number(type.order) || 0,
        }))
        .filter((type) => type.id && type.name)
    : [];
  if (!tags.length) return null;
  return { tags, types };
}

/* 语言 id 表在 ./langs（/_lfe/config 实测）。这里只消费 resolveLangId：
   不认识的语言返回 null → 拒绝提交并转页面内提交辅助，绝不悄悄换成默认语言。 */
const { resolveLangId } = require("./langs");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function quoteFor(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const index = Math.floor((date - start) / 86400000) % QUOTES.length;
  return QUOTES[index];
}

function findArray(root, predicate, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    if (root.length && root.every((item) => item && typeof item === "object") && predicate(root[0])) return root;
    for (const item of root) {
      const hit = findArray(item, predicate, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    for (const key of Object.keys(root)) {
      const hit = findArray(root[key], predicate, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findObject(root, predicate, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findObject(item, predicate, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    if (predicate(root)) return root;
    for (const key of Object.keys(root)) {
      const hit = findObject(root[key], predicate, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function toMillis(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

/* 列表摘要只保留纯文本：去掉公式、HTML 和 Markdown 记号，避免列表里直接露出
   $\sum...$ 之类源码（正文仍由页面完整渲染）。 */
function plainExcerpt(value, limit = 120) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\})?/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[#>*`_~{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function trimMap(map, limit) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

class LuoguService {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.loadPromise = null;
    this.winIdleTimer = null;
    this.user = {
      loggedIn: false,
      uid: null,
      name: "",
      avatar: "",
      submittedProblemCount: null,
      passedProblemCount: null,
      ranking: null,
    };
    this.home = {
      quote: quoteFor(new Date()),
      heat: [],
      acProgress: [],
      acRecentTotal: 0,
      contest: null,
      recent: [],
      punched: null,
      streak: 0,
      updatedAt: 0,
      error: "",
    };
    this.refreshing = false;
    this.refreshWaiters = [];
    this.lastRefresh = 0;
    this.libCache = new Map();
    this.tagsCache = null;
    this.tagsPromise = null;
    this.randomCounts = new Map();
    this.userSearchCache = new Map();
    /* 断网可用：在线状态由主窗口 navigator.onLine 轮询 + 页面 fetch 失败反馈共同维护。 */
    this.online = true;
    this.onlineTimer = null;
    this.flushing = false;
    this.queueTimer = null;
    this.contextStats = { direct: 0, browser: 0, last: '' };
  }

  init() {
    this.hydrate();
    this.refresh(true).catch((err) => console.error("[luogu] init refresh:", err.message));
    this.startOnlineWatch();
    // 上次退出时留在队列里的提交，趁启动联网时补交
    if (this.online) this.flushQueue().catch(() => {});
  }

  /* 启动即回填：上次成功刷新的主页/身份快照先上屏，再等网络刷新。
     断网启动时界面不是空的，而是「离线数据」。 */
  hydrate() {
    const store = this.ctx.store;
    if (!store) return;
    const home = store.get("home");
    if (home && typeof home === "object" && home.updatedAt) {
      this.home = Object.assign({}, this.home, home, { error: "" });
    }
    const user = store.get("user");
    if (user && typeof user === "object" && user.uid) {
      this.user = Object.assign({}, this.user, user);
    }
    const queue = store.get("queue");
    if (Array.isArray(queue) && queue.length) {
      console.log("[luogu] 启动时发现离线队列 " + queue.length + " 条");
      this.scheduleQueueRetry(4000);
    }
  }

  /* ---------- 在线状态 ---------- */

  startOnlineWatch() {
    if (this.onlineTimer) return;
    this.onlineTimer = setInterval(async () => {
      try {
        const win = this.ctx.win;
        if (!win || win.isDestroyed()) return;
        const online = await win.webContents.executeJavaScript("navigator.onLine");
        this.setOnline(!!online);
      } catch {
        /* 主窗口未就绪时保持现状 */
      }
    }, 60000);
    if (this.onlineTimer.unref) this.onlineTimer.unref();
  }

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    console.log("[luogu] 网络状态 → " + (online ? "在线" : "离线"));
    if (this.ctx.emitState) this.ctx.emitState();
    if (!online) return;
    this.refresh(true).catch(() => {});
    this.flushQueue().catch(() => {});
  }

  /* ---------- 离线提交队列 ---------- */

  queueItems() {
    const store = this.ctx.store;
    const list = store ? store.get("queue") : null;
    return Array.isArray(list) ? list.filter((item) => item && item.pid && item.code) : [];
  }

  queueState() {
    const items = this.queueItems();
    return {
      count: items.filter((item) => item.status !== "done" && item.status !== "failed").length,
      items: items.map((item) => ({
        id: item.id,
        pid: item.pid,
        lang: item.lang,
        status: item.status || "pending",
        tries: item.tries || 0,
        queuedAt: item.queuedAt || 0,
        lastError: String(item.lastError || "").slice(0, 80),
      })),
    };
  }

  async enqueueSubmit(pid, code, lang, reason, o2 = false) {
    const store = this.ctx.store;
    if (!store) return { ok: false, message: "本地存储不可用，无法离线排队。" };
    const queue = this.queueItems();
    // 同题同码的重复入队直接合并，避免断网期间连点堆积
    if (queue.some((item) => item.pid === pid && item.code === code && item.status !== "done" && item.status !== "failed")) {
      return { ok: false, queued: true, message: `已排在离线队列里（${pid}），联网后自动提交。` };
    }
    queue.push({
      id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      pid,
      code,
      lang: lang || "C++14 (GCC 9)",
      o2: !!o2,
      status: "pending",
      tries: 0,
      nextTryAt: 0,
      queuedAt: Date.now(),
      lastError: String(reason || "").slice(0, 80),
    });
    if (queue.length > 20) queue.splice(0, queue.length - 20);
    store.set("queue", queue, 100);
    store.flush("queue");
    if (this.ctx.emitState) this.ctx.emitState();
    return { ok: false, queued: true, message: `${reason || "当前离线"}，已加入队列（${pid}），联网后自动提交。` };
  }

  async queueAction(op, id) {
    const store = this.ctx.store;
    if (!store) return this.queueState();
    const queue = this.queueItems();
    if (op === "clear") {
      store.set("queue", [], 0);
      store.flush("queue");
    } else if (op === "retry") {
      for (const item of queue) {
        if (id && item.id !== id) continue;
        if (item.status === "done") continue;
        item.status = "pending";
        item.nextTryAt = 0;
        item.lastError = "";
      }
      store.set("queue", queue, 0);
      store.flush("queue");
      this.flushQueue().catch(() => {});
    } else if (op === "remove" && id) {
      store.set(
        "queue",
        queue.filter((item) => item.id !== id),
        0
      );
      store.flush("queue");
    }
    if (this.ctx.emitState) this.ctx.emitState();
    return this.queueState();
  }

  scheduleQueueRetry(delayMs = 60000) {
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      if (this.online) this.flushQueue().catch(() => {});
      else this.scheduleQueueRetry();
    }, delayMs);
  }

  /* 逐条重放：走与手动提交完全相同的 submit 管线（含验证码自动识别与页面辅助语义）。
     结果分类：ok → 完成；验证码/交互式 → 标记 captcha 等用户处理；
     status 0（网络层失败）→ 保留待重试；服务器明确拒绝 → failed 停止重试。 */
  async flushQueue() {
    if (this.flushing || !this.online) return;
    const store = this.ctx.store;
    if (!store) return;
    this.flushing = true;
    let mutated = false;
    try {
      const queue = this.queueItems();
      const now = Date.now();
      for (const item of queue) {
        if (item.status === "done" || item.status === "failed") continue;
        if (item.status === "captcha") continue;
        if (item.nextTryAt && item.nextTryAt > now) continue;
        const result = await this.submit(item.pid, item.code, item.lang, "", item.o2);
        item.tries = (item.tries || 0) + 1;
        mutated = true;
        if (result.ok) {
          item.status = "done";
          item.rid = result.rid || "";
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 已自动提交，评测完成后通知。`);
        } else if (result.captchaRequired) {
          item.status = "captcha";
          item.lastError = "需要验证码，点击「去验证」在页面里完成提交。";
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 需要验证码，请在题目页完成提交。`);
        } else if (Number(result.status) === 0 || /网络|离线/.test(String(result.message || ""))) {
          item.status = "pending";
          item.lastError = "网络未就绪，稍后重试";
          item.nextTryAt = Date.now() + 90000;
        } else {
          item.status = "failed";
          item.lastError = String(result.message || result.detail || "提交被拒绝").slice(0, 120);
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 提交被拒：` + item.lastError);
        }
        await delay(1500);
      }
      const remaining = queue.filter((item) => item.status === "pending" || item.status === "retry");
      if (remaining.length) this.scheduleQueueRetry();
      const cleaned = queue.filter((item) => item.status !== "done").slice(-20);
      store.set("queue", cleaned, 100);
      store.flush("queue");
      if (this.ctx.emitState) this.ctx.emitState();
    } finally {
      this.flushing = false;
    }
    return mutated;
  }

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
  }

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
  }

  scheduleWindowIdle() {
    if (this.winIdleTimer) clearTimeout(this.winIdleTimer);
    this.winIdleTimer = setTimeout(() => {
      this.winIdleTimer = null;
      if (!this.win || this.win.isDestroyed()) return;
      this.win.destroy();
      this.win = null;
      this.loadPromise = null;
    }, Math.max(5000, Number(process.env.LG_DATA_WINDOW_IDLE_MS) || 15000));
  }

  reloadHidden() {
    if (!this.win || this.win.isDestroyed()) return;
    this.loadPromise = waitForLoadStop(this.win.webContents, 12000);
    this.win.webContents.reload();
  }

  async fetchContextDirect(url) {
    if (!this.ctx.session || typeof this.ctx.session.fetch !== 'function') {
      return { ok: false, reason: 'no-session-fetch' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let timedOut = false;
    let timeoutTimer = null;
    try {
      const request = this.ctx.session.fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      }).then(async (response) => {
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, status: response.status, reason: 'http', len: text.length };
        }
        const match = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
        if (!match) {
          return { ok: false, status: response.status, reason: 'no-ctx', len: text.length };
        }
        try {
          return { ok: true, context: JSON.parse(match[1]), transport: 'session.fetch' };
        } catch (error) {
          return { ok: false, status: response.status, reason: 'parse', detail: String(error).slice(0, 120) };
        }
      }).catch((error) => ({ ok: false, reason: 'network', error: String(error).slice(0, 160) }));
      const watchdog = new Promise((resolve) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          resolve({ ok: false, reason: 'timeout' });
        }, 12000);
      });
      return await Promise.race([request, watchdog]);
    } catch (error) {
      return { ok: false, reason: timedOut ? 'timeout' : 'network', error: String(error).slice(0, 160) };
    } finally {
      clearTimeout(timer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  async fetchContext(pathname) {
    const url = pathname.startsWith('http') ? pathname : 'https://www.luogu.com.cn' + pathname;
    // 离线时页面 fetch 立刻失败，重试只是白等——直接走调用方的缓存回退。
    if (!this.online) return null;

    // 常规读取只取 HTML 内的 lentille-context，不需要完整站点 renderer。
    // 这样主页刷新、题库/记录分页不会为了抓一段 JSON 常驻隐藏 BrowserWindow。
    const direct = await this.fetchContextDirect(url);
    if (direct.ok && direct.context) {
      this.contextStats.direct += 1;
      this.contextStats.last = 'session.fetch';
      return direct.context;
    }

    // 只有直连拿不到可解析上下文时才启用浏览器回退，兼容防爬页、验证码页
    // 或未来需要站点脚本生成 DOM 的页面。成功一次后仍保持隐藏窗空闲回收。
    this.contextStats.browser += 1;
    this.contextStats.last = 'browser';
    let lastFail = JSON.stringify(direct);
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.exec(
        `(async () => {
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', signal: AbortSignal.timeout(9000) });
            const text = await r.text();
            const m = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
            if (!m) return { ok: false, status: r.status, reason: 'no-ctx', len: text.length, online: navigator.onLine };
            try {
              return { ok: true, context: JSON.parse(m[1]), online: navigator.onLine };
            } catch (e) {
              return { ok: false, status: r.status, reason: 'parse', detail: String(e).slice(0, 120), online: navigator.onLine };
            }
          } catch (e) {
            return { ok: false, error: String(e).slice(0, 120), online: navigator.onLine };
          }
        })()`
      );
      if (result && typeof result.online === 'boolean') this.setOnline(result.online);
      if (result && result.ok && result.context) return result.context;
      if (result && result.online === false) return null;
      lastFail = JSON.stringify(result);
      await delay(600);
    }
    console.error('[luogu] fetchContext failed', pathname, lastFail);
    return null;
  }

  contextDiagnostics() {
    return Object.assign({ hiddenWindow: !!(this.win && !this.win.isDestroyed()) }, this.contextStats);
  }

  async cookies() {
    try {
      return await this.ctx.session.cookies.get({ url: "https://www.luogu.com.cn" });
    } catch {
      return [];
    }
  }

  async loginState() {
    const list = await this.cookies();
    const get = (name) => {
      const c = list.find((item) => item.name === name);
      return c ? c.value : "";
    };
    const clientId = get("__client_id");
    const uid = Number(get("_uid")) || 0;
    // 游客也会拿到 __client_id 和 _uid=0，必须要求真实 uid 才算登录。
    return { loggedIn: !!clientId && uid > 0, uid: uid || null };
  }

  /* ---------- 数据抓取 ---------- */

  parseRecords(context) {
    if (!context) return [];
    const list = findArray(context, (item) => {
      if (!item || typeof item !== "object") return false;
      const hasTime = "submitTime" in item || "time" in item;
      const hasProblem = "problem" in item || "pid" in item;
      return hasTime && hasProblem;
    });
    return list || [];
  }

  parseContests(context) {
    if (!context) return [];
    const list = findArray(context, (item) => {
      if (!item || typeof item !== "object") return false;
      return "startTime" in item && ("name" in item || "title" in item) && ("endTime" in item || "duration" in item);
    });
    return list || [];
  }

  parseUser(context, uid) {
    if (!context) return null;
    return findObject(context, (item) => {
      if (!item || typeof item !== "object") return false;
      if (!("uid" in item) || !("name" in item)) return false;
      return uid ? Number(item.uid) === Number(uid) : true;
    });
  }

  /* 个人中心把做题趋势放在 dailyCounts 中。字段在不同页面版本里可能是
     [日期, 次数]、{ date, count } 或 { time, value }，这里统一归一化；
     看不到公开数据时返回空数组，由最近提交回退。 */
  parseDailyCounts(context) {
    if (!context) return [];
    const holder = findObject(context, (item) => item && item.dailyCounts && typeof item.dailyCounts === "object");
    if (!holder) return [];
    const rawList = Array.isArray(holder.dailyCounts)
      ? holder.dailyCounts
      : Object.entries(holder.dailyCounts).map(([date, count]) => ({ date, count }));
    const out = [];
    for (const raw of rawList) {
      let date = "";
      let count = 0;
      if (Array.isArray(raw)) {
        date = raw[0];
        count = raw[1];
      } else if (raw && typeof raw === "object") {
        date = raw.date || raw.day || raw.time || raw.timestamp || raw.at || "";
        count = raw.count ?? raw.value ?? raw.total ?? raw.num ?? 0;
      } else {
        continue;
      }
      // 官方 dailyCounts 的值为 [等级, 提交次数]；旧解析把数组直接 Number()
      // 会得到 NaN 并显示成全零。兼容普通数字和 [次数, 等级] 两种变体。
      if (Array.isArray(count)) {
        const first = Number(count[0]) || 0;
        const second = Number(count[1]) || 0;
        count = first >= 1 && first <= 5 && second >= first ? second : first;
      }
      const numeric = Number(date);
      let key = "";
      if (Number.isFinite(numeric) && numeric > 0) key = dayKey(new Date(toMillis(numeric)));
      else key = String(date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      out.push({ date: key, count: Math.max(0, Number(count) || 0) });
    }
    return out;
  }

  /* ---------- 原生列表 ---------- */

  libStoreKey(cacheKey) {
    return "lib:" + cacheKey;
  }

  cachedLib(cacheKey) {
    const store = this.ctx.store;
    if (!store) return null;
    const entry = store.get(this.libStoreKey(cacheKey));
    return entry && entry.payload ? entry : null;
  }

  saveLib(cacheKey, payload) {
    const store = this.ctx.store;
    if (!store) return;
    const key = this.libStoreKey(cacheKey);
    store.set(key, { key, at: Date.now(), payload });
    // 搜索词会产生无穷多个 key，按时间保留最新 60 份
    if (store.evict("lib:", 60) > 80) store.evict("lib:", 40);
  }

  /* 标签目录是公开接口（不需要登录），缓存 6 小时；过期先用旧目录再后台刷新。 */
  async fetchTags(options = {}) {
    const force = !!options.force;
    const now = Date.now();
    const fresh = 6 * 60 * 60 * 1000;
    if (!force && this.tagsCache && now - this.tagsCache.at < fresh) return this.tagsCache.payload;
    if (!force && this.tagsPromise) return this.tagsPromise;

    const stored = this.ctx.store ? this.ctx.store.get("libtags") : null;
    const storedPayload =
      stored && stored.payload && Array.isArray(stored.payload.tags) && stored.payload.tags.length
        ? stored.payload
        : null;
    if (!force && storedPayload && now - (stored.at || 0) < 24 * 60 * 60 * 1000) {
      this.tagsCache = { at: stored.at, payload: storedPayload };
      if (now - stored.at >= fresh) this.fetchTags({ force: true }).catch(() => {});
      return storedPayload;
    }
    if (!this.online) {
      if (storedPayload) return Object.assign({}, storedPayload, { stale: true, offline: true });
      return { tags: [], types: [], error: "当前离线，标签目录还没有缓存过。" };
    }

    const run = (async () => {
      const raw = await this.exec(
        `(async () => {
          try {
            const r = await fetch("/_lfe/tags", { credentials: "include", signal: AbortSignal.timeout(9000) });
            if (!r.ok) return { ok: false, status: r.status };
            return { ok: true, data: await r.json() };
          } catch (e) {
            return { ok: false, error: String(e).slice(0, 120), online: navigator.onLine };
          }
        })()`
      );
      const payload = raw && raw.ok ? normalizeTagCatalog(raw.data) : null;
      if (!payload) {
        if (storedPayload) return Object.assign({}, storedPayload, { stale: true, error: "标签目录刷新失败，已使用缓存。" });
        return { tags: [], types: [], error: "标签目录加载失败，请检查网络。" };
      }
      const saved = Object.assign({}, payload, { at: now });
      this.tagsCache = { at: now, payload: saved };
      if (this.ctx.store) this.ctx.store.set("libtags", saved, 500);
      return saved;
    })();
    this.tagsPromise = run;
    try {
      return await run;
    } finally {
      if (this.tagsPromise === run) this.tagsPromise = null;
    }
  }

  randomGuard() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const store = this.ctx.store;
    const saved = store ? store.get("randomJumpGuard", null) : null;
    const guard = saved && saved.date === today ? saved : { date: today, used: 0, last: 0 };
    const elapsed = Date.now() - (Number(guard.last) || 0);
    if (guard.used >= 100) return { guard, allowed: false, reason: "daily", remaining: 0, waitMs: 0 };
    if (elapsed < 60000) {
      return { guard, allowed: false, reason: "interval", remaining: 100 - guard.used, waitMs: 60000 - elapsed };
    }
    return { guard, allowed: true, reason: "", remaining: 100 - guard.used, waitMs: 0 };
  }

  markRandomUsed(guard) {
    if (!this.ctx.store) return;
    this.ctx.store.set("randomJumpGuard", { date: guard.date, used: guard.used + 1, last: Date.now() }, 0);
  }

  async randomProblem(options = {}) {
    const difficulty = Math.max(1, Math.min(8, Number(options.difficulty) || 1));
    const source = ["P", "CF", "SP", "AT", "UVA"].includes(String(options.source || "").toUpperCase())
      ? String(options.source).toUpperCase()
      : "P";
    const gate = this.randomGuard();
    if (!gate.allowed) {
      return { ok: false, reason: gate.reason, remaining: gate.remaining, waitMs: gate.waitMs };
    }
    if (!this.online) return { ok: false, reason: "offline", remaining: gate.remaining, waitMs: 0 };

    const countKey = difficulty + "|" + source;
    let cached = this.randomCounts.get(countKey);
    let total = cached && Date.now() - cached.at < 10 * 60 * 1000 ? cached.total : 0;
    if (!total) {
      const first = await this.fetchLibrary("problems", { page: 1, difficulty: String(difficulty), type: source, force: false });
      if (!first || first.error) return { ok: false, reason: "network", remaining: gate.remaining, waitMs: 0 };
      total = Number(first.total) || first.items.length;
      const perPage = Number(first.perPage) || first.items.length || 50;
      if (!total) return { ok: false, reason: "empty", remaining: gate.remaining, waitMs: 0 };
      cached = { total, perPage, at: Date.now() };
      this.randomCounts.set(countKey, cached);
    }

    const perPage = cached.perPage || 50;
    const index = Math.floor(Math.random() * total);
    const page = Math.floor(index / perPage) + 1;
    const payload = page === 1
      ? await this.fetchLibrary("problems", { page, difficulty: String(difficulty), type: source, force: false })
      : await this.fetchLibrary("problems", { page, difficulty: String(difficulty), type: source, force: true });
    if (!payload || payload.error || !payload.items.length) {
      return { ok: false, reason: "network", remaining: gate.remaining, waitMs: 0 };
    }
    const item = payload.items[Math.min(payload.items.length - 1, index - (page - 1) * perPage)];
    if (!item || !item.pid) return { ok: false, reason: "empty", remaining: gate.remaining, waitMs: 0 };
    this.markRandomUsed(gate.guard);
    return {
      ok: true,
      pid: item.pid,
      title: item.title,
      difficulty: item.difficulty,
      difficultyName: item.difficultyName,
      remaining: gate.remaining - 1,
      waitMs: 60000,
    };
  }

  async searchUsers(rawKeyword) {
    const keyword = String(rawKeyword || "").trim().slice(0, 40);
    if (!keyword) return { ok: false, users: [], reason: "empty" };
    const cacheKey = keyword.toLowerCase();
    const cached = this.userSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return { ok: true, users: cached.users, cached: true };
    if (!this.online) return { ok: false, users: [], reason: "offline" };
    const store = this.ctx.store;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const saved = store ? store.get("userSearchGuard", null) : null;
    const guard = saved && saved.date === today ? saved : { date: today, used: 0, last: 0 };
    const elapsed = Date.now() - (Number(guard.last) || 0);
    if (guard.used >= 60) return { ok: false, users: [], reason: "daily" };
    if (elapsed < 180000) return { ok: false, users: [], reason: "interval", waitMs: 180000 - elapsed };
    const data = await this.exec(`(async () => {
      try {
        const r = await fetch("/api/user/search?keyword=" + encodeURIComponent(${JSON.stringify(keyword)}), {
          credentials: "include", headers: { "x-requested-with": "XMLHttpRequest" }, signal: AbortSignal.timeout(9000)
        });
        if (!r.ok) return { ok: false, status: r.status };
        return { ok: true, data: await r.json() };
      } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
    })()`);
    const list = data && data.ok && data.data && Array.isArray(data.data.users) ? data.data.users : [];
    const users = list.filter(Boolean).slice(0, 20).map((user) => ({
      uid: Number(user.uid) || 0,
      name: String(user.name || ""),
      avatar: String(user.avatar || ""),
      color: String(user.color || ""),
      ccfLevel: Number(user.ccfLevel) || 0,
      badge: String(user.badge || ""),
    })).filter((user) => user.uid > 0 && user.name);
    if (!data || !data.ok) return { ok: false, users: [], reason: "network" };
    if (store) store.set("userSearchGuard", { date: today, used: guard.used + 1, last: Date.now() }, 0);
    this.userSearchCache.set(cacheKey, { users, at: Date.now() });
    trimMap(this.userSearchCache, 20);
    return { ok: true, users, remaining: 59 - guard.used };
  }

  async fetchLibrary(kind, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const keyword = String(options.keyword || "").trim();
    const difficulty = String(options.difficulty || "").trim();
    const type = kind === "problems" && PROBLEM_TYPES.has(String(options.type || ""))
      ? String(options.type)
      : "";
    const tagGroups = kind === "problems" ? normalizeTagGroups(options.tags) : [];
    const searchContent = kind === "problems" && !!options.content;
    const force = !!options.force;
    // 无筛选时保持原 key（problems|1||），旧缓存与冒烟打桩仍可直接命中
    const cacheKey = [kind, page, keyword, difficulty]
      .concat(
        type && type !== "luogu" ? ["t:" + type] : [],
        tagGroups.length ? ["g:" + tagQuery(tagGroups)] : [],
        searchContent ? ["c:1"] : []
      )
      .join("|");
    const cached = this.libCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < 45000) return cached.payload;

    const base = { kind, page, perPage: 0, total: 0, items: [], needLogin: false, categories: [], error: "" };
    let login = null;
    if (kind === "record") {
      login = await this.loginState();
      if (!login.loggedIn) {
        return Object.assign(base, { needLogin: true });
      }
    }
    // 离线时不再碰网络：有缓存出缓存（带 stale 标记），没缓存给离线提示
    if (!this.online) {
      const hit = this.cachedLib(cacheKey);
      if (hit) return Object.assign({}, hit.payload, { stale: true, offline: true });
      return Object.assign(base, { error: "当前离线，这份列表还没有缓存过。" });
    }
    if (kind === "record") {
      const context = await this.fetchContext(
        `/record/list?user=${encodeURIComponent(login.uid || "")}&page=${page}`
      );
      if (!context) {
        // 网络失败（含刚断网还没被轮询发现）：回退缓存而不是清空列表
        const hit = this.cachedLib(cacheKey);
        if (hit) return Object.assign({}, hit.payload, { stale: true, offline: !this.online });
        return Object.assign(base, { error: "记录加载失败" });
      }
      const records = this.parseRecords(context);
      // 记录列表的分页元数据：登录态下 data.records 是 { result, count, perPage }；
      // 拿不到 count 时用「整页（20 条）→ 可能还有下一页」的保守启发，别让翻页按钮消失
      const node = findObject(
        context,
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Array.isArray(item.result) &&
          typeof item.count === "number" &&
          typeof item.perPage === "number"
      );
      const countKnown = !!(node && Number(node.count) > 0);
      const perPage = node ? Number(node.perPage) || 0 : 0;
      const full = records.length >= (perPage || 20);
      const items = records.map((record) => {
        const problem = record.problem || {};
        const status = Number(record.status);
        return {
          type: "record",
          id: record.id || record.rid || "",
          pid: String(problem.pid || record.pid || ""),
          title: String(problem.title || record.title || ""),
          status: Number.isFinite(status) ? status : null,
          statusText: Number.isFinite(status) ? STATUS_TEXT[status] || String(status) : "",
          score: Number(record.score) || 0,
          time: toMillis(record.submitTime || record.time),
          memory: Number(record.memory) || 0,
          language: String(record.languageName || record.language || ""),
        };
      });
      const payload = Object.assign(base, {
        items,
        perPage: perPage || (full ? 20 : 0),
        // count 未知时不虚报总数；library 靠 hasMore 决定要不要出「加载更多」
        total: countKnown ? Number(node.count) : items.length,
        hasMore: !countKnown && full,
      });
      this.libCache.set(cacheKey, { at: Date.now(), payload });
      trimMap(this.libCache, 30);
      this.saveLib(cacheKey, payload);
      return payload;
    }

    const params = new URLSearchParams();
    params.set("page", String(page));
    if (keyword) params.set("keyword", keyword);
    if (kind === "problems") {
      if (type && type !== "luogu") params.set("type", type);
      if (difficulty) params.set("difficulty", difficulty);
      if (tagGroups.length) params.set("tag", tagQuery(tagGroups));
      if (searchContent) params.set("content", "1");
    } else if (difficulty) {
      params.set("difficulty", difficulty);
    }
    const paths = {
      problems: "/problem/list?" + params.toString(),
      training: "/training/list?" + params.toString(),
      contest: "/contest/list?" + params.toString(),
      discuss: "/discuss?" + params.toString(),
      article: "/article?" + params.toString(),
    };
    const pathname = paths[kind];
    if (!pathname) return Object.assign(base, { error: "未知列表" });
    const context = await this.fetchContext(pathname);
    if (!context) {
      const hit = this.cachedLib(cacheKey);
      if (hit) return Object.assign({}, hit.payload, { stale: true, offline: !this.online });
      return Object.assign(base, { error: "数据加载失败，请检查网络" });
    }
    const data = context.data || {};
    const node =
      kind === "problems"
        ? data.problems
        : kind === "training"
          ? data.trainings
          : kind === "contest"
            ? data.contests
            : kind === "discuss"
              ? data.posts
              : data.articles;
    const list = node && Array.isArray(node.result) ? node.result : [];
    const categories = Array.isArray(data.categories) ? data.categories : [];
    let items = [];
    if (kind === "problems") {
      items = list.map((item) => {
        const diff = DIFFICULTY[Number(item.difficulty)] || DIFFICULTY[0];
        return {
          type: "problem",
          pid: String(item.pid || ""),
          title: String(item.name || ""),
          difficulty: Number(item.difficulty) || 0,
          difficultyName: diff.name,
          difficultyColor: diff.color,
          submissions: Number(item.totalSubmit) || 0,
          accepted: Number(item.totalAccepted) || 0,
          provider: item.provider ? String(item.provider.name || "") : "",
          tags: Array.isArray(item.tags) ? item.tags.map((tag) => Number(tag) || 0).filter(Boolean) : [],
        };
      });
    } else if (kind === "training") {
      items = list.map((item) => ({
        type: "training",
        id: String(item.id || ""),
        title: String(item.name || ""),
        provider: item.provider ? String(item.provider.name || "") : "",
        createTime: toMillis(item.createTime),
        deadline: toMillis(item.deadline),
        problemCount: Number(item.problemCount) || 0,
        markCount: Number(item.markCount) || 0,
      }));
    } else if (kind === "contest") {
      items = list.map((item) => ({
        type: "contest",
        id: String(item.id || ""),
        title: String(item.name || ""),
        start: toMillis(item.startTime),
        end: toMillis(item.endTime),
        host: item.host ? String(item.host.name || "") : "",
        rated: Number(item.rated) || 0,
        problemCount: Number(item.problemCount) || 0,
      }));
    } else if (kind === "discuss") {
      items = list.map((item) => ({
        type: "discuss",
        id: String(item.id || ""),
        title: String(item.title || ""),
        author: item.author ? String(item.author.name || "") : "",
        avatar: item.author ? String(item.author.avatar || "") : "",
        time: toMillis(item.time),
        forum: item.forum ? String(item.forum.name || "") : "",
        replyCount: Number(item.replyCount) || 0,
        topped: !!item.topped,
        locked: !!item.locked,
      }));
    } else if (kind === "article") {
      items = list.map((item) => ({
        type: "article",
        id: String(item.lid || item.id || ""),
        title: String(item.title || ""),
        author: item.author ? String(item.author.name || "") : "",
        avatar: item.author ? String(item.author.avatar || "") : "",
        time: toMillis(item.time),
        upvote: Number(item.upvote) || 0,
        replyCount: Number(item.replyCount) || 0,
        favorCount: Number(item.favorCount) || 0,
        category: Number(item.category) || 0,
        excerpt: plainExcerpt(item.content),
      }));
    }
    const payload = Object.assign(base, {
      items,
      perPage: Number(node && node.perPage) || items.length,
      total: Number(node && node.count) || items.length,
      categories: categories.map((item) => ({ key: String(item.key || ""), name: String(item.name || "") })),
    });
    this.libCache.set(cacheKey, { at: Date.now(), payload });
    this.saveLib(cacheKey, payload);
    return payload;
  }

  buildHeat(records, dailyCounts) {
    const counts = new Map();
    for (const item of Array.isArray(dailyCounts) ? dailyCounts : []) {
      if (!item || !item.date) continue;
      counts.set(String(item.date).slice(0, 10), Math.max(0, Number(item.count) || 0));
    }
    if (!counts.size) {
      for (const record of records) {
        const ms = toMillis(record.submitTime || record.time);
        if (!ms) continue;
        const key = dayKey(new Date(ms));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 与个人中心一致：26 周、以周日为一列，覆盖约半年。
    const end = new Date(today);
    end.setDate(today.getDate() + (6 - today.getDay()));
    const start = new Date(end);
    start.setDate(end.getDate() - 26 * 7 + 1);
    const days = [];
    for (let i = 0; i < 26 * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      days.push({ date: key, count: counts.get(key) || 0 });
    }
    return days;
  }

  /* 主页累计通过趋势：按题目去重，只统计首次通过，避免同一题重复提交把曲线抬高。 */
  buildProgress(records, days = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - days + 1);
    const startKey = dayKey(start);
    const todayKey = dayKey(today);
    const firstAccepted = new Map();
    for (const record of records) {
      if (Number(record && record.status) !== 12) continue;
      const ms = toMillis(record.submitTime || record.time);
      if (!ms) continue;
      const problem = record.problem || {};
      const pid = String(problem.pid || record.pid || "").toUpperCase();
      if (!pid) continue;
      if (!firstAccepted.has(pid) || ms < firstAccepted.get(pid)) firstAccepted.set(pid, ms);
    }
    const byDay = new Map();
    for (const ms of firstAccepted.values()) {
      const day = dayKey(new Date(ms));
      // 窗口前已经 AC 过的老题，窗口内再次 AC 不算“新通过”。
      if (day < startKey || day > todayKey) continue;
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    let cumulative = 0;
    const points = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = dayKey(d);
      const passed = byDay.get(date) || 0;
      cumulative += passed;
      points.push({ date, passed, cumulative });
    }
    return { points, total: firstAccepted.size };
  }

  buildRecent(records) {
    return records
      .slice()
      .sort((a, b) => toMillis(b.submitTime || b.time) - toMillis(a.submitTime || a.time))
      .slice(0, 5)
      .map((record) => {
        const problem = record.problem || {};
        const pid = String(problem.pid || record.pid || "");
        const title = String(problem.title || problem.name || record.title || "");
        const status = Number(record.status);
        return {
          pid,
          title,
          status: Number.isFinite(status) ? status : null,
          statusText: Number.isFinite(status) ? STATUS_TEXT[status] || String(status) : "",
          score: Number(record.score) || 0,
          time: toMillis(record.submitTime || record.time),
        };
      })
      .filter((item) => item.pid);
  }

  pickContest(contests) {
    const now = Date.now();
    const prepared = contests
      .map((contest) => ({
        id: contest.id,
        name: contest.name || contest.title || "比赛",
        start: toMillis(contest.startTime),
        end: toMillis(contest.endTime) || (toMillis(contest.startTime) + (Number(contest.duration) || 0) * 1000),
      }))
      .filter((contest) => contest.start)
      .sort((a, b) => a.start - b.start);
    const live = prepared.find((contest) => contest.start <= now && contest.end && now <= contest.end);
    if (live) return Object.assign({}, live, { live: true });
    const next = prepared.find((contest) => contest.start > now);
    if (next) return Object.assign({}, next, { live: false });
    return null;
  }

  /* 0.7.2 主页比赛日历：进行中的排前，取前 5 场 */
  buildContests(contests) {
    const now = Date.now();
    const prepared = contests
      .map((contest) => ({
        id: contest.id,
        name: contest.name || contest.title || "比赛",
        start: toMillis(contest.startTime),
        end: toMillis(contest.endTime) || (toMillis(contest.startTime) + (Number(contest.duration) || 0) * 1000),
      }))
      .filter((contest) => contest.start)
      .sort((a, b) => a.start - b.start);
    const live = prepared.filter((contest) => contest.start <= now && contest.end && now <= contest.end);
    const upcoming = prepared.filter((contest) => contest.start > now);
    return live.concat(upcoming).slice(0, 5);
  }

  /* ---------- 主刷新 ---------- */

  async refresh(force = false) {
    if (this.refreshing) {
      await new Promise((resolve) => this.refreshWaiters.push(resolve));
      return this.state();
    }
    if (!force && Date.now() - this.lastRefresh < 20000) return this.state();
    // 离线时保留现有/缓存数据不动，不要用一轮失败的抓取把好数据清掉
    if (!this.online) {
      if (this.ctx.emitState) this.ctx.emitState();
      return this.state();
    }
    this.refreshing = true;
    const prev = this.home;
    let networkFailed = false;
    let stage = "login";
    const slowTimer = setTimeout(() => {
      console.warn("[luogu] refresh slow at " + stage);
    }, 15000);
    try {
      const login = await this.loginState();
      this.user = { loggedIn: login.loggedIn, uid: login.uid, name: "", avatar: "" };
      const next = {
        quote: quoteFor(new Date()),
        heat: [],
        acProgress: [],
        acRecentTotal: 0,
        contest: null,
        contests: [],
        official: null,
        recent: [],
        punched: null,
        streak: 0,
        updatedAt: Date.now(),
        error: "",
      };

      // 比赛列表是公开数据：未登录也抓，主页不至于空着
      stage = "contests";
      try {
        const contestContext = await this.fetchContext("/contest/list");
        const all = this.parseContests(contestContext);
        next.contest = this.pickContest(all);
        next.contests = this.buildContests(all);
      } catch (err) {
        console.error("[luogu] contest fetch threw", err && err.message);
      }

      // 0.7.2 官方主页融合块：比赛倒计时/欢迎/运势（旧版首页 DOM，游客可见倒计时）
      stage = "official-home";
      try {
        next.official = await this.fetchOfficialHome();
      } catch (err) {
        console.error("[luogu] official home scrape failed:", err && err.message);
      }

      if (login.loggedIn) {
        stage = "profile";
        let profileContext = null;
        if (login.uid) profileContext = await this.fetchContext("/user/" + login.uid);
        const profile = this.parseUser(profileContext, login.uid);
        if (profile) {
          this.user.name = String(profile.name || "");
          this.user.avatar = String(profile.avatar || "");
          this.user.submittedProblemCount =
            profile.submittedProblemCount == null ? null : Math.max(0, Number(profile.submittedProblemCount) || 0);
          this.user.passedProblemCount =
            profile.passedProblemCount == null ? null : Math.max(0, Number(profile.passedProblemCount) || 0);
          this.user.ranking = profile.ranking == null ? null : Math.max(0, Number(profile.ranking) || 0);
        }

        let records = [];
        // 最近提交只需要第一页；热力图直接消费个人中心 dailyCounts。
        // 不再为自绘半年图翻 12 页记录，既保持官网口径又显著降低内存/请求量。
        stage = "records";
        const recordContext = await this.fetchContext(
          `/record/list?user=${encodeURIComponent(login.uid)}&page=1`
        );
        // cookie 还在但服务端会话已过期时，记录页会返回 needLogin 错误页
        if (recordContext && recordContext.data && recordContext.data.errorCode) {
          this.user.loggedIn = false;
          next.error = "登录已过期，请重新登录";
        } else if (!recordContext) {
          networkFailed = true;
        } else {
          records = this.parseRecords(recordContext);
        }
        const dailyCounts = this.parseDailyCounts(profileContext);
        stage = "assemble";
        next.heat = this.buildHeat(records, dailyCounts);
        const progress = this.buildProgress(records);
        next.acProgress = progress.points;
        next.acRecentTotal = progress.total;
        next.recent = this.buildRecent(records);

        const punch = await this.readPunchState();
        next.punched = punch.punched;
        next.streak = punch.streak;
        if (!this.user.name) this.user.name = "洛谷用户";
      }

      // 抓取中途断网：保留上一次的打卡/热力/最近提交，只更新拿到的部分
      if (networkFailed) {
        if (!next.contest && prev.contest) next.contest = prev.contest;
        if (!next.contests.length && prev.contests && prev.contests.length) next.contests = prev.contests;
        if (!next.official && prev.official) next.official = prev.official;
        if (!next.heat.length && prev.heat && prev.heat.length) next.heat = prev.heat;
        if (!next.acProgress.length && prev.acProgress && prev.acProgress.length) {
          next.acProgress = prev.acProgress;
          next.acRecentTotal = prev.acRecentTotal || 0;
        }
        if (!next.recent.length && prev.recent && prev.recent.length) next.recent = prev.recent;
        if (next.punched === null && prev.punched !== null) {
          next.punched = prev.punched;
          next.streak = prev.streak;
        }
        next.updatedAt = prev.updatedAt || next.updatedAt;
      }

      this.home = next;
      this.lastRefresh = Date.now();
      stage = "persist";
      this.persistSnapshot();
    } catch (err) {
      const message = String((err && err.message) || "主页同步失败").slice(0, 240);
      const hasUsableSnapshot = !!(
        prev &&
        (prev.updatedAt ||
          (prev.heat || []).some((item) => Number(item.count) > 0) ||
          (prev.acProgress || []).length ||
          (prev.recent || []).length ||
          (prev.contests || []).length ||
          prev.official)
      );
      // 一次临时脚本/网络失败不能把已有主页推成「数据同步失败」大卡片；
      // 保留上一份可用快照，下一轮静默重试即可。
      this.home = hasUsableSnapshot
        ? Object.assign({}, prev, { error: "" })
        : Object.assign({}, prev || this.home, { error: message });
      console.error("[luogu] refresh(" + stage + "):", message);
    } finally {
      clearTimeout(slowTimer);
      this.refreshing = false;
      const waiters = this.refreshWaiters.splice(0);
      for (const resolve of waiters) resolve();
      if (this.ctx.emitState) this.ctx.emitState();
    }
    return this.state();
  }

  /* 主页/身份快照落盘：断网启动时 hydrate() 回填的就是这里写的。 */
  persistSnapshot() {
    const store = this.ctx.store;
    if (!store) return;
    store.set("home", this.home, 800);
    store.set("user", this.user, 800);
  }

  /* 0.7.2 官方主页融合：只抓结构化倒计时与可识别的运势片段。
     昵称统一使用登录资料；无法识别的打卡容器文本必须丢弃，禁止整块文本回填。 */
  async fetchOfficialHome() {
    const data = await this.exec(`(() => {
      const root = document.querySelector("#app-old .lg-index-content") || document.querySelector("#app-old");
      if (!root) return { ok: false };
      const text = (el) => ((el && el.textContent) || "").replace(/\\s+/g, " ").trim();
      const absolute = (href) => {
        try { return new URL(href, location.origin).href; } catch { return ""; }
      };
      const articles = Array.from(root.querySelectorAll(".lg-article"));
      const headingOf = (article) => text(article && article.querySelector("h2, h3, .panel-title"));
      const findSection = (wanted) => articles.find((article) => headingOf(article) === wanted) || null;
      const uniqueLinks = (node, limit = 40, pattern = "") => {
        if (!node) return [];
        const re = pattern ? new RegExp(pattern) : null;
        return Array.from(node.querySelectorAll("a[href]"))
          .map((a) => ({ title: text(a).slice(0, 120), url: absolute(a.getAttribute("href")) }))
          .filter((item) => item.title && item.url && (!re || re.test(item.url)))
          .filter((item, index, list) => list.findIndex((x) => x.url === item.url) === index)
          .slice(0, limit);
      };

      const countdowns = [];
      const countdownText = String((root.querySelector(".lg-punch") && root.querySelector(".lg-punch").innerText) || "");
      for (const raw of countdownText.split("\\n")) {
        const line = raw.replace(/\\s+/g, " ").trim();
        const m = line.match(/距\\s*(.+?)\\s*还剩\\s*(-?\\d+)\\s*天/);
        if (m) countdowns.push({ name: m[1].trim(), days: Number(m[2]) });
      }

      const punch = root.querySelector(".lg-punch");
      const punchText = punch ? String(punch.innerText || punch.textContent || "") : "";
      const punchLines = punchText.split("\\n").map((line) => line.replace(/\\s+/g, " ").trim()).filter(Boolean);
      const resultNode = punch && punch.querySelector(".lg-punch-result, [class*='punch-result']");
      const resultText = text(resultNode) || (punchLines.find((line) => /大吉|中吉|小吉|末吉|大凶|凶|吉/.test(line)) || "");
      const fortuneResult = (resultText.match(/(大吉|中吉|小吉|末吉|大凶|凶|吉)/) || [])[1] || "";
      const adviceNodes = punch
        ? Array.from(punch.querySelectorAll(".am-u-sm-6, .lg-punch-advice, [class*='fortune'], [class*='advice']"))
        : [];
      const advice = [];
      for (const node of adviceNodes) {
        const value = text(node);
        if (value && !advice.includes(value)) advice.push(value);
      }
      for (const line of punchLines) {
        if (/^[宜忌]\\s*[:：]/.test(line) && !advice.includes(line)) advice.push(line);
      }
      const part = (prefix) => {
        const row = advice.find((item) => item.startsWith(prefix));
        return row ? row.slice(prefix.length).replace(/^[\\s:：]+/, "").replace(/[§·,，。;；\\s]+$/g, "").slice(0, 36) : "";
      };
      const fortuneGood = part("宜");
      const fortuneBad = part("忌");
      const punched = /已打卡|已签到|今日已/.test(punchText);
      const streakMatch = punchText.match(/(\\d+)\\s*天/);
      const fortune = fortuneResult || fortuneGood || fortuneBad
        ? { result: fortuneResult, good: fortuneGood, bad: fortuneBad, advice, text: punchText }
        : null;

      const linksNode = findSection("友情链接");
      const linkGroups = [];
      if (linksNode) {
        for (const p of Array.from(linksNode.querySelectorAll("p"))) {
          const strong = p.querySelector("strong");
          const links = uniqueLinks(p, 20);
          if (links.length) linkGroups.push({ title: text(strong) || "相关链接", links });
        }
        if (!linkGroups.length) linkGroups.push({ title: "相关链接", links: uniqueLinks(linksNode, 40) });
      }

      const announcementNode = findSection("本站公告");
      const discussionNode = findSection("最近讨论");
      const contestNode = findSection("近期比赛");
      const contestItems = contestNode
        ? Array.from(contestNode.querySelectorAll("section.am-panel, [class*='contest']"))
            .map((node) => {
              const titleLink = node.querySelector("h3 a[href], h2 a[href], a[href]");
              const title = text(titleLink);
              if (!title) return null;
              return {
                title,
                url: absolute(titleLink.getAttribute("href")),
                badges: Array.from(node.querySelectorAll(".am-badge")).map(text).filter(Boolean).slice(0, 4),
                meta: text(node.querySelector(".am-panel-bd, [class*='body']")).slice(0, 260),
              };
            })
            .filter(Boolean)
            .filter((item, index, list) => list.findIndex((x) => x.url === item.url && x.title === item.title) === index)
            .slice(0, 8)
        : [];

      const tasksFor = (wanted) => {
        const node = findSection(wanted);
        if (!node) return { title: wanted, text: "", items: [] };
        const itemMap = new Map();
        const candidates = Array.from(node.querySelectorAll("li, a[href], button, [role='button'], [class*='task'], [class*='mission'], [class*='todo']"));
        const push = (element) => {
          if (!element || element === node) return;
          const lines = String(element.innerText || "")
            .split("\\n")
            .map((line) => line.replace(/\\s+/g, " ").trim())
            .filter(Boolean)
            .filter((line) => line !== wanted);
          if (!lines.length) return;
          const title = lines[0].slice(0, 180);
          if (!title || title.length < 2) return;
          const all = lines.join(" ");
          const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
          const url = link ? absolute(link.getAttribute("href")) : "";
          const meta = lines.slice(1, 5).join(" · ").slice(0, 260);
          const progressMatch = all.match(/(\\d+\\s*\\/\\s*\\d+|\\d+\\s*%)/);
          const item = {
            title,
            meta,
            url,
            progress: progressMatch ? progressMatch[1].replace(/\\s+/g, "") : "",
            done: /已完成|已领取|已打卡/.test(all),
          };
          const key = [url, title, meta].join("|");
          if (!itemMap.has(key)) itemMap.set(key, item);
        };
        for (const element of candidates.slice(0, 160)) push(element);
        let items = Array.from(itemMap.values());
        if (!items.length) {
          const lines = String(node.innerText || "")
            .split("\\n")
            .map((line) => line.replace(/\\s+/g, " ").trim())
            .filter(Boolean)
            .filter((line) => line !== wanted);
          items = lines.slice(0, 60).map((line) => ({ title: line.slice(0, 180), meta: "", url: "", progress: "", done: /已完成|已领取|已打卡/.test(line) }));
        }
        return { title: wanted, text: text(node).slice(0, 6000), items: items.slice(0, 60) };
      };
      const taskPlan = tasksFor("任务计划");
      const taskData = taskPlan.items.length ? taskPlan : tasksFor("智能推荐");

      const discussionLinks = uniqueLinks(discussionNode, 12, "/discuss/");
      return {
        ok: true,
        countdowns: countdowns.slice(0, 4),
        fortune,
        punch: {
          punched,
          streak: streakMatch ? Number(streakMatch[1]) : 0,
          text: punchText,
        },
        sections: {
          announcement: { title: "本站公告", text: text(announcementNode).slice(0, 6000), links: uniqueLinks(announcementNode, 40) },
          tasks: taskData,
          links: { title: "友情链接", text: text(linksNode).slice(0, 6000), groups: linkGroups },
          discussions: { title: "最近讨论", items: discussionLinks },
          contests: { title: "近期比赛", items: contestItems },
          quickJump: { title: "问题跳转", text: text(findSection("问题跳转")).slice(0, 500) },
        },
      };
    })()`);
    if (!data || data.ok !== true) return null;
    return data;
  }

  async readPunchState() {
    const result = await this.exec(`(() => {
      const clean = (node) => String((node && node.textContent) || "").replace(/\\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll(
        ".lg-punch, [class*='punch'], [class*='checkin'], [class*='check-in'], [class*='signin'], [class*='sign-in']"
      ));
      const controls = Array.from(document.querySelectorAll("button, a, [role='button'], [onclick], .am-btn"));
      const target = controls.find((node) => /^(签到|打卡|已签到|已打卡|今日已签)/.test(clean(node)));
      if (target) {
        const panel = target.closest(".am-panel, .card, section, [class*='punch'], [class*='checkin'], [class*='signin']");
        if (panel) cards.push(panel);
      }
      const uniqueCards = cards.filter((node, index) => node && cards.indexOf(node) === index);
      const text = uniqueCards.map(clean).filter(Boolean).join(" ");
      const btnText = target ? clean(target) : "";
      const streakMatch = (text + " " + btnText).match(/(\\d+)\\s*天/);
      return {
        punched: /已打卡|已签到|今日已/.test(text + " " + btnText),
        hasButton: !!target,
        hasCard: uniqueCards.length > 0,
        streak: streakMatch ? Number(streakMatch[1]) : 0
      };
    })()`);
    if (!result) return { punched: null, hasButton: false, hasCard: false, streak: 0 };
    return {
      punched: result.punched || (result.hasCard && result.hasButton === false ? false : null),
      hasButton: !!result.hasButton,
      hasCard: !!result.hasCard,
      streak: result.streak || 0,
    };
  }

  async checkin() {
    if (!this.online) return { ok: false, message: "当前离线，签到需要联网后进行。" };
    const refreshedMs = Number(this.home && this.home.updatedAt) || 0;
    const homeAge = Date.now() - refreshedMs;
    const homeDay = refreshedMs ? new Date(refreshedMs).toDateString() : "";
    const today = new Date().toDateString();
    if (homeDay === today && homeAge < 30 * 60 * 1000 && this.home && this.home.punched === true) {
      const refreshed = await this.refresh(true);
      const payload = refreshed && refreshed.home ? refreshed.home : this.home;
      return {
        ok: true,
        already: true,
        home: refreshed,
        fortune: payload && payload.official ? payload.official.fortune || null : null,
      };
    }
    const punchState = await this.readPunchState();
    if (punchState.punched) {
      // 已签到时仍强制同步一次，确保历史登录会话能立刻拿到当天真实运势。
      const refreshed = await this.refresh(true);
      return {
        ok: true,
        already: true,
        home: refreshed,
        fortune: refreshed && refreshed.home && refreshed.home.official ? refreshed.home.official.fortune || null : null,
      };
    }
    const clickScript = `(() => {
      const clean = (node) => String((node && node.textContent) || "").replace(/\\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll(
        ".lg-punch, [class*='punch'], [class*='checkin'], [class*='check-in'], [class*='signin'], [class*='sign-in']"
      ));
      const scoped = Array.from(document.querySelectorAll(
        ".lg-punch button, .lg-punch a, [class*='punch'] button, [class*='punch'] a, " +
        "[class*='checkin'] button, [class*='checkin'] a, [class*='signin'] button, [class*='signin'] a, " +
        "[name='punch'], [name='checkin'], [role='button'], .am-btn"
      ));
      const controls = Array.from(new Set(scoped.concat(
        Array.from(document.querySelectorAll("button, a, [role='button'], [onclick], .am-btn"))
      )));
      const target = controls.find((node) => /^(签到|打卡|已签到|已打卡|今日已签)/.test(clean(node)));
      if (!target) return { ok: false, reason: "not-found" };
      const panel = target.closest(".am-panel, .card, section, [class*='punch'], [class*='checkin'], [class*='signin']");
      if (/已打卡|已签到|今日已/.test(clean(panel) + " " + clean(target))) return { ok: true, already: true };
      if (target.disabled || target.classList.contains("am-disabled")) return { ok: false, reason: "disabled" };
      target.click();
      return { ok: true, clicked: true };
    })()`;
    let result = await this.exec(clickScript);
    if (!result || !result.ok) {
      // 首页可能还没渲染出打卡卡，重载一次再试
      this.reloadHidden();
      await delay(3500);
      result = await this.exec(clickScript);
    }
    if (!result || !result.ok) {
      // 页面 DOM 已更新但选择器没命中时，先用一次完整同步确认是否其实已签到，
      // 避免把“今日已完成”误报成失败。
      const refreshed = await this.refresh(true);
      const payload = refreshed && refreshed.home ? refreshed.home : this.home;
      if (payload && payload.punched === true) {
        return {
          ok: true,
          already: true,
          home: refreshed,
          fortune: payload.official ? payload.official.fortune || null : null,
        };
      }
      return { ok: false, uncertain: true, message: "暂时没找到签到入口，可能今天已经完成。请刷新主页确认。" };
    }
    let confirmed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(attempt === 0 ? 1200 : 650);
      const stateAfter = await this.readPunchState();
      if (stateAfter && stateAfter.punched) {
        confirmed = true;
        break;
      }
    }
    let refreshed = null;
    if (confirmed) refreshed = await this.refresh(true);
    if (!confirmed) {
      // 页面 DOM 尚未换新时再完整同步一次；refresh 内部也会重新读取打卡卡。
      refreshed = await this.refresh(true);
      confirmed = !!(refreshed && refreshed.home && refreshed.home.punched);
    }
    if (!confirmed) {
      return { ok: false, message: "洛谷没有确认签到成功，请稍后重试。" };
    }
    return {
      ok: true,
      already: !!result.already,
      home: refreshed,
      fortune: refreshed && refreshed.home && refreshed.home.official ? refreshed.home.official.fortune || null : null,
    };
  }

  /* ---------- 提交 ---------- */

  async fetchCaptchaPng() {
    // 提交验证码的图从 /api/verify/captcha 取（洛谷新前端提交重试用的就是这个路由，
    // 与 /lg4/captcha 是两套；拿错端点的图提交必被拒）
    const data = await this.exec(
      `(async () => {
        const r = await fetch("/api/verify/captcha?_t=" + Date.now(), { credentials: "include" });
        const b = await r.blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
      })()`
    );
    if (!data || typeof data !== "string" || data.indexOf(",") === -1) return null;
    try {
      return Buffer.from(String(data).split(",").pop(), "base64");
    } catch {
      return null;
    }
  }

  async submit(pid, code, lang, captcha = "", o2 = false) {
    const result = await this.submitOnce(pid, code, lang, captcha, o2);
    if (result.ok || !result.captchaRequired || captcha) return result;
    // 交互式挑战（易盾滑块等）是洛谷的反自动化设计，不破解——交给页面内提交辅助。
    if (result.interactive) return result;
    // 图片验证码：本机有 ddddocr 时换新图最多再试 3 次；不可用则保持 captchaRequired 语义
    for (let attempt = 0; attempt < 3; attempt++) {
      const png = await this.fetchCaptchaPng();
      if (!png) break;
      const ocr = await captchaOcr(png);
      if (!ocr.ok) {
        console.log("[luogu] 验证码自动识别不可用 " + (ocr.reason || ""));
        break;
      }
      const retry = await this.submitOnce(pid, code, lang, ocr.text, o2);
      console.log(
        "[luogu] 提交验证码自动识别 #" +
          (attempt + 1) +
          " " +
          ocr.text +
          " → " +
          (retry.ok ? "通过" : "未通过 status=" + retry.status + " detail=" + String(retry.detail || "").slice(0, 100))
      );
      if (retry.ok || !retry.captchaRequired) return retry;
    }
    return result;
  }

  async submitOnce(pid, code, lang, captcha = "", o2 = false) {
    const langInfo = resolveLangId(lang);
    if (!langInfo) {
      // 不认识的语言不能悄悄按 C++14 交上去（那是数据事故）——转页面内提交辅助，
      // 用户在洛谷真实下拉里自选语言。
      return {
        ok: false,
        fallback: true,
        unsupportedLang: true,
        message: `暂不支持的语言「${lang || "未指定"}」，请在题目页的提交区选择语言提交。`,
      };
    }
    const langId = langInfo.id;
    // CSRF token 在页面 meta[name=csrf-token] 里，随会话轮换，不能拿 cookie 顶替。
    // payload 形状照抄洛谷新前端 columba bundle：{ code, lang: <数字id>, enableO2: 0|1, captcha }；
    // lang 必须是数字（字符串会被 record.invalid_language_type 拒），验证码字段是 captcha（不是 verify）。
    // enableO2 只对 canO2 的语言有效（C/C++/Pascal/Rust/Haskell/OCaml），其余语言传 0。
    const enableO2 = o2 && langInfo.o2 ? 1 : 0;
    const script = `(async () => {
      const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
      const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest", "x-csrf-token": csrf };
      const tryReq = async (url, bodyText) => {
        try {
          const r = await fetch(url, { method: "POST", headers, body: bodyText, credentials: "include" });
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch {}
          // interactive 字段在 errorData 末尾，必须在全文上匹配（截断文本里没有）
          const interactive = (text.match(/"interactive"\\s*:\\s*\\{\\s*"type"\\s*:\\s*"([A-Z]+)"/) || [])[1] || "";
          return { status: r.status, json, text: text.slice(0, 240), interactive };
        } catch (e) { return { status: 0, error: String(e) }; }
      };
      const ridOf = (j) => j && (j.rid || (j.data && j.data.rid) || (j.currentData && j.currentData.rid));
      const code = ${JSON.stringify(code)};
      const captcha = ${JSON.stringify(String(captcha || ""))};
      const body = captcha
        ? { code, lang: ${Number(langId)}, enableO2: ${Number(enableO2)}, captcha }
        : { code, lang: ${Number(langId)}, enableO2: ${Number(enableO2)} };
      const res = await tryReq("/fe/api/problem/submit/${pid}", JSON.stringify(body));
      if (ridOf(res.json)) return { ok: true, rid: ridOf(res.json) };
      const text = String(res.text || "");
      if (text.indexOf("Captcha") !== -1 || text.indexOf("验证码") !== -1) {
        return { ok: false, captchaRequired: true, interactive: res.interactive || "", status: res.status, detail: text.slice(0, 200) };
      }
      return { ok: false, status: res.status, detail: res.text || res.error || "no response" };
    })()`;
    const result = await this.exec(script);
    if (result && result.captchaRequired) {
      return {
        ok: false,
        captchaRequired: true,
        interactive: result.interactive || "",
        status: result.status || 0,
        detail: result.detail || "",
        message: "本次提交需要图形验证码，已在题目页打开提交区。",
      };
    }
    if (!result || !result.ok) {
      return {
        ok: false,
        fallback: true,
        message: "自动提交没有成功，代码已复制，请在题目页内提交。",
        detail: result ? String(result.detail || result.error || "").slice(0, 300) : "exec failed",
        status: result ? result.status : 0,
      };
    }
    this.watchRecord(result.rid, pid).catch(() => {});
    return { ok: true, rid: result.rid };
  }

  async watchRecord(rid, pid) {
    for (let i = 0; i < 50; i++) {
      await delay(1500);
      const context = await this.fetchContext("/record/" + rid);
      if (!context) continue;
      const record = findObject(context, (item) => item && typeof item === "object" && "status" in item && "score" in item);
      if (!record) continue;
      const status = Number(record.status);
      if (status === 0 || status === 1) continue;
      const score = Number(record.score);
      const text = STATUS_TEXT[status] || String(status);
      const title = `评测完成 · ${pid} ${text}`;
      const body = `${score} 分${record.time ? " · " + record.time + "ms" : ""}`;
      if (this.ctx.cfg.get().notify.judge) {
        const notification = new Notification({ title, body });
        notification.on("click", () => {
          this.ctx.showWindow && this.ctx.showWindow();
          this.ctx.views && this.ctx.views.openProblem(pid);
        });
        notification.show();
      }
      if (this.ctx.notify && this.ctx.notify.judgeDone) this.ctx.notify.judgeDone(status === 12 ? "ac" : "wa");
      if (this.ctx.emitState) this.ctx.emitState();
      return;
    }
  }

  /* ---------- 题目快照（离线阅读） ---------- */

  problemSnapshotUrl(pid) {
    const store = this.ctx.store;
    if (!store) return "";
    const snap = store.get("problem:" + String(pid || "").toUpperCase(), null);
    return snap && snap.html ? "lgoff://problem/" + encodeURIComponent(String(pid).toUpperCase()) : "";
  }

  hasProblemSnapshot(pid) {
    return !!this.problemSnapshotUrl(pid);
  }

  /* views.js 在题目页渲染稳定后调用：把已渲染的题面 DOM 存下来。
     存 DOM 而不是 markdown 源文本——洛谷自己渲染的 KaTeX/代码高亮直接保留，
     离线页零渲染成本；换来的代价是快照比源文本大，靠数量上限约束。 */
  saveProblemSnapshot(pid, title, html) {
    const store = this.ctx.store;
    if (!store || !html || html.length < 200) return false;
    const key = "problem:" + String(pid || "").toUpperCase();
    store.set(
      key,
      {
        key,
        pid: String(pid).toUpperCase(),
        title: String(title || pid || "").slice(0, 120),
        html: String(html).slice(0, 600000),
        url: "https://www.luogu.com.cn/problem/" + String(pid).toUpperCase(),
        savedAt: Date.now(),
      },
      600
    );
    store.evict("problem:", 40);
    return true;
  }

  problemSnapshot(pid) {
    const store = this.ctx.store;
    if (!store) return null;
    return store.get("problem:" + String(pid || "").toUpperCase(), null);
  }

  async logout() {
    try {
      await this.ctx.session.clearStorageData({ storages: ["cookies"] });
    } catch {
      /* ignore */
    }
    this.libCache.clear();
    this.lastRefresh = 0;
    // 本地快照属于上一个账号，一并清掉（题目快照是公开题面，保留无害但顺手清理列表/主页）
    const store = this.ctx.store;
    if (store) {
      store.delete("home");
      store.delete("user");
      for (const entry of store.entries("lib:")) store.delete(entry.key);
    }
    await this.refresh(true);
  }

  state() {
    return { user: this.user, home: this.home };
  }
}

module.exports = { LuoguService, STATUS_TEXT, QUOTES };
