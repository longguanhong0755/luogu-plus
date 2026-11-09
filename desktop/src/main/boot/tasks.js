/* ready 收尾：缓存维护定时器、开机自启、壁纸轮换、在线初始化与首帧状态推送。 */
const { app } = require("electron");
const { broadcastState } = require("../ipc");
const { CACHE_MAINTENANCE_MS } = require("./constants");
const smoke = () => require("../smoke");

function finishReady(ctx) {
  const cacheEpoch = ctx.store.get("cacheEpoch");
  ctx.store.set("cacheEpoch", app.getVersion(), 0);
  const cacheStartup = cacheEpoch && cacheEpoch !== app.getVersion()
    ? ctx.maintainWebCache("version-change", true)
    : ctx.maintainWebCache("startup");
  cacheStartup.catch(() => {});
  ctx.cacheTimer = setInterval(() => ctx.maintainWebCache("scheduled"), CACHE_MAINTENANCE_MS);
  ctx.cacheTimer.unref && ctx.cacheTimer.unref();

  ctx.applyAutoLaunch();
  ctx.scheduleWallpaperRotation();
  if (!ctx.smoke || process.env.LG_SMOKE_NET === "1") ctx.luogu.init();
  app.__lgCtx = ctx;

  const pushState = () => broadcastState(ctx);
  if (ctx.win.webContents.isLoading()) ctx.win.webContents.on("did-finish-load", pushState);
  else pushState();

  if (ctx.smoke) {
    try {
      smoke().runSmoke(ctx);
    } catch (err) {
      console.error("[smoke] harness not available:", err.message);
    }
  }
}

module.exports = { finishReady };
