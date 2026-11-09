/* 主窗口事件：布局重排、焦点同步、后台释放与系统主题变化。 */
const { nativeTheme } = require("electron");
const { BACKGROUND_RELEASE_MS } = require("./constants");

function installWindowEvents(ctx) {
  let relayoutTimer = null;
  const relayout = () => {
    if (relayoutTimer) return;
    relayoutTimer = setTimeout(() => {
      relayoutTimer = null;
      if (ctx.win && !ctx.win.isDestroyed()) ctx.views.layout();
    }, 16);
  };
  ctx.win.on("resize", relayout);
  ctx.win.on("maximize", relayout);
  ctx.win.on("unmaximize", relayout);
  ctx.win.on("enter-full-screen", relayout);
  ctx.win.on("leave-full-screen", relayout);
  const syncWindowFocus = (focused) => {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    ctx.win.webContents.send("app:window-focus", !!focused);
  };
  let backgroundReleaseTimer = null;
  const cancelBackgroundRelease = () => {
    if (!backgroundReleaseTimer) return;
    clearTimeout(backgroundReleaseTimer);
    backgroundReleaseTimer = null;
  };
  const scheduleBackgroundRelease = () => {
    cancelBackgroundRelease();
    backgroundReleaseTimer = setTimeout(() => {
      backgroundReleaseTimer = null;
      if (ctx.win && !ctx.win.isDestroyed() && (ctx.win.isMinimized() || !ctx.win.isVisible())) {
        ctx.views.suspendBackground().catch(() => {});
      }
    }, BACKGROUND_RELEASE_MS);
    backgroundReleaseTimer.unref && backgroundReleaseTimer.unref();
  };
  ctx.win.on("focus", () => {
    cancelBackgroundRelease();
    syncWindowFocus(true);
  });
  ctx.win.on("blur", () => syncWindowFocus(false));
  ctx.win.on("hide", () => {
    syncWindowFocus(false);
    scheduleBackgroundRelease();
  });
  ctx.win.on("minimize", () => {
    syncWindowFocus(false);
    scheduleBackgroundRelease();
  });
  ctx.win.on("restore", () => {
    cancelBackgroundRelease();
    syncWindowFocus(ctx.win.isFocused());
  });
  ctx.win.on("show", () => {
    cancelBackgroundRelease();
    syncWindowFocus(ctx.win.isFocused());
    if (ctx.views) ctx.views.restoreCurrent();
  });

  nativeTheme.on("updated", () => {
    if (ctx.cfg.get().appearance.mode === "system") {
      ctx.refreshAppearance().catch((err) => console.error("[theme]", err.message));
    }
  });
}

module.exports = { installWindowEvents };
