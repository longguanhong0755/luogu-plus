/* 主题解析：配置 → 具体色板。渲染层只消费解析后的颜色，不自己判断深浅。 */
const { nativeTheme, systemPreferences } = require("electron");

const DARK = {
  bg: "#1e1e22",
  rail: "#17171a",
  title: "#19191d",
  surface: "#26262c",
  surface2: "#2b2b32",
  editor: "#1a1a1e",
  border: "rgba(255,255,255,0.08)",
  text: "#ececf0",
  text2: "#9a9aa4",
  text3: "#6e6e78",
  green: "#3ecf8e",
  red: "#f0616d",
  orange: "#f2a33c",
  accent: "#5b8cff",
};

const LIGHT = {
  bg: "#f5f6f8",
  rail: "#ececf0",
  title: "#f0f0f3",
  surface: "#ffffff",
  surface2: "#f7f8fa",
  editor: "#ffffff",
  border: "rgba(0,0,0,0.08)",
  text: "#1d1d22",
  text2: "#63636e",
  text3: "#9a9aa5",
  green: "#1fa971",
  red: "#d94855",
  orange: "#c9821f",
  accent: "#3d6cf0",
};

function clamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
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
  colors.accentSoft = hexToRgba(colors.accent, isDark ? 0.16 : 0.12);
  const material = clamp(cfg.appearance.material, 0, 100, 55);
  return {
    mode,
    isDark,
    colors,
    material,
    // 材质滑杆 → 面板不透明度与模糊半径（0 = 全实心）
    panelPct: Math.round(100 - material * 0.55),
    blurPx: Math.round(material * 0.18 * 10) / 10,
  };
}

module.exports = { payload, resolveMode, resolveAccent, DARK, LIGHT };
