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
  const jumpForm = document.getElementById("rail-jump");
  const jumpInput = document.getElementById("rail-jump-input");
  const railUser = document.getElementById("rail-user");

  let data = null;
  let railSignature = "";
  let toolbarSignature = "";
  let pinState = null;
  let hoverTimer = 0;

  function navButton(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-btn";
    btn.title = item.label;
    btn.setAttribute("aria-label", item.label);
    btn.dataset.id = item.id;
    btn.innerHTML = icon(item.icon) || icon("dot");
    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = item.label;
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      if (item.kind === "custom") actions.custom(item.url, item.label);
      else if (item.kind === "action") actions.settings();
      else actions.nav(item.id);
    });
    return btn;
  }

  function renderRail(config) {
    const signature = JSON.stringify([config.top, config.bottom]);
    if (signature === railSignature) return;
    railSignature = signature;
    railTop.textContent = "";
    railBottom.textContent = "";
    appendRailItems(railTop, config.top);
    appendRailItems(railBottom, config.bottom);
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

  function updateRailUser(user) {
    if (!railUser) return;
    const logged = !!(user && user.loggedIn);
    const name = logged ? String(user.name || "我的洛谷") : "未登录";
    const sub = logged ? "个人主页" : "点击登录";
    railUser.classList.toggle("guest", !logged);
    railUser.title = name + " · " + sub;
    railUser.setAttribute("aria-label", name + "，" + sub);
    const nameEl = railUser.querySelector(".rail-user-name");
    const subEl = railUser.querySelector(".rail-user-sub");
    if (nameEl) nameEl.textContent = name;
    if (subEl) subEl.textContent = sub;
    const box = railUser.querySelector(".rail-user-avatar");
    if (!box) return;
    const url = logged && user.avatar ? String(user.avatar) : "";
    if (url) {
      if (box.dataset.url !== url) {
        box.dataset.url = url;
        box.textContent = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        box.appendChild(img);
      }
    } else {
      box.dataset.url = "";
      box.textContent = "洛";
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
    pin.title = pinned ? "取消固定（回到折叠，悬停自动展开）" : "固定侧栏（常驻展开）";
    pin.setAttribute("aria-label", pin.title);
  }

  function update(next) {
    data = next;
    renderRail(next.rail);
    syncPin(next.rail.pinned);
    const page = next.page;
    titleEl.textContent = page.home ? "主页" : page.title || "";
    if (page.library) titleEl.textContent = (next.rail.all.find((item) => item.id === page.library) || {}).label || page.title;
    titleEl.title = titleEl.textContent;

    homeEl.hidden = !page.home;
    libraryEl.hidden = !page.library;
    browseEl.hidden = page.home || !!page.library;

    // 侧栏只做入口，不表示当前页面：所有页面都不高亮
    updateAvatar(next.user);
    updateRailUser(next.user);

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

  jumpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = jumpInput.value.trim();
    const match = raw.match(/^([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)$/);
    if (!match) {
      jumpForm.classList.add("bad");
      setTimeout(() => jumpForm.classList.remove("bad"), 900);
      jumpInput.select();
      return;
    }
    jumpInput.value = "";
    jumpInput.blur();
    actions.openProblem(match[1]); // 规范化（AT_ 小写形等）在主进程单源完成
  });

  jumpForm.addEventListener("click", (event) => {
    if (!data || !data.rail) return;
    if (data.rail.pinned) {
      if (event.target !== jumpInput) jumpInput.focus();
      return;
    }
    event.preventDefault();
    actions.railHover({ open: true, focus: "jump" });
  });

  jumpInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      jumpInput.value = "";
      jumpInput.blur();
    }
  });

  pin.addEventListener("click", () => {
    const next = !(data && data.rail && data.rail.pinned);
    syncPin(next);
    actions.setRailPinned(next);
  });

  rail.addEventListener("mouseenter", () => {
    if (!data || !data.rail || data.rail.pinned) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    // 悬停意图：掠过侧栏不展开，停留 ~70ms 才展开
    hoverTimer = setTimeout(() => {
      hoverTimer = 0;
      if (data && data.rail && !data.rail.pinned) actions.railHover(true);
    }, 70);
  });
  rail.addEventListener("mouseleave", () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = 0;
    actions.railHover(false);
  });

  if (railUser) {
    railUser.addEventListener("click", () => {
      const logged = !!(data && data.user && data.user.loggedIn);
      if (data && data.rail && !data.rail.pinned) actions.railHover(false);
      if (logged) actions.profile();
      else actions.nav("login");
    });
  }

  avatar.addEventListener("click", () => actions.profile());

  return {
    update,
    get data() {
      return data;
    },
  };
}
