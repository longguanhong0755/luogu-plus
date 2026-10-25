/* 设置窗口：改动即时生效（无保存按钮），所有状态以主进程广播为准。 */
import { applyTheme } from "../shared/theme.js";

const api = window.lgSettings;
let current = null;
let section = "appearance";
let weItems = [];
let weScanning = false;
let railSignature = "";
let weSignature = "";

function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

  applyAppearance(state);
  applyWallpaper(state);
  renderRail(state);
  applyGeneral(state);
  applyAccount(state);

  if (section === "wallpaper" && state.appearance.weRoot && !weItems.length && !weScanning) {
    scanWe();
  }
}

function applyAppearance(state) {
  const appearance = state.appearance;
  document.querySelectorAll("#mode-seg button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.mode === appearance.mode);
  });
  const mat = $("mat");
  if (document.activeElement !== mat) mat.value = appearance.material;
  $("mat-val").textContent = appearance.material;

  document.querySelectorAll("#accent-row .sw[data-accent]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.accent === appearance.accent);
  });
  const custom = $("accent-custom");
  if (/^#[0-9a-fA-F]{6}$/.test(appearance.accent)) custom.value = appearance.accent;
}

function applyWallpaper(state) {
  const a = state.appearance;
  const wall = (state.theme && state.theme.wallpaper) || {};
  document.querySelectorAll("#wp-sources .src").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.wall === a.wallpaper);
  });

  const img = $("wp-preview-img");
  img.textContent = "";
  img.style.backgroundImage = "";
  if (wall.video && wall.url) {
    const video = document.createElement("video");
    video.src = wall.url;
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    if (wall.poster) video.poster = wall.poster;
    img.appendChild(video);
  } else if (wall.url) {
    img.style.backgroundImage = `url("${String(wall.url).replace(/"/g, '\\"')}")`;
  } else {
    const accent = (state.theme.colors && state.theme.colors.accent) || "#5b8cff";
    img.style.backgroundImage =
      `radial-gradient(120% 90% at 76% 6%, color-mix(in srgb, ${accent} 24%, transparent), transparent 58%),` +
      `linear-gradient(160deg, color-mix(in srgb, ${accent} 9%, ${state.theme.colors.bg}), ${state.theme.colors.bg} 72%)`;
  }
  $("wp-preview-label").textContent = wall.label || "—";
  const kinds = {
    desktop: "跟随桌面",
    builtin: "内置渐变",
    daily: "每日一图",
    custom: "单张",
    folder: "文件夹轮换",
    we: "Wallpaper Engine",
  };
  $("wp-preview-kind").textContent = (kinds[a.wallpaper] || "") + (wall.count > 1 ? ` · ${wall.count} 张` : "");

  $("wp-interval").value = String(a.wallpaperInterval);
  $("wp-shuffle").checked = !!a.wallpaperShuffle;
  $("wp-motion").checked = !!a.wallpaperMotion;
  $("wp-zoom").checked = !!a.wallpaperZoom;
  $("wp-fade").checked = !!a.wallpaperFade;
  $("wp-dir-label").textContent = a.wallpaperDir ? "文件夹：" + a.wallpaperDir : "未选择壁纸文件夹";
  $("wp-we-label").textContent = a.weRoot ? "目录：" + a.weRoot : "未选择目录（可选 Steam 库根目录）";
  $("wp-folder-opts").hidden = !["folder", "we"].includes(a.wallpaper);

  if (a.weRoot && section === "wallpaper" && !weItems.length && !weScanning) scanWe();
  renderWe(state);
}

function applyGeneral(state) {
  const closeRadio = document.querySelector(`input[name="close"][value="${state.general.closeAction}"]`);
  if (closeRadio) closeRadio.checked = true;
  $("autolaunch").checked = !!state.general.autoLaunch;
  $("notify-judge").checked = !!state.notify.judge;
  $("notify-contest").checked = !!state.notify.contest;
}

function applyAccount(state) {
  const name = $("account-name");
  if (state.user && state.user.loggedIn) {
    name.textContent = state.user.name ? `${state.user.name}（已登录）` : "已登录";
  } else {
    name.textContent = "未登录";
  }
  $("btn-logout").disabled = !(state.user && state.user.loggedIn);
}

/* ---------- 侧边栏 ---------- */

function renderRail(state) {
  const rail = state.rail;
  const signature = JSON.stringify([rail.order, rail.hidden, rail.custom]);
  if (signature === railSignature) return;
  railSignature = signature;

  const labels = new Map((rail.all || []).map((item) => [item.id, item]));
  const hidden = new Set(rail.hidden);
  const list = $("rail-list");
  list.textContent = "";

  rail.order.forEach((id, index) => {
    const meta = labels.get(id) || { label: id };
    const row = el("div", "rail-row" + (hidden.has(id) ? " off" : ""));
    row.appendChild(el("span", "rail-name", meta.label));
    const spacer = el("span", "rail-spacer-mini");
    row.appendChild(spacer);

    const up = el("button", "rail-mini", "↑");
    up.type = "button";
    up.title = "上移";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      const order = rail.order.slice();
      [order[index - 1], order[index]] = [order[index], order[index - 1]];
      api.setRail({ order });
    });
    const down = el("button", "rail-mini", "↓");
    down.type = "button";
    down.title = "下移";
    down.disabled = index === rail.order.length - 1;
    down.addEventListener("click", () => {
      const order = rail.order.slice();
      [order[index + 1], order[index]] = [order[index], order[index + 1]];
      api.setRail({ order });
    });
    const toggle = el("button", "rail-eye" + (hidden.has(id) ? " off" : ""), hidden.has(id) ? "显示" : "隐藏");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      api.setRail({ hidden: [...next] });
    });
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(toggle);
    list.appendChild(row);
  });

  const customBox = $("rail-custom");
  customBox.textContent = "";
  if (!rail.custom.length) {
    customBox.appendChild(el("div", "hint-line", "还没有自定义链接。"));
  }
  for (const item of rail.custom) {
    const row = el("div", "rail-row");
    row.appendChild(el("span", "rail-name", item.label));
    row.appendChild(el("span", "rail-kind url", item.url));
    const spacer = el("span", "rail-spacer-mini");
    row.appendChild(spacer);
    const del = el("button", "rail-mini wide", "删除");
    del.type = "button";
    del.addEventListener("click", () => {
      api.setRail({ custom: rail.custom.filter((entry) => entry.id !== item.id) });
    });
    row.appendChild(del);
    customBox.appendChild(row);
  }
}

/* ---------- Wallpaper Engine ---------- */

async function scanWe() {
  if (!current || !current.appearance.weRoot || weScanning) return;
  weScanning = true;
  const list = $("wp-we-list");
  list.textContent = "";
  list.appendChild(el("div", "hint-line", "正在扫描…"));
  try {
    const res = await api.scanWe(current.appearance.weRoot);
    weItems = (res && res.items) || [];
  } catch {
    weItems = [];
  }
  weScanning = false;
  renderWe(current);
}

function renderWe(state) {
  const list = $("wp-we-list");
  if (!list) return;
  const signature = [state ? state.appearance.weId : "", weItems.map((item) => item.id).join(",")].join("|");
  if (signature === weSignature && list.childElementCount && weItems.length) return;
  weSignature = signature;
  list.textContent = "";
  if (!weItems.length) {
    if (state && state.appearance.weRoot) list.appendChild(el("div", "hint-line", "没有找到可用壁纸。"));
    return;
  }
  for (const item of weItems) {
    const btn = el("button", "we-item");
    btn.type = "button";
    btn.title = item.title + (item.note ? "（" + item.note + "）" : "");
    if (state && state.appearance.weId === item.id) btn.classList.add("on");
    const thumb = el("span", "we-thumb");
    if (item.previewUrl) {
      const img = document.createElement("img");
      img.src = item.previewUrl;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      thumb.appendChild(el("span", "we-placeholder", item.type === "video" ? "视频" : "预览"));
    }
    btn.appendChild(thumb);
    btn.appendChild(el("span", "we-name", item.title));
    btn.appendChild(el("span", "we-type", item.playable ? (item.type === "video" ? "视频" : "图片") : "预览图"));
    btn.addEventListener("click", () => api.setAppearance({ wallpaper: "we", weId: item.id }));
    list.appendChild(btn);
  }
}

/* ---------- 绑定 ---------- */

function bind() {
  document.querySelectorAll(".snav").forEach((btn) => {
    btn.addEventListener("click", () => {
      section = btn.dataset.sec;
      apply(current);
      if (section === "wallpaper" && current && current.appearance.weRoot && !weItems.length) scanWe();
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

  document.querySelectorAll("#wp-sources .src").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.wall;
      if (kind === "custom") api.pickWallpaper();
      else if (kind === "folder") api.pickWallpaperDir();
      else if (kind === "we") api.pickWeRoot().then((res) => {
        if (res && res.state) {
          weItems = res.items || [];
          weSignature = "";
          apply(res.state);
        }
      });
      else api.setAppearance({ wallpaper: kind, wallpaperIndex: 0 });
    });
  });

  $("wp-next").addEventListener("click", () => api.nextWallpaper());
  $("wp-pick-file").addEventListener("click", () => api.pickWallpaper());
  $("wp-pick-dir").addEventListener("click", () => api.pickWallpaperDir());
  $("wp-we-pick").addEventListener("click", () => {
    api.pickWeRoot().then((res) => {
      if (res && res.state) {
        weItems = res.items || [];
        weSignature = "";
        apply(res.state);
      }
    });
  });
  $("wp-we-scan").addEventListener("click", () => {
    weItems = [];
    weSignature = "";
    scanWe();
  });
  $("wp-interval").addEventListener("change", (event) => {
    api.setAppearance({ wallpaperInterval: Number(event.target.value) });
  });
  $("wp-shuffle").addEventListener("change", (event) => {
    api.setAppearance({ wallpaperShuffle: event.target.checked });
  });
  $("wp-motion").addEventListener("change", (event) => {
    api.setAppearance({ wallpaperMotion: event.target.checked });
  });
  $("wp-zoom").addEventListener("change", (event) => {
    api.setAppearance({ wallpaperZoom: event.target.checked });
  });
  $("wp-fade").addEventListener("change", (event) => {
    api.setAppearance({ wallpaperFade: event.target.checked });
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

  $("rail-reset").addEventListener("click", () => api.resetRail());

  $("rail-add").addEventListener("submit", (event) => {
    event.preventDefault();
    const label = $("rail-add-label").value.trim().slice(0, 24);
    const url = $("rail-add-url").value.trim();
    if (!label || !/^https?:\/\//i.test(url)) {
      $("rail-add-url").classList.toggle("bad", !/^https?:\/\//i.test(url));
      return;
    }
    $("rail-add-url").classList.remove("bad");
    const custom = (current.rail.custom || []).slice();
    custom.push({ id: "custom:" + Date.now().toString(36), label, url });
    api.setRail({ custom });
    $("rail-add-label").value = "";
    $("rail-add-url").value = "";
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
