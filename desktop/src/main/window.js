/* 主窗口与设置窗口。标题栏由外壳自绘，右上角窗口按钮用 Windows 原生
   titleBarOverlay（系统负责 Snap、双击最大化与右键系统菜单）。 */
const path = require("node:path");
const { BrowserWindow, app, screen } = require("electron");
const { PRELOAD, RENDERER, ASSETS } = require("./paths");
const { safeOpenExternal } = require("./external");

const TITLE_H = 40;
const RAIL_W = 208;
const RAIL_COLLAPSED_W = 64;
const TOOLBAR_H = 44;
const APP_USER_MODEL_ID = "com.luogulab.desktop";
const APP_DISPLAY_NAME = "洛谷桌面版";
const MIN_WINDOW_W = 640;
const MIN_WINDOW_H = 480;
const MIN_SETTINGS_W = 640;
const MIN_SETTINGS_H = 480;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function fitBoundsToArea(saved, area) {
  // Windows Snap 左/右半屏在 1920px 显示器上是 960px；旧的最小 1000px
  // 会把半屏强行撑宽。默认仍打开 1280×820，只降低用户主动缩放的下限。
  const minWidth = Math.min(MIN_WINDOW_W, area.width);
  const minHeight = Math.min(MIN_WINDOW_H, area.height);
  const width = Math.min(Math.max(minWidth, Math.round(saved.width || 1280)), area.width);
  const height = Math.min(Math.max(minHeight, Math.round(saved.height || 820)), area.height);
  const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);
  const x = hasPosition
    ? clamp(Math.round(saved.x), area.x, Math.max(area.x, area.x + area.width - width))
    : area.x + Math.max(0, Math.floor((area.width - width) / 2));
  const y = hasPosition
    ? clamp(Math.round(saved.y), area.y, Math.max(area.y, area.y + area.height - height))
    : area.y + Math.max(0, Math.floor((area.height - height) / 2));
  return { width, height, x, y, maximized: !!saved.maximized };
}

function sanitizeBounds(saved) {
  const primary = screen.getPrimaryDisplay();
  const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);
  const display = hasPosition
    ? screen.getDisplayMatching({
        x: Math.round(saved.x),
        y: Math.round(saved.y),
        width: Math.max(1, Math.round(saved.width || 1280)),
        height: Math.max(1, Math.round(saved.height || 820)),
      })
    : primary;
  return fitBoundsToArea(saved, display.workArea);
}
function overlayFor(colors) {
  // Windows 会自行绘制 overlay 的底色。标题栏本身已经是半透明玻璃，
  // 若这里再传主题色会在右上角形成一块不透明矩形；透明 overlay 让
  // 原生最小化/最大化/关闭按钮直接覆盖在外壳玻璃上。
  return { color: "#00000000", symbolColor: colors.text2, height: TITLE_H };
}

function relaunchCommand() {
  const exe = process.execPath.replace(/"/g, '\\"');
  if (app.isPackaged) return `"${exe}"`;
  const appPath = app.getAppPath().replace(/"/g, '\\"');
  return `"${exe}" "${appPath}"`;
}

function applyAppDetails(win) {
  if (!win || win.isDestroyed() || process.platform !== "win32") return;
  try {
    win.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: path.join(ASSETS, "icon.ico"),
      appIconIndex: 0,
      relaunchCommand: relaunchCommand(),
      relaunchDisplayName: APP_DISPLAY_NAME,
    });
  } catch (err) {
    console.warn("[window] taskbar identity:", err.message);
  }
}

function createMainWindow(ctx) {
  const cfg = ctx.cfg.get();
  const t = ctx.theme;
  const bounds = sanitizeBounds(cfg.window);

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x === null ? undefined : bounds.x,
    y: bounds.y === null ? undefined : bounds.y,
    minWidth: Math.min(MIN_WINDOW_W, screen.getPrimaryDisplay().workArea.width),
    minHeight: Math.min(MIN_WINDOW_H, screen.getPrimaryDisplay().workArea.height),
    show: false,
    backgroundColor: t.colors.bg,
    icon: path.join(ASSETS, "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(t.colors),
    webPreferences: {
      preload: path.join(PRELOAD, "shell.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 冒烟窗口是不可见的；关闭后台节流才能稳定截到刚切换的面板
      backgroundThrottling: !ctx.smoke,
    },
  });
  applyAppDetails(win);

  win.loadFile(path.join(RENDERER, "shell", "index.html"));

  // 外壳窗口是纯本地页，永不导航：拖入链接/文件不改文档，外链走系统浏览器。
  // 没有这条防护，被拖入的新文档会继承 preload 暴露的 window.lg 特权桥。
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  win.once("ready-to-show", () => {
    if (bounds.maximized) win.maximize();
    if (!ctx.smoke) win.show();
  });

  win.on("close", (event) => {
    const closeAction = ctx.cfg.get().general.closeAction;
    if (!app.quitting && closeAction === "tray") {
      event.preventDefault();
      win.hide();
      ctx.notify.hiddenToTray();
    } else {
      app.quitting = true;
    }
  });

  let saveTimer = null;
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const normal = maximized ? null : win.getNormalBounds();
    ctx.cfg.setWindow(
      Object.assign({ maximized }, normal ? { width: normal.width, height: normal.height, x: normal.x, y: normal.y } : {})
    );
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.on("close", saveBounds);

  return win;
}

function createSettingsWindow(ctx) {
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
    ctx.settingsWin.show();
    ctx.settingsWin.focus();
    return ctx.settingsWin;
  }
  const t = ctx.theme;
  const display = ctx.win && !ctx.win.isDestroyed()
    ? screen.getDisplayMatching(ctx.win.getBounds())
    : screen.getPrimaryDisplay();
  const bounds = fitBoundsToArea({ width: 860, height: 640 }, display.workArea);
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: Math.min(MIN_SETTINGS_W, display.workArea.width),
    minHeight: Math.min(MIN_SETTINGS_H, display.workArea.height),
    show: false,
    parent: ctx.win && !ctx.win.isDestroyed() ? ctx.win : undefined,
    backgroundColor: t.colors.bg,
    icon: path.join(ASSETS, "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(t.colors),
    webPreferences: {
      preload: path.join(PRELOAD, "settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  applyAppDetails(win);
  win.loadFile(path.join(RENDERER, "settings", "index.html"));
  // 设置窗永不导航：外链走安全出口，其余窗口打开请求一律拒绝
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // 设置窗里的外链（关于页的仓库/反馈）交给系统浏览器，而不是把设置窗导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  win.once("ready-to-show", () => {
    if (ctx.smoke) {
      win.setOpacity(0);
      win.showInactive();
    } else {
      win.show();
    }
  });
  win.on("closed", () => {
    ctx.settingsWin = null;
  });
  ctx.settingsWin = win;
  return win;
}

function applyTheme(win, t) {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(t.colors.bg);
  try {
    win.setTitleBarOverlay(overlayFor(t.colors));
  } catch {
    /* 某些平台不支持 overlay */
  }
}

module.exports = {
  TITLE_H,
  APP_USER_MODEL_ID,
  APP_DISPLAY_NAME,
  RAIL_W,
  RAIL_COLLAPSED_W,
  TOOLBAR_H,
  MIN_WINDOW_W,
  MIN_WINDOW_H,
  MIN_SETTINGS_W,
  MIN_SETTINGS_H,
  createMainWindow,
  createSettingsWindow,
  applyTheme,
  sanitizeBounds,
  fitBoundsToArea,
};
