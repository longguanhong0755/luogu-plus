/* 把主进程解析好的主题落成 CSS 变量，并驱动壁纸层。
   外壳与设置窗共用；设置窗没有 #wallpaper 时只落变量。 */
let wallKey = "";
let wallContentKey = "";
let activeSlot = 0;

function builtinImage(theme) {
  const accent = (theme.colors && theme.colors.accent) || "#5b8cff";
  const bg = (theme.colors && theme.colors.bg) || "#1b1c20";
  return (
    `radial-gradient(120% 90% at 76% 6%, color-mix(in srgb, ${accent} 22%, transparent), transparent 55%), ` +
    `linear-gradient(160deg, color-mix(in srgb, ${accent} 8%, ${bg}), ${bg} 72%)`
  );
}

function fillLayer(layer, wall, theme) {
  layer.textContent = "";
  layer.style.backgroundImage = "";
  layer.classList.toggle("builtin", wall.kind === "builtin");
  const allowVideo = !document.body || document.body.dataset.wallpaperVideo !== "off";
  if (wall.video && wall.url && allowVideo) {
    const video = document.createElement("video");
    video.src = wall.url;
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    if (wall.poster) video.poster = wall.poster;
    video.addEventListener("error", () => {
      layer.style.backgroundImage = wall.poster ? `url("${wall.poster}")` : builtinImage(theme);
    });
    layer.appendChild(video);
    const play = video.play();
    if (play && play.catch) play.catch(() => {});
  } else if (wall.poster) {
    layer.style.backgroundImage = `url("${String(wall.poster).replace(/"/g, '\\"')}")`;
  } else if (wall.url && !wall.video) {
    layer.style.backgroundImage = `url("${String(wall.url).replace(/"/g, '\\"')}")`;
  } else {
    layer.style.backgroundImage = builtinImage(theme);
  }
}

function applyWallpaper(theme) {
  const box = document.getElementById("wallpaper");
  if (!box) return;
  const wall = theme.wallpaper || { kind: "builtin", url: "" };
  const contentKey = [wall.kind, wall.url, wall.video, wall.poster, theme.isDark].join("|");
  const key = contentKey + "|fade:" + (wall.fade ? "1" : "0");
  if (key === wallKey) return;
  const contentChanged = contentKey !== wallContentKey;
  const first = !wallContentKey;
  wallKey = key;

  const layers = box.querySelectorAll(".wall-layer");
  if (!layers.length) return;
  // 淡入开关本身也要即时生效；内容没变时只更新 body class 后返回。
  if (document.body) document.body.classList.toggle("wall-fade", !!(wall && wall.fade));
  if (!contentChanged) return;
  wallContentKey = contentKey;
  const slot = first ? 0 : 1 - activeSlot;
  const next = layers[slot];
  const prev = layers[1 - slot];
  if (first || !wall.fade) {
    for (const layer of layers) {
      layer.textContent = "";
      layer.style.opacity = "0";
    }
    fillLayer(next, wall, theme);
    next.style.opacity = "1";
    activeSlot = slot;
    return;
  }

  fillLayer(next, wall, theme);
  next.style.opacity = "0";
  // 强制一帧，让透明度过渡从 0 开始
  void next.offsetWidth;
  next.style.opacity = "1";
  prev.style.opacity = "0";
  activeSlot = slot;
  setTimeout(() => {
    if (layers[1 - slot] !== prev) return;
    prev.textContent = "";
    prev.style.backgroundImage = "";
  }, 700);
}

export function applyThemeVars(theme) {
  if (!theme || !theme.colors) return;
  const root = document.documentElement;
  const map = {
    "--bg": theme.colors.bg,
    "--rail": theme.colors.rail,
    "--title": theme.colors.title,
    "--surface": theme.colors.surface,
    "--surface-2": theme.colors.surface2,
    "--editor": theme.colors.editor,
    "--border": theme.colors.border,
    "--text": theme.colors.text,
    "--text-2": theme.colors.text2,
    "--text-3": theme.colors.text3,
    "--accent": theme.colors.accent,
    "--glass-tint": theme.colors.glassTint || theme.colors.accent,
    "--glass-tint-soft": theme.colors.glassTintSoft || theme.colors.accentSoft,
    "--accent-soft": theme.colors.accentSoft,
    "--accent-line": theme.colors.accentLine,
    "--accent-fill": theme.colors.accentFill || theme.colors.accent,
    "--accent-text": theme.colors.accentText || theme.colors.accent,
    "--on-accent": theme.colors.onAccent || "#ffffff",
    "--green": theme.colors.green,
    "--red": theme.colors.red,
    "--orange": theme.colors.orange,
    "--border-strong": theme.colors.borderStrong,
    "--divider": theme.colors.divider,
    "--hover": theme.colors.hover,
    "--pressed": theme.colors.pressed,
    "--shadow-color": theme.colors.shadow,
    "--glass-highlight": theme.colors.highlight,
    "--scrim": theme.colors.scrim || (theme.isDark ? "rgba(8,10,14,0.45)" : "rgba(20,24,32,0.24)"),
    "--panel-alpha": theme.panelAlpha + "%",
    "--panel-pct": theme.panelAlpha + "%",
    "--page-scrim": theme.pageScrim + "%",
    "--card-alpha": theme.cardAlpha + "%",
    "--overlay-alpha": theme.overlayAlpha + "%",
    "--blur": theme.blurPx + "px",
    "--mat": String(theme.material),
  };
  for (const key of Object.keys(map)) root.style.setProperty(key, map[key]);
  root.dataset.theme = theme.isDark ? "dark" : "light";
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

export function applyTheme(theme) {
  if (!theme || !theme.colors) return;
  applyThemeVars(theme);
  applyWallpaper(theme);
}

export function resetWallpaperKey() {
  wallKey = "";
  wallContentKey = "";
  activeSlot = 0;
}

export function panelStyle() {
  return getComputedStyle(document.documentElement);
}
