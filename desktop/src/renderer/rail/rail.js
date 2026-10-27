/* 悬停展开的侧栏浮层渲染：与外壳共用同一份 rail 配置与主题变量。
   浮层只负责导航和固定；真正的页面 view 宽度仍按折叠态排版。 */
import { applyThemeVars } from "../shared/theme.js";
import { icon } from "../shell/icons.js";

const $ = (id) => document.getElementById(id);
const railTop = $("rail-top");
const railBottom = $("rail-bottom");
const pin = $("rail-pin");
const jumpForm = $("rail-jump");
const jumpInput = $("rail-jump-input");
const railUser = $("rail-user");
const wall = $("wallpaper");
const layer = wall ? wall.querySelector(".wall-layer") : null;

let state = null;
let railSignature = "";
let wallKey = "";
let wallRaf = 0;
let wallLast = 0;

function navButton(item) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rail-btn";
  btn.title = item.label;
  btn.setAttribute("aria-label", item.label);
  btn.dataset.id = item.id;
  btn.innerHTML = icon(item.icon) || icon("dot");
  const label = document.createElement("span");
  label.className = "rail-label";
  label.textContent = item.label;
  btn.appendChild(label);
  btn.addEventListener("click", () => {
    window.lgRail.railHover({ open: false, force: true });
    if (item.kind === "custom") window.lgRail.openCustom({ url: item.url, label: item.label });
    else if (item.kind === "action") window.lgRail.openSettings();
    else window.lgRail.nav(item.id);
  });
  return btn;
}

function renderRail() {
  if (!state || !state.rail) return;
  const signature = JSON.stringify([state.rail.top, state.rail.bottom]);
  if (signature === railSignature) return;
  railSignature = signature;
  railTop.textContent = "";
  railBottom.textContent = "";
  appendRailItems(railTop, state.rail.top);
  appendRailItems(railBottom, state.rail.bottom);
}

function appendRailItems(container, items) {
  let lastGroup = "";
  for (const item of items) {
    if (item.group && item.group !== lastGroup) {
      const group = document.createElement("div");
      group.className = "rail-group";
      group.dataset.group = item.group;
      const label = document.createElement("span");
      label.className = "rail-group-label";
      label.textContent = item.groupLabel || "";
      group.appendChild(label);
      container.appendChild(group);
      lastGroup = item.group;
    }
    container.appendChild(navButton(item));
  }
}

function renderRailUser() {
  if (!railUser || !state) return;
  const user = state.user || {};
  const logged = !!user.loggedIn;
  const name = logged ? String(user.name || "我的洛谷") : "未登录";
  const sub = logged ? "个人主页" : "点击登录";
  railUser.classList.toggle("guest", !logged);
  railUser.title = name + " · " + sub;
  railUser.setAttribute("aria-label", name + "，" + sub);
  const nameEl = railUser.querySelector(".rail-user-name");
  const subEl = railUser.querySelector(".rail-user-sub");
  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = sub;
  const box = railUser.querySelector(".rail-user-avatar");
  if (!box) return;
  const url = logged && user.avatar ? String(user.avatar) : "";
  if (url) {
    if (box.dataset.url !== url) {
      box.dataset.url = url;
      box.textContent = "";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      box.appendChild(img);
    }
  } else {
    box.dataset.url = "";
    box.textContent = "洛";
  }
}

function syncPin() {
  const pinned = !!(state && state.rail && state.rail.pinned);
  pin.classList.toggle("on", pinned);
  pin.setAttribute("aria-pressed", pinned ? "true" : "false");
  pin.innerHTML = icon(pinned ? "pin" : "pinOff");
  pin.title = pinned ? "取消固定（回到折叠，悬停自动展开）" : "固定侧栏（常驻展开）";
  pin.setAttribute("aria-label", pin.title);
}

function applyWallpaper() {
  if (!state) return;
  const w = state.theme && state.theme.wallpaper ? state.theme.wallpaper : {};
  const key = [w.kind, w.url, w.video, w.poster, w.backdrop, state.theme.isDark].join("|");
  document.documentElement.style.setProperty("--wall-w", (state.window ? state.window.width : 1280) + "px");
  document.documentElement.style.setProperty("--wall-h", (state.window ? state.window.height : 820) + "px");
  if (key === wallKey) return;
  wallKey = key;
  if (layer) {
    layer.style.backgroundImage = w.backdrop || "";
    layer.classList.toggle("builtin", w.kind === "builtin");
  }
}

function stopWall(reset) {
  if (wallRaf) cancelAnimationFrame(wallRaf);
  wallRaf = 0;
  if (!reset) return;
  const style = document.documentElement.style;
  style.setProperty("--lg-pan-x", "0px");
  style.setProperty("--lg-pan-y", "0px");
  style.setProperty("--lg-zoom", "1");
}

function tickWall(now) {
  wallRaf = 0;
  const w = state && state.theme && state.theme.wallpaper ? state.theme.wallpaper : {};
  const perf = !!(state && state.general && state.general.performanceMode);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (perf || reduced || document.hidden || (!w.motion && !w.zoom)) {
    stopWall(perf || reduced || (!w.motion && !w.zoom));
    return;
  }
  if (now && wallLast && now - wallLast < 33) {
    wallRaf = requestAnimationFrame(tickWall);
    return;
  }
  wallLast = now || 0;
  const style = document.documentElement.style;
  const t = Date.now();
  if (w.motion) {
    style.setProperty("--lg-pan-x", (Math.sin(t / 11000) * 6).toFixed(2) + "px");
    style.setProperty("--lg-pan-y", (Math.cos(t / 15000) * 4).toFixed(2) + "px");
  } else {
    style.setProperty("--lg-pan-x", "0px");
    style.setProperty("--lg-pan-y", "0px");
  }
  style.setProperty("--lg-zoom", w.zoom ? (1.055 + Math.sin(t / 19000) * 0.012).toFixed(4) : "1");
  wallRaf = requestAnimationFrame(tickWall);
}

function syncWall() {
  if (!state) return;
  const w = state.theme && state.theme.wallpaper ? state.theme.wallpaper : {};
  const perf = !!(state.general && state.general.performanceMode);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (perf || reduced || document.hidden || (!w.motion && !w.zoom)) {
    stopWall(perf || reduced || (!w.motion && !w.zoom));
    return;
  }
  if (!wallRaf) {
    wallLast = 0;
    wallRaf = requestAnimationFrame(tickWall);
  }
}

function apply(next) {
  if (!next) return;
  state = next;
  applyThemeVars(next.theme);
  applyWallpaper();
  renderRail();
  renderRailUser();
  syncPin();
  syncWall();
}

jumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = jumpInput.value.trim();
  const match = raw.match(/^([A-Za-z]{1,4}\d+[A-Za-z0-9]*)$/);
  if (!match) {
    jumpForm.classList.add("bad");
    setTimeout(() => jumpForm.classList.remove("bad"), 900);
    jumpInput.select();
    return;
  }
  jumpInput.value = "";
  jumpInput.blur();
  window.lgRail.railHover({ open: false, force: true });
  window.lgRail.openProblem(match[1].toUpperCase());
});

pin.addEventListener("click", () => {
  const next = !(state && state.rail && state.rail.pinned);
  syncPin();
  window.lgRail.setRailPinned(next);
});

if (railUser) {
  railUser.addEventListener("click", () => {
    const logged = !!(state && state.user && state.user.loggedIn);
    window.lgRail.railHover({ open: false, force: true });
    window.lgRail.nav(logged ? "profile" : "login");
  });
}

document.documentElement.addEventListener("mouseenter", () => window.lgRail.railHover(true));
document.documentElement.addEventListener("mouseleave", () => window.lgRail.railHover(false));
document.addEventListener("visibilitychange", syncWall);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.lgRail.railHover({ open: false, force: true });
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    const next = !(state && state.rail && state.rail.pinned);
    syncPin();
    window.lgRail.setRailPinned(next);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    jumpInput.focus();
    jumpInput.select();
  }
});

window.lgRail.onState(apply);
window.lgRail.onFocus((kind) => {
  if (kind === "jump") {
    jumpInput.focus();
    jumpInput.select();
  }
});

window.lgRail
  .getState()
  .then((s) => {
    apply(s);
    // 浮层是在鼠标已经进入侧栏时出现的：主动续上悬停状态，避免交接空档被收起
    window.lgRail.railHover(true);
  })
  .catch(() => {
    /* 主进程还没准备好时由 onState 补 */
  });
