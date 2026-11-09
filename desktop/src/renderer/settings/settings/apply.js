/* 设置状态快照 → 各分区渲染的调度入口（主进程每次广播都会调用）。 */
import { applyTheme } from "../../shared/theme.js";
import { store } from "./store.js";
import { updateNav } from "./nav.js";
import { applyFeatures } from "./features.js";
import { applyAppearance, syncWallpaperMotion } from "./appearance.js";
import { applyWallpaper, scanWe } from "./wallpaper.js";
import { applyGeneral, applyAccount } from "./general.js";
import { renderRail } from "./rail.js";

export function apply(state) {
  if (!state) return;
  store.current = state;
  applyTheme(state.theme);
  updateNav();
  applyAppearance(state);
  applyWallpaper(state);
  renderRail(state);
  applyFeatures(state);
  applyGeneral(state);
  syncWallpaperMotion(state);
  applyAccount(state);

  if (store.section === "wallpaper" && state.appearance.weRoot && !store.weItems.length && !store.weScanning) {
    scanWe();
  }
}
