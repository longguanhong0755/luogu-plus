/* 主题解析：配置 → 具体色板与材质参数。
   渲染层只消费解析后的颜色，不自己判断深浅。
   材质参数的含义：
   - panelAlpha：标题栏/侧栏/工具条的不透明度（材质越高越透）
   - pageScrim：洛谷页面里壁纸之上的主题色纱层
   - cardAlpha：页面卡片/列表/输入框的不透明度
   - blurPx：玻璃模糊半径 */
const { nativeTheme, systemPreferences } = require("electron");

const DARK = {
  bg: "#1b1c20",
  rail: "#17181c",
  title: "#191a1e",
  surface: "#25262c",
  surface2: "#2b2c33",
  editor: "#18191d",
  border: "rgba(255,255,255,0.09)",
  text: "#ededf2",
  text2: "#a7a8b3",
  text3: "#8b8c98",
  green: "#46d39a",
  red: "#f4707b",
  orange: "#f2ad4a",
  accent: "#5b8cff",
};

const LIGHT = {
  bg: "#f2f3f6",
  rail: "#e9eaef",
  title: "#eef0f4",
  surface: "#ffffff",
  surface2: "#f6f7f9",
  editor: "#ffffff",
  border: "rgba(22,24,31,0.10)",
  text: "#1b1c21",
  text2: "#5c5f69",
  text3: "#6b6e78",
  green: "#0f7a51",
  red: "#a52f3b",
  orange: "#8f5a0f",
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
  colors.accentSoft = hexToRgba(colors.accent, isDark ? 0.18 : 0.12);
  colors.accentLine = hexToRgba(colors.accent, isDark ? 0.42 : 0.34);
  colors.accentFill = isDark ? mixHex(colors.accent, "#101218", 0.78) : colors.accent;
  colors.onAccent = contrast("#ffffff", colors.accentFill) >= 4.5 ? "#ffffff" : "#101218";
  const material = clamp(cfg.appearance.material, 0, 100, 55);
  const panelAlpha = Math.round(92 - material * 0.35);
  const pageScrim = Math.round(96 - material * 0.5);
  const cardAlpha = Math.round(98 - material * 0.38);
  const overlayAlpha = Math.min(97, panelAlpha + 9);
  const blurPx = Math.round((2 + material * 0.16) * 10) / 10;
  return {
    mode,
    isDark,
    colors,
    material,
    panelAlpha,
    panelPct: panelAlpha,
    pageScrim,
    cardAlpha,
    overlayAlpha,
    blurPx,
  };
}

module.exports = { payload, resolveMode, resolveAccent, hexToRgba, mixHex, contrast, DARK, LIGHT };
