/* 导航域 IPC：侧栏/主页跳转、命令面板、页面切换器、设置窗与命令分发。 */
const { ipcMain } = require("electron");
const { LIBRARY_IDS } = require("../sections");
const { palette } = require("./palette");

function register(ctx) {
  ipcMain.handle("app:nav", (_event, target) => {
    if (target === "home") ctx.views.showHome();
    else if (target === "login") ctx.views.openLogin();
    else if (target === "profile") ctx.views.openProfile(ctx.luogu.user.uid);
    else if (target === "settings") ctx.openSettings();
    else if (LIBRARY_IDS.has(target) || target === "chat" || target === "notification") {
      ctx.views.openSection(target);
    }
    ctx.emitPage();
  });

  ipcMain.handle("app:palette", (_event, query) => palette(query, ctx));

  ipcMain.handle("app:switcher", () => ctx.views.listOpen());

  ipcMain.handle("app:switchTo", (_event, key) => {
    ctx.views.switchTo(String(key || ""));
  });

  ipcMain.handle("app:openSettings", () => {
    ctx.openSettings();
  });

  ipcMain.handle("app:command", (_event, name) => {
    ctx.command(String(name || ""));
  });
}

module.exports = { register };
