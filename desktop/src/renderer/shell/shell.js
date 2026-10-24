/* 外壳入口：装配导航、主页、编辑器、覆盖层，并转发键盘快捷键。 */
import { applyTheme } from "../shared/theme.js";
import { initChrome } from "./chrome.js";
import { renderHome } from "./home.js";
import { initOverlays } from "./overlays.js";
import { initEditor } from "./editor.js";

const stateBox = { data: null };

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
  });

  const homeActions = {
    refresh: () => window.lg.refreshHome(),
    checkin: () => window.lg.checkin(),
    login: () => window.lg.nav("login"),
    nav: (target) => window.lg.nav(target),
    openProblem: (pid) => window.lg.openProblem(pid),
  };

  function runItem(item) {
    if (!item) return;
    if (item.type === "problem") {
      window.lg.openProblem(item.pid);
      return;
    }
    if (["home", "problems", "training", "contest", "discuss", "record", "login"].includes(item.id)) {
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
  });

  function apply(state) {
    if (!state) return;
    stateBox.data = state;
    applyTheme(state.theme);
    chrome.update(state);
    renderHome(state, homeActions);
    editor.show(!state.page.home && state.page.isProblem && state.page.ide);
  }

  window.lg.onState(apply);
  window.lg.onCommand((name) => {
    if (name === "palette") overlays.openPalette();
    else if (name === "switcher") overlays.openSwitcher();
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
