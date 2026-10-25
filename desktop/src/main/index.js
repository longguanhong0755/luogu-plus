/* 主进程入口：生命周期、单实例、窗口/视图/托盘/通知的装配。
   业务能力在各自模块里，这里只做连线。 */
const { app, session, nativeTheme, protocol } = require("electron");

const config = require("./config");
const theme = require("./theme");
const wallpaper = require("./wallpaper");
const { Store } = require("./store");
const { createMainWindow, createSettingsWindow, applyTheme } = require("./window");
const { ViewManager } = require("./views");
const { LuoguService } = require("./luogu");
const { createNotifier } = require("./notify");
const { createTray } = require("./tray");
const { registerIpc, broadcastState, state } = require("./ipc");
const { runSmoke, seedDemo } = require("./smoke");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

app.setAppUserModelId("com.luogulab.desktop");
app.userAgentFallback = UA;
app.quitting = false;

/* 离线快照协议：lgoff://problem/<PID>。必须在 ready 之前注册特权。 */
protocol.registerSchemesAsPrivileged([
  { scheme: "lgoff", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

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

/* 离线题目页：快照是洛谷自己渲染的 DOM（公式/高亮已在 HTML 里），
   这里只包一层带主题色的外壳和「离线快照」提示条。 */
function offlinePageHtml(snap, theme) {
  const c = theme.colors;
  const when = snap.savedAt ? new Date(snap.savedAt).toLocaleString("zh-CN", { hour12: false }) : "";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(snap.pid)} ${esc(snap.title || "")}</title>
<base href="https://www.luogu.com.cn/">
<style>
  :root { color-scheme: ${theme.isDark ? "dark" : "light"}; }
  html, body { margin: 0; }
  body { background: ${c.bg}; color: ${c.text}; font: 14px/1.75 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .lg-off-bar { position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 10px;
    padding: 8px 20px; background: ${c.rail}; color: ${c.text2}; border-bottom: 1px solid ${c.border};
    font-size: 12px; }
  .lg-off-bar b { color: ${c.text}; font-weight: 600; }
  .lg-off-dot { width: 8px; height: 8px; border-radius: 50%; background: ${c.orange}; flex: none; }
  .lg-off-fill { flex: 1; }
  .lg-off-main { max-width: 920px; margin: 0 auto; padding: 20px 24px 64px; }
  .lg-off-main img { max-width: 100%; }
  .lg-off-main pre { overflow: auto; background: ${c.surface}; border: 1px solid ${c.border};
    border-radius: 8px; padding: 12px 14px; }
  .lg-off-main code { font-family: Consolas, "Cascadia Mono", "Courier New", monospace; font-size: 13px; }
  /* 离线时没有 KaTeX 样式：让结构元素按行内文本流式排布，公式仍可读 */
  .katex-display { display: block; text-align: center; margin: 10px 0; }
  .katex .base { display: inline; }
</style></head><body>
<div class="lg-off-bar"><span class="lg-off-dot"></span><b>${esc(snap.pid)}</b>
<span>离线快照${when ? " · 保存于 " + esc(when) : ""}</span><span class="lg-off-fill"></span>
<span>联网后重新打开本题即恢复在线版</span></div>
<div class="lg-off-main">${snap.html}</div>
</body></html>`;
}

function offlineMissingHtml(pid, theme) {
  const c = theme.colors;
  return `<!doctype html><html><head><meta charset="utf-8"><title>没有离线快照</title><style>
  body { background: ${c.bg}; color: ${c.text}; font: 14px/1.8 system-ui, "Microsoft YaHei", sans-serif;
    display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .box { max-width: 420px; padding: 32px; text-align: center; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { color: ${c.text2}; margin: 0; font-size: 13px; }
</style></head><body><div class="box"><h1>当前离线，这道题还没有快照</h1>
<p>${pid ? pid + " 只在联网时打开过才有离线缓存。" : "离线快照地址无效。"}联网打开一次题目后，题面会自动存到本地。</p></div></body></html>`;
}

function registerOfflineProtocol(ctx) {
  const serve = (request) => {
    const headers = { "content-type": "text/html; charset=utf-8" };
    try {
      const url = new URL(request.url);
      const pid = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/$/, "")).toUpperCase();
      const snap = pid && ctx.luogu ? ctx.luogu.problemSnapshot(pid) : null;
      if (!snap || !snap.html) {
        return new Response(offlineMissingHtml(pid, ctx.theme), { headers });
      }
      return new Response(offlinePageHtml(snap, ctx.theme), { headers });
    } catch (err) {
      console.error("[lgoff] serve failed:", err.message);
      return new Response(offlineMissingHtml("", ctx.theme), { headers });
    }
  };
  protocol.handle("lgoff", serve);
  // 页面视图全部跑在 persist:luogu 分区，自定义协议必须在那个 session 上也注册一份
  if (ctx.session && ctx.session.protocol) {
    try {
      ctx.session.protocol.handle("lgoff", serve);
    } catch (err) {
      console.error("[lgoff] session register failed:", err.message);
    }
  }
}

function bootstrap() {
  const ctx = {
    cfg: config,
    smoke: process.argv.includes("--smoke"),
    theme: null,
    wallpaper: { kind: "builtin", url: "" },
    store: null,
  };

  app.whenReady().then(async () => {
    ctx.cfg.init();
    ctx.store = new Store(require("node:path").join(app.getPath("userData"), "store")).init();
    const startMode = ctx.cfg.get().appearance.mode;
    nativeTheme.themeSource = startMode === "system" ? "system" : startMode;
    ctx.theme = theme.payload(ctx.cfg.get());
    ctx.wallpaper = await wallpaper.resolve(ctx.cfg.get(), ctx.theme);
    ctx.scanWe = (root) => wallpaper.scanWe(root);

    ctx.session = session.fromPartition("persist:luogu");
    ctx.session.setUserAgent(UA);
    ctx.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ctx.session.setPermissionCheckHandler(() => false);
    // lgoff 离线协议要同时挂在默认 session 和洛谷分区 session 上（页面视图用后者）
    registerOfflineProtocol(ctx);

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

    ctx.refreshAppearance = async (options = {}) => {
      const mode = ctx.cfg.get().appearance.mode;
      nativeTheme.themeSource = mode === "system" ? "system" : mode;
      ctx.theme = theme.payload(ctx.cfg.get());
      ctx.wallpaper = await wallpaper.resolve(ctx.cfg.get(), ctx.theme);
      applyTheme(ctx.win, ctx.theme);
      applyTheme(ctx.settingsWin, ctx.theme);
      ctx.views.updateTheme();
      if (options.reschedule !== false) ctx.scheduleWallpaperRotation();
      broadcastState(ctx);
    };

    let rotationTimer = null;
    ctx.scheduleWallpaperRotation = () => {
      if (rotationTimer) {
        clearInterval(rotationTimer);
        rotationTimer = null;
      }
      const a = ctx.cfg.get().appearance;
      if (!["folder", "we"].includes(a.wallpaper) || a.wallpaperInterval <= 0) return;
      rotationTimer = setInterval(() => {
        ctx.nextWallpaper().catch((err) => console.error("[wallpaper] rotate:", err.message));
      }, a.wallpaperInterval * 60000);
    };

    ctx.nextWallpaper = async () => {
      const cfg = ctx.cfg.get();
      const a = cfg.appearance;
      const total = wallpaper.count(cfg);
      let next = (Number(a.wallpaperIndex) || 0) + 1;
      if (a.wallpaperShuffle && total > 1) {
        next = Math.floor(Math.random() * total);
        if (next === a.wallpaperIndex) next = (next + 1) % total;
      } else if (total > 0) {
        next = next % total;
      }
      ctx.cfg.setAppearance({ wallpaperIndex: next, weId: "" });
      await ctx.refreshAppearance({ reschedule: false });
      return state(ctx);
    };

    ctx.command = (name) => {
      if (!ctx.win || ctx.win.isDestroyed()) return;
      if (name === "palette" || name === "switcher" || name === "jump") {
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
    ctx.scheduleWallpaperRotation();
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
    if (ctx.store) ctx.store.flushAll();
  });

  app.on("window-all-closed", () => {
    if (app.quitting) app.quit();
  });

  process.on("uncaughtException", (err) => {
    console.error("[fatal]", err);
  });
}
