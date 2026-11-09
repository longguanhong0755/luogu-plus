/* 事件绑定：所有控件 → preload API 的即时写回。 */
import { icon } from "../../shell/icons.js";
import { api, store } from "./store.js";
import { $ } from "./utils.js";
import { refreshStorageStats } from "./storage.js";
import { NAV_ICONS, setSection } from "./nav.js";
import { apply } from "./apply.js";
import { FEATURE_CONTROLS } from "./features.js";
import { scanWe } from "./wallpaper.js";

export function bind() {
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
            store.weItems = res.items || [];
            store.weSignature = "";
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
        store.weItems = res.items || [];
        store.weSignature = "";
        apply(res.state);
      }
    });
  });
  $("wp-we-scan").addEventListener("click", () => {
    store.weItems = [];
    store.weSignature = "";
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
    const custom = (store.current.rail.custom || []).slice();
    custom.push({ id: "custom:" + Date.now().toString(36), label, url });
    api.setRail({ custom });
    $("rail-add-label").value = "";
    $("rail-add-url").value = "";
  });
}
