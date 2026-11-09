/* 外观分区：模式/材质/透出/强调色回填，以及壁纸动效开关。 */
import { $ } from "./utils.js";

export function applyAppearance(state) {
  const appearance = state.appearance;
  document.querySelectorAll("#mode-seg button").forEach((btn) => {
    const on = btn.dataset.mode === appearance.mode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const mat = $("mat");
  if (document.activeElement !== mat) mat.value = appearance.material;
  $("mat-val").textContent = appearance.material;
  const pct = ((Number(mat.value) - Number(mat.min || 0)) / (Number(mat.max || 100) - Number(mat.min || 0))) * 100;
  mat.style.setProperty("--fill", pct + "%");

  const glass = $("glass");
  if (document.activeElement !== glass) glass.value = appearance.glass;
  $("glass-val").textContent = appearance.glass;
  const glassPct = ((Number(glass.value) - Number(glass.min || 0)) / (Number(glass.max || 100) - Number(glass.min || 0))) * 100;
  glass.style.setProperty("--fill", glassPct + "%");

  document.querySelectorAll("#accent-row .sw[data-accent]").forEach((btn) => {
    const on = btn.dataset.accent === appearance.accent;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const custom = $("accent-custom");
  const customActive = /^#[0-9a-fA-F]{6}$/.test(appearance.accent);
  if (customActive && document.activeElement !== custom) custom.value = appearance.accent;
  custom.classList.toggle("on", customActive);
  const value = $("accent-value");
  if (value) value.textContent = customActive ? appearance.accent.toUpperCase() : appearance.accent === "system" ? "跟随系统" : "洛谷蓝";
}

export function syncWallpaperMotion(state) {
  const wallpaper = (state.theme && state.theme.wallpaper) || {};
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paused = !!(state.general && state.general.performanceMode) || reduced;
  document.body.classList.toggle("wall-motion", !!wallpaper.motion && !paused);
  document.body.classList.toggle("wall-zoom", !!wallpaper.zoom && !paused);
  document.body.classList.toggle("wall-paused", paused);
  const video = document.querySelector("#wallpaper video");
  if (video) {
    if (paused) video.pause();
    else video.play().catch(() => {});
  }
}
