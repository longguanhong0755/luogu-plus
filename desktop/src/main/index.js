/* 主进程入口：生命周期、单实例、窗口/视图/托盘/通知的装配。
   业务能力在各自模块里，这里只做连线。 */
const { app, session, nativeTheme } = require("electron");

const config = require("./config");
const theme = require("./theme");
const wallpaper = require("./wallpaper");
const { createMainWindow, createSettingsWindow, applyTheme } = require("./window");
const { ViewManager } = require("./views");
const { LuoguService } = require("./luogu");
const { createNotifier } = require("./notify");
const { createTray } = require("./tray");
const { registerIpc, broadcastState } = require("./ipc");
const { runSmoke, seedDemo } = require("./smoke");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

app.setAppUserModelId("com.luogulab.desktop");
app.userAgentFallback = UA;
app.quitting = false;

if (process.argv.includes("--smoke")) app.disableHardwareAcceleration();

if (process.env.LG_USERDATA) {
  app.setPath("userData", process.env.LG_USERDATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  const ctx = {
    cfg: config,
    smoke: process.argv.includes("--smoke"),
    theme: null,
    wallpaper: { kind: "builtin", url: "" },
  };

  app.whenReady().then(async () => {
    ctx.cfg.init();
    const startMode = ctx.cfg.get().appearance.mode;
    nativeTheme.themeSource = startMode === "system" ? "system" : startMode;
    ctx.theme = theme.payload(ctx.cfg.get());
    ctx.wallpaper = await wallpaper.resolve(ctx.cfg.get());

    ctx.session = session.fromPartition("persist:luogu");
    ctx.session.setUserAgent(UA);
    ctx.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ctx.session.setPermissionCheckHandler(() => false);

    ctx.notify = createNotifier(ctx);
    ctx.win = createMainWindow(ctx);
    ctx.views = new ViewManager(ctx);
    ctx.views.setWindow(ctx.win);
    ctx.luogu = new LuoguService(ctx);
    if (process.env.LG_DEMO === "1") seedDemo(ctx);
    ctx.tray = createTray(ctx);
    registerIpc(ctx);

    ctx.emitPage = () => broadcastState(ctx);
    ctx.emitState = () => broadcastState(ctx);
    ctx.toast = (title, body) => {
      ctx.notify.toast(title, body);
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send("app:toast", { title, body });
      }
    };
    ctx.showWindow = () => {
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.show();
        ctx.win.focus();
      }
    };
    ctx.openSettings = () => createSettingsWindow(ctx);

    ctx.applyAutoLaunch = () => {
      if (process.platform !== "win32") return;
      try {
        app.setLoginItemSettings({ openAtLogin: ctx.cfg.get().general.autoLaunch });
      } catch (err) {
        console.error("[app] autoLaunch:", err.message);
      }
    };

    ctx.refreshAppearance = async () => {
      const mode = ctx.cfg.get().appearance.mode;
      nativeTheme.themeSource = mode === "system" ? "system" : mode;
      ctx.theme = theme.payload(ctx.cfg.get());
      ctx.wallpaper = await wallpaper.resolve(ctx.cfg.get());
      applyTheme(ctx.win, ctx.theme);
      applyTheme(ctx.settingsWin, ctx.theme);
      ctx.views.updateTheme();
      broadcastState(ctx);
    };

    ctx.command = (name) => {
      if (!ctx.win || ctx.win.isDestroyed()) return;
      if (name === "palette" || name === "switcher") {
        ctx.showWindow();
        ctx.win.webContents.send("app:command", name);
        return;
      }
      if (name === "settings") {
        ctx.openSettings();
        return;
      }
      if (name === "fullscreen") {
        ctx.win.setFullScreen(!ctx.win.isFullScreen());
        return;
      }
      if (name === "devtools") {
        const wc = ctx.views.currentWebContents() || ctx.win.webContents;
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: "detach" });
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

    const relayout = () => ctx.views.layout();
    ctx.win.on("resize", relayout);
    ctx.win.on("maximize", relayout);
    ctx.win.on("unmaximize", relayout);
    ctx.win.on("enter-full-screen", relayout);
    ctx.win.on("leave-full-screen", relayout);

    nativeTheme.on("updated", () => {
      if (ctx.cfg.get().appearance.mode === "system") {
        ctx.refreshAppearance().catch((err) => console.error("[theme]", err.message));
      }
    });

    ctx.applyAutoLaunch();
    if (!ctx.smoke || process.env.LG_SMOKE_NET === "1") ctx.luogu.init();
    app.__lgCtx = ctx;

    const pushState = () => broadcastState(ctx);
    if (ctx.win.webContents.isLoading()) ctx.win.webContents.on("did-finish-load", pushState);
    else pushState();

    if (ctx.smoke) runSmoke(ctx);
  });

  app.on("second-instance", () => {
    if (app.__lgCtx && app.__lgCtx.win) {
      const win = app.__lgCtx.win;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.on("before-quit", () => {
    app.quitting = true;
  });

  app.on("window-all-closed", () => {
    if (app.quitting) app.quit();
  });

  process.on("uncaughtException", (err) => {
    console.error("[fatal]", err);
  });
}
