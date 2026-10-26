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
  const jumpForm = document.getElementById("rail-jump");
  const jumpInput = document.getElementById("rail-jump-input");

  let data = null;
  let railSignature = "";
  let toolbarSignature = "";
  let buttons = new Map();

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
    buttons = new Map();
    for (const item of config.top) {
      const btn = navButton(item);
      railTop.appendChild(btn);
      buttons.set(item.id, btn);
    }
    for (const item of config.bottom) {
      const btn = navButton(item);
      railBottom.appendChild(btn);
      buttons.set(item.id, btn);
    }
    rail.classList.toggle("empty-top", !config.top.length);
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

  function activeId(page) {
    if (page.home) return "home";
    if (page.library) return page.library;
    if (page.section) return page.section;
    if (page.kind === "problem" || page.kind === "detail") return "problems";
    return "";
  }

  function update(next) {
    data = next;
    renderRail(next.rail);
    const page = next.page;
    const active = activeId(page);
    titleEl.textContent = page.home ? "主页" : page.title || "";
    if (page.library) titleEl.textContent = (next.rail.all.find((item) => item.id === page.library) || {}).label || page.title;

    homeEl.hidden = !page.home;
    libraryEl.hidden = !page.library;
    browseEl.hidden = page.home || !!page.library;

    for (const [id, btn] of buttons) {
      const on = id === active;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }
    avatar.classList.toggle("active", page.kind === "profile");
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
    nav.appendChild(back);
    nav.appendChild(forward);
    nav.appendChild(reload);
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
    const match = raw.match(/^([A-Za-z]{1,4}\d+[A-Za-z0-9]*)$/);
    if (!match) {
      jumpForm.classList.add("bad");
      setTimeout(() => jumpForm.classList.remove("bad"), 900);
      jumpInput.select();
      return;
    }
    jumpInput.value = "";
    jumpInput.blur();
    actions.openProblem(match[1].toUpperCase());
  });

  jumpInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      jumpInput.value = "";
      jumpInput.blur();
    }
  });

  avatar.addEventListener("click", () => actions.profile());

  return {
    update,
    get data() {
      return data;
    },
  };
}
