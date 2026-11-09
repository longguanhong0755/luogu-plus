/* 壁纸分区：来源/预览/轮换回填，以及 Wallpaper Engine 扫描与列表。 */
import { api, store } from "./store.js";
import { $, el } from "./utils.js";

export function applyWallpaper(state) {
  const a = state.appearance;
  const wall = (state.theme && state.theme.wallpaper) || {};
  document.querySelectorAll("#wp-sources .src").forEach((btn) => {
    const on = btn.dataset.wall === a.wallpaper;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const signature = [wall.kind, wall.url, wall.video, wall.poster, wall.label, wall.count, state.theme.isDark].join("|");
  if (signature !== store.previewSignature) {
    store.previewSignature = signature;
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

  if (a.weRoot && store.section === "wallpaper" && !store.weItems.length && !store.weScanning) scanWe();
  renderWe(state);
}

export async function scanWe() {
  if (!store.current || !store.current.appearance.weRoot || store.weScanning) return;
  store.weScanning = true;
  const list = $("wp-we-list");
  list.textContent = "";
  list.appendChild(el("div", "hint-line", "正在扫描…"));
  try {
    const res = await api.scanWe(store.current.appearance.weRoot);
    store.weItems = (res && res.items) || [];
  } catch {
    store.weItems = [];
  }
  store.weScanning = false;
  renderWe(store.current);
}

export function renderWe(state) {
  const list = $("wp-we-list");
  if (!list) return;
  const signature = [state ? state.appearance.weId : "", store.weItems.map((item) => item.id).join(",")].join("|");
  if (signature === store.weSignature && list.childElementCount && store.weItems.length) return;
  store.weSignature = signature;
  list.textContent = "";
  if (!store.weItems.length) {
    if (state && state.appearance.weRoot) list.appendChild(el("div", "hint-line", "没有找到可用壁纸。"));
    return;
  }
  for (const item of store.weItems) {
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
