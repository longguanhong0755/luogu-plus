/* ready 首批：配置、store、系统主题与壁纸解析。 */
const { app, nativeTheme } = require("electron");
const theme = require("../theme");
const wallpaper = require("../wallpaper");
const { Store } = require("../store");

async function initCore(ctx) {
  ctx.cfg.init();
  ctx.store = new Store(require("node:path").join(app.getPath("userData"), "store")).init();
  const startMode = ctx.cfg.get().appearance.mode;
  nativeTheme.themeSource = startMode === "system" ? "system" : startMode;
  ctx.theme = theme.payload(ctx.cfg.get());
  ctx.wallpaper = await wallpaper.resolve(ctx.cfg.get(), ctx.theme);
  ctx.scanWe = (root) => wallpaper.scanWe(root);
}

module.exports = { initCore };
