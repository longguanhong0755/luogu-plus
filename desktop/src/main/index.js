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
const adblock = require("./adblock");
const smoke = () => require("./smoke");

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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: data:; base-uri 'none'; form-action 'none'">
<title>${esc(snap.pid)} ${esc(snap.title || "")}</title>
<base href="https://www.luogu.com.cn/">
<style>
  :root {
    color-scheme: ${theme.isDark ? "dark" : "light"};
    --bg: ${c.bg}; --surface: ${c.surface}; --surface2: ${c.surface2};
    --border: ${c.border}; --border-strong: ${c.borderStrong}; --divider: ${c.divider};
    --text: ${c.text}; --text2: ${c.text2}; --text3: ${c.text3};
    --accent: ${c.accent}; --accent-text: ${c.accentText};
    --accent-soft: ${c.accentSoft}; --shadow: ${c.shadow}; --highlight: ${c.highlight};
  }
  html, body { margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px; line-height: 1.8; font-synthesis: none;
  }
  a { color: var(--accent-text); text-underline-offset: 2px; }
  .lg-off-bar {
    position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 10px;
    height: 40px; padding: 0 20px; background: ${c.title}; color: var(--text2);
    border-bottom: 1px solid var(--border); font-size: 12px; line-height: 18px;
  }
  .lg-off-bar b { color: var(--text); font-weight: 600; }
  .lg-off-dot { width: 7px; height: 7px; border-radius: 50%; background: ${c.orange}; flex: none; }
  .lg-off-fill { flex: 1; }
  .lg-off-main { max-width: 960px; margin: 0 auto; padding: 28px 32px 64px; }
  .lg-off-main img { max-width: 100%; height: auto; }
  .lg-off-main h1, .lg-off-main h2, .lg-off-main h3, .lg-off-main h4 {
    color: var(--text); font-weight: 600; letter-spacing: 0; line-height: 1.4;
  }
  .lg-off-main h1 { font-size: 24px; line-height: 32px; margin: 0 0 16px; }
  .lg-off-main h2 { font-size: 20px; line-height: 28px; margin: 28px 0 10px; }
  .lg-off-main h3 { font-size: 16px; line-height: 24px; margin: 22px 0 8px; }
  .lg-off-main p { max-width: 74ch; margin: 0 0 12px; }
  .lg-off-main :is(.l-card, .lfe-card, .card, .header-card, .lfe-panel, .lfe-comment, .comment) {
    background: color-mix(in srgb, var(--surface) 95%, transparent);
    border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 1px 2px var(--shadow), 0 8px 24px color-mix(in srgb, var(--shadow) 55%, transparent);
  }
  .lg-off-main table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .lg-off-main th {
    height: 38px; padding: 0 12px; text-align: left; font-size: 12px; font-weight: 600;
    color: var(--text2); background: color-mix(in srgb, var(--text) 5%, transparent);
    border-bottom: 1px solid var(--divider);
  }
  .lg-off-main td { height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--divider); }
  .lg-off-main pre {
    overflow: auto; background: color-mix(in srgb, var(--surface2) 82%, transparent);
    border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
    font-size: 13px; line-height: 1.7;
  }
  .lg-off-main code {
    font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace; font-size: 0.94em;
  }
  .lg-off-main :not(pre) > code {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: 4px; padding: 1px 5px;
  }
  .lg-off-main blockquote {
    margin: 0 0 12px; padding: 8px 14px; border-left: 2px solid var(--accent);
    border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text2);
  }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  ::selection { background: var(--accent-soft); }
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
  :root { color-scheme: ${theme.isDark ? "dark" : "light"}; }
  html, body { margin: 0; }
  body {
    background: ${c.bg}; color: ${c.text};
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px; line-height: 1.8;
    display: flex; min-height: 100vh; align-items: center; justify-content: center;
  }
  .box {
    width: min(440px, calc(100vw - 48px)); padding: 32px; text-align: center;
    background: color-mix(in srgb, ${c.surface} 95%, transparent);
    border: 1px solid ${c.border}; border-radius: 12px;
    box-shadow: 0 1px 2px ${c.shadow}, 0 8px 24px color-mix(in srgb, ${c.shadow} 55%, transparent);
  }
  .ico {
    width: 40px; height: 40px; margin: 0 auto 14px; border-radius: 50%;
    display: grid; place-items: center; color: ${c.orange};
    background: color-mix(in srgb, ${c.orange} 14%, transparent);
  }
  h1 { font-size: 16px; line-height: 24px; margin: 0 0 6px; font-weight: 600; }
  p { color: ${c.text2}; margin: 0; font-size: 13px; line-height: 20px; }
</style></head><body><div class="box">
<div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 16 16"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M5 12a10 10 0 0 1 3.5-2.3"/><path d="M15.5 9.7A10 10 0 0 1 19 12"/></svg></div>
<h1>当前离线，这道题还没有快照</h1>
<p>${pid ? pid + " 只在联网时打开过才有离线缓存。" : "离线快照地址无效。"}联网打开一次题目后，题面会自动存到本地。</p>
</div></body></html>`;
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
    // 站内代码块复制按钮走 clipboard API：仅对洛谷来源放行剪贴板写，其余权限一律拒绝
    ctx.session.setPermissionCheckHandler((_wc, permission, origin) => {
      return (
        permission === "clipboard-sanitized-write" &&
        /^https?:\/\/([a-z0-9-]+\.)*luogu\.com\.cn(:\d+)?$/i.test(String(origin || ""))
      );
    });
    // 广告拦截只在这个会话上挂一次；开关状态由回调实时读取。
    adblock.wire(ctx.session, () => ctx.cfg.get().general.adBlock);
    // 页面里的下载（附件/素材）自动落到系统「下载」文件夹，完成后 toast，不弹另存为
    ctx.session.on("will-download", (_event, item) => {
      try {
        const dir = app.getPath("downloads");
        // basename 收敛：服务端建议文件名绝不许带路径成分
        const filename = require("node:path").basename(item.getFilename() || "download");
        let savePath = require("node:path").join(dir, filename);
        const dot = filename.lastIndexOf(".");
        const stem = dot > 0 ? filename.slice(0, dot) : filename;
        const ext = dot > 0 ? filename.slice(dot) : "";
        for (let i = 1; i < 100; i++) {
          if (!require("node:fs").existsSync(savePath)) break;
          savePath = require("node:path").join(dir, `${stem}(${i})${ext}`);
        }
        item.setSavePath(savePath);
        item.once("done", (_e, state) => {
          if (state === "completed") ctx.toast("下载完成", `${filename} 已保存到「下载」文件夹。`);
          else if (state === "interrupted") ctx.toast("下载失败", filename);
        });
      } catch (err) {
        console.error("[download]", err.message);
      }
    });
    // lgoff 离线协议要同时挂在默认 session 和洛谷分区 session 上（页面视图用后者）
    registerOfflineProtocol(ctx);

    ctx.notify = createNotifier(ctx);
    ctx.win = createMainWindow(ctx);
    ctx.views = new ViewManager(ctx);
    ctx.views.setWindow(ctx.win);
    ctx.luogu = new LuoguService(ctx);
    if (process.env.LG_DEMO === "1") smoke().seedDemo(ctx);
    ctx.tray = createTray(ctx);
    registerIpc(ctx);

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

    const relayout = () => ctx.views.layout();
    ctx.win.on("resize", relayout);
    ctx.win.on("maximize", relayout);
    ctx.win.on("unmaximize", relayout);
    ctx.win.on("enter-full-screen", relayout);
    ctx.win.on("leave-full-screen", relayout);
    // 窗口失焦/最小化时悬停浮层没有存在意义，立即收起
    const syncWindowFocus = (focused) => {
      if (!ctx.win || ctx.win.isDestroyed()) return;
      ctx.win.webContents.send("app:window-focus", !!focused);
      if (ctx.views) ctx.views.setWindowActive(!!focused);
    };
    ctx.win.on("focus", () => syncWindowFocus(true));
    ctx.win.on("blur", () => {
      ctx.views.hideRailOverlay();
      syncWindowFocus(false);
    });
    ctx.win.on("hide", () => syncWindowFocus(false));
    ctx.win.on("minimize", () => syncWindowFocus(false));
    ctx.win.on("restore", () => syncWindowFocus(ctx.win.isFocused()));
    ctx.win.on("show", () => syncWindowFocus(ctx.win.isFocused()));

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

    if (ctx.smoke) smoke().runSmoke(ctx);
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
    persistCrash(err);
    try {
      if (ctx && ctx.toast) ctx.toast("内部错误", "程序遇到未预期的异常，已记录到日志。");
    } catch {
      /* 崩溃路径上不允许再抛 */
    }
  });
}

/* 崩溃可观测性：主进程未捕获异常落盘到 logs/crash.log（userData 内标准 logs 目录，
   隔离测试实例落自己的 profile，互不可见）。仅追加，失败静默——崩溃路径上不能再抛。 */
function persistCrash(err) {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const { app } = require("electron");
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "crash.log"),
      JSON.stringify({
        t: new Date().toISOString(),
        ver: app.getVersion(),
        msg: String((err && err.message) || err),
        stack: String((err && err.stack) || "").slice(0, 4000),
      }) + "\n",
    );
  } catch {
    /* ignore */
  }
}
