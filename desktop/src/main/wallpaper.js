/* 壁纸解析：桌面 / 内置 / 每日一图 / 单张 / 文件夹轮换 / Wallpaper Engine。
   解析结果同时服务两个渲染层：
   - 外壳：真实 wallpaper 层（图片或视频）；
   - 洛谷页面：同坐标的静态复刻层（backdrop），保证玻璃面板后面透出同一张图。
   Wallpaper Engine 的 scene/web 壁纸无法在本应用内运行，退化为其预览图并标注。 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, net, nativeImage, screen } = require("electron");
const { execFileSync } = require("node:child_process");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { hexToRgba } = require("./theme");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv"]);

const weCache = new Map();

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

function displayBudget() {
  let area = { width: 1920, height: 1080 };
  let scaleFactor = 1;
  try {
    const display = screen.getPrimaryDisplay();
    area = display.workArea || display.size || area;
    scaleFactor = Math.max(1, Math.min(2, Number(display.scaleFactor) || 1));
  } catch {
    /* ready 前使用保守默认值 */
  }
  return {
    maxWidth: Math.max(960, Math.min(2560, Math.round(area.width * scaleFactor))),
    maxHeight: Math.max(640, Math.min(1600, Math.round(area.height * scaleFactor))),
  };
}

function pruneDisplayCache(dir, keep, maxBytes) {
  try {
    const files = fs.readdirSync(dir)
      .filter((name) => /^[a-f0-9]+\.jpg$/i.test(name))
      .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return { file, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    let bytes = 0;
    let kept = 0;
    for (const item of files) {
      const fits = kept < keep && bytes + item.size <= maxBytes;
      if (fits) {
        kept += 1;
        bytes += item.size;
      } else {
        fs.rmSync(item.file, { force: true });
      }
    }
  } catch {
    /* 缓存清理失败不影响壁纸显示 */
  }
}

function pruneDailyCache(dir, keep = 3) {
  try {
    const files = fs.readdirSync(dir)
      .filter((name) => /^daily-\d{4}-\d{2}-\d{2}\.jpg$/i.test(name))
      .map((name) => {
        const file = path.join(dir, name);
        return { file, mtime: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of files.slice(keep)) fs.rmSync(item.file, { force: true });
  } catch {
    /* ignore */
  }
}

function displayImage(url, maxWidth, maxHeight) {
  if (!url || !/^file:/i.test(url)) return url;
  let file = "";
  try {
    file = fileURLToPath(url);
  } catch {
    return url;
  }
  const ext = extOf(file);
  if (!new Set([".jpg", ".jpeg", ".png", ".webp"]).has(ext)) return url;
  const limitW = Number(maxWidth);
  const limitH = Number(maxHeight);
  if (!Number.isFinite(limitW) || !Number.isFinite(limitH) || limitW < 1 || limitH < 1) return url;
  try {
    const stat = fs.statSync(file);
    const image = nativeImage.createFromPath(file);
    const size = image.getSize();
    if (!size.width || !size.height) return url;
    const scale = Math.min(1, limitW / size.width, limitH / size.height);
    if (scale >= 0.98) return url;
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const key = crypto.createHash("sha1").update(`${file}|${stat.size}|${stat.mtimeMs}|${width}x${height}`).digest("hex").slice(0, 16);
    const dir = path.join(app.getPath("userData"), "wallpapers", "display-cache");
    const cache = path.join(dir, key + ".jpg");
    if (!fs.existsSync(cache)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cache, image.resize({ width, height, quality: "good" }).toJPEG(84));
      pruneDisplayCache(dir, 8, 48 * 1024 * 1024);
    }
    return toUrl(cache);
  } catch {
    return url;
  }
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

async function dailyImage() {
  const dir = path.join(app.getPath("userData"), "wallpapers");
  pruneDailyCache(dir, 3);
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

/* ---------- Wallpaper Engine ---------- */

function readProject(dir) {
  const projectFile = path.join(dir, "project.json");
  let json;
  try {
    json = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  } catch {
    return null;
  }
  const type = String(json.type || "").toLowerCase();
  const mediaName = typeof json.file === "string" ? json.file : "";
  const previewName = typeof json.preview === "string" ? json.preview : "";
  const media = mediaName ? path.join(dir, mediaName) : "";
  const preview = previewName ? path.join(dir, previewName) : "";
  const mediaOk = !!media && fs.existsSync(media) && (isVideo(media) || isImage(media));
  const previewOk = !!preview && fs.existsSync(preview) && isImage(preview);
  const playable = mediaOk && (type === "video" || type === "image" || isImage(media));
  let note = "";
  if (!playable) {
    if (type === "scene") note = "场景壁纸：以预览图呈现";
    else if (type === "web") note = "网页壁纸：以预览图呈现";
    else if (type === "application") note = "程序壁纸：以预览图呈现";
    else note = "无可用视频/图片，以预览图呈现";
  }
  return {
    id: path.basename(dir),
    dir,
    title: String(json.title || path.basename(dir)).slice(0, 80),
    type: type || "unknown",
    media,
    preview,
    playable,
    note,
    previewUrl: toUrl(previewOk ? preview : mediaOk && isImage(media) ? media : ""),
  };
}

function findWeDirs(root) {
  const dirs = [];
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && dirs.length < 200 && visited < 3000) {
    const { dir, depth } = queue.shift();
    visited++;
    if (fs.existsSync(path.join(dir, "project.json"))) {
      dirs.push(dir);
      continue;
    }
    if (depth >= 5) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return dirs;
}

function scanWe(root) {
  if (!root) return [];
  const key = path.resolve(root);
  const cached = weCache.get(key);
  if (cached && Date.now() - cached.at < 30000) return cached.items;
  const candidates = [root];
  if (path.basename(root) !== "431960") {
    candidates.push(path.join(root, "steamapps", "workshop", "content", "431960"));
    candidates.push(path.join(root, "workshop", "content", "431960"));
    candidates.push(path.join(root, "content", "431960"));
  }
  const dirs = [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dirs.push(...findWeDirs(candidate));
    if (dirs.length) break;
  }
  const items = dirs.map(readProject).filter(Boolean);
  items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  weCache.set(key, { at: Date.now(), items });
  return items;
}

/* ---------- 解析 ---------- */

function builtinBackdrop(theme) {
  const accent = (theme && theme.colors && theme.colors.accent) || "#5b8cff";
  const bg = (theme && theme.colors && theme.colors.bg) || "#1e1e22";
  return (
    `radial-gradient(120% 90% at 76% 6%, ${hexToRgba(accent, 0.22)}, transparent 55%), ` +
    `linear-gradient(160deg, ${hexToRgba(accent, 0.08)}, ${bg} 72%)`
  );
}

function videoFallback(theme) {
  const accent = (theme && theme.colors && theme.colors.accent) || "#5b8cff";
  const bg = (theme && theme.colors && theme.colors.bg) || "#1e1e22";
  return (
    `radial-gradient(100% 80% at 30% 10%, ${hexToRgba(accent, 0.18)}, transparent 60%), ` +
    `linear-gradient(145deg, ${hexToRgba(accent, 0.06)}, ${bg})`
  );
}

function pickIndex(cfg, count) {
  if (!count) return 0;
  const index = Number(cfg.appearance.wallpaperIndex) || 0;
  return ((index % count) + count) % count;
}

async function resolve(cfg, theme) {
  const a = cfg.appearance;
  const budget = displayBudget();
  const base = {
    kind: a.wallpaper,
    url: "",
    video: false,
    poster: "",
    backdrop: builtinBackdrop(theme),
    label: "",
    count: 0,
    items: [],
    motion: !!a.wallpaperMotion,
    zoom: !!a.wallpaperZoom,
    fade: !!a.wallpaperFade,
  };

  if (a.wallpaper === "desktop") {
    const file = desktopWallpaperPath();
    const url = displayImage(toUrl(file), budget.maxWidth, budget.maxHeight);
    return Object.assign(base, {
      url,
      backdrop: url ? cssUrl(url) : builtinBackdrop(theme),
      label: url ? "桌面壁纸" : "桌面壁纸不可用",
      count: url ? 1 : 0,
    });
  }

  if (a.wallpaper === "daily") {
    const url = displayImage(await dailyImage(), budget.maxWidth, budget.maxHeight);
    return Object.assign(base, {
      url,
      backdrop: url ? cssUrl(url) : builtinBackdrop(theme),
      label: url ? "Bing 每日一图" : "每日一图暂不可用",
      count: url ? 1 : 0,
    });
  }

  if (a.wallpaper === "custom") {
    const file = a.wallpaperFile;
    const video = isVideo(file);
    const rawUrl = toUrl(file);
    const url = video ? rawUrl : displayImage(rawUrl, budget.maxWidth, budget.maxHeight);
    return Object.assign(base, {
      url,
      video,
      backdrop: video || !url ? videoFallback(theme) : cssUrl(url),
      label: url ? path.basename(file) : "未选择图片",
      count: url ? 1 : 0,
    });
  }

  if (a.wallpaper === "folder") {
    const files = listFolder(a.wallpaperDir);
    const index = pickIndex(cfg, files.length);
    const file = files[index] || "";
    const video = isVideo(file);
    const rawUrl = toUrl(file);
    const url = video ? rawUrl : displayImage(rawUrl, budget.maxWidth, budget.maxHeight);
    return Object.assign(base, {
      url,
      video,
      backdrop: video || !url ? videoFallback(theme) : cssUrl(url),
      label: url ? `${path.basename(file)} · ${index + 1}/${files.length}` : "文件夹为空",
      count: files.length,
      items: files.slice(0, 24).map((item) => ({ url: toUrl(item), title: path.basename(item), video: isVideo(item) })),
    });
  }

  if (a.wallpaper === "we") {
    const items = scanWe(a.weRoot);
    let chosen = null;
    if (a.weId) chosen = items.find((item) => item.id === a.weId) || null;
    if (!chosen) chosen = items[pickIndex(cfg, items.length)] || null;
    if (!chosen) {
      return Object.assign(base, {
        backdrop: builtinBackdrop(theme),
        label: a.weRoot ? "没有找到 Wallpaper Engine 壁纸" : "未选择 Wallpaper Engine 目录",
        items,
      });
    }
    const video = chosen.playable && isVideo(chosen.media);
    const rawUrl = toUrl(chosen.playable ? chosen.media : chosen.preview);
    const url = video ? rawUrl : displayImage(rawUrl, budget.maxWidth, budget.maxHeight);
    const rawPoster = chosen.previewUrl || toUrl(chosen.preview);
    const poster = displayImage(rawPoster, budget.maxWidth, budget.maxHeight);
    return Object.assign(base, {
      url,
      video,
      poster,
      backdrop: video || !url ? poster ? cssUrl(poster) : videoFallback(theme) : cssUrl(url),
      label: chosen.title + (chosen.note ? " · " + chosen.note : ""),
      count: items.length,
      items,
    });
  }

  return base;
}

function count(cfg) {
  const a = cfg.appearance;
  if (a.wallpaper === "folder") return listFolder(a.wallpaperDir).length;
  if (a.wallpaper === "we") return scanWe(a.weRoot).length;
  return 1;
}

module.exports = {
  resolve,
  count,
  scanWe,
  listFolder,
  desktopWallpaperPath,
  isImage,
  isVideo,
  builtinBackdrop,
  videoFallback,
};
