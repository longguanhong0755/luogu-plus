/* 主窗口与设置窗口。标题栏由外壳自绘，右上角窗口按钮用 Windows 原生
   titleBarOverlay（系统负责 Snap、双击最大化与右键系统菜单）。 */
const path = require("node:path");
const { BrowserWindow, app, screen } = require("electron");
const { PRELOAD, RENDERER, ASSETS } = require("./paths");
const { safeOpenExternal } = require("./external");

const TITLE_H = 40;
const RAIL_W = 208;
const RAIL_COLLAPSED_W = 56;
const TOOLBAR_H = 44;

function sanitizeBounds(saved) {
  const width = Math.max(1000, Math.round(saved.width || 1280));
  const height = Math.max(640, Math.round(saved.height || 820));
  let x = Number.isFinite(saved.x) ? saved.x : null;
  let y = Number.isFinite(saved.y) ? saved.y : null;
  if (x !== null && y !== null) {
    const display = screen.getDisplayNearestPoint({ x, y });
    const area = display.workArea;
    const visible =
      x + width > area.x + 80 &&
      x < area.x + area.width - 80 &&
      y + 80 > area.y &&
      y < area.y + area.height - 80;
    if (!visible) {
      x = null;
      y = null;
    }
  }
  return { width, height, x, y };
}

function overlayFor(colors) {
  return { color: colors.title, symbolColor: colors.text2, height: TITLE_H };
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
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: t.colors.bg,
    icon: path.join(ASSETS, "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(t.colors),
    webPreferences: {
      preload: path.join(PRELOAD, "shell.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // 冒烟窗口是不可见的；关闭后台节流才能稳定截到刚切换的面板
      backgroundThrottling: !ctx.smoke,
    },
  });

  win.loadFile(path.join(RENDERER, "shell", "index.html"));

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
  const win = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 760,
    minHeight: 560,
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
      sandbox: false,
    },
  });
  win.loadFile(path.join(RENDERER, "settings", "index.html"));
  // 设置窗里的外链（关于页的仓库/反馈）交给系统浏览器，而不是把设置窗导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: "deny" };
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
  RAIL_W,
  RAIL_COLLAPSED_W,
  TOOLBAR_H,
  createMainWindow,
  createSettingsWindow,
  applyTheme,
  sanitizeBounds,
};
