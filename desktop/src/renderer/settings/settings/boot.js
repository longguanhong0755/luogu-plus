/* 启动：绑定事件、拉取首帧状态、渲染版本号。 */
import { fatal } from "../../shared/fatal.js";
import { api, store } from "./store.js";
import { $ } from "./utils.js";
import { refreshStorageStats } from "./storage.js";
import { apply } from "./apply.js";
import { bind } from "./bind.js";
import { setSection } from "./nav.js";

export async function boot() {
  if (!api) {
    fatal("设置初始化失败", "preload 加载失败，请重启应用。");
    return;
  }
  bind();
  api.onState(apply);
  apply(await api.getState());
  setSection(store.section, false);
  refreshStorageStats();
  try {
    $("about-version").textContent = "版本 " + (await api.getVersion());
  } catch {
    $("about-version").textContent = "版本 —";
  }
}
