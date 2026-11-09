/* 设置窗分区导航：图标映射、选中态与分区切换。 */
import { store } from "./store.js";

export const NAV_ICONS = {
  appearance: "palette",
  wallpaper: "image",
  rail: "sidebar",
  enhance: "star",
  general: "settings",
  notify: "bell",
  account: "user",
  about: "info",
};

export function updateNav() {
  document.querySelectorAll(".snav").forEach((btn) => {
    const on = btn.dataset.sec === store.section;
    btn.classList.toggle("on", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== store.section;
  });
}

export function setSection(next, focus = true) {
  if (!next) return;
  store.section = next;
  updateNav();
  const pane = document.querySelector(".set-pane");
  if (pane) pane.scrollTop = 0;
  if (focus) {
    const head = document.querySelector(`[data-panel="${store.section}"] h2`);
    if (head) head.focus({ preventScroll: true });
  }
}
