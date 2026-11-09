/* 状态快照与广播：app:state 的唯一构造点，外壳与设置窗共享同一份 payload。 */
const { app } = require("electron");
const { resolveRail } = require("../sections");

function publicWallpaper(wallpaper) {
  const out = Object.assign({}, wallpaper);
  out.items = [];
  return out;
}

function state(ctx) {
  const cfg = ctx.cfg.get();
  const rail = resolveRail(cfg);
  rail.width = ctx.views.railWidth();
  let bounds = { width: 1280, height: 820 };
  try {
    if (ctx.win && !ctx.win.isDestroyed()) bounds = ctx.win.getContentBounds();
  } catch {
    /* window 正在创建 */
  }
  return {
    version: app.getVersion(),
    appearance: cfg.appearance,
    general: cfg.general,
    features: cfg.features,
    notify: cfg.notify,
    rail,
    window: { width: bounds.width, height: bounds.height },
    theme: Object.assign({}, ctx.theme, { wallpaper: publicWallpaper(ctx.wallpaper) }),
    user: ctx.luogu.user,
    home: ctx.luogu.home,
    online: ctx.luogu.online !== false,
    queue: ctx.luogu.queueState(),
    page: ctx.views.currentInfo(),
    switcher: ctx.views.listOpen(),
  };
}

function broadcastState(ctx) {
  const payload = state(ctx);
  const targets = [ctx.win, ctx.settingsWin];
  for (const win of targets) {
    if (win && !win.isDestroyed()) win.webContents.send("app:state", payload);
  }
}

module.exports = { publicWallpaper, state, broadcastState };
