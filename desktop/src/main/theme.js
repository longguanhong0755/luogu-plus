/* 主题解析：配置 → 具体色板与材质参数。
   渲染层只消费解析后的颜色，不自己判断深浅。
   材质参数的含义（0.7.0 起）：
   - panelAlpha：标题栏/侧栏/工具条的不透明度（材质越高越透）
   - glass：「壁纸透出程度」，70-100 把内容面/纱层/外壳线性压到 0，
     glass=100 时壁纸完整透出；浮层保留 60% 可读下限
   - pageScrim：内容画布与洛谷页面壁纸之上的主题色纱层
   - cardAlpha：卡片/列表/输入框的不透明度
   - blurPx：玻璃模糊半径（主要作用于外壳与浮层） */
const { nativeTheme, systemPreferences } = require("electron");
const materialLevels = require("./material").levels;

const DARK = {
  bg: "#16181d",
  rail: "#15171c",
  title: "#17191e",
  surface: "#1d2027",
  surface2: "#23262f",
  editor: "#17191e",
  border: "rgba(255,255,255,0.10)",
  text: "#f2f3f6",
  text2: "#a8adb8",
  text3: "#8b909c",
  green: "#3fb950",
  red: "#f85149",
  orange: "#d29922",
  accent: "#5b8cff",
};

const LIGHT = {
  bg: "#f5f6f8",
  rail: "#eef0f4",
  title: "#f1f3f6",
  surface: "#ffffff",
  surface2: "#f3f5f8",
  editor: "#ffffff",
  border: "rgba(22,24,31,0.12)",
  text: "#1b1f26",
  text2: "#59606b",
  text3: "#6b7280",
  green: "#1a7f37",
  red: "#cf222e",
  orange: "#9a6700",
  accent: "#3360e0",
};

function clamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function mixHex(a, b, ratio) {
  const pa = String(a || "").replace("#", "");
  const pb = String(b || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(pa) || !/^[0-9a-fA-F]{6}$/.test(pb)) return a;
  const out = [0, 2, 4].map((i) => {
    const va = parseInt(pa.slice(i, i + 2), 16);
    const vb = parseInt(pb.slice(i, i + 2), 16);
    return Math.round(va * ratio + vb * (1 - ratio))
      .toString(16)
      .padStart(2, "0");
  });
  return "#" + out.join("");
}

function luminance(hex) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0;
  const channel = (i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hexToRgba(hex, alpha) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(91,140,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* 自定义强调色可能很浅（例如黄色）。文字用色必须在 bg 与 surface 上都 >= 4.5:1，
   所以逐步向黑/白混合，而不是直接把原色当文字色。 */
function readableAccent(accent, isDark, surfaces) {
  const target = isDark ? "#ffffff" : "#101218";
  let out = accent;
  for (let step = 1; step <= 20; step++) {
    if (surfaces.every((bg) => contrast(out, bg) >= 4.5)) return out;
    out = mixHex(accent, target, 1 - step / 20);
  }
  return target;
}

function resolveMode(cfg) {
  const mode = cfg.appearance.mode;
  if (mode === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return mode === "light" ? "light" : "dark";
}

function resolveAccent(cfg, isDark) {
  const value = cfg.appearance.accent;
  if (value === "system") {
    try {
      const hex = systemPreferences.getAccentColor();
      if (/^[0-9a-fA-F]{8}$/.test(hex)) return "#" + hex.slice(0, 6);
    } catch {
      /* fall through */
    }
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return isDark ? DARK.accent : LIGHT.accent;
}

function payload(cfg) {
  const mode = resolveMode(cfg);
  const isDark = mode === "dark";
  const colors = Object.assign({}, isDark ? DARK : LIGHT);
  colors.accent = resolveAccent(cfg, isDark);
  colors.accentSoft = hexToRgba(colors.accent, isDark ? 0.14 : 0.1);
  colors.accentLine = hexToRgba(colors.accent, isDark ? 0.65 : 0.55);
  colors.accentFill = isDark ? mixHex(colors.accent, "#101218", 0.78) : colors.accent;
  colors.onAccent = contrast("#ffffff", colors.accentFill) >= 4.5 ? "#ffffff" : "#101218";
  colors.accentText = readableAccent(colors.accent, isDark, [colors.bg, colors.surface]);
  colors.borderStrong = isDark ? "rgba(255,255,255,0.18)" : "rgba(22,24,31,0.22)";
  colors.divider = isDark ? "rgba(255,255,255,0.07)" : "rgba(22,24,31,0.08)";
  colors.hover = isDark ? "rgba(255,255,255,0.06)" : "rgba(22,24,31,0.05)";
  colors.pressed = isDark ? "rgba(255,255,255,0.10)" : "rgba(22,24,31,0.09)";
  colors.shadow = isDark ? "rgba(0,0,0,0.45)" : "rgba(16,24,40,0.14)";
  colors.highlight = isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)";

  const material = clamp(cfg.appearance.material, 0, 100, 55);
  const glass = clamp(cfg.appearance.glass, 0, 100, 45);
  const perf = !!(cfg.general && cfg.general.performanceMode);
  // 0.7.0：70-100 的尾部区间把内容面/纱层/外壳压到 0，glass=100 真正全透；
  // 浮层保留 60% 可读下限。数值在 material.js，静态检查可直接断言。
  const level = materialLevels({ material, glass }, perf);
  const panelAlpha = level.panelAlpha;
  const pageScrim = level.pageScrim;
  const cardAlpha = level.cardAlpha;
  const overlayAlpha = level.overlayAlpha;
  const blurPx = level.blurPx;
  return {
    mode,
    isDark,
    colors,
    material,
    glass,
    panelAlpha,
    panelPct: panelAlpha,
    pageScrim,
    cardAlpha,
    overlayAlpha,
    blurPx,
    performanceMode: perf,
  };
}

module.exports = {
  payload,
  resolveMode,
  resolveAccent,
  readableAccent,
  hexToRgba,
  mixHex,
  contrast,
  DARK,
  LIGHT,
};
