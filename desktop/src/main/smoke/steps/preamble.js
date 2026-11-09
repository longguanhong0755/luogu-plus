/* 冒烟前置：登录实测 / 主题 / 壁纸 / 窗口尺寸 / 首页截图。 */
const { loginFlow } = require("../login");

async function runPreambleStep({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_LOGIN) {
    await loginFlow(ctx, wait, outDir);
  }
  if (process.env.LG_SMOKE_THEME === "light" || process.env.LG_SMOKE_THEME === "dark") {
    ctx.cfg.setAppearance({ mode: process.env.LG_SMOKE_THEME });
    await ctx.refreshAppearance();
    await wait(700);
  }
  if (process.env.LG_SMOKE_FOLDER) {
    ctx.cfg.setAppearance({
      wallpaper: "folder",
      wallpaperDir: process.env.LG_SMOKE_FOLDER,
      wallpaperInterval: 15,
      wallpaperIndex: 0,
    });
    await ctx.refreshAppearance();
    await wait(500);
    console.log("SMOKE_WALL_FOLDER " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
    await ctx.nextWallpaper();
    console.log("SMOKE_WALL_NEXT " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
  }
  if (process.env.LG_SMOKE_WE) {
    const items = ctx.scanWe(process.env.LG_SMOKE_WE);
    const first = process.env.LG_SMOKE_WE_ID
      ? items.find((item) => item.id === process.env.LG_SMOKE_WE_ID) || items[0]
      : items.find((item) => item.playable) || items[0];
    ctx.cfg.setAppearance({
      wallpaper: "we",
      weRoot: process.env.LG_SMOKE_WE,
      weId: first ? first.id : "",
      wallpaperIndex: 0,
    });
    await ctx.refreshAppearance();
    await wait(600);
    console.log("SMOKE_WALL_WE " + JSON.stringify({ count: items.length, items: items.slice(0, 3), label: ctx.wallpaper.label, video: ctx.wallpaper.video }));
  }
  ctx.win.setOpacity(0);
  ctx.win.showInactive();
  if (process.env.LG_SMOKE_SIZE) {
    const [width, height] = String(process.env.LG_SMOKE_SIZE).split("x").map((value) => Number(value));
    if (width && height) {
      ctx.win.setContentSize(width, height);
      await wait(600);
    }
  }
  // 登录/提交流程可能把页面停在题目页；首页截图前先回到原生主页
  ctx.views.showHome();
  await wait(process.env.LG_SMOKE_NET === "1" ? 9000 : 1400);
  const homeShot = await shot("home");
  console.log("SMOKE_OK " + homeShot);
}

module.exports = { runPreambleStep };
