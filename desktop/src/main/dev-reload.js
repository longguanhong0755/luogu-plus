/* 开发态热加载：仅由 scripts/dev.js 通过 LG_DEV_WATCH=1 启用。
   主进程/预加载变更由启动器整进程重启；渲染层变更尽量原地刷新。 */
function reloadWindow(win) {
  if (!win || win.isDestroyed()) return false;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.reloadIgnoringCache();
  return true;
}

function handleDevCommand(command, ctx) {
  if (!ctx) return false;
  if (command === "reload-shell") {
    const ok = reloadWindow(ctx.win);
    if (ok) console.log("[dev] shell reloaded");
    return ok;
  }
  if (command === "reload-settings") {
    const ok = reloadWindow(ctx.settingsWin);
    if (ok) console.log("[dev] settings reloaded");
    return ok;
  }
  if (command === "reload-ui") {
    const a = reloadWindow(ctx.win);
    const b = reloadWindow(ctx.settingsWin);
    if (a || b) console.log("[dev] renderer reloaded");
    return a || b;
  }
  if (command === "reload-skin") {
    if (!ctx.views || typeof ctx.views.updateTheme !== "function") return false;
    ctx.views.updateTheme();
    console.log("[dev] page skin reapplied");
    return true;
  }
  if (command === "restart") {
    if (ctx.app) {
      ctx.app.quitting = true;
      console.log("[dev] main/preload changed, restarting Electron");
      setImmediate(() => ctx.app.quit());
    }
    return true;
  }
  return false;
}

function installDevReload(ctx) {
  if (process.env.LG_DEV_WATCH !== "1") return () => {};
  const onMessage = (message) => {
    if (!message || message.type !== "dev") return;
    const command = String(message.command || "");
    const ok = handleDevCommand(command, ctx);
    if (process.send) process.send({ type: "dev-ack", command, ok });
  };
  process.on("message", onMessage);
  console.log("[dev] hot reload connected");
  return () => process.off("message", onMessage);
}

module.exports = { handleDevCommand, installDevReload };
