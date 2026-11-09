/* 壁纸解析层：把配置里的 wallpaper 来源解析成渲染层可直接用的 url / 兜底渐变 /
   计数与候选清单。来源：桌面、内置、Bing 每日一图、单张、文件夹轮换、
   Wallpaper Engine（仅预览图）。 */
const path = require("node:path");
const { hexToRgba } = require("../theme");
const { desktopWallpaperPath, isImage, isVideo, toUrl, cssUrl, listFolder } = require("./files");
const { displayBudget, displayImage, dailyImage } = require("./cache");
const { scanWe } = require("./wengine");

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

module.exports = { builtinBackdrop, videoFallback, pickIndex, resolve, count };
