/* Web 缓存维护：超过软上限或强制清理时清网页缓存（登录态与离线数据保留）。 */
const { WEB_CACHE_SOFT_LIMIT } = require("./constants");

async function maintainWebCache(ctx, reason = "scheduled", force = false) {
  if (!ctx.session) return { ok: false, reason: "no-session" };
  try {
    const before = await ctx.session.getCacheSize();
    if (!force && before <= WEB_CACHE_SOFT_LIMIT) return { ok: true, before, cleared: false };
    await ctx.session.clearCache();
    console.log("[cache] cleared web cache", reason, Math.round(before / 1024 / 1024) + "MB");
    return { ok: true, before, cleared: true };
  } catch (err) {
    console.warn("[cache] maintenance failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { maintainWebCache };
