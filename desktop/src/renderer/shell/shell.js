/* 外壳入口：装配导航、主页、原生列表、编辑器、覆盖层，并转发键盘快捷键。
   壁纸运动与洛谷页面共用同一个 Date.now 相位公式，保证两侧边缘不错位。 */
import { applyTheme } from "../shared/theme.js";
import { initChrome } from "./chrome.js";
import { renderHome } from "./home.js";
import { initLibrary } from "./library.js";
import { initOverlays } from "./overlays.js";
import { initEditor } from "./editor.js";

const stateBox = { data: null };
let homeSignature = "";

function toast(payload) {
  const host = document.getElementById("toasts");
  if (!host || !payload) return;
  const item = document.createElement("div");
  item.className = "toast";
  const title = document.createElement("div");
  title.className = "toast-title";
  title.textContent = payload.title || "";
  item.appendChild(title);
  if (payload.body) {
    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = payload.body;
    item.appendChild(body);
  }
  host.appendChild(item);
  setTimeout(() => item.remove(), 4200);
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
    }
    library.update(state);
    editor.show(!state.page.home && !!state.page.isProblem && !!state.page.ide);
  }

  /* 壁纸运动：与页面 preload 的公式一致 */
  function tickWallpaper() {
    const state = stateBox.data;
    if (state) {
      const wall = (state.theme && state.theme.wallpaper) || {};
      const style = document.documentElement.style;
      const t = Date.now();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (wall.motion && !reduced) {
        style.setProperty("--lg-pan-x", (Math.sin(t / 11000) * 6).toFixed(2) + "px");
        style.setProperty("--lg-pan-y", (Math.cos(t / 15000) * 4).toFixed(2) + "px");
      } else {
        style.setProperty("--lg-pan-x", "0px");
        style.setProperty("--lg-pan-y", "0px");
      }
      style.setProperty("--lg-zoom", wall.zoom && !reduced ? (1.055 + Math.sin(t / 19000) * 0.012).toFixed(4) : "1");
    }
    requestAnimationFrame(tickWallpaper);
  }
  requestAnimationFrame(tickWallpaper);

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
