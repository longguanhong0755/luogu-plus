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

const DIFFICULTY = {
  0: { name: "暂无评定", color: "#9aa0aa" },
  1: { name: "入门", color: "#f0616d" },
  2: { name: "普及−", color: "#f2a33c" },
  3: { name: "普及/提高−", color: "#f2c94c" },
  4: { name: "普及+/提高", color: "#3ecf8e" },
  5: { name: "提高+/省选−", color: "#5b8cff" },
  6: { name: "省选/NOI−", color: "#a86bff" },
  7: { name: "NOI/NOI+", color: "#8b8f9c" },
  8: { name: "NOI+/CTSC", color: "#5d6270" },
};

/* 洛谷 2026-10 新评测机语言 id（真实 UI 抓包实测）：
   28 = C++14 (GCC 9)，是洛谷提交页的默认语言；旧 id 5（C++14）已失效（400 record.invalid_language_type）。
   3/4 沿用旧表（在 acceptLanguages 里且能过校验）。其余名字未逐一确认，一律回落 28 ——
   原生提交只服务 C++ 主路径，其他语言走页面内提交辅助（用户在真实下拉里自选）。 */
const LANG_IDS = {
  "C++14": 28,
  "C++14 (GCC 9)": 28,
  "C++": 28,
  "C++98": 3,
  "C++11": 4,
};
const DEFAULT_LANG_ID = 28;

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
  }

  init() {
    this.refresh(true).catch((err) => console.error("[luogu] init refresh:", err.message));
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
    let lastFail = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.exec(
        `(async () => {
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: "include" });
            const text = await r.text();
            const m = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\\s\\S]*?)<\\/script>/);
            if (!m) return { ok: false, status: r.status, reason: "no-ctx", len: text.length };
            try {
              return { ok: true, context: JSON.parse(m[1]) };
            } catch (e) {
              return { ok: false, status: r.status, reason: "parse", detail: String(e).slice(0, 120) };
            }
          } catch (e) {
            return { ok: false, error: String(e).slice(0, 120) };
          }
        })()`
      );
      if (result && result.ok && result.context) return result.context;
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

  async fetchLibrary(kind, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const keyword = String(options.keyword || "").trim();
    const difficulty = String(options.difficulty || "").trim();
    const force = !!options.force;
    const cacheKey = [kind, page, keyword, difficulty].join("|");
    const cached = this.libCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < 45000) return cached.payload;

    const base = { kind, page, perPage: 0, total: 0, items: [], needLogin: false, categories: [], error: "" };
    if (kind === "record") {
      const login = await this.loginState();
      if (!login.loggedIn) {
        return Object.assign(base, { needLogin: true });
      }
      const context = await this.fetchContext(
        `/record/list?user=${encodeURIComponent(login.uid || "")}&page=${page}`
      );
      if (!context) return Object.assign(base, { error: "记录加载失败" });
      const records = this.parseRecords(context);
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
      const payload = Object.assign(base, { items, total: items.length });
      this.libCache.set(cacheKey, { at: Date.now(), payload });
      return payload;
    }

    const params = new URLSearchParams();
    params.set("page", String(page));
    if (keyword) params.set("keyword", keyword);
    if (difficulty) params.set("difficulty", difficulty);
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
    if (!context) return Object.assign(base, { error: "数据加载失败，请检查网络" });
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
        excerpt: String(item.content || "")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[#>*`_~]/g, "")
          .slice(0, 120),
      }));
    }
    const payload = Object.assign(base, {
      items,
      perPage: Number(node && node.perPage) || items.length,
      total: Number(node && node.count) || items.length,
      categories: categories.map((item) => ({ key: String(item.key || ""), name: String(item.name || "") })),
    });
    this.libCache.set(cacheKey, { at: Date.now(), payload });
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
    this.refreshing = true;
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
          const pageRecords = this.parseRecords(context);
          if (!pageRecords.length) break;
          records = records.concat(pageRecords);
          if (pageRecords.length < 20) break;
        }
        next.heat = this.buildHeat(records);
        next.recent = this.buildRecent(records);

        const punch = await this.readPunchState();
        next.punched = punch.punched;
        next.streak = punch.streak;
        if (!this.user.name) this.user.name = "洛谷用户";
      }

      this.home = next;
      this.lastRefresh = Date.now();
    } catch (err) {
      this.home.error = err.message;
      console.error("[luogu] refresh:", err.message);
    } finally {
      this.refreshing = false;
      if (this.ctx.emitState) this.ctx.emitState();
    }
    return this.state();
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
    const data = await this.exec(
      `(async () => {
        const r = await fetch("/lg4/captcha?_t=" + Date.now(), { credentials: "include" });
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

  async submit(pid, code, lang, captcha = "") {
    const result = await this.submitOnce(pid, code, lang, captcha);
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
      const retry = await this.submitOnce(pid, code, lang, ocr.text);
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

  async submitOnce(pid, code, lang, captcha = "") {
    const langId = LANG_IDS[lang] || LANG_IDS["C++14"];
    // CSRF token 在页面 meta[name=csrf-token] 里，随会话轮换，不能拿 cookie 顶替。
    // payload 形状照抄洛谷新前端 columba bundle：{ code, lang: <数字id>, enableO2: 0|1, captcha }；
    // lang 必须是数字（字符串会被 record.invalid_language_type 拒），验证码字段是 captcha（不是 verify）。
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
        ? { code, lang: ${Number(langId)}, enableO2: 0, captcha }
        : { code, lang: ${Number(langId)}, enableO2: 0 };
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

  async logout() {
    try {
      await this.ctx.session.clearStorageData({ storages: ["cookies"] });
    } catch {
      /* ignore */
    }
    this.libCache.clear();
    this.lastRefresh = 0;
    await this.refresh(true);
  }

  state() {
    return { user: this.user, home: this.home };
  }
}

module.exports = { LuoguService, STATUS_TEXT, QUOTES };
