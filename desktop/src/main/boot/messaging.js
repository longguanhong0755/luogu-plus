/* 对外消息面：状态广播出口、toast、窗口命令与开发热加载。 */
const { createSettingsWindow } = require("../window");
const { broadcastState } = require("../ipc");
const { installDevReload } = require("../dev-reload");

function installMessaging(ctx) {
  ctx.emitPage = () => broadcastState(ctx);
  ctx.emitState = () => broadcastState(ctx);
  ctx.toast = (title, body) => {
    ctx.notify.toast(title, body);
    const payload = { title, body };
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send("app:toast", payload);
    }
    // 页面视图（题面/详情）盖在外壳之上，外壳里的 toast 会被整个挡住——
    // 有页面在场时同步发一份给页面，由页面 preload 画在自己的顶层
    const pageWc = ctx.views && ctx.views.currentWebContents ? ctx.views.currentWebContents() : null;
    if (pageWc && !pageWc.isDestroyed()) {
      pageWc.send("app:toast", payload);
    }
  };
  if (ctx.smoke) {
    ctx.win.webContents.on("console-message", (_e, _level, message, line, sourceId) => {
      console.log("[renderer-console]", String(message).slice(0, 200), "@", String(sourceId).split(/[\/]/).pop() + ":" + line);
    });
  }
  ctx.showWindow = () => {
    if (ctx.win && !ctx.win.isDestroyed()) {
      if (ctx.views) {
        try {
          ctx.views.restoreCurrent();
        } catch {
          /* ignore */
        }
      }
      ctx.win.show();
      ctx.win.focus();
    }
  };
  ctx.openSettings = () => createSettingsWindow(ctx);
  ctx.pinTaskbar = () => require("../taskbar").pinToTaskbar({ smoke: ctx.smoke });
  installDevReload(ctx);
}

module.exports = { installMessaging };
