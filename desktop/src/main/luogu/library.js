/* 洛谷数据服务 · 列表离线缓存与标签目录（拆分自 src/main/luogu.js）。 */
const { normalizeTagCatalog } = require("./util");

const libraryMethods = {
  /* ---------- 原生列表 ---------- */

  libStoreKey(cacheKey) {
    return "lib:" + cacheKey;
  },

  cachedLib(cacheKey) {
    const store = this.ctx.store;
    if (!store) return null;
    const entry = store.get(this.libStoreKey(cacheKey));
    return entry && entry.payload ? entry : null;
  },

  saveLib(cacheKey, payload) {
    const store = this.ctx.store;
    if (!store) return;
    const key = this.libStoreKey(cacheKey);
    store.set(key, { key, at: Date.now(), payload });
    // 搜索词会产生无穷多个 key，按时间保留最新 60 份
    if (store.evict("lib:", 60) > 80) store.evict("lib:", 40);
  },

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
};

module.exports = { libraryMethods };
