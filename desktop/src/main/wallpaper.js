/* 壁纸解析：跟随桌面 / 内置渐变 / 每日一图 / 自定义图片。
   桌面壁纸从注册表读原图路径；每日一图来自 Bing，按天缓存到 userData。 */
const fs = require("node:fs");
const path = require("node:path");
const { app, net } = require("electron");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

function desktopWallpaperPath() {
  if (process.platform !== "win32") return "";
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Control Panel\\Desktop", "/v", "Wallpaper"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const m = out.match(/Wallpaper\s+REG_SZ\s+(.+)/i);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function toUrl(file) {
  try {
    if (file && fs.existsSync(file)) return pathToFileURL(file).href;
  } catch {
    /* ignore */
  }
  return "";
}

function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function dailyImage() {
  const dir = path.join(app.getPath("userData"), "wallpapers");
  const file = path.join(dir, `daily-${todayKey()}.jpg`);
  if (fs.existsSync(file)) return toUrl(file);
  try {
    const res = await net.fetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN");
    const json = await res.json();
    const image = json && json.images && json.images[0];
    if (!image || !image.url) return "";
    const dl = await net.fetch("https://www.bing.com" + image.url);
    const buffer = Buffer.from(await dl.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buffer);
    return toUrl(file);
  } catch {
    return "";
  }
}

async function resolve(cfg) {
  const kind = cfg.appearance.wallpaper;
  if (kind === "desktop") {
    return { kind, url: toUrl(desktopWallpaperPath()) };
  }
  if (kind === "custom") {
    return { kind, url: toUrl(cfg.appearance.customWallpaper) };
  }
  if (kind === "daily") {
    return { kind, url: await dailyImage() };
  }
  return { kind: "builtin", url: "" };
}

module.exports = { resolve, desktopWallpaperPath };
