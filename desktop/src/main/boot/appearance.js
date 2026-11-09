/* 外观刷新调度：主题/材质同步、壁纸解析防竞态、轮换定时器、开机自启。 */
const { app, nativeTheme } = require("electron");
const theme = require("../theme");
const wallpaper = require("../wallpaper");
const { applyTheme } = require("../window");
const { broadcastState, state } = require("../ipc");

function installAppearance(ctx) {
  ctx.applyAutoLaunch = () => {
    if (process.platform !== "win32") return;
    try {
      app.setLoginItemSettings({ openAtLogin: ctx.cfg.get().general.autoLaunch });
    } catch (err) {
      console.error("[app] autoLaunch:", err.message);
    }
  };

  let wallpaperEpoch = 0;
  ctx.refreshAppearance = async (options = {}) => {
    const cfg = ctx.cfg.get();
    const mode = cfg.appearance.mode;
    nativeTheme.themeSource = mode === "system" ? "system" : mode;
    // 材质、透明度、主题色只改 CSS 变量，必须同步落到外壳与设置窗，
    // 不能等图片/视频壁纸解析完再更新，否则拖动滑杆时两个窗口会各慢一拍。
    ctx.theme = theme.payload(cfg);
    applyTheme(ctx.win, ctx.theme);
    applyTheme(ctx.settingsWin, ctx.theme);
    ctx.views.updateTheme();
    if (options.reschedule !== false) ctx.scheduleWallpaperRotation();
    if (options.resolveWallpaper === false) {
      broadcastState(ctx);
      return;
    }
    const epoch = ++wallpaperEpoch;
    const resolved = await wallpaper.resolve(cfg, ctx.theme);
    // 只让最后一轮壁纸解析提交；材质请求不会再错误取消正在解析的壁纸。
    if (epoch !== wallpaperEpoch) return;
    ctx.wallpaper = resolved;
    broadcastState(ctx);
  };

  let rotationTimer = null;
  ctx.scheduleWallpaperRotation = () => {
    if (rotationTimer) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
    const a = ctx.cfg.get().appearance;
    if (!["folder", "we"].includes(a.wallpaper) || a.wallpaperInterval <= 0) return;
    rotationTimer = setInterval(() => {
      ctx.nextWallpaper().catch((err) => console.error("[wallpaper] rotate:", err.message));
    }, a.wallpaperInterval * 60000);
  };

  ctx.nextWallpaper = async () => {
    const cfg = ctx.cfg.get();
    const a = cfg.appearance;
    const total = wallpaper.count(cfg);
    let next = (Number(a.wallpaperIndex) || 0) + 1;
    if (a.wallpaperShuffle && total > 1) {
      next = Math.floor(Math.random() * total);
      if (next === a.wallpaperIndex) next = (next + 1) % total;
    } else if (total > 0) {
      next = next % total;
    }
    ctx.cfg.setAppearance({ wallpaperIndex: next, weId: "" });
    await ctx.refreshAppearance({ reschedule: false });
    return state(ctx);
  };
}

module.exports = { installAppearance };
