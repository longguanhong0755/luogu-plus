/* 洛谷数据服务 · 随机跳题与用户搜索（拆分自 src/main/luogu.js）。 */
const { trimMap } = require("./util");

const randomMethods = {
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
  },

  markRandomUsed(guard) {
    if (!this.ctx.store) return;
    this.ctx.store.set("randomJumpGuard", { date: guard.date, used: guard.used + 1, last: Date.now() }, 0);
  },

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
  },

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
};

module.exports = { randomMethods };
