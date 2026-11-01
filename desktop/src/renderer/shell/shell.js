/* 外壳入口：装配导航、主页、原生列表、编辑器、覆盖层，并转发键盘快捷键。
   壁纸运动与洛谷页面共用同一个 Date.now 相位公式，保证两侧边缘不错位。 */
import { applyTheme } from "../shared/theme.js";
import { icon } from "./icons.js";
import { initChrome } from "./chrome.js";
import { renderHome, disposeHome } from "./home.js";
import { initLibrary } from "./library.js";
import { initOverlays } from "./overlays.js";
import { fatal } from "../shared/fatal.js";
import { initEditor } from "./editor.js";

const stateBox = { data: null };
let homeSignature = "";
let themeKey = "";

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

  // 超过 3 条时最旧的先淡出再移除，避免整摞 toast 突然跳一下
  const extras = [...host.children].slice(0, Math.max(0, host.children.length - 3));
  for (const old of extras) {
    if (old.classList.contains("removing")) continue;
    old.classList.add("removing");
    setTimeout(() => old.remove(), 180);
  }

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
    (home.contests || []).map((c) => [c.id, c.start, c.live ? 1 : 0].join(":")).join(","),
    home.official
      ? (home.official.countdowns || []).map((cd) => cd.name + ":" + cd.days).join(",") +
        "|" + String(home.official.welcome || "") + "|" + String(home.official.fortune || "")
      : "",
    (home.heat || []).length,
    JSON.stringify(state.features || {}),
    state.online === false ? "off" : "on",
    (state.queue && state.queue.items || []).map((item) => [item.id, item.status, item.tries]).join(","),
  ]);
}

function matchesShortcut(event, accelerator) {
  const parts = String(accelerator || "").split("+");
  const key = String(parts.pop() || "").toLowerCase();
  const has = (name) => parts.some((part) => part.toLowerCase() === name);
  return (
    key === String(event.key || "").toLowerCase() &&
    !!(event.ctrlKey || event.metaKey) === has("ctrl") &&
    !!event.altKey === has("alt") &&
    !!event.shiftKey === has("shift")
  );
}

async function boot() {
  if (!window.lg) {
    fatal("外壳初始化失败", "preload 加载失败，请重启应用。");
    return;
  }

  const editor = initEditor({
    canSubmit: () => !!(stateBox.data && stateBox.data.user && stateBox.data.user.loggedIn),
    submit: (code, lang, o2) =>
      window.lg.submit({
        pid: stateBox.data && stateBox.data.page ? stateBox.data.page.pid : "",
        code,
        lang,
        o2: !!o2,
      }),
    saveDraft: (payload) => window.lg.saveDraft(payload),
    loadDraft: (payload) => window.lg.getDraft(payload),
    setIdeSplit: (ratio) => window.lg.setIdeSplit(ratio),
  });

  const homeActions = {
    refresh: () => window.lg.refreshHome(),
    checkin: () => window.lg.checkin(),
    login: () => window.lg.nav("login"),
    nav: (target) => window.lg.nav(target),
    openProblem: (pid) => window.lg.openProblem(pid),
    openDetail: (payload) => window.lg.openDetail(payload),
    queueAction: (payload) => window.lg.queueAction(payload),
    setGeneral: (patch) => window.lg.setGeneral(patch),
  };

  const library = initLibrary({
    library: (payload) => window.lg.library(payload),
    libraryTags: () => window.lg.libraryTags(),
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
    if (item.type === "page" && item.key) {
      window.lg.switchTo(item.key);
      return;
    }
    if (item.id === "reopen") {
      window.lg.viewAction("reopen");
      return;
    }
    if (
      ["home", "problems", "training", "contest", "record", "discuss", "article", "chat", "notification", "login"].includes(
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
    openProblem: (pid) => window.lg.openProblem(pid),
    randomProblem: (payload) => window.lg.randomProblem(payload),
    searchUsers: (keyword) => window.lg.searchUsers(keyword),
    openUser: (uid) => window.lg.openUser(uid),
    openUrl: (url, title) => window.lg.openDetail({ url, title }),
    run: runItem,
  });

  const chrome = initChrome({
    nav: (target) => window.lg.nav(target),
    profile: () => window.lg.nav("profile"),
    settings: () => window.lg.openSettings(),
    view: (action) => window.lg.viewAction(action),
    problem: (payload) => window.lg.problemAction(payload),
    ide: (on) => window.lg.setIde(on),
    custom: (payload) => window.lg.openCustom(payload),
    openJump: () => overlays.openJump(),
    openUserSearch: () => overlays.openUserSearch(),
    focusPage: () => window.lg.command("focusPage"),
    setRailPinned: (pinned) => window.lg.setRailPinned(pinned),
  });

  function apply(state) {
    if (!state) return;
    stateBox.data = state;
    document.body.classList.toggle("perf", !!(state.general && state.general.performanceMode));
    const nextThemeKey = JSON.stringify(state.theme);
    if (nextThemeKey !== themeKey) {
      themeKey = nextThemeKey;
      applyTheme(state.theme);
    }
    chrome.update(state);
    overlays.setFeatures(state.features);
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
    // 草稿跟题走：换题即切换草稿（编辑器内部去重同题调用）
    if (state.page && state.page.pid) editor.setProblem(state.page.pid);
    syncWallpaper();
  }

  /* 壁纸运动交给合成器动画，不在每帧写 CSS 变量，避免持续样式重算。 */
  let windowFocused = true;
  let scrolling = false;
  let scrollTimer = null;

  function syncWallpaper() {
    const state = stateBox.data;
    if (!state) return;
    const wall = (state.theme && state.theme.wallpaper) || {};
    const perf = !!(state.general && state.general.performanceMode);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paused = perf || reduced || !windowFocused || document.hidden || scrolling;
    document.body.classList.toggle("wall-motion", !!wall.motion);
    document.body.classList.toggle("wall-zoom", !!wall.zoom);
    document.body.classList.toggle("wall-paused", paused);
    const video = document.querySelector("#wallpaper video");
    if (video) {
      if (paused) video.pause();
      else video.play().catch(() => {});
    }
  }

  window.lg.onWindowFocus((focused) => {
    windowFocused = !!focused;
    syncWallpaper();
  });

  document.addEventListener(
    "scroll",
    () => {
      scrolling = true;
      syncWallpaper();
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrolling = false;
        syncWallpaper();
      }, 140);
    },
    true
  );

  document.addEventListener("visibilitychange", () => syncWallpaper());

  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", () => syncWallpaper());
  window.lg.onState(apply);
  window.lg.onRailLayout((payload) => {
    const width = Number(payload && payload.width);
    if (Number.isFinite(width) && width > 0) chrome.setRailWidth(width);
  });
  window.lg.onCommand((name) => {
    if (name === "palette") overlays.openPalette();
    else if (name === "switcher") overlays.openSwitcher();
    else if (name === "jump") overlays.openJump();
    else if (name === "userSearch") overlays.openUserSearch();
    else if (name === "focusRail") chrome.focusRail();
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
      overlays.openJump();
    } else if (ctrl && event.key.toLowerCase() === "b") {
      event.preventDefault();
      const pinned = !!(stateBox.data && stateBox.data.rail && stateBox.data.rail.pinned);
      window.lg.setRailPinned(!pinned);
    } else if (ctrl && event.key.toLowerCase() === "u") {
      event.preventDefault();
      if (!(stateBox.data && stateBox.data.features && stateBox.data.features.userSearch === false)) overlays.openUserSearch();
    } else if (stateBox.data && matchesShortcut(event, stateBox.data.general && stateBox.data.general.shortcutOpenProblems)) {
      event.preventDefault();
      const enabled = !(stateBox.data.features && stateBox.data.features.shortcuts === false);
      if (enabled) window.lg.nav("problems");
    } else if (event.key === "F6") {
      event.preventDefault();
      if (event.shiftKey) window.lg.command("focusPage");
      else chrome.focusRail();
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
  fatal("界面初始化失败", err.message);
});
