/* 设置域 IPC：侧栏、通用、增强开关、通知、导入导出与重置。 */
const { ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const { broadcastState, state } = require("./state");

function register(ctx) {
  ipcMain.handle("app:setRail", (_event, patch) => {
    const next = patch || {};
    const rail = ctx.cfg.setRail(next);
    if (Object.prototype.hasOwnProperty.call(next, "pinned")) ctx.views.setRailPinned(!!rail.pinned);
    else broadcastState(ctx);
    return rail;
  });

  ipcMain.handle("app:railPin", (_event, pinned) => {
    // 无参数表示 toggle：快速点击时由主进程基于最新状态取反，避免 renderer 旧状态丢操作。
    if (typeof pinned === "boolean") ctx.views.setRailPinned(pinned);
    else ctx.views.setRailPinned(!ctx.views.railPinned);
    return ctx.cfg.get().rail;
  });

  ipcMain.handle("app:resetRail", () => {
    const rail = ctx.cfg.resetRail();
    broadcastState(ctx);
    return rail;
  });

  ipcMain.handle("app:setGeneral", (_event, patch) => {
    const next = patch || {};
    const general = ctx.cfg.setGeneral(next);
    ctx.applyAutoLaunch();
    if (Object.prototype.hasOwnProperty.call(next, "adBlock")) {
      ctx.views.applyAdBlock();
      broadcastState(ctx);
      return general;
    }
    if (Object.prototype.hasOwnProperty.call(next, "performanceMode")) {
      ctx.refreshAppearance({ reschedule: false, resolveWallpaper: false }).catch(() => {});
    } else {
      broadcastState(ctx);
    }
    return general;
  });

  ipcMain.handle("app:setFeatures", (_event, patch) => {
    const features = ctx.cfg.setFeatures(patch || {});
    if (features.autoRefresh !== false) ctx.views.applyFeatures();
    broadcastState(ctx);
    return features;
  });

  ipcMain.handle("app:exportSettings", async () => {
    const result = await dialog.showSaveDialog(ctx.settingsWin || ctx.win, {
      title: "导出设置",
      defaultPath: "luogu-desktop-settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(ctx.cfg.exportData(), null, 2), "utf8");
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("app:importSettings", async () => {
    const result = await dialog.showOpenDialog(ctx.settingsWin || ctx.win, {
      title: "导入设置",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true, state: state(ctx) };
    const file = result.filePaths[0];
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) throw new Error("设置文件不能超过 1MB");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    ctx.cfg.replaceData(parsed);
    await ctx.refreshAppearance({ reschedule: false });
    ctx.scheduleWallpaperRotation();
    ctx.views.setRailPinned(!!ctx.cfg.get().rail.pinned);
    ctx.views.applyAdBlock();
    ctx.views.applyFeatures();
    broadcastState(ctx);
    return { ok: true, state: state(ctx) };
  });

  ipcMain.handle("app:resetSettings", async () => {
    ctx.cfg.resetAll();
    await ctx.refreshAppearance({ reschedule: false });
    ctx.scheduleWallpaperRotation();
    ctx.views.setRailPinned(false);
    ctx.views.applyAdBlock();
    ctx.views.applyFeatures();
    broadcastState(ctx);
    return { ok: true, state: state(ctx) };
  });

  ipcMain.handle("app:setNotify", (_event, patch) => {
    const notify = ctx.cfg.setNotify(patch);
    broadcastState(ctx);
    return notify;
  });
}

module.exports = { register };
