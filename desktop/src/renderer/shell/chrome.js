/* 外壳骨架：标题栏标题、左侧导航、浏览工具条。只有状态更新，不做业务。 */
import { icon } from "./icons.js";

const NAV = [
  { id: "home", label: "主页", icon: "home" },
  { id: "problems", label: "题库", icon: "library" },
  { id: "training", label: "训练", icon: "training" },
  { id: "contest", label: "比赛", icon: "contest" },
  { id: "discuss", label: "讨论", icon: "discuss" },
  { id: "record", label: "记录", icon: "record" },
];

export function initChrome(actions) {
  const rail = document.getElementById("rail");
  const titleEl = document.getElementById("tb-title");
  const toolbar = document.getElementById("toolbar");
  const homeEl = document.getElementById("home");
  const browseEl = document.getElementById("browse");

  const avatar = document.createElement("button");
  avatar.className = "rail-avatar";
  avatar.title = "个人主页";
  avatar.type = "button";
  avatar.textContent = "洛";
  avatar.addEventListener("click", () => actions.profile());
  rail.appendChild(avatar);

  const buttons = new Map();
  for (const item of NAV) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-btn";
    btn.title = item.label;
    btn.innerHTML = icon(item.icon);
    btn.addEventListener("click", () => actions.nav(item.id));
    rail.appendChild(btn);
    buttons.set(item.id, btn);
  }

  const spacer = document.createElement("div");
  spacer.className = "rail-spacer";
  rail.appendChild(spacer);

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "rail-btn";
  settings.title = "设置";
  settings.innerHTML = icon("settings");
  settings.addEventListener("click", () => actions.settings());
  rail.appendChild(settings);

  let data = null;

  function update(next) {
    data = next;
    const page = next.page;
    titleEl.textContent = page.home ? "主页" : page.title || "";

    homeEl.hidden = !page.home;
    browseEl.hidden = page.home;

    for (const [id, btn] of buttons) {
      btn.classList.toggle("active", page.home ? id === "home" : id === activeSection(page));
    }

    avatar.classList.toggle("active", page.kind === "profile");
    if (next.user && next.user.avatar) {
      if (avatar.dataset.url !== next.user.avatar) {
        avatar.dataset.url = next.user.avatar;
        avatar.textContent = "";
        const img = document.createElement("img");
        img.src = next.user.avatar;
        img.alt = next.user.name || "头像";
        avatar.appendChild(img);
      }
    } else if (avatar.dataset.url) {
      avatar.dataset.url = "";
      avatar.textContent = "洛";
    }

    if (!page.home) renderToolbar(page);
  }

  function activeSection(page) {
    if (page.kind === "section") return String(page.key).replace("section:", "");
    if (page.kind === "problem") return "problems";
    if (page.kind === "login") return "home";
    return "";
  }

  function renderToolbar(page) {
    toolbar.textContent = "";

    const back = iconButton("back", "后退", () => actions.view("back"));
    back.disabled = !page.canBack;
    const forward = iconButton("forward", "前进", () => actions.view("forward"));
    forward.disabled = !page.canForward;
    toolbar.appendChild(back);
    toolbar.appendChild(forward);
    toolbar.appendChild(iconButton("refresh", "刷新", () => actions.view("reload")));

    const sep = document.createElement("span");
    sep.className = "tb-sep-v";
    toolbar.appendChild(sep);

    const crumbs = document.createElement("div");
    crumbs.id = "crumbs";
    crumbs.textContent = page.title || "";
    toolbar.appendChild(crumbs);

    if (page.isProblem) {
      toolbar.appendChild(textButton(icon("list") + "提交记录", () => actions.problem({ action: "records", pid: page.pid })));
      toolbar.appendChild(textButton(icon("discuss") + "题解", () => actions.problem({ action: "solutions", pid: page.pid })));
      const ide = textButton(icon("code") + "IDE", () => actions.ide(!page.ide));
      if (page.ide) ide.classList.add("primary");
      toolbar.appendChild(ide);
    }

    toolbar.appendChild(textButton(icon("external") + "浏览器", () => actions.view("external")));
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

  return { update, get data() { return data; } };
}
