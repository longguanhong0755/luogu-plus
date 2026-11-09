/* 主进程启动常量：UA 与各维护周期（纯常量，无副作用）。 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const WEB_CACHE_SOFT_LIMIT = 220 * 1024 * 1024;
const CACHE_MAINTENANCE_MS = 4 * 60 * 60 * 1000;
const BACKGROUND_RELEASE_MS = Math.max(10000, Number(process.env.LG_BACKGROUND_RELEASE_MS) || 10 * 60 * 1000);

module.exports = { UA, WEB_CACHE_SOFT_LIMIT, CACHE_MAINTENANCE_MS, BACKGROUND_RELEASE_MS };
