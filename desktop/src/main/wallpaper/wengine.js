/* Wallpaper Engine 扫描层：project.json 解析、创意工坊目录发现与 30 秒结果缓存。
   scene/web/application 类壁纸无法在本应用内运行，退化为预览图并标注原因。 */
const fs = require("node:fs");
const path = require("node:path");
const { weCache } = require("./constants");
const { isImage, isVideo, toUrl } = require("./files");

function readCache(key) {
  const cached = weCache.get(key);
  if (cached && Date.now() - cached.at < 30000) return cached.items;
  return null;
}

function writeCache(key, items) {
  weCache.set(key, { at: Date.now(), items });
}

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
  const cached = readCache(key);
  if (cached) return cached;
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
  writeCache(key, items);
  return items;
}

module.exports = { readCache, writeCache, readProject, findWeDirs, scanWe };
