/* 壁纸文件层：系统桌面壁纸路径、扩展名判定、file:// URL、CSS url()、日期键、
   文件夹（含子目录）图片/视频清单。 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { IMAGE_EXT, VIDEO_EXT } = require("./constants");

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

function extOf(file) {
  return path.extname(String(file || "")).toLowerCase();
}

function isImage(file) {
  return IMAGE_EXT.has(extOf(file));
}

function isVideo(file) {
  return VIDEO_EXT.has(extOf(file));
}

function toUrl(file) {
  try {
    if (file && fs.existsSync(file)) return pathToFileURL(file).href;
  } catch {
    /* ignore */
  }
  return "";
}

function cssUrl(url) {
  return url ? `url("${String(url).replace(/"/g, '\\"')}")` : "";
}

function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ---------- 文件夹轮换 ---------- */

function listFolder(dir) {
  const out = [];
  if (!dir) return out;
  const walk = (current, depth) => {
    if (depth > 3 || out.length >= 400) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 400) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (isImage(entry.name) || isVideo(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir, 0);
  out.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return out;
}

module.exports = { desktopWallpaperPath, extOf, isImage, isVideo, toUrl, cssUrl, todayKey, listFolder };
