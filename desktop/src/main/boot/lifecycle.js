/* 进程级生命周期：二次实例唤起、退出落盘、窗口全关退出、未捕获异常。 */
const { persistCrash } = require("./crash");

function installLifecycle(app, ctx) {
  app.on("second-instance", () => {
    if (app.__lgCtx && app.__lgCtx.win) {
      const win = app.__lgCtx.win;
      if (win.isMinimized()) win.restore();
      if (app.__lgCtx.views) app.__lgCtx.views.restoreCurrent();
      win.show();
      win.focus();
    }
  });

  app.on("before-quit", () => {
    app.quitting = true;
    if (ctx.views) ctx.views.dispose();
    if (ctx.cacheTimer) clearInterval(ctx.cacheTimer);
    if (ctx.views) ctx.views.cancelAllSleep && ctx.views.cancelAllSleep();
    if (ctx.cfg) ctx.cfg.flush();
    if (ctx.store) ctx.store.flushAll();
  });

  app.on("window-all-closed", () => {
    if (app.quitting) app.quit();
  });

  process.on("uncaughtException", (err) => {
    console.error("[fatal]", err);
    persistCrash(err);
    try {
      if (ctx && ctx.toast) ctx.toast("内部错误", "程序遇到未预期的异常，已记录到日志。");
    } catch {
      /* 崩溃路径上不允许再抛 */
    }
  });
}

module.exports = { installLifecycle };
