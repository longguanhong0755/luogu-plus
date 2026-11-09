/* Ctrl+K 命令面板：打开、搜索、渲染与键盘选中态。 */
import { icon } from "../icons.js";
import { dom, store } from "./context.js";
import { ACTION_ICONS, loadingRow, rowId } from "./ui.js";
import { choose, rememberFocus, reveal } from "./session.js";

export function openPalette(options = {}) {
  rememberFocus(options);
  store.mode = "palette";
  reveal();
  dom.palette.hidden = false;
  dom.switcher.hidden = true;
  dom.userSearch.hidden = true;
  dom.jumpOptions.hidden = true;
  dom.input.value = "";
  dom.input.placeholder = "输入题号、题名或功能…";
  dom.input.setAttribute("aria-label", "搜索题号、题名或功能");
  dom.input.setAttribute("aria-expanded", "true");
  dom.input.removeAttribute("aria-invalid");
  dom.palette.setAttribute("aria-label", "命令面板");
  dom.palList.hidden = false;
  if (dom.palFoot) dom.palFoot.textContent = dom.palFootDefault;
  store.selected = 0;
  store.rows = [];
  dom.palList.textContent = "";
  dom.palList.appendChild(loadingRow("正在搜索…"));
  store.actions.overlay(true);
  dom.input.focus();
  runQuery("");
}

export function runQuery(query) {
  const token = ++store.queryToken;
  store.actions
    .palette(query)
    .then((result) => {
      if (token !== store.queryToken || store.mode !== "palette") return;
      store.rows = Array.isArray(result) ? result : [];
      if (store.selected >= store.rows.length) store.selected = Math.max(0, store.rows.length - 1);
      renderPalette();
    })
    .catch(() => {
      if (token !== store.queryToken || store.mode !== "palette") return;
      store.rows = [];
      renderPalette();
    });
}

export function renderPalette() {
  dom.palList.textContent = "";
  store.rows.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "pal-row" + (index === store.selected ? " on" : "");
    row.id = rowId("pal", index);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === store.selected ? "true" : "false");
    row.innerHTML =
      icon(item.type === "problem" ? "code" : item.type === "page" ? "library" : ACTION_ICONS[item.id] || "search");
    const label = document.createElement("span");
    label.className = "pal-label";
    label.textContent = item.label;
    label.title = item.label;
    row.appendChild(label);
    const kind = document.createElement("span");
    kind.className = "pal-kind";
    kind.textContent = item.type === "problem" ? "题目" : item.type === "page" ? "已打开" : "功能";
    row.appendChild(kind);
    row.addEventListener("mouseenter", () => {
      if (store.selected === index) return;
      store.selected = index;
      updatePaletteSelection();
    });
    row.addEventListener("click", () => choose(item));
    dom.palList.appendChild(row);
  });
  if (!store.rows.length) {
    dom.palList.appendChild(loadingRow("没有匹配项"));
  }
  updatePaletteSelection(true);
}

export function updatePaletteSelection(scroll) {
  if (!store.rows.length) {
    dom.input.removeAttribute("aria-activedescendant");
    return;
  }
  const nodes = dom.palList.querySelectorAll(".pal-row");
  nodes.forEach((node, index) => {
    const on = index === store.selected;
    node.classList.toggle("on", on);
    node.setAttribute("aria-selected", on ? "true" : "false");
  });
  const active = nodes[store.selected];
  if (!active) return;
  dom.input.setAttribute("aria-activedescendant", active.id);
  if (scroll) active.scrollIntoView({ block: "nearest" });
}
