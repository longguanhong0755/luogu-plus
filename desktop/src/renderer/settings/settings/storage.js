/* 缓存与离线数据的容量统计。 */
import { api } from "./store.js";
import { $, formatBytes } from "./utils.js";

export async function refreshStorageStats() {
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
