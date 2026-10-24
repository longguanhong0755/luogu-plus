/* 设置窗口：改动即时生效（无保存按钮），所有状态以主进程广播为准。 */
import { applyTheme } from "../shared/theme.js";

const api = window.lgSettings;
let current = null;
let section = "appearance";

function $(id) {
  return document.getElementById(id);
}

function apply(state) {
  if (!state) return;
  current = state;
  applyTheme(state.theme);

  document.querySelectorAll(".snav").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.sec === section);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== section;
  });

  const appearance = state.appearance;
  document.querySelectorAll("#mode-seg button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mode === appearance.mode);
  });

  const mat = $("mat");
  if (document.activeElement !== mat) mat.value = appearance.material;
  $("mat-val").textContent = appearance.material;

  document.querySelectorAll(".thumb").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.wall === appearance.wallpaper);
  });

  document.querySelectorAll("#accent-row .sw[data-accent]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.accent === appearance.accent);
  });
  const custom = $("accent-custom");
  if (/^#[0-9a-fA-F]{6}$/.test(appearance.accent)) custom.value = appearance.accent;

  const closeRadio = document.querySelector(`input[name="close"][value="${state.general.closeAction}"]`);
  if (closeRadio) closeRadio.checked = true;
  $("autolaunch").checked = !!state.general.autoLaunch;
  $("notify-judge").checked = !!state.notify.judge;
  $("notify-contest").checked = !!state.notify.contest;

  const name = $("account-name");
  if (state.user && state.user.loggedIn) {
    name.textContent = state.user.name ? `${state.user.name}（已登录）` : "已登录";
  } else {
    name.textContent = "未登录";
  }
  $("btn-logout").disabled = !(state.user && state.user.loggedIn);
}

function bind() {
  document.querySelectorAll(".snav").forEach((btn) => {
    btn.addEventListener("click", () => {
      section = btn.dataset.sec;
      apply(current);
    });
  });

  document.querySelectorAll("#mode-seg button").forEach((btn) => {
    btn.addEventListener("click", () => api.setAppearance({ mode: btn.dataset.mode }));
  });

  const mat = $("mat");
  let timer = null;
  mat.addEventListener("input", () => {
    $("mat-val").textContent = mat.value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => api.setAppearance({ material: Number(mat.value) }), 70);
  });

  document.querySelectorAll(".thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.wall === "custom") api.pickWallpaper();
      else api.setAppearance({ wallpaper: btn.dataset.wall });
    });
  });

  document.querySelectorAll("#accent-row .sw[data-accent]").forEach((btn) => {
    btn.addEventListener("click", () => api.setAppearance({ accent: btn.dataset.accent }));
  });
  $("accent-custom").addEventListener("change", (event) => {
    api.setAppearance({ accent: event.target.value });
  });

  document.querySelectorAll('input[name="close"]').forEach((radio) => {
    radio.addEventListener("change", () => api.setGeneral({ closeAction: radio.value }));
  });
  $("autolaunch").addEventListener("change", (event) => api.setGeneral({ autoLaunch: event.target.checked }));
  $("notify-judge").addEventListener("change", (event) => api.setNotify({ judge: event.target.checked }));
  $("notify-contest").addEventListener("change", (event) => api.setNotify({ contest: event.target.checked }));

  $("btn-login").addEventListener("click", () => api.nav("login"));
  $("btn-logout").addEventListener("click", async () => {
    await api.logout();
  });
}

async function boot() {
  if (!api) {
    document.body.textContent = "preload 加载失败，请重启应用。";
    return;
  }
  bind();
  api.onState(apply);
  apply(await api.getState());
  try {
    $("about-version").textContent = "版本 " + (await api.getVersion());
  } catch {
    $("about-version").textContent = "版本 —";
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = "设置初始化失败：" + err.message;
});
