/* 配置持久化：userData/config.json。
   结构固定为四节，写入时整文件替换（体量很小）。
   注意：这里只存设置，不存「上次打开的页面/滚动位置」——产品要求不记忆会话。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  appearance: {
    mode: "system", // light | dark | system
    material: 55, // 0 = 纯色不透明, 100 = 强玻璃
    wallpaper: "desktop", // desktop | builtin | daily | custom
    customWallpaper: "",
    accent: "luogu", // luogu | system | #rrggbb
  },
  general: {
    closeAction: "tray", // tray | quit
    autoLaunch: false,
  },
  notify: {
    judge: true,
    contest: true,
    contestLeadMin: 10,
  },
  window: {
    width: 1280,
    height: 820,
    x: null,
    y: null,
    maximized: false,
  },
};

let data = clone(DEFAULTS);
let file = "";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function merge(base, over) {
  const out = clone(base);
  if (!isPlainObject(over)) return out;
  for (const key of Object.keys(out)) {
    if (!(key in over)) continue;
    if (isPlainObject(out[key])) out[key] = merge(out[key], over[key]);
    else out[key] = over[key];
  }
  return out;
}

function clamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function sanitize() {
  const a = data.appearance;
  if (!["light", "dark", "system"].includes(a.mode)) a.mode = "system";
  a.material = Math.round(clamp(a.material, 0, 100, 55));
  if (!["desktop", "builtin", "daily", "custom"].includes(a.wallpaper)) a.wallpaper = "desktop";
  if (typeof a.customWallpaper !== "string") a.customWallpaper = "";
  if (typeof a.accent !== "string" || !(a.accent === "luogu" || a.accent === "system" || /^#[0-9a-fA-F]{6}$/.test(a.accent))) {
    a.accent = "luogu";
  }

  const g = data.general;
  if (!["tray", "quit"].includes(g.closeAction)) g.closeAction = "tray";
  g.autoLaunch = !!g.autoLaunch;

  const n = data.notify;
  n.judge = !!n.judge;
  n.contest = !!n.contest;
  n.contestLeadMin = Math.round(clamp(n.contestLeadMin, 1, 60, 10));

  const w = data.window;
  w.width = Math.round(clamp(w.width, 1000, 10000, 1280));
  w.height = Math.round(clamp(w.height, 640, 10000, 820));
  w.x = Number.isFinite(Number(w.x)) ? Math.round(Number(w.x)) : null;
  w.y = Number.isFinite(Number(w.y)) ? Math.round(Number(w.y)) : null;
  w.maximized = !!w.maximized;
}

function init() {
  file = path.join(app.getPath("userData"), "config.json");
  try {
    data = merge(DEFAULTS, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    data = clone(DEFAULTS);
  }
  sanitize();
  return data;
}

function get() {
  return data;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[config] save failed:", err.message);
  }
}

function setAppearance(patch) {
  data.appearance = Object.assign({}, data.appearance, patch || {});
  sanitize();
  save();
  return data.appearance;
}

function setGeneral(patch) {
  data.general = Object.assign({}, data.general, patch || {});
  sanitize();
  save();
  return data.general;
}

function setNotify(patch) {
  data.notify = Object.assign({}, data.notify, patch || {});
  sanitize();
  save();
  return data.notify;
}

function setWindow(patch) {
  data.window = Object.assign({}, data.window, patch || {});
  sanitize();
  save();
  return data.window;
}

module.exports = { DEFAULTS, init, get, save, setAppearance, setGeneral, setNotify, setWindow, sanitize };
