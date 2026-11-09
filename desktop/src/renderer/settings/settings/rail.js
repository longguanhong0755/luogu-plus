/* 侧边栏分区：顺序/隐藏/自定义链接的渲染与操作。 */
import { icon } from "../../shell/icons.js";
import { api, store } from "./store.js";
import { $, el } from "./utils.js";

export function renderRail(state) {
  const rail = state.rail;
  const signature = JSON.stringify([rail.order, rail.hidden, rail.custom]);
  if (signature === store.railSignature) return;
  store.railSignature = signature;

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
