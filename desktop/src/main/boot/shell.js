/* 窗口 / 视图 / 托盘 / 通知 / IPC 的装配（只做连线，不含业务）。 */
const { createMainWindow } = require("../window");
const { ViewManager } = require("../views");
const { LuoguService } = require("../luogu");
const { createNotifier } = require("../notify");
const { createTray } = require("../tray");
const { registerIpc } = require("../ipc");
const smoke = () => require("../smoke");

function mountShell(ctx) {
  ctx.notify = createNotifier(ctx);
  ctx.win = createMainWindow(ctx);
  ctx.views = new ViewManager(ctx);
  ctx.views.setWindow(ctx.win);
  ctx.luogu = new LuoguService(ctx);
  if (process.env.LG_DEMO === "1") {
    // 便携包已剥离探针 harness：模块缺失时静默跳过演示数据（正常使用不触发）
    try {
      smoke().seedDemo(ctx);
    } catch (err) {
      console.warn("[demo] smoke harness not available:", err.message);
    }
  }
  ctx.tray = createTray(ctx);
  registerIpc(ctx);
}

module.exports = { mountShell };
