/* 洛谷数据服务。
   登录态用 cookie（__client_id / _uid）判断；页面数据在隐藏窗口的页面上下文里
   fetch 真实页面，解析 #lentille-context 的 JSON（洛谷新前端把服务端直出数据放在
   这个 script 里），不依赖易变的私有 API。
   签到用页面内点击（洛谷的打卡本身是前端行为），提交先尝试接口、失败则回退。 */
const { BrowserWindow, Notification } = require("electron");

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
};

const LANG_IDS = {
  "C++98": 3,
  "C++11": 4,
  "C++14": 5,
  "C++17": 6,
  "C++20": 7,
  "C": 2,
  "Python3": 8,
  "Python": 8,
  "Pascal": 1,
  "Java8": 9,
};

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
    try {
      return await this.win.webContents.executeJavaScript(script, true);
    } catch (err) {
      console.error("[luogu] exec:", err.message);
      return null;
    }
  }

  async fetchContext(pathname) {
    const url = pathname.startsWith("http") ? pathname : "https://www.luogu.com.cn" + pathname;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.exec(
        `(async () => {
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: "include" });
            const text = await r.text();
            const m = text.match(/<script[^>]*id="lentille-context"[^>]*>([\\s\\S]*?)<\\/script>/);
            if (!m) return { ok: false, status: r.status };
            return { ok: true, context: JSON.parse(m[1]) };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        })()`
      );
      if (result && result.ok && result.context) return result.context;
      await delay(600);
    }
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
    const uid = Number(get("_uid")) || null;
    return { loggedIn: !!clientId, uid };
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
      } catch {
        /* ignore */
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
    const result = await this.exec(`(() => {
      const scope = document.querySelector(".lg-punch") || document;
      const buttons = Array.from(scope.querySelectorAll("button, a, .am-btn"));
      const target = buttons.find((b) => /打卡|签到/.test(b.textContent || ""));
      if (!target) return { ok: false, reason: "not-found" };
      if (/已打卡|已签到/.test(target.textContent || "")) return { ok: true, already: true };
      target.click();
      return { ok: true, clicked: true };
    })()`);
    if (!result || !result.ok) {
      return { ok: false, message: "没找到签到入口，已打开洛谷首页，可以在页面里手动签到。" };
    }
    await delay(1800);
    const refreshed = await this.refresh(true);
    return { ok: true, already: !!result.already, home: refreshed };
  }

  /* ---------- 提交 ---------- */

  async submit(pid, code, lang) {
    const langId = LANG_IDS[lang] || LANG_IDS["C++14"];
    const script = `(async () => {
      const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest" };
      const body = JSON.stringify({ pid: ${JSON.stringify(pid)}, code: ${JSON.stringify(code)}, lang: ${Number(langId)}, enableO2: false });
      const tryReq = async (url, options) => {
        try {
          const r = await fetch(url, options);
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch {}
          return { status: r.status, json, text: text.slice(0, 200) };
        } catch (e) { return { status: 0, error: String(e) }; }
      };
      const a = await tryReq("/api/problem/submit", { method: "POST", headers, body, credentials: "include" });
      const ridOf = (j) => j && (j.rid || (j.data && j.data.rid) || (j.currentData && j.currentData.rid));
      if (ridOf(a.json)) return { ok: true, rid: ridOf(a.json) };
      const form = new URLSearchParams({ pid: ${JSON.stringify(pid)}, code: ${JSON.stringify(code)}, lang: String(${Number(langId)}), enableO2: "false" });
      const b = await tryReq("/api/problem/submit", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Luogu-Type": "content-only" }, body: form.toString(), credentials: "include" });
      if (ridOf(b.json)) return { ok: true, rid: ridOf(b.json) };
      return { ok: false, status: a.status || b.status, detail: (a.text || "") + " " + (b.text || "") };
    })()`;
    const result = await this.exec(script);
    if (!result || !result.ok) {
      return { ok: false, fallback: true, message: "自动提交没有成功，代码已复制，请在题目页内提交。" };
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
    this.lastRefresh = 0;
    await this.refresh(true);
  }

  state() {
    return { user: this.user, home: this.home };
  }
}

module.exports = { LuoguService, STATUS_TEXT, QUOTES };
