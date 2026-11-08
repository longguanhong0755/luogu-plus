/* 设置窗口：改动即时生效（无保存按钮），所有状态以主进程广播为准。 */
import { applyTheme } from "../shared/theme.js";
import { fatal } from "../shared/fatal.js";
import { icon } from "../shell/icons.js";

const api = window.lgSettings;
let current = null;
let section = "appearance";
let weItems = [];
let weScanning = false;
let railSignature = "";
let weSignature = "";
let previewSignature = "";

const NAV_ICONS = {
  appearance: "palette",
  wallpaper: "image",
  rail: "sidebar",
  enhance: "star",
  general: "settings",
  notify: "bell",
  account: "user",
  about: "info",
};

function $(id) {
  return document.getElementById(id);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / 1024 / 1024).toFixed(1) + " MB";
}

async function refreshStorageStats() {
  const status = $("storage-status");
  if (!status) return;
  try {
    const stats = await api.getStorageStats();
    const store = stats && stats.store;
    const web = stats ? Number(stats.webCacheBytes) || 0 : 0;
    const views = stats && stats.views;
    const parts = [
      "网页缓存 " + formatBytes(web),
      store ? "离线数据 " + formatBytes(store.diskBytes) : "",
      views ? "活动页面 " + views.live + " / 休眠 " + views.sleeping : "",
    ].filter(Boolean);
    status.textContent = parts.join(" · ");
  } catch (err) {
    status.textContent = "缓存统计失败：" + err.message;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateNav() {
  document.querySelectorAll(".snav").forEach((btn) => {
    const on = btn.dataset.sec === section;
    btn.classList.toggle("on", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== section;
  });
}

function setSection(next, focus = true) {
  if (!next) return;
  section = next;
  updateNav();
  const pane = document.querySelector(".set-pane");
  if (pane) pane.scrollTop = 0;
  if (focus) {
    const head = document.querySelector(`[data-panel="${section}"] h2`);
    if (head) head.focus({ preventScroll: true });
  }
}

function apply(state) {
  if (!state) return;
  current = state;
  applyTheme(state.theme);
  updateNav();
  applyAppearance(state);
  applyWallpaper(state);
  renderRail(state);
  applyFeatures(state);
  applyGeneral(state);
  syncWallpaperMotion(state);
  applyAccount(state);

  if (section === "wallpaper" && state.appearance.weRoot && !weItems.length && !weScanning) {
    scanWe();
  }
}

const FEATURE_CONTROLS = {
  "feat-problem-detect": "problemDetect",
  "feat-user-intro": "showUserIntro",
  "feat-problem-color": "problemDifficultyColor",
  "feat-user-search": "userSearch",
  "feat-shortcuts": "shortcuts",
  "feat-dynamic": "dynamicDetection",
  "feat-fortune": "changeFortune",
  "feat-support": "supportPrompt",
  "feat-better-search": "betterSearch",
  "feat-beautify-home": "beautifyUI",
  "feat-smooth-home": "smoothHome",
  "feat-auto-refresh": "autoRefresh",
  "feat-custom-sections": "customSections",
  "feat-home-recent": "homeRecent",
  "feat-home-official": "homeOfficial",
  "feat-home-countdown": "homeCountdown",
  "feat-home-quick-jump": "homeQuickJump",
  "feat-home-progress": "homeProgress",
  "feat-home-contest": "homeContest",
  "feat-home-heat": "homeHeat",
  "feat-home-first-run": "homeFirstRun",
  "feat-home-announcement": "homeAnnouncement",
  "feat-home-tasks": "homeTasks",
  "feat-home-links": "homeLinks",
  "feat-home-community": "homeCommunity",
};

function applyFeatures(state) {
  const features = state.features || {};
  for (const [id, key] of Object.entries(FEATURE_CONTROLS)) {
    const input = $(id);
    if (input) input.checked = !!features[key];
  }
}

function applyAppearance(state) {
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

function applyWallpaper(state) {
  const a = state.appearance;
  const wall = (state.theme && state.theme.wallpaper) || {};
  document.querySelectorAll("#wp-sources .src").forEach((btn) => {
    const on = btn.dataset.wall === a.wallpaper;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const signature = [wall.kind, wall.url, wall.video, wall.poster, wall.label, wall.count, state.theme.isDark].join("|");
  if (signature !== previewSignature) {
    previewSignature = signature;
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
    $("wp-preview-label").title = wall.label || "";
    const kinds = {
      desktop: "跟随桌面",
      builtin: "内置渐变",
      daily: "每日一图",
      custom: "单张",
      folder: "文件夹轮换",
      we: "Wallpaper Engine",
    };
    $("wp-preview-kind").textContent = (kinds[a.wallpaper] || "") + (wall.count > 1 ? ` · ${wall.count} 张` : "");
  }

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

function syncWallpaperMotion(state) {
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

function applyGeneral(state) {
  const closeRadio = document.querySelector(`input[name="close"][value="${state.general.closeAction}"]`);
  if (closeRadio) closeRadio.checked = true;
  $("autolaunch").checked = !!state.general.autoLaunch;
  $("perf-mode").checked = !!state.general.performanceMode;
  $("disclaimer-accepted").checked = !!state.general.disclaimerAccepted;
  $("shortcut-problems").value = state.general.shortcutOpenProblems || "Alt+L";
  document.body.classList.toggle("perf", !!state.general.performanceMode);
  $("notify-judge").checked = !!state.notify.judge;
  $("notify-contest").checked = !!state.notify.contest;
  $("notify-lead").value = String(state.notify.contestLeadMin || 10);
}

function applyAccount(state) {
  const name = $("account-name");
  const uid = $("account-uid");
  const avatar = $("account-avatar");
  if (state.user && state.user.loggedIn) {
    name.textContent = state.user.name || "已登录";
    uid.textContent = state.user.uid ? "UID " + state.user.uid : "";
    const url = state.user.avatar ? String(state.user.avatar) : "";
    avatar.textContent = "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = state.user.name || "头像";
      avatar.appendChild(img);
    } else {
      avatar.textContent = (state.user.name || "洛").slice(0, 1);
    }
  } else {
    name.textContent = "未登录";
    uid.textContent = "登录后可查看提交记录与签到";
    avatar.textContent = "洛";
  }
  $("btn-logout").disabled = !(state.user && state.user.loggedIn);
}

/* ---------- 侧边栏 ---------- */

function renderRail(state) {
  const rail = state.rail;
  const signature = JSON.stringify([rail.order, rail.hidden, rail.custom]);
  if (signature === railSignature) return;
  railSignature = signature;

  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : "";
  const labels = new Map((rail.all || []).map((item) => [item.id, item]));
  const hidden = new Set(rail.hidden);
  const list = $("rail-list");
  list.textContent = "";

  rail.order.forEach((id, index) => {
    const meta = labels.get(id) || { label: id };
    const row = el("div", "rail-row" + (hidden.has(id) ? " off" : ""));
    row.appendChild(el("span", "rail-name", meta.label));
    row.appendChild(el("span", "rail-spacer-mini"));

    const up = el("button", "rail-mini");
    up.type = "button";
    up.title = "上移";
    up.setAttribute("aria-label", meta.label + " 上移");
    up.innerHTML = icon("chevronUp");
    up.dataset.focusKey = "up:" + id;
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      const order = rail.order.slice();
      [order[index - 1], order[index]] = [order[index], order[index - 1]];
      api.setRail({ order });
    });
    const down = el("button", "rail-mini");
    down.type = "button";
    down.title = "下移";
    down.setAttribute("aria-label", meta.label + " 下移");
    down.innerHTML = icon("chevronDown");
    down.dataset.focusKey = "down:" + id;
    down.disabled = index === rail.order.length - 1;
    down.addEventListener("click", () => {
      const order = rail.order.slice();
      [order[index + 1], order[index]] = [order[index], order[index + 1]];
      api.setRail({ order });
    });
    const toggle = el("button", "rail-eye" + (hidden.has(id) ? " off" : ""), hidden.has(id) ? "显示" : "隐藏");
    toggle.type = "button";
    toggle.dataset.focusKey = "toggle:" + id;
    toggle.setAttribute("aria-pressed", hidden.has(id) ? "true" : "false");
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
    const urlEl = el("span", "rail-kind url", item.url);
    urlEl.title = item.url;
    row.appendChild(urlEl);
    row.appendChild(el("span", "rail-spacer-mini"));
    const del = el("button", "rail-mini wide", "删除");
    del.type = "button";
    del.dataset.focusKey = "del:" + item.id;
    del.addEventListener("click", () => {
      api.setRail({ custom: rail.custom.filter((entry) => entry.id !== item.id) });
    });
    row.appendChild(del);
    customBox.appendChild(row);
  }

  if (focusKey) {
    const back = document.querySelector(`[data-focus-key="${focusKey}"]`);
    if (back) back.focus();
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
    const box = btn.querySelector(".snav-icon");
    if (box) box.innerHTML = icon(NAV_ICONS[btn.dataset.sec] || "dot");
    btn.addEventListener("click", () => setSection(btn.dataset.sec));
  });
  const nav = document.querySelector(".set-nav");
  if (nav) {
    nav.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...nav.querySelectorAll(".snav")];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next.focus();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    event.preventDefault();
    window.close();
  });

  document.querySelectorAll("#mode-seg button").forEach((btn) => {
    btn.addEventListener("click", () => api.setAppearance({ mode: btn.dataset.mode }));
  });

  const mat = $("mat");
  let timer = null;
  mat.addEventListener("input", () => {
    $("mat-val").textContent = mat.value;
    const pct = ((Number(mat.value) - Number(mat.min || 0)) / (Number(mat.max || 100) - Number(mat.min || 0))) * 100;
    mat.style.setProperty("--fill", pct + "%");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => api.setAppearance({ material: Number(mat.value) }), 70);
  });

  const glass = $("glass");
  let glassTimer = null;
  glass.addEventListener("input", () => {
    $("glass-val").textContent = glass.value;
    const pct = ((Number(glass.value) - Number(glass.min || 0)) / (Number(glass.max || 100) - Number(glass.min || 0))) * 100;
    glass.style.setProperty("--fill", pct + "%");
    if (glassTimer) clearTimeout(glassTimer);
    glassTimer = setTimeout(() => api.setAppearance({ glass: Number(glass.value) }), 70);
  });

  document.querySelectorAll("#wp-sources .src").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.wall;
      if (kind === "custom") api.pickWallpaper();
      else if (kind === "folder") api.pickWallpaperDir();
      else if (kind === "we")
        api.pickWeRoot().then((res) => {
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
  let accentTimer = null;
  const applyCustomAccent = (value) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    if (accentTimer) clearTimeout(accentTimer);
    accentTimer = setTimeout(() => api.setAppearance({ accent: value }), 70);
  };
  $("accent-custom").addEventListener("input", (event) => applyCustomAccent(event.target.value));
  $("accent-custom").addEventListener("change", (event) => applyCustomAccent(event.target.value));

  document.querySelectorAll('input[name="close"]').forEach((radio) => {
    radio.addEventListener("change", () => api.setGeneral({ closeAction: radio.value }));
  });
  $("taskbar-pin").addEventListener("click", async () => {
    const button = $("taskbar-pin");
    const status = $("taskbar-pin-status");
    button.disabled = true;
    status.textContent = "正在创建任务栏入口…";
    try {
      const result = await api.pinTaskbar();
      if (result && result.ok) {
        status.textContent = result.already ? "已经固定在任务栏。" : "已发送固定请求，请查看任务栏。";
        button.textContent = "已固定";
      } else {
        status.textContent = (result && result.message) || "Windows 未允许自动固定，请右键任务栏中的洛谷图标选择“固定到任务栏”。";
      }
    } catch (err) {
      status.textContent = "固定失败：" + (err.message || "未知错误") + "。可在任务栏图标上右键手动固定。";
    } finally {
      button.disabled = false;
    }
  });
  $("autolaunch").addEventListener("change", (event) => api.setGeneral({ autoLaunch: event.target.checked }));
  $("perf-mode").addEventListener("change", (event) => api.setGeneral({ performanceMode: event.target.checked }));
  $("disclaimer-accepted").addEventListener("change", (event) => api.setGeneral({ disclaimerAccepted: event.target.checked }));
  $("shortcut-problems").addEventListener("keydown", (event) => {
    event.preventDefault();
    if (event.key === "Escape") {
      $("shortcut-problems").value = "Alt+L";
      api.setGeneral({ shortcutOpenProblems: "Alt+L" });
      return;
    }
    const key = String(event.key || "").toUpperCase();
    if (!/^[A-Z0-9]$/.test(key)) return;
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (!parts.length) return;
    const accelerator = parts.concat(key).join("+");
    $("shortcut-problems").value = accelerator;
    api.setGeneral({ shortcutOpenProblems: accelerator });
  });
  $("shortcut-reset").addEventListener("click", () => {
    $("shortcut-problems").value = "Alt+L";
    api.setGeneral({ shortcutOpenProblems: "Alt+L" });
  });

  for (const [id, key] of Object.entries(FEATURE_CONTROLS)) {
    const input = $(id);
    if (input) input.addEventListener("change", () => api.setFeatures({ [key]: input.checked }));
  }
  $("settings-export").addEventListener("click", async () => {
    try {
      await api.exportSettings();
    } catch (err) {
      alert("导出设置失败：" + err.message);
    }
  });
  $("settings-import").addEventListener("click", async () => {
    try {
      const res = await api.importSettings();
      if (res && res.state) apply(res.state);
    } catch (err) {
      alert("导入设置失败：" + err.message);
    }
  });
  $("settings-reset").addEventListener("click", async () => {
    if (!confirm("恢复全部默认设置？当前外观、侧栏、增强与通知配置都会被重置。")) return;
    try {
      const res = await api.resetSettings();
      if (res && res.state) apply(res.state);
    } catch (err) {
      alert("恢复默认失败：" + err.message);
    }
  });
  $("clear-web-cache").addEventListener("click", async () => {
    const button = $("clear-web-cache");
    button.disabled = true;
    $("storage-status").textContent = "正在清理网页缓存…";
    try {
      const result = await api.clearWebCache();
      const message = (result && result.message) || "网页缓存已清理。";
      await refreshStorageStats();
      $("storage-status").textContent = message;
    } catch (err) {
      $("storage-status").textContent = "清理失败：" + err.message;
    } finally {
      button.disabled = false;
    }
  });

  $("check-update").addEventListener("click", async () => {
    const button = $("check-update");
    const status = $("update-status");
    button.disabled = true;
    status.textContent = "正在检查…";
    try {
      const result = await api.checkUpdate();
      status.textContent = result.newer
        ? "发现 " + result.latest + "，可前往发布页查看"
        : result.latest
          ? "已是最新版本（" + result.current + "）"
          : "暂无发布版本（当前 " + result.current + "）";
      if (result.newer && result.notes) {
        $("about-announcement").textContent = result.notes.slice(0, 1200);
      }
    } catch (err) {
      status.textContent = "检查失败：" + err.message;
    } finally {
      button.disabled = false;
    }
  });
  $("notify-judge").addEventListener("change", (event) => api.setNotify({ judge: event.target.checked }));
  $("notify-contest").addEventListener("change", (event) => api.setNotify({ contest: event.target.checked }));
  $("notify-lead").addEventListener("change", (event) => {
    api.setNotify({ contestLeadMin: Number(event.target.value) });
  });

  $("btn-login").addEventListener("click", () => api.nav("login"));
  $("btn-logout").addEventListener("click", async () => {
    await api.logout();
  });

  $("rail-add-url").addEventListener("input", () => $("rail-add-url").classList.remove("bad"));
  $("rail-add-label").addEventListener("input", () => $("rail-add-label").classList.remove("bad"));

  $("rail-reset").addEventListener("click", () => api.resetRail());

  $("rail-add").addEventListener("submit", (event) => {
    event.preventDefault();
    const label = $("rail-add-label").value.trim().slice(0, 24);
    const url = $("rail-add-url").value.trim();
    const urlOk = /^https?:\/\//i.test(url);
    $("rail-add-url").classList.toggle("bad", !urlOk);
    $("rail-add-label").classList.toggle("bad", !label);
    if (!label || !urlOk) return;
    $("rail-add-url").classList.remove("bad");
    $("rail-add-label").classList.remove("bad");
    const custom = (current.rail.custom || []).slice();
    custom.push({ id: "custom:" + Date.now().toString(36), label, url });
    api.setRail({ custom });
    $("rail-add-label").value = "";
    $("rail-add-url").value = "";
  });
}

async function boot() {
  if (!api) {
    fatal("设置初始化失败", "preload 加载失败，请重启应用。");
    return;
  }
  bind();
  api.onState(apply);
  apply(await api.getState());
  setSection(section, false);
  refreshStorageStats();
  try {
    $("about-version").textContent = "版本 " + (await api.getVersion());
  } catch {
    $("about-version").textContent = "版本 —";
  }
}

boot().catch((err) => {
  console.error(err);
  fatal("设置初始化失败", err.message);
});
