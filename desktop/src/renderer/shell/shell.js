/* 外壳入口：装配导航、主页、原生列表、编辑器、覆盖层，并转发键盘快捷键。
   壁纸运动与洛谷页面共用同一个 Date.now 相位公式，保证两侧边缘不错位。 */
import { applyTheme } from "../shared/theme.js";
import { icon } from "./icons.js";
import { initChrome } from "./chrome.js";
import { renderHome, disposeHome } from "./home.js";
import { initLibrary } from "./library.js";
import { initOverlays } from "./overlays.js";
import { initEditor } from "./editor.js";

const stateBox = { data: null };
let homeSignature = "";

const TOAST_ICONS = {
  success: "checkCircle",
  error: "xCircle",
  warning: "alert",
  info: "info",
};

function toast(payload) {
  const host = document.getElementById("toasts");
  if (!host || !payload) return;
  const kind = TOAST_ICONS[payload.kind] ? payload.kind : "info";
  const item = document.createElement("div");
  item.className = "toast " + kind;
  item.setAttribute("role", kind === "error" ? "alert" : "status");

  const glyph = document.createElement("span");
  glyph.className = "toast-icon";
  glyph.innerHTML = icon(TOAST_ICONS[kind]);
  item.appendChild(glyph);

  const wrap = document.createElement("div");
  wrap.className = "toast-body-wrap";
  const title = document.createElement("div");
  title.className = "toast-title";
  title.textContent = payload.title || "";
  wrap.appendChild(title);
  if (payload.body) {
    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = payload.body;
    wrap.appendChild(body);
  }
  item.appendChild(wrap);
  host.appendChild(item);

  while (host.children.length > 3) host.firstElementChild.remove();

  let timer = setTimeout(dismiss, kind === "error" ? 8000 : 5000);
  function dismiss() {
    clearTimeout(timer);
    item.classList.add("removing");
    setTimeout(() => item.remove(), 180);
  }
  item.addEventListener("mouseenter", () => clearTimeout(timer));
  item.addEventListener("mouseleave", () => {
    timer = setTimeout(dismiss, 1800);
  });
  item.addEventListener("click", dismiss);
}

function homeKey(state) {
  const home = state.home || {};
  const user = state.user || {};
  return JSON.stringify([
    user.loggedIn,
    user.uid,
    user.name,
    home.punched,
    home.streak,
    home.quote,
    home.updatedAt,
    home.error,
    (home.recent || []).map((item) => [item.pid, item.status, item.time]).join(","),
    home.contest ? [home.contest.id, home.contest.start, home.contest.live].join("|") : "",
    (home.heat || []).length,
    state.online === false ? "off" : "on",
    (state.queue && state.queue.items || []).map((item) => [item.id, item.status, item.tries]).join(","),
  ]);
}

async function boot() {
  if (!window.lg) {
    document.body.textContent = "preload 加载失败，请重启应用。";
    return;
  }

  const editor = initEditor({
    canSubmit: () => !!(stateBox.data && stateBox.data.user && stateBox.data.user.loggedIn),
    submit: (code, lang) =>
      window.lg.submit({
        pid: stateBox.data && stateBox.data.page ? stateBox.data.page.pid : "",
        code,
        lang,
      }),
    saveDraft: (payload) => window.lg.saveDraft(payload),
    loadDraft: () => window.lg.getDraft(),
    setIdeSplit: (ratio) => window.lg.setIdeSplit(ratio),
  });

  const homeActions = {
    refresh: () => window.lg.refreshHome(),
    checkin: () => window.lg.checkin(),
    login: () => window.lg.nav("login"),
    nav: (target) => window.lg.nav(target),
    openProblem: (pid) => window.lg.openProblem(pid),
    queueAction: (payload) => window.lg.queueAction(payload),
  };

  const library = initLibrary({
    library: (payload) => window.lg.library(payload),
    openProblem: (pid) => window.lg.openProblem(pid),
    openDetail: (payload) => window.lg.openDetail(payload),
    webFallback: (kind) => window.lg.openWebFallback(kind),
    login: () => window.lg.nav("login"),
    toast,
  });

  function runItem(item) {
    if (!item) return;
    if (item.type === "problem") {
      window.lg.openProblem(item.pid);
      return;
    }
    if (
      ["home", "problems", "class", "training", "contest", "record", "discuss", "article", "chat", "notification", "login"].includes(
        item.id
      )
    ) {
      window.lg.nav(item.id);
      return;
    }
    if (item.id === "checkin") {
      window.lg.checkin();
      return;
    }
    if (item.id === "settings") window.lg.openSettings();
  }

  const overlays = initOverlays({
    overlay: (open) => window.lg.overlay(open),
    palette: (query) => window.lg.palette(query),
    listPages: () => window.lg.switcher(),
    switchTo: (key) => window.lg.switchTo(key),
    run: runItem,
  });

  const chrome = initChrome({
    nav: (target) => window.lg.nav(target),
    profile: () => window.lg.nav("profile"),
    settings: () => window.lg.openSettings(),
    view: (action) => window.lg.viewAction(action),
    problem: (payload) => window.lg.problemAction(payload),
    ide: (on) => window.lg.setIde(on),
    custom: (url, label) => window.lg.openCustom({ url, label }),
    openProblem: (pid) => window.lg.openProblem(pid),
  });

  function apply(state) {
    if (!state) return;
    stateBox.data = state;
    applyTheme(state.theme);
    chrome.update(state);
    if (state.page.home) {
      const key = homeKey(state);
      if (key !== homeSignature) {
        homeSignature = key;
        renderHome(state, homeActions);
      }
    } else {
      disposeHome();
    }
    library.update(state);
    editor.show(!state.page.home && !!state.page.isProblem && !!state.page.ide);
    syncWallpaper();
  }

  /* 壁纸运动：与页面 preload 的公式一致；关闭运动时停止 rAF。 */
  let wallRaf = 0;
  function stopWallpaper() {
    if (wallRaf) cancelAnimationFrame(wallRaf);
    wallRaf = 0;
    const style = document.documentElement.style;
    style.setProperty("--lg-pan-x", "0px");
    style.setProperty("--lg-pan-y", "0px");
    style.setProperty("--lg-zoom", "1");
  }

  function tickWallpaper() {
    wallRaf = 0;
    const state = stateBox.data;
    if (!state) return;
    const wall = (state.theme && state.theme.wallpaper) || {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if ((!wall.motion && !wall.zoom) || reduced) {
      stopWallpaper();
      return;
    }
    const style = document.documentElement.style;
    const t = Date.now();
    if (wall.motion) {
      style.setProperty("--lg-pan-x", (Math.sin(t / 11000) * 6).toFixed(2) + "px");
      style.setProperty("--lg-pan-y", (Math.cos(t / 15000) * 4).toFixed(2) + "px");
    } else {
      style.setProperty("--lg-pan-x", "0px");
      style.setProperty("--lg-pan-y", "0px");
    }
    style.setProperty("--lg-zoom", wall.zoom ? (1.055 + Math.sin(t / 19000) * 0.012).toFixed(4) : "1");
    wallRaf = requestAnimationFrame(tickWallpaper);
  }

  function syncWallpaper() {
    const state = stateBox.data;
    if (!state) return;
    const wall = (state.theme && state.theme.wallpaper) || {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && (wall.motion || wall.zoom)) {
      if (!wallRaf) wallRaf = requestAnimationFrame(tickWallpaper);
    } else {
      stopWallpaper();
    }
  }

  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", () => syncWallpaper());

  window.lg.onState(apply);
  window.lg.onCommand((name) => {
    if (name === "palette") overlays.openPalette();
    else if (name === "switcher") overlays.openSwitcher();
    else if (name === "jump") {
      const input = document.getElementById("rail-jump-input");
      if (input) {
        input.focus();
        input.select();
      }
    }
  });
  window.lg.onToast(toast);

  window.addEventListener("keydown", (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === "k") {
      event.preventDefault();
      overlays.openPalette();
    } else if (ctrl && event.key === "Tab") {
      event.preventDefault();
      overlays.openSwitcher();
    } else if (ctrl && (event.key === "," || event.key === "，")) {
      event.preventDefault();
      window.lg.openSettings();
    } else if (ctrl && event.key.toLowerCase() === "l") {
      event.preventDefault();
      const input = document.getElementById("rail-jump-input");
      if (input) {
        input.focus();
        input.select();
      }
    } else if (event.key === "F11") {
      event.preventDefault();
      window.lg.command("fullscreen");
    } else if (event.key === "F12") {
      event.preventDefault();
      window.lg.command("devtools");
    }
  });

  window.addEventListener("focus", () => {
    const state = stateBox.data;
    if (state && state.page.home && state.user && state.user.loggedIn) {
      window.lg.refreshHome();
    }
  });

  apply(await window.lg.getState());
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = "界面初始化失败：" + err.message;
});
