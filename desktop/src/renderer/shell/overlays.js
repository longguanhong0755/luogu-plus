/* 覆盖层：Ctrl+K 全局直达 + Ctrl+Tab 页面切换器。
   打开时由主进程把页面视图隐藏，覆盖层画在内容区之上。 */
import { icon } from "./icons.js";

const ACTION_ICONS = {
  home: "home",
  problems: "library",
  training: "training",
  contest: "contest",
  discuss: "discuss",
  article: "article",
  record: "record",
  chat: "chat",
  notification: "bell",
  checkin: "calendarCheck",
  login: "user",
  reopen: "reopen",
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
  let lastFocus = null;
  let closeTimer = null;

  function rowId(prefix, index) {
    return `${prefix}-opt-${index}`;
  }

  /* 退场动画期间再次打开：作废收起计时器，直接进场 */
  function reveal() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    overlay.classList.remove("closing");
    overlay.hidden = false;
  }

  function loadingRow(text, kind = "pal") {
    const row = document.createElement("div");
    row.className = (kind === "sw" ? "sw-row" : "pal-row") + " empty";
    row.textContent = text;
    return row;
  }

  function openPalette() {
    lastFocus = document.activeElement;
    mode = "palette";
    reveal();
    palette.hidden = false;
    switcher.hidden = true;
    input.value = "";
    selected = 0;
    rows = [];
    palList.textContent = "";
    palList.appendChild(loadingRow("正在搜索…"));
    actions.overlay(true);
    input.focus();
    runQuery("");
  }

  function openSwitcher() {
    lastFocus = document.activeElement;
    mode = "switcher";
    reveal();
    switcher.hidden = false;
    palette.hidden = true;
    actions.overlay(true);
    swSelected = 0;
    swRows = [];
    swList.textContent = "";
    swList.appendChild(loadingRow("正在读取页面…", "sw"));
    switcher.focus();
    actions
      .listPages()
      .then((list) => {
        if (mode !== "switcher") return;
        swRows = Array.isArray(list) ? list : [];
      })
      .catch(() => {
        swRows = [];
      })
      .finally(() => {
        if (mode === "switcher") renderSwitcher();
      });
  }

  function close() {
    if (overlay.hidden) return;
    if (closeTimer) return;
    mode = "";
    // 160ms 退场动画后再真正隐藏；期间页面视图已由主进程恢复
    overlay.classList.add("closing");
    actions.overlay(false);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      overlay.classList.remove("closing");
      overlay.hidden = true;
      palette.hidden = true;
      switcher.hidden = true;
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
      lastFocus = null;
    }, 160);
  }

  function runQuery(query) {
    const token = ++queryToken;
    actions
      .palette(query)
      .then((result) => {
        if (token !== queryToken || mode !== "palette") return;
        rows = Array.isArray(result) ? result : [];
        if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
        renderPalette();
      })
      .catch(() => {
        if (token !== queryToken || mode !== "palette") return;
        rows = [];
        renderPalette();
      });
  }

  function renderPalette() {
    palList.textContent = "";
    rows.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "pal-row" + (index === selected ? " on" : "");
      row.id = rowId("pal", index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === selected ? "true" : "false");
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
        if (selected === index) return;
        selected = index;
        updatePaletteSelection();
      });
      row.addEventListener("click", () => choose(item));
      palList.appendChild(row);
    });
    if (!rows.length) {
      palList.appendChild(loadingRow("没有匹配项"));
    }
    updatePaletteSelection(true);
  }

  function updatePaletteSelection(scroll) {
    if (!rows.length) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const nodes = palList.querySelectorAll(".pal-row");
    nodes.forEach((node, index) => {
      const on = index === selected;
      node.classList.toggle("on", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = nodes[selected];
    if (!active) return;
    input.setAttribute("aria-activedescendant", active.id);
    if (scroll) active.scrollIntoView({ block: "nearest" });
  }

  function renderSwitcher() {
    swList.textContent = "";
    swRows.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "sw-row" + (index === swSelected ? " on" : "");
      row.id = rowId("sw", index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === swSelected ? "true" : "false");
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
        if (swSelected === index) return;
        swSelected = index;
        updateSwitcherSelection();
      });
      row.addEventListener("click", () => chooseSwitcher(item));
      swList.appendChild(row);
    });
    if (!swRows.length) {
      swList.appendChild(loadingRow("还没有打开的页面", "sw"));
    }
    updateSwitcherSelection(true);
  }

  function updateSwitcherSelection(scroll) {
    if (!swRows.length) return;
    const nodes = swList.querySelectorAll(".sw-row");
    nodes.forEach((node, index) => {
      const on = index === swSelected;
      node.classList.toggle("on", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = nodes[swSelected];
    if (active && scroll) active.scrollIntoView({ block: "nearest" });
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
        updatePaletteSelection(true);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length) {
        selected = (selected - 1 + rows.length) % rows.length;
        updatePaletteSelection(true);
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
    if (event.key === "Tab") {
      event.preventDefault();
      if (mode === "palette") input.focus();
      else switcher.focus();
      return;
    }
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
        updateSwitcherSelection(true);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (swRows.length) {
        swSelected = (swSelected - 1 + swRows.length) % swRows.length;
        updateSwitcherSelection(true);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (swRows[swSelected]) chooseSwitcher(swRows[swSelected]);
    }
  });

  scrim.addEventListener("click", close);

  return { openPalette, openSwitcher, close, isOpen: () => !overlay.hidden };
}
