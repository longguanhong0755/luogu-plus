/* 外壳骨架：标题栏、左侧导航、浏览工具条。
   导航完全由主进程下发的 rail 配置驱动，设置里的显隐/排序/自定义链接即时生效。 */
import { icon } from "./icons.js";

export function initChrome(actions) {
  const railTop = document.getElementById("rail-top");
  const railBottom = document.getElementById("rail-bottom");
  const rail = document.getElementById("rail");
  const titleEl = document.getElementById("tb-title");
  const toolbar = document.getElementById("toolbar");
  const homeEl = document.getElementById("home");
  const libraryEl = document.getElementById("library");
  const browseEl = document.getElementById("browse");
  const avatar = document.getElementById("tb-avatar");
  const pin = document.getElementById("rail-pin");
  const jump = document.getElementById("rail-jump");

  let data = null;
  let railSignature = "";
  let toolbarSignature = "";
  let pinState = null;
  let activeId = "";
  let railButtons = new Map();

  function navButton(item) {
    let btn = railButtons.get(item.id);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rail-btn";
      btn.dataset.id = item.id;
      btn.addEventListener("click", () => {
        const current = btn._railItem;
        if (!current) return;
        if (current.kind === "custom") actions.custom({ id: current.id, url: current.url, label: current.label });
        else if (current.kind === "action") actions.settings();
        else actions.nav(current.id);
      });
      railButtons.set(item.id, btn);
    }
    btn._railItem = item;
    btn.title = item.label;
    btn.setAttribute("aria-label", item.label);
    btn.dataset.kind = item.kind;
    btn.innerHTML = icon(item.icon) || icon("dot");
    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = item.label;
    btn.appendChild(label);
    return btn;
  }

  function renderRail(config) {
    const signature = JSON.stringify([config.top, config.bottom]);
    if (signature === railSignature) return;
    railSignature = signature;
    const scrollTop = railTop.scrollTop;
    const focusedId = rail.contains(document.activeElement) ? document.activeElement.dataset.id || "" : "";
    railButtons = new Map(
      [...rail.querySelectorAll(".rail-btn[data-id]")].map((button) => [button.dataset.id, button])
    );
    railTop.textContent = "";
    railBottom.textContent = "";
    appendRailItems(railTop, config.top);
    appendRailItems(railBottom, config.bottom);
    railTop.scrollTop = scrollTop;
    if (focusedId && railButtons.has(focusedId)) railButtons.get(focusedId).focus({ preventScroll: true });
    applyActive(activeId);
  }

  function appendRailItems(container, items) {
    let lastGroup = "";
    for (const item of items) {
      if (item.group && item.group !== lastGroup) {
        const group = document.createElement("div");
        group.className = "rail-group";
        group.dataset.group = item.group;
        const label = document.createElement("span");
        label.className = "rail-group-label";
        label.textContent = item.groupLabel || "";
        group.appendChild(label);
        container.appendChild(group);
        lastGroup = item.group;
      }
      container.appendChild(navButton(item));
    }
  }

  function applyActive(id) {
    activeId = String(id || "");
    for (const button of rail.querySelectorAll(".rail-btn[data-id]")) {
      const on = button.dataset.id === activeId && button.dataset.kind !== "action";
      button.classList.toggle("active", on);
      if (on) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  function updateAvatar(user) {
    const url = user && user.avatar ? String(user.avatar) : "";
    if (url) {
      if (avatar.dataset.url !== url) {
        avatar.dataset.url = url;
        avatar.textContent = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = (user && user.name) || "头像";
        avatar.appendChild(img);
      }
      avatar.classList.toggle("guest", false);
    } else {
      if (avatar.dataset.url) {
        avatar.dataset.url = "";
        avatar.textContent = "";
      }
      if (!avatar.textContent) avatar.textContent = "洛";
      avatar.classList.toggle("guest", !(user && user.loggedIn));
    }
  }

  function syncPin(pinned) {
    if (pinState === !!pinned) return;
    pinState = !!pinned;
    document.body.classList.toggle("rail-pinned", !!pinned);
    pin.classList.toggle("on", !!pinned);
    pin.setAttribute("aria-pressed", pinned ? "true" : "false");
    pin.innerHTML = icon(pinned ? "pin" : "pinOff");
    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = pinned ? "收起侧栏" : "展开侧栏";
    pin.appendChild(label);
    pin.title = pinned ? "收起侧栏（Ctrl+B）" : "展开侧栏（Ctrl+B）";
    pin.setAttribute("aria-label", pin.title);
  }

  function update(next) {
    data = next;
    const railWidth = Number(next.rail && next.rail.width);
    const width = Number.isFinite(railWidth) && railWidth > 0 ? railWidth : next.rail.pinned ? 208 : 64;
    document.documentElement.style.setProperty("--rail-current-w", width + "px");
    renderRail(next.rail);
    syncPin(next.rail.pinned);
    applyActive(next.page.railId);
    const page = next.page;
    titleEl.textContent = page.home ? "主页" : page.title || "";
    if (page.library) titleEl.textContent = (next.rail.all.find((item) => item.id === page.library) || {}).label || page.title;
    titleEl.title = titleEl.textContent;

    homeEl.hidden = !page.home;
    libraryEl.hidden = !page.library;
    browseEl.hidden = page.home || !!page.library;

    updateAvatar(next.user);

    if (!page.home && !page.library) renderToolbar(page);
    else {
      toolbar.textContent = "";
      toolbarSignature = "";
    }
  }

  function renderToolbar(page) {
    const signature = JSON.stringify([
      page.title,
      !!page.canBack,
      !!page.canForward,
      !!page.canReopen,
      !!page.isProblem,
      page.pid || "",
      !!page.ide,
    ]);
    if (signature === toolbarSignature) return;
    toolbarSignature = signature;
    toolbar.textContent = "";

    const nav = document.createElement("div");
    nav.className = "tb-nav";
    const back = iconButton("back", "后退", () => actions.view("back"));
    back.disabled = !page.canBack;
    const forward = iconButton("forward", "前进", () => actions.view("forward"));
    forward.disabled = !page.canForward;
    const reload = iconButton("refresh", "刷新", () => actions.view("reload"));
    const reopen = iconButton("reopen", "恢复关闭的页面（Ctrl+Shift+T）", () => actions.view("reopen"));
    reopen.disabled = !page.canReopen;
    nav.appendChild(back);
    nav.appendChild(forward);
    nav.appendChild(reload);
    nav.appendChild(reopen);
    toolbar.appendChild(nav);

    const sep = document.createElement("span");
    sep.className = "tb-sep-v";
    toolbar.appendChild(sep);

    const crumbs = document.createElement("div");
    crumbs.id = "crumbs";
    crumbs.textContent = page.title || "";
    crumbs.title = page.title || "";
    toolbar.appendChild(crumbs);

    if (page.isProblem) {
      const group = document.createElement("div");
      group.className = "tb-actions";
      group.appendChild(textButton(icon("list") + "提交记录", () => actions.problem({ action: "records", pid: page.pid })));
      group.appendChild(textButton(icon("article") + "题解", () => actions.problem({ action: "solutions", pid: page.pid })));
      const ide = textButton(icon("code") + "IDE", () => actions.ide(!page.ide));
      if (page.ide) {
        ide.classList.add("primary");
        ide.setAttribute("aria-pressed", "true");
      } else {
        ide.setAttribute("aria-pressed", "false");
      }
      group.appendChild(ide);
      toolbar.appendChild(group);
    }

    toolbar.appendChild(iconButton("external", "在浏览器打开", () => actions.view("external")));
  }

  function iconButton(name, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon(name);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function textButton(html, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbtn";
    btn.innerHTML = html;
    btn.addEventListener("click", onClick);
    return btn;
  }

  jump.dataset.id = "jump";
  jump.dataset.kind = "action";
  jump.innerHTML = icon("search");
  const jumpLabel = document.createElement("span");
  jumpLabel.className = "rail-label";
  jumpLabel.textContent = "题号跳转";
  jump.appendChild(jumpLabel);
  jump.addEventListener("click", () => actions.openJump());

  pin.addEventListener("click", () => {
    const next = !(data && data.rail && data.rail.pinned);
    syncPin(next);
    actions.setRailPinned(next);
  });

  function railFocusables() {
    return [...rail.querySelectorAll(".rail-btn:not([disabled])")].filter((button) => button.offsetParent !== null);
  }

  function focusRail() {
    const active = railButtons.get(activeId);
    const target = (active && active.offsetParent !== null && active) || railFocusables()[0];
    if (target) target.focus({ preventScroll: true });
  }

  rail.addEventListener("keydown", (event) => {
    const buttons = railFocusables();
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Escape" || (event.key === "F6" && event.shiftKey)) {
      event.preventDefault();
      actions.focusPage();
      return;
    }
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next < 0 || !buttons[next]) return;
    event.preventDefault();
    buttons[next].focus({ preventScroll: false });
  });

  avatar.addEventListener("click", () => actions.profile());

  return {
    update,
    setRailWidth(width) {
      document.documentElement.style.setProperty("--rail-current-w", Math.round(width) + "px");
    },
    focusRail,
    get data() {
      return data;
    },
  };
}
