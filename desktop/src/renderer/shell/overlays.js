/* 覆盖层：Ctrl+K 全局直达 + Ctrl+Tab 页面切换器。
   打开时由主进程把页面视图隐藏，覆盖层画在内容区之上。 */
import { icon } from "./icons.js";

const ACTION_ICONS = {
  home: "home",
  problems: "library",
  class: "class",
  training: "training",
  contest: "contest",
  discuss: "discuss",
  article: "article",
  record: "record",
  chat: "chat",
  notification: "bell",
  checkin: "calendarCheck",
  login: "user",
  settings: "settings",
  problem: "code",
};

export function initOverlays(actions) {
  const overlay = document.getElementById("overlay");
  const palette = document.getElementById("palette");
  const switcher = document.getElementById("switcher");
  const scrim = document.getElementById("scrim");
  const input = document.getElementById("pal-input");
  const palList = document.getElementById("pal-list");
  const swList = document.getElementById("sw-list");

  let mode = "";
  let rows = [];
  let selected = 0;
  let swRows = [];
  let swSelected = 0;
  let queryToken = 0;

  function openPalette() {
    mode = "palette";
    overlay.hidden = false;
    palette.hidden = false;
    switcher.hidden = true;
    input.value = "";
    selected = 0;
    actions.overlay(true);
    input.focus();
    runQuery("");
  }

  function openSwitcher() {
    mode = "switcher";
    overlay.hidden = false;
    switcher.hidden = false;
    palette.hidden = true;
    actions.overlay(true);
    swSelected = 0;
    actions.listPages().then((list) => {
      swRows = Array.isArray(list) ? list : [];
      renderSwitcher();
    });
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    palette.hidden = true;
    switcher.hidden = true;
    mode = "";
    actions.overlay(false);
  }

  function runQuery(query) {
    const token = ++queryToken;
    actions.palette(query).then((result) => {
      if (token !== queryToken || mode !== "palette") return;
      rows = Array.isArray(result) ? result : [];
      if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
      renderPalette();
    });
  }

  function renderPalette() {
    palList.textContent = "";
    rows.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "pal-row" + (index === selected ? " on" : "");
      const name = item.type === "problem" ? "code" : ACTION_ICONS[item.id] || "search";
      row.innerHTML = icon(name);
      row.appendChild(document.createTextNode(item.label));
      const kind = document.createElement("span");
      kind.className = "pal-kind";
      kind.textContent = item.type === "problem" ? "题目" : "功能";
      row.appendChild(kind);
      row.addEventListener("mouseenter", () => {
        selected = index;
        renderPalette();
      });
      row.addEventListener("click", () => choose(item));
      palList.appendChild(row);
    });
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "pal-row";
      empty.textContent = "没有匹配项";
      palList.appendChild(empty);
    }
  }

  function renderSwitcher() {
    swList.textContent = "";
    swRows.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "sw-row" + (index === swSelected ? " on" : "");
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
      row.appendChild(document.createTextNode(item.title || item.key));
      const kind = document.createElement("span");
      kind.className = "sw-kind";
      kind.textContent = item.kind === "problem" ? "题目" : item.kind === "profile" ? "主页" : "板块";
      row.appendChild(kind);
      row.addEventListener("mouseenter", () => {
        swSelected = index;
        renderSwitcher();
      });
      row.addEventListener("click", () => chooseSwitcher(item));
      swList.appendChild(row);
    });
    if (!swRows.length) {
      const empty = document.createElement("div");
      empty.className = "sw-row";
      empty.textContent = "还没有打开的页面";
      swList.appendChild(empty);
    }
  }

  function choose(item) {
    close();
    actions.run(item);
  }

  function chooseSwitcher(item) {
    close();
    actions.switchTo(item.key);
  }

  input.addEventListener("input", () => {
    selected = 0;
    runQuery(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length) {
        selected = (selected + 1) % rows.length;
        renderPalette();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length) {
        selected = (selected - 1 + rows.length) % rows.length;
        renderPalette();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (rows[selected]) choose(rows[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (mode !== "switcher") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (swRows.length) {
        swSelected = (swSelected + 1) % swRows.length;
        renderSwitcher();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (swRows.length) {
        swSelected = (swSelected - 1 + swRows.length) % swRows.length;
        renderSwitcher();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (swRows[swSelected]) chooseSwitcher(swRows[swSelected]);
    }
  });

  scrim.addEventListener("click", close);

  return { openPalette, openSwitcher, close, isOpen: () => !overlay.hidden };
}
