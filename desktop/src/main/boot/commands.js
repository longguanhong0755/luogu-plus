/* 命令分发（快捷键/菜单/页面转交）与首页导航刷新。 */
function installCommands(ctx) {
  ctx.command = (name) => {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    if (name === "palette" || name === "switcher" || name === "jump" || name === "userSearch" || name === "focusRail") {
      ctx.showWindow();
      ctx.win.webContents.send("app:command", name);
      return;
    }
    if (name === "railPin") {
      ctx.views.setRailPinned(!ctx.cfg.get().rail.pinned);
      return;
    }
    if (name === "problems") {
      if (ctx.cfg.get().features.shortcuts) ctx.views.showLibrary("problems");
      return;
    }
    if (name === "focusPage") {
      const wc = ctx.views.currentWebContents();
      if (wc && !wc.isDestroyed()) wc.focus();
      else ctx.win.webContents.focus();
      return;
    }
    if (name === "settings") {
      ctx.openSettings();
      return;
    }
    if (name === "reopen") {
      ctx.views.reopenClosed();
      return;
    }
    if (name === "reload") {
      ctx.views.reload();
      return;
    }
    if (name === "back") {
      ctx.views.back();
      return;
    }
    if (name === "forward") {
      ctx.views.forward();
      return;
    }
    if (name === "closepage") {
      ctx.views.closePage();
      return;
    }
    if (name === "fullscreen") {
      ctx.win.setFullScreen(!ctx.win.isFullScreen());
      return;
    }
    if (name === "devtools") {
      const viewWc = ctx.views.currentWebContents();
      const wc = viewWc || ctx.win.webContents;
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools();
        return;
      }
      let detached = false;
      if (viewWc) {
        try {
          if (viewWc.debugger.isAttached()) {
            viewWc.debugger.detach();
            detached = true;
          }
        } catch {
          /* ignore */
        }
        if (detached) wc.once("devtools-closed", () => ctx.views.reinstallGuard(wc));
      }
      setTimeout(() => {
        try {
          wc.openDevTools({ mode: "detach" });
        } catch (err) {
          console.error("[devtools]", err.message);
        }
      }, 40);
    }
  };

  let navigateTimer = null;
  ctx.onNavigate = (url) => {
    if (!url) return;
    if (navigateTimer) clearTimeout(navigateTimer);
    navigateTimer = setTimeout(() => {
      const isHome =
        url === "https://www.luogu.com.cn/" ||
        url.startsWith("https://www.luogu.com.cn/?") ||
        url.includes("auth/login");
      if (isHome) ctx.luogu.refresh(true).catch(() => {});
    }, 900);
  };
}

module.exports = { installCommands };
