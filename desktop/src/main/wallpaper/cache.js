/* 壁纸显示缓存层：按屏幕显示预算把静态图缩放成 JPEG 落盘复用，
   每日一图（Bing）也在这里下载并保留最近 3 张。 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, net, nativeImage, screen } = require("electron");
const { fileURLToPath } = require("node:url");
const { extOf, toUrl, todayKey } = require("./files");

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

module.exports = { displayBudget, pruneDisplayCache, pruneDailyCache, displayImage, dailyImage };
