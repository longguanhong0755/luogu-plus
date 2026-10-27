/* 洛谷数据服务。
   登录态用 cookie（__client_id / _uid）判断；页面数据在隐藏窗口的页面上下文里
   fetch 真实页面，解析 #lentille-context 的 JSON（洛谷新前端把服务端直出数据放在
   这个 script 里），不依赖易变的私有 API。
   签到用页面内点击（洛谷的打卡本身是前端行为），提交先尝试接口、失败则回退。 */
const { BrowserWindow, Notification } = require("electron");

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

class LuoguService {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.loadPromise = null;
    this.user = { loggedIn: false, uid: null, name: "", avatar: "" };
    this.home = {
      quote: quoteFor(new Date()),
      heat: [],
      contest: null,
      recent: [],
      punched: null,
      streak: 0,
      updatedAt: 0,
      error: "",
    };
    this.refreshing = false;
    this.lastRefresh = 0;
    this.libCache = new Map();
    this.tagsCache = null;
    this.tagsPromise = null;
    /* 断网可用：在线状态由主窗口 navigator.onLine 轮询 + 页面 fetch 失败反馈共同维护。 */
    this.online = true;
    this.onlineTimer = null;
    this.flushing = false;
    this.queueTimer = null;
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
    }, 10000);
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
        backgroundThrottling: false,
      },
    });
    this.win.loadURL("https://www.luogu.com.cn/");
    this.loadPromise = new Promise((resolve) => {
      const done = () => resolve();
      this.win.webContents.once("did-stop-loading", done);
      this.win.webContents.once("did-fail-load", done);
      setTimeout(done, 12000);
    });
    return this.win;
  }

  async exec(script) {
    this.ensureWindow();
    await this.loadPromise;
    if (!this.win || this.win.isDestroyed()) return null;
    // reload/导航期间 executeJavaScript 会失败，这里统一等待
    try {
      const wc = this.win.webContents;
      if (wc.isLoading()) {
        await new Promise((resolve) => {
          const done = () => resolve();
          wc.once("did-stop-loading", done);
          setTimeout(done, 10000);
        });
      }
    } catch {
      /* ignore */
    }
    try {
      return await this.win.webContents.executeJavaScript(script, true);
    } catch (err) {
      console.error("[luogu] exec:", err.message);
      return null;
    }
  }

  reloadHidden() {
    if (!this.win || this.win.isDestroyed()) return;
    this.loadPromise = new Promise((resolve) => {
      const done = () => resolve();
      this.win.webContents.once("did-stop-loading", done);
      this.win.webContents.once("did-fail-load", done);
      setTimeout(done, 12000);
    });
    this.win.webContents.reload();
  }

  async fetchContext(pathname) {
    const url = pathname.startsWith("http") ? pathname : "https://www.luogu.com.cn" + pathname;
    // 离线时页面 fetch 立刻失败，重试五次只是白等——直接走调用方的缓存回退
    if (!this.online) return null;
    let lastFail = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.exec(
        `(async () => {
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: "include", signal: AbortSignal.timeout(9000) });
            const text = await r.text();
            const m = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\\s\\S]*?)<\\/script>/);
            if (!m) return { ok: false, status: r.status, reason: "no-ctx", len: text.length, online: navigator.onLine };
            try {
              return { ok: true, context: JSON.parse(m[1]), online: navigator.onLine };
            } catch (e) {
              return { ok: false, status: r.status, reason: "parse", detail: String(e).slice(0, 120), online: navigator.onLine };
            }
          } catch (e) {
            return { ok: false, error: String(e).slice(0, 120), online: navigator.onLine };
          }
        })()`
      );
      // 页面上下文顺手回报 OS 网络状态：轮询之外最快的离线感知途径
      if (result && typeof result.online === "boolean") this.setOnline(result.online);
      if (result && result.ok && result.context) return result.context;
      if (result && result.online === false) return null;
      lastFail = JSON.stringify(result);
      await delay(800);
    }
    console.error("[luogu] fetchContext failed", pathname, lastFail);
    return null;
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

  buildHeat(records) {
    const counts = new Map();
    for (const record of records) {
      const ms = toMillis(record.submitTime || record.time);
      if (!ms) continue;
      const key = dayKey(new Date(ms));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 139);
    const cellByDate = new Map();
    for (const [key, count] of counts) cellByDate.set(key, count);
    const days = [];
    for (let i = 0; i < 140; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      days.push({ date: key, count: cellByDate.get(key) || 0 });
    }
    return days;
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

  /* ---------- 主刷新 ---------- */

  async refresh(force = false) {
    if (this.refreshing) return this.state();
    if (!force && Date.now() - this.lastRefresh < 20000) return this.state();
    // 离线时保留现有/缓存数据不动，不要用一轮失败的抓取把好数据清掉
    if (!this.online) {
      if (this.ctx.emitState) this.ctx.emitState();
      return this.state();
    }
    this.refreshing = true;
    const prev = this.home;
    let networkFailed = false;
    try {
      const login = await this.loginState();
      this.user = { loggedIn: login.loggedIn, uid: login.uid, name: "", avatar: "" };
      const next = {
        quote: quoteFor(new Date()),
        heat: [],
        contest: null,
        recent: [],
        punched: null,
        streak: 0,
        updatedAt: Date.now(),
        error: "",
      };

      // 比赛列表是公开数据：未登录也抓，主页不至于空着
      try {
        const contestContext = await this.fetchContext("/contest/list");
        next.contest = this.pickContest(this.parseContests(contestContext));
      } catch (err) {
        console.error("[luogu] contest fetch threw", err && err.message);
      }

      if (login.loggedIn) {
        let profileContext = null;
        if (login.uid) profileContext = await this.fetchContext("/user/" + login.uid);
        const profile = this.parseUser(profileContext, login.uid);
        if (profile) {
          this.user.name = String(profile.name || "");
          this.user.avatar = String(profile.avatar || "");
        }

        let records = [];
        // 热力图只要最近 140 天：翻页翻到早于窗口起点就可以停，别为边缘数据拉满 6 页
        const heatWindowStart = Date.now() - 140 * 86400000;
        for (let page = 1; page <= 6; page++) {
          const context = await this.fetchContext(
            `/record/list?user=${encodeURIComponent(login.uid)}&page=${page}`
          );
          // cookie 还在但服务端会话已过期时，记录页会返回 needLogin 错误页
          if (context && context.data && context.data.errorCode) {
            this.user.loggedIn = false;
            next.error = "登录已过期，请重新登录";
            break;
          }
          if (!context) {
            networkFailed = true;
            break;
          }
          const pageRecords = this.parseRecords(context);
          if (!pageRecords.length) break;
          records = records.concat(pageRecords);
          if (pageRecords.length < 20) break;
          const oldest = pageRecords.reduce((min, record) => {
            const ms = toMillis(record.submitTime || record.time);
            return ms && ms < min ? ms : min;
          }, Infinity);
          if (oldest < heatWindowStart) break;
        }
        next.heat = this.buildHeat(records);
        next.recent = this.buildRecent(records);

        const punch = await this.readPunchState();
        next.punched = punch.punched;
        next.streak = punch.streak;
        if (!this.user.name) this.user.name = "洛谷用户";
      }

      // 抓取中途断网：保留上一次的打卡/热力/最近提交，只更新拿到的部分
      if (networkFailed) {
        if (!next.contest && prev.contest) next.contest = prev.contest;
        if (!next.heat.length && prev.heat && prev.heat.length) next.heat = prev.heat;
        if (!next.recent.length && prev.recent && prev.recent.length) next.recent = prev.recent;
        if (next.punched === null && prev.punched !== null) {
          next.punched = prev.punched;
          next.streak = prev.streak;
        }
        next.updatedAt = prev.updatedAt || next.updatedAt;
      }

      this.home = next;
      this.lastRefresh = Date.now();
      this.persistSnapshot();
    } catch (err) {
      this.home.error = err.message;
      console.error("[luogu] refresh:", err.message);
    } finally {
      this.refreshing = false;
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

  async readPunchState() {
    const result = await this.exec(`(() => {
      const card = document.querySelector(".lg-punch") || document.querySelector('[class*="punch"]');
      const text = card ? card.textContent || "" : "";
      const buttons = Array.from(document.querySelectorAll("button, a, .am-btn"));
      const target = buttons.find((b) => /打卡|签到/.test(b.textContent || ""));
      const btnText = target ? target.textContent || "" : "";
      const streakMatch = (text + " " + btnText).match(/(\\d+)\\s*天/);
      return {
        punched: /已打卡|已签到|今日已/.test(text + " " + btnText),
        hasButton: !!target,
        streak: streakMatch ? Number(streakMatch[1]) : 0
      };
    })()`);
    if (!result) return { punched: null, streak: 0 };
    return { punched: result.punched || (result.hasButton === false ? null : false), streak: result.streak || 0 };
  }

  async checkin() {
    if (!this.online) return { ok: false, message: "当前离线，签到需要联网后进行。" };
    const punchState = await this.readPunchState();
    if (punchState.punched) return { ok: true, already: true };
    const clickScript = `(() => {
      const buttons = Array.from(document.querySelectorAll("button, a, [role=button], .am-btn"));
      const target = buttons.find((b) => /打卡|签到/.test(b.textContent || ""));
      if (!target) return { ok: false, reason: "not-found" };
      if (/已打卡|已签到/.test(target.textContent || "")) return { ok: true, already: true };
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
      return { ok: false, message: "没找到签到入口，已打开洛谷首页，可以在页面里手动签到。" };
    }
    await delay(1800);
    const refreshed = await this.refresh(true);
    return { ok: true, already: !!result.already, home: refreshed };
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
