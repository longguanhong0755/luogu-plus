/* 外观域 IPC：主题/材质补丁、壁纸选择（文件/目录/Wallpaper Engine）与切换。 */
const { ipcMain, dialog } = require("electron");
const { state } = require("./state");

function register(ctx) {
  ipcMain.handle("app:setAppearance", async (_event, patch) => {
    const next = patch || {};
    const wallpaperKeys = new Set([
      "wallpaper",
      "wallpaperFile",
      "wallpaperDir",
      "wallpaperIndex",
      "wallpaperInterval",
      "wallpaperShuffle",
      "wallpaperMotion",
      "wallpaperZoom",
      "wallpaperFade",
      "weRoot",
      "weId",
    ]);
    const resolveWallpaper = Object.keys(next).some((key) => wallpaperKeys.has(key));
    const appearance = ctx.cfg.setAppearance(next);
    await ctx.refreshAppearance({ resolveWallpaper });
    if (resolveWallpaper) ctx.scheduleWallpaperRotation();
    return { appearance, state: state(ctx) };
  });

  ipcMain.handle("app:pickWallpaper", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择壁纸",
      properties: ["openFile"],
      filters: [
        { name: "图片与视频", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif", "mp4", "webm", "ogv"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    ctx.cfg.setAppearance({ wallpaper: "custom", wallpaperFile: result.filePaths[0], wallpaperIndex: 0 });
    await ctx.refreshAppearance();
    return state(ctx);
  });

  ipcMain.handle("app:pickWallpaperDir", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择壁纸文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    ctx.cfg.setAppearance({ wallpaper: "folder", wallpaperDir: result.filePaths[0], wallpaperIndex: 0 });
    await ctx.refreshAppearance();
    ctx.scheduleWallpaperRotation();
    return state(ctx);
  });

  ipcMain.handle("app:pickWeRoot", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择 Wallpaper Engine 目录（创意工坊 431960 或 Steam 库）",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    const root = result.filePaths[0];
    const items = await Promise.resolve(ctx.scanWe(root));
    const first = items.find((item) => item.playable) || items[0];
    ctx.cfg.setAppearance({
      wallpaper: "we",
      weRoot: root,
      weId: first ? first.id : "",
      wallpaperIndex: 0,
    });
    await ctx.refreshAppearance();
    ctx.scheduleWallpaperRotation();
    return { state: state(ctx), items };
  });

  ipcMain.handle("app:scanWe", (_event, root) => {
    const dir = String(root || ctx.cfg.get().appearance.weRoot || "");
    return { root: dir, items: dir ? ctx.scanWe(dir) : [] };
  });

  ipcMain.handle("app:nextWallpaper", async () => {
    await ctx.nextWallpaper();
    return state(ctx);
  });
}

module.exports = { register };
