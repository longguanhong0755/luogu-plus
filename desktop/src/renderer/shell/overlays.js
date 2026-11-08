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
  const jumpOptions = document.getElementById("jump-options");
  const jumpDifficulty = document.getElementById("jump-difficulty");
  const jumpSource = document.getElementById("jump-source");
  const jumpStatus = document.getElementById("jump-status");
  const jumpRandom = document.getElementById("jump-random");
  const jumpTrueRandom = document.getElementById("jump-true-random");
  const userSearch = document.getElementById("user-search");
  const userForm = document.getElementById("user-search-form");
  const userInput = document.getElementById("user-search-input");
  const userList = document.getElementById("user-search-list");
  const palFoot = palette.querySelector(".pal-foot");
  const palFootDefault = palFoot ? palFoot.textContent : "";

  let mode = "";
  let rows = [];
  let selected = 0;
  let swRows = [];
  let swSelected = 0;
  let queryToken = 0;
  let featureState = {};
  let lastFocus = null;
  let returnToPage = false;
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

  function rememberFocus(options = {}) {
    if (!overlay.hidden) return;
    lastFocus = document.activeElement;
    returnToPage = !!options.fromPage;
  }

  function loadingRow(text, kind = "pal") {
    const row = document.createElement("div");
    row.className = (kind === "sw" ? "sw-row" : "pal-row") + " empty";
    row.textContent = text;
    return row;
  }

  function openPalette(options = {}) {
    rememberFocus(options);
    mode = "palette";
    reveal();
    palette.hidden = false;
    switcher.hidden = true;
    userSearch.hidden = true;
    jumpOptions.hidden = true;
    input.value = "";
    input.placeholder = "输入题号、题名或功能…";
    input.setAttribute("aria-label", "搜索题号、题名或功能");
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-invalid");
    palette.setAttribute("aria-label", "命令面板");
    palList.hidden = false;
    if (palFoot) palFoot.textContent = palFootDefault;
    selected = 0;
    rows = [];
    palList.textContent = "";
    palList.appendChild(loadingRow("正在搜索…"));
    actions.overlay(true);
    input.focus();
    runQuery("");
  }

  function openJump(options = {}) {
    rememberFocus(options);
    mode = "jump";
    reveal();
    palette.hidden = false;
    switcher.hidden = true;
    userSearch.hidden = true;
    jumpOptions.hidden = featureState.betterSearch === false;
    input.value = "";
    input.placeholder = "输入题号，例如 P1001";
    input.setAttribute("aria-label", "输入题号跳转");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-invalid");
    palette.setAttribute("aria-label", "题号跳转");
    palList.hidden = true;
    palList.textContent = "";
    if (palFoot) palFoot.textContent = featureState.betterSearch === false
      ? "题号支持 P1001 / 1001 / 13A · ↵ 跳转 · Esc 关闭"
      : "题号支持 P1001 / 1001 / 13A · ↵ 跳转 · 难度/题库随机 · Esc 关闭";
    const randomMode = options && options.random === true;
    if (jumpStatus) {
      jumpStatus.textContent = randomMode
        ? "选择难度与题库，然后点击「按条件随机」"
        : "可输入题号，或按难度与题库随机跳题";
      jumpStatus.classList.remove("bad");
    }
    if (jumpRandom) jumpRandom.disabled = false;
    actions.overlay(true);
    if (randomMode && jumpRandom && !jumpOptions.hidden) {
      requestAnimationFrame(() => jumpRandom.focus());
    } else {
      input.focus();
      input.select();
    }
  }

  function openRandomJump() {
    openJump({ random: true });
  }

  function openUserSearch(options = {}) {
    rememberFocus(options);
    mode = "user";
    reveal();
    palette.hidden = true;
    switcher.hidden = true;
    userSearch.hidden = false;
    userInput.value = "";
    userList.textContent = "";
    userList.appendChild(loadingRow("输入用户名或 UID 后搜索", "sw"));
    actions.overlay(true);
    userInput.focus();
  }

  function openSwitcher(options = {}) {
    rememberFocus(options);
    mode = "switcher";
    reveal();
    switcher.hidden = false;
    palette.hidden = true;
    userSearch.hidden = true;
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

  function close({ restoreFocus = true } = {}) {
    if (overlay.hidden) return;
    if (closeTimer) return;
    mode = "";
    const focusTarget = lastFocus;
    overlay.classList.add("closing");
    // 页面视图立即恢复，但焦点只由外壳在退场结束后恢复，避免主进程与 DOM 争抢。
    actions.overlay(false);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      overlay.classList.remove("closing");
      overlay.hidden = true;
      palette.hidden = true;
      switcher.hidden = true;
      userSearch.hidden = true;
      if (jumpOptions) jumpOptions.hidden = true;
      input.removeAttribute("aria-invalid");
      if (restoreFocus) {
        if (!returnToPage && focusTarget && focusTarget.isConnected && focusTarget !== document.body && typeof focusTarget.focus === "function") {
          focusTarget.focus();
        } else {
          actions.focusPage();
        }
      }
      lastFocus = null;
      returnToPage = false;
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

  function normalizeProblemInput(raw) {
    let value = String(raw || "").trim().toUpperCase();
    if (/^\d+$/.test(value)) value = "P" + value;
    else if (/^\d{1,4}[A-Z]\d?$/.test(value)) value = "CF" + value;
    return /^(?:AT_?[A-Z0-9_]+|CF\d{1,4}[A-Z]\d?|SP\d{1,5}|UVA\d{1,5}|[PBU]\d{1,6})$/.test(value)
      ? value
      : "";
  }

  function setJumpStatus(text, bad) {
    if (!jumpStatus) return;
    jumpStatus.textContent = text;
    jumpStatus.classList.toggle("bad", !!bad);
  }

  async function runRandomProblem() {
    if (!jumpRandom || jumpRandom.disabled) return;
    jumpRandom.disabled = true;
    setJumpStatus("正在随机选题…", false);
    try {
      const result = await actions.randomProblem({
        difficulty: Number(jumpDifficulty.value),
        source: jumpSource.value,
      });
      if (result && result.ok && result.pid) {
        close();
        actions.openProblem(result.pid);
        return;
      }
      const wait = result && result.waitMs ? Math.ceil(result.waitMs / 1000) + " 秒后再试" : "稍后再试";
      const messages = {
        daily: "今日随机次数已达上限",
        interval: "冷却中，请 " + wait,
        offline: "当前离线，无法随机跳题",
        empty: "该条件下暂无题目",
        network: "加载失败，请稍后再试",
      };
      setJumpStatus((result && messages[result.reason]) || "加载失败，请稍后再试", true);
    } catch {
      setJumpStatus("加载失败，请稍后再试", true);
    } finally {
      if (jumpRandom) jumpRandom.disabled = false;
    }
  }

  function renderUserResults(result) {
    userList.textContent = "";
    const users = result && Array.isArray(result.users) ? result.users : [];
    if (!users.length) {
      const text =
        result && result.reason === "interval" ? "操作过于频繁，请稍后再试" :
        result && result.reason === "daily" ? "今日用户搜索次数已达上限" :
        result && result.reason === "offline" ? "当前离线，无法搜索用户" :
        "未搜索到相关内容";
      userList.appendChild(loadingRow(text, "sw"));
      return;
    }
    for (const user of users) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "user-search-row";
      row.setAttribute("role", "option");
      const avatar = document.createElement("span");
      avatar.className = "user-search-avatar";
      avatar.textContent = String(user.name || "洛").slice(0, 1);
      if (/^https?:\/\//i.test(String(user.avatar || ""))) {
        avatar.textContent = "";
        const image = document.createElement("img");
        image.src = user.avatar;
        image.alt = "";
        image.loading = "lazy";
        avatar.appendChild(image);
      }
      const info = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = user.name || "未命名用户";
      const meta = document.createElement("small");
      meta.textContent = "UID " + user.uid + (user.badge ? " · " + user.badge : "") + (user.ccfLevel ? " · CCF " + user.ccfLevel : "");
      info.appendChild(name);
      info.appendChild(meta);
      row.appendChild(avatar);
      row.appendChild(info);
      row.addEventListener("click", () => {
        close();
        actions.openUser(user.uid);
      });
      userList.appendChild(row);
    }
    const first = userList.querySelector(".user-search-row");
    if (first) first.focus({ preventScroll: true });
  }

  async function submitUserSearch() {
    const keyword = userInput.value.trim();
    if (!keyword) {
      renderUserResults({ users: [], reason: "empty" });
      userInput.focus();
      return;
    }
    userList.textContent = "";
    userList.appendChild(loadingRow("正在搜索用户…", "sw"));
    try {
      renderUserResults(await actions.searchUsers(keyword));
    } catch {
      renderUserResults({ users: [], reason: "network" });
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
    if (mode === "jump") {
      input.removeAttribute("aria-invalid");
      return;
    }
    selected = 0;
    runQuery(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (mode === "jump" && event.key === "Enter") {
      event.preventDefault();
      const pid = normalizeProblemInput(input.value);
      if (!pid) {
        input.setAttribute("aria-invalid", "true");
        input.select();
        return;
      }
      close();
      actions.openProblem(pid);
      return;
    }
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

  jumpRandom.addEventListener("click", runRandomProblem);
  jumpTrueRandom.addEventListener("click", () => {
    close();
    actions.openUrl("https://www.luogu.com.cn/problem/random", "随机跳题");
  });
  userForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitUserSearch();
  });
  userList.addEventListener("keydown", (event) => {
    const nodes = [...userList.querySelectorAll(".user-search-row")];
    if (!nodes.length) return;
    const index = nodes.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % nodes.length;
    else if (event.key === "ArrowUp") next = index < 0 ? nodes.length - 1 : (index - 1 + nodes.length) % nodes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    if (next < 0) return;
    event.preventDefault();
    nodes[next].focus({ preventScroll: false });
  });

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) return;
    if (event.key === "Tab") {
      event.preventDefault();
      if (mode === "palette" || mode === "jump") input.focus();
      else if (mode === "user") userInput.focus();
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

  function setFeatures(next) {
    featureState = next && typeof next === "object" ? next : {};
  }

  return {
    setFeatures,
    openPalette,
    openJump,
    openRandomJump,
    openUserSearch,
    openSwitcher,
    close,
    isOpen: () => !overlay.hidden,
  };
}
