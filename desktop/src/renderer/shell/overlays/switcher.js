/* Ctrl+Tab 页面切换器：列表拉取、渲染与键盘选中态。 */
import { icon } from "../icons.js";
import { dom, store } from "./context.js";
import { ACTION_ICONS, loadingRow, rowId } from "./ui.js";
import { chooseSwitcher, rememberFocus, reveal } from "./session.js";

export function openSwitcher(options = {}) {
  rememberFocus(options);
  store.mode = "switcher";
  reveal();
  dom.switcher.hidden = false;
  dom.palette.hidden = true;
  dom.userSearch.hidden = true;
  store.actions.overlay(true);
  store.swSelected = 0;
  store.swRows = [];
  dom.swList.textContent = "";
  dom.swList.appendChild(loadingRow("正在读取页面…", "sw"));
  dom.switcher.focus();
  store.actions
    .listPages()
    .then((list) => {
      if (store.mode !== "switcher") return;
      store.swRows = Array.isArray(list) ? list : [];
    })
    .catch(() => {
      store.swRows = [];
    })
    .finally(() => {
      if (store.mode === "switcher") renderSwitcher();
    });
}

export function renderSwitcher() {
  dom.swList.textContent = "";
  store.swRows.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "sw-row" + (index === store.swSelected ? " on" : "");
    row.id = rowId("sw", index);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === store.swSelected ? "true" : "false");
    const ico = document.createElement("span");
    ico.className = "sw-ico";
    const name =
      item.kind === "problem"
        ? "code"
        : item.kind === "section"
          ? ACTION_ICONS[String(item.key).replace("section:", "")] || "library"
          : item.kind === "profile"
            ? "user"
            : "search";
    ico.innerHTML = icon(name);
    row.appendChild(ico);
    const title = document.createElement("span");
    title.className = "sw-title";
    title.textContent = item.title || item.key;
    title.title = item.title || item.key;
    row.appendChild(title);
    const kind = document.createElement("span");
    kind.className = "sw-kind";
    kind.textContent = item.kind === "problem" ? "题目" : item.kind === "profile" ? "主页" : "板块";
    row.appendChild(kind);
    row.addEventListener("mouseenter", () => {
      if (store.swSelected === index) return;
      store.swSelected = index;
      updateSwitcherSelection();
    });
    row.addEventListener("click", () => chooseSwitcher(item));
    dom.swList.appendChild(row);
  });
  if (!store.swRows.length) {
    dom.swList.appendChild(loadingRow("还没有打开的页面", "sw"));
  }
  updateSwitcherSelection(true);
}

export function updateSwitcherSelection(scroll) {
  if (!store.swRows.length) return;
  const nodes = dom.swList.querySelectorAll(".sw-row");
  nodes.forEach((node, index) => {
    const on = index === store.swSelected;
    node.classList.toggle("on", on);
    node.setAttribute("aria-selected", on ? "true" : "false");
  });
  const active = nodes[store.swSelected];
  if (active && scroll) active.scrollIntoView({ block: "nearest" });
}
