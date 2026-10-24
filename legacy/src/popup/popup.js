/* LuoguLab — 弹出层渲染
   外壳层把菜单的 HTML（已经带好 data-pop 点击键）发过来，这里只负责摆位置、
   收点击。所有点击都回传给外壳层执行，这一层不持有任何业务逻辑。 */
const root = document.getElementById("pop-root");
let current = {};

function applyTheme(p) {
  const de = document.documentElement;
  // 外壳把整套内联变量（--surface / --ink / 玻璃参数…）原样下发，
  // 覆盖层直接照抄，配色才不会和外壳两样
  if (p.cssText) de.style.cssText = p.cssText;
  de.setAttribute("data-theme", p.theme || "light");
  de.setAttribute("data-glass", p.glass || "flat");
  document.body.dataset.layout = p.layout || "horizontal";
  // 侧栏所在侧（悬停浮层的圆角/投影/展开方向跟着翻面）
  document.body.dataset.side = p.side === "right" ? "right" : "left";
  setWallWin(p.win); // 必须在 cssText 赋值之后（赋值会清掉内联变量）
}
/* 假壁纸的窗口几何：--lg-wall-w/h 是"整个窗口"的宽高（.lg-fake::before 用它
   铺壁纸，偏移走 --pop-x/y）。rect 弹层的视图只有面板那一块，CSS 的
   100vw/100vh 兜底会把壁纸压成一小片——悬停浮层那种整条面板（底色 3% 白）
   看上去几乎就是那张压扁的壁纸，与窄条背后的真壁纸对不上。 */
function setWallWin(win) {
  if (!win || !win.w || !win.h) return;
  const de = document.documentElement;
  de.style.setProperty("--lg-wall-w", Math.round(win.w) + "px");
  de.style.setProperty("--lg-wall-h", Math.round(win.h) + "px");
}

function place(menu, p) {
  menu.hidden = false;
  menu.style.position = "absolute";
  menu.style.visibility = "hidden";
  /* display 不强制 block：菜单自己就是块级，不需要；而悬停浮层（#tab-flyout）
     是 flex 列（列表撑开、脚贴底）、命令面板是 grid（居中）——强行 block 会把
     它们的布局打散（浮层变成"920px 高的空板子"就是这么来的：列表不撑开、
     内容堆在顶上，下面一大片空面板一直盖到坞栏）。 */
  const w = menu.offsetWidth || 240;
  const h = menu.offsetHeight || 0;
  /* 夹取基准必须是"整个窗口"的尺寸（主进程每次 popup:show 都带 payload.win）。
     弹层视图本体的视口在 showPopup 改 bounds 的同一拍里还没跟上——预热态是
     1×1、上一次 rect 弹层留下的是一小块，拿 window.innerWidth 夹取会把贴右缘
     的菜单夹成 left=0、溢出翻转再把 top 推到 8：用户截图的"点右上角账号，
     菜单弹到左上角"就是这个（有时候才出现 = 取决于视口有没有跟上）。 */
  const vw = p.win && p.win.w ? Math.round(p.win.w) : window.innerWidth;
  const vh = p.win && p.win.h ? Math.round(p.win.h) : window.innerHeight;
  // 注意 al/ay 要用 != null 判：悬停浮层就是 al:0（贴左缘），|| 会把 0 当没传
  let left = p.ax != null ? p.ax - w : p.al != null ? p.al : 8;
  left = Math.max(0, Math.min(left, vw - w - 8));
  let top = p.ay != null ? p.ay : 8;
  // 底边放不下就翻到锚点上方（账号菜单带验证码时会很高）；
  // 悬停浮层占满全高，不参与翻转
  if (!p.flyout && top + h > vh - 8) top = Math.max(8, (p.ay || 0) - h - 12);
  menu.style.left = Math.round(left) + "px";
  menu.style.top = Math.round(top) + "px";
  menu.style.visibility = "";
  /* 玻璃菜单的假折射层定位：菜单里的"壁纸副本"按窗口几何绘制，偏移量 =
     菜单在窗口里的真实位置（--pop-x/y 消费在 popup.css 的 ::before 上）。
     用 getBoundingClientRect 读回：#palette 这类被 CSS !important 钉死的
     元素，inline 的 left/top 不是最终位置。 */
  const rr = menu.getBoundingClientRect();
  menu.style.setProperty("--pop-x", Math.round(rr.left) + "px");
  menu.style.setProperty("--pop-y", Math.round(rr.top) + "px");
  // 命令面板：玻璃贴在 pal-box 上（全屏遮罩是调光层，不吃玻璃）
  const inner = menu.querySelector ? menu.querySelector(".pal-box") : null;
  if (inner) {
    const ir = inner.getBoundingClientRect();
    inner.style.setProperty("--pop-x", Math.round(ir.left) + "px");
    inner.style.setProperty("--pop-y", Math.round(ir.top) + "px");
  }
}

/* 矩形模式（fit:"rect"）摆放：量出内容尺寸 → 主进程把弹层视图缩到面板大小
   （夹进窗口、留投影余量）→ 面板在视图内的坐标恒为 (margin,margin)，超限时
   按主进程给的上限滚动。假壁纸的 --pop-x/y 要的是"面板在窗口里的坐标"，
   视图原点 = 面板原点 - margin，换算时补回来。 */
async function fitRect(menu) {
  menu.hidden = false;
  menu.style.position = "absolute";
  menu.style.visibility = "hidden";
  const doFit = async () => {
    const w = Math.ceil(menu.offsetWidth || 240);
    const h = Math.ceil(menu.offsetHeight || 0);
    let r = null;
    try { r = await window.lgPopup.fit({ w, h }); } catch (e) { r = null; }
    if (r && r.ok) {
      menu.style.maxWidth = r.maxW + "px";
      menu.style.maxHeight = r.maxH + "px";
      menu.style.left = r.padL + "px";
      menu.style.top = r.padT + "px";
    } else {
      menu.style.left = "12px";
      menu.style.top = "12px";
    }
    return r;
  };
  let r = await doFit();
  // 被夹住（或 maxHeight 生效后收缩）时实际尺寸会变：再量一次，让弹层视图
  // 与面板严丝合缝——视图比面板大的那圈透明区同样是"吃点击的死区"
  const w1 = Math.ceil(menu.offsetWidth || 0);
  const h1 = Math.ceil(menu.offsetHeight || 0);
  if (r && r.ok) {
    const wantW = Math.min(w1, r.maxW);
    const wantH = Math.min(h1, r.maxH);
    if (wantW !== r.maxW || wantH !== r.maxH) r = (await doFit()) || r;
  }
  menu.style.visibility = "";
  /* 首开动画：外壳在 HTML 上带了 data-anim（只在悬停展开的第一帧）。
     必须等尺寸量完再打 .tf-anim —— 46px 的起始帧若参与测量，弹层视图会
     按窄条宽度缩水，面板长到 248 就被裁掉了。 */
  if (menu.dataset && menu.dataset.anim === "1") {
    menu.removeAttribute("data-anim");
    menu.classList.add("tf-anim");
    menu.addEventListener("animationend", () => menu.classList.remove("tf-anim"), { once: true });
  }
  const rr = menu.getBoundingClientRect();
  const padL = r && r.ok ? r.padL : 12;
  const padT = r && r.ok ? r.padT : 12;
  const ox = r && r.ok ? r.originX : 0;
  const oy = r && r.ok ? r.originY : 0;
  menu.style.setProperty("--pop-x", Math.round(ox - padL + rr.left) + "px");
  menu.style.setProperty("--pop-y", Math.round(oy - padT + rr.top) + "px");
  /* 面板已经画好（坐标、假壁纸、动画类都到位）：回报一声，外壳收到才把窄条
     隐去。交接那一刻面板的 0~46px 与窄条是同一份像素（浮层就是 #vtab 的克隆、
     同矩形同料），所以"窄条先没、面板后到"的那一下闪烁不存在。
     隐藏窗口里 rAF 可能不推进，定时器兜底保证信号一定发得出去。 */
  if (current.flyout && window.lgPopup.flyoutShown) {
    let sent = false;
    const ping = () => { if (sent) return; sent = true; try { window.lgPopup.flyoutShown(); } catch (e) {} };
    try { requestAnimationFrame(() => requestAnimationFrame(ping)); } catch (e) {}
    setTimeout(ping, 48);
  }
}

function show(p) {
  current = p || {};
  applyTheme(current);
  // 菜单内容会按外壳的轮询反复重发（账号切换时每 700ms 一份）：重绘前把
  // 输入框的值按 class 存下来、重绘后回填，用户正在输的验证码不会被清掉。
  const saved = {};
  root.querySelectorAll("input").forEach((inp, i) => {
    if (inp.value) saved[inp.className + "#" + i] = inp.value;
  });
  /* 重绘会替换整棵 DOM：先把"刚才焦点在哪"记下来（验证码输入框 / 面板项），
     重绘后按同一个 id / data-pop / 输入框序号还回去——只保存 value 不还焦点，
     用户每 700ms 就被踢出输入框一次。 */
  const prevActive = document.activeElement;
  const hadFocus = root.contains(prevActive);
  const prevId = prevActive && prevActive.id;
  const prevPopEl = prevActive && prevActive.closest ? prevActive.closest("[data-pop]") : null;
  const prevPop = prevPopEl ? prevPopEl.getAttribute("data-pop") : null;
  const prevInputIdx = prevActive && prevActive.tagName === "INPUT"
    ? [...root.querySelectorAll("input")].indexOf(prevActive)
    : -1;
  const prevInput = prevActive && prevActive.tagName === "INPUT"
    ? /** @type {HTMLInputElement} */ (prevActive)
    : null;
  const prevSel = prevInput && typeof prevInput.selectionStart === "number"
    ? { s: prevInput.selectionStart, e: prevInput.selectionEnd }
    : null;
  root.innerHTML = current.html || "";
  root.querySelectorAll("input").forEach((inp, i) => {
    const k = inp.className + "#" + i;
    if (k in saved) inp.value = saved[k];
  });
  const menu = /** @type {HTMLElement} */ (root.firstElementChild);
  if (!menu) return;
  /* 面的材质类：material.css 的唯一配方（假壁纸背景 + 与外壳/页面同源同值的
     上色 + 发丝线/高光/投影）。命令面板的面在居中的 .pal-box 上（全屏遮罩
     只是调光层），速览的面在顶栏上，其余菜单就是根本身。这一层不再有任何
     自己的材质声明——皮肤差异全在变量里（flat=纯色面、liquid=模糊+高光）。 */
  const faceEl =
    menu.id === "palette" ? menu.querySelector(".pal-box")
    : menu.id === "glance-wrap" ? menu.querySelector(".gl-bar")
    : menu;
  if (faceEl) faceEl.classList.add("lg-fake", "lg-face-b");
  /* 主题变量与面都就位后才允许假壁纸/面色显示；CSS 对未就绪状态兜底透明，
     避免变量缺失时 .lg-fake::after 退回 material.css 的白色兜底。 */
  document.documentElement.setAttribute("data-lg-ready", "1");
  document.body.classList.toggle("lg-flyout", !!current.flyout);
  /* 两种几何：
     - 矩形模式（fit:"rect"：垂直栏悬停浮层、地址栏联想、查找条）：视图只盖面板
       本身，面板外的点击落到网页/外壳上；
     - 全窗模式（命令面板 / 速览壳 / 现有下拉菜单）：覆盖整窗，点空白即关。
     收回：浮层只认主进程的光标裁判（窄条 ∪ 面板并集），这里不做 mouseleave
     自闭合——跨视图的 enter/leave 接力正是当年"悬停闪烁"的来源。 */
  const afterLayout = () => {
    if (current.kind === "palette") setupPalette(menu);
    else if (current.kind === "find") setupFind(menu);
    else if (!current.preview) setupMenuKeys(menu);
    /** @type {HTMLElement|null} */
    let focusEl = null;
    if (hadFocus) {
      if (prevPop) {
        try { focusEl = /** @type {HTMLElement|null} */ (root.querySelector('[data-pop="' + String(prevPop).replace(/"/g, '\\"') + '"]')); } catch (e) {}
      }
      if (!focusEl && prevId) { try { focusEl = /** @type {HTMLElement|null} */ (root.querySelector("#" + CSS.escape(prevId))); } catch (e) {} }
      if (!focusEl && prevInputIdx >= 0) focusEl = [...root.querySelectorAll("input")][prevInputIdx] || null;
    }
    if (!focusEl && current.focus === "input") focusEl = menu.querySelector("input");
    if (!focusEl && current.focus === "view" && !current.kind) {
      try {
        menu.tabIndex = -1;
        // 有输入框（验证码/重命名）时优先给输入框，菜单本体只接键盘导航
        focusEl = menu.querySelector("input") || menu;
      } catch (e) {}
    }
    // 验证码输入框一出现就接住焦点；用户已经点进菜单里就别再抢
    if (!focusEl && !hadFocus) focusEl = menu.querySelector("input");
    if (focusEl) {
      try {
        focusEl.focus();
        const selEl = /** @type {HTMLInputElement} */ (focusEl);
        if (prevSel && typeof selEl.setSelectionRange === "function") {
          selEl.setSelectionRange(prevSel.s, prevSel.e);
        }
      } catch (e) {}
    }
  };
  if (current.fit === "rect") {
    fitRect(menu).then(afterLayout, afterLayout);
  } else {
    if (current.kind !== "glance") place(menu, current); // Glance 壳是全屏结构，自己按内联几何定位
    afterLayout();
  }
}

/* ---------- 命令面板（palette） ----------
   外壳把命令/标签/快捷键渲染成带 data-pal-text 与 data-pop="pal:<i>" 的条目，
   这一层只做本地过滤 + 键盘选择：输入法组字不会触发跨进程往返，列表也不会
   被整份重绘（只切 hidden 与 .on）。 */
function setupPalette(menu) {
  const input = menu.querySelector("#pal-input");
  const list = menu.querySelector("#pal-list");
  if (!input || !list) return;
  const mode = menu.dataset.mode || "cmd";
  let idx = 0;
  const items = () => [...list.querySelectorAll(".pal-item")].filter((el) => !el.hidden);
  const setOn = (n) => {
    const arr = items();
    if (!arr.length) return;
    idx = Math.max(0, Math.min(arr.length - 1, n));
    // 被过滤掉的行也要脱掉 .on：残留的“选中”会让方向键看起来没反应
    list.querySelectorAll(".pal-item.on").forEach((el) => el.classList.remove("on"));
    arr.forEach((el, i) => el.classList.toggle("on", i === idx));
    try { arr[idx].scrollIntoView({ block: "nearest" }); } catch (e) {}
  };
  const filter = () => {
    const q = mode === "keys" ? "" : String(input.value || "").trim().toLowerCase();
    let visible = 0;
    list.querySelectorAll(".pal-item").forEach((el) => {
      const hit = !q || String(el.dataset.palText || "").includes(q);
      el.hidden = !hit;
      if (hit) visible++;
    });
    const head = list.querySelector("#pal-head");
    if (head) {
      const total = Number(head.dataset.total || 0);
      head.textContent = q ? "匹配 " + visible + " / 共 " + total + " 个标签" : "共 " + total + " 个标签";
    }
    const closedHead = list.querySelector(".pal-head-closed");
    if (closedHead) {
      closedHead.hidden = ![...list.querySelectorAll(".pal-item.closed")].some((el) => !el.hidden);
    }
    const empty = list.querySelector(".pal-empty");
    if (empty) empty.hidden = visible > 0;
    idx = 0;
    setOn(0);
  };
  input.addEventListener("input", () => { if (mode !== "keys") filter(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); window.lgPopup.close(); return; }
    if (mode === "keys") return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOn(idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOn(idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); setOn(0); }
    else if (e.key === "End") { e.preventDefault(); setOn(items().length - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const el = items()[idx];
      if (el && el.dataset.pop) window.lgPopup.pick(el.dataset.pop);
    }
  });
  /* 重绘（如标签搜索异步补「最近关闭」）会带回用户已输入的过滤词：这里补跑
     一次过滤，别让列表回退成全量、把用户刚筛好的结果冲掉。 */
  if (mode !== "keys" && String(input.value || "").trim()) filter();
  try { input.focus(); if (!input.value) input.select(); } catch (e) {}
}

/* ---------- 页内查找条（fit:"rect"） ----------
   查找在页面上执行（主进程 lg-app:find 的同一段逻辑），这里只负责输入、计数、
   上一个/下一个与关闭。关闭时同时清掉页面高亮。 */
function setupFind(menu) {
  const input = menu.querySelector("#find-input");
  const count = menu.querySelector("#find-count");
  if (!input || !count) return;
  let timer = null;
  const closeFind = () => {
    try { window.lgPopup.findStop(); } catch (e) {}
    window.lgPopup.close();
  };
  const go = async (findNext, forward) => {
    const text = input.value.trim();
    if (!text) {
      count.textContent = "";
      try { await window.lgPopup.findStop(); } catch (e) {}
      return;
    }
    try {
      const r = await window.lgPopup.find(text, { findNext: !!findNext, forward: forward !== false });
      count.textContent = r && r.ok ? (r.count ? r.count + " 处" : "无结果") : "";
    } catch (e) { count.textContent = ""; }
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => go(false), 80);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); go(true, !e.shiftKey); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  menu.querySelectorAll("[data-find]").forEach((b) => {
    b.addEventListener("click", () => {
      const a = b.getAttribute("data-find");
      if (a === "close") closeFind();
      else go(true, a === "next");
    });
  });
  try { input.focus(); input.select(); } catch (e) {}
}

/* ---------- 普通菜单的键盘导航 ----------
   打开时把焦点放到菜单本体（有输入框时留给输入框），↑↓/Home/End/Tab 在
   [data-pop] 项之间移动，Enter/Space 执行。鼠标流程不变（mousedown 立即执行）。 */
let kbdEls = [];
let kbdIdx = -1;
function setupMenuKeys(menu) {
  kbdEls = [];
  kbdIdx = -1;
  if (current.flyout || current.kind) return;
  kbdEls = [...menu.querySelectorAll("[data-pop]")].filter(
    (el) => !el.hasAttribute("data-drag-row") && el.offsetParent !== null
  );
  try { menu.tabIndex = -1; } catch (e) {}
  if (menu.querySelector("input")) return; // 验证码等输入优先，不抢焦点
  try { menu.focus({ preventScroll: true }); } catch (e) { try { menu.focus(); } catch (e2) {} }
}

/* 菜单项执行：鼠标 mousedown 与键盘 Enter 共用同一条路（data-pop-value 会读回
   输入框的值；data-pop-stay 表示点了不关面板）。 */
function activateEl(hit) {
  if (!hit) return;
  try { document.documentElement.dataset.lgPick = String(hit.getAttribute("data-pop") || ""); } catch (e) {}
  if (hit.hasAttribute("data-drag-row")) return;
  const sel = hit.getAttribute("data-pop-value");
  let v;
  if (sel) {
    const inp = hit.closest("#pop-root > *").querySelector(sel);
    v = inp ? inp.value : "";
  }
  if (hit.hasAttribute("data-pop-stay")) window.lgPopup.pickStay(hit.getAttribute("data-pop"), v);
  else window.lgPopup.pick(hit.getAttribute("data-pop"), v);
}

/* 点菜单项 → 回传点击键；点别处 / Esc → 关闭。
   sticky：账号切换或登录验证码进行中，菜单不许被点掉，否则验证码输入被打断。
   data-pop-stay 标记的项走 pickStay：面板不关（分组面板改色这种点了还要
   留在面板里的操作），内容变了外壳会重发一份。 */
document.addEventListener("mousedown", (e) => {
  const t = /** @type {Element} */ (e.target);
  const hit = t.closest ? t.closest("[data-pop]") : null;
  if (hit) {
    /* 面包屑：探针/排障据此判断"点击键有没有从覆盖层发出去"（链路第一跳） */
    activateEl(hit);
    return;
  }
  if (current.sticky) return;
  if (!t.closest || !t.closest("#pop-root > *")) window.lgPopup.close();
}, true);

/* 普通菜单的键盘导航（命令面板/查找条/悬停浮层有自己的键盘逻辑） */
document.addEventListener("keydown", (e) => {
  if (current.kind === "palette" || current.kind === "find" || current.flyout) return;
  if (!kbdEls.length) return;
  const t = /** @type {Element} */ (e.target);
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  const cur = kbdEls.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
    e.preventDefault();
    kbdIdx = cur >= 0 ? (cur + 1) % kbdEls.length : 0;
    try { kbdEls[kbdIdx].focus(); } catch (err) {}
  } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
    e.preventDefault();
    kbdIdx = cur >= 0 ? (cur - 1 + kbdEls.length) % kbdEls.length : kbdEls.length - 1;
    try { kbdEls[kbdIdx].focus(); } catch (err) {}
  } else if (e.key === "Home") {
    e.preventDefault(); kbdIdx = 0; try { kbdEls[0].focus(); } catch (err) {}
  } else if (e.key === "End") {
    e.preventDefault(); kbdIdx = kbdEls.length - 1; try { kbdEls[kbdIdx].focus(); } catch (err) {}
  } else if (e.key === "Enter" || e.key === " ") {
    const el = cur >= 0 ? kbdEls[cur] : (kbdIdx >= 0 ? kbdEls[kbdIdx] : null);
    if (el) { e.preventDefault(); activateEl(el); }
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !current.sticky) {
    if (current.kind === "find") { try { window.lgPopup.findStop(); } catch (err) {} }
    window.lgPopup.close();
    return;
  }
  // 输入框里回车 = 点带 data-pop-submit 的那个按钮（验证码输入框的
  // keydown 监听器在外壳原节点上，对覆盖层副本无效，只能在这里转一道）
  if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
    const menu = e.target.closest("#pop-root > *");
    const btn = menu ? menu.querySelector("[data-pop-submit]") : null;
    if (btn) {
      e.preventDefault();
      const inp = btn.getAttribute("data-pop-value")
        ? menu.querySelector(btn.getAttribute("data-pop-value"))
        : e.target;
      window.lgPopup.pick(btn.getAttribute("data-pop"), inp ? inp.value : e.target.value);
    }
  }
}, true);

/* 标签行（浮层列表）的右键 / 中键：弹层是独立 webContents，外壳的事件到不了
   这里，所以按 data-tab-id 走主进程——右键弹原生标签菜单（光标处），中键关
   标签。其余区域的右键/拖拽一律压掉（弹层不是网页）。 */
document.addEventListener("contextmenu", (e) => {
  /* 组头这类"右键 = 打开外壳渲染的面板"的元素：带 data-pop-ctx（外壳登记的
     动作键），直接把键回传，外壳负责渲染面板并摆到正确锚点 */
  const ctx = e.target && e.target.closest ? e.target.closest("[data-pop-ctx]") : null;
  if (ctx && window.lgPopup.pick) {
    e.preventDefault();
    window.lgPopup.pick(ctx.getAttribute("data-pop-ctx"));
    return;
  }
  const row = e.target && e.target.closest ? e.target.closest("[data-tab-id]") : null;
  if (row && window.lgPopup.tabContext) {
    e.preventDefault();
    window.lgPopup.tabContext(row.getAttribute("data-tab-id"));
    return;
  }
  e.preventDefault();
});
document.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  const row = e.target && e.target.closest ? e.target.closest("[data-tab-id]") : null;
  if (row && window.lgPopup.tabAux) {
    e.preventDefault();
    window.lgPopup.tabAux(row.getAttribute("data-tab-id"), "close");
  }
});
document.addEventListener("dragstart", (e) => e.preventDefault());

/* ---------- 浮层里的拖拽排序（Edge：悬停展开的那条侧栏也能拖） ----------
   浮层是独立 webContents，外壳的拖拽代码够不到这里，所以这一小段与外壳同规则：
   只报"放到谁前面" + 落点区（pinned / normal），主进程在权威 tabOrder 上落位。
   拖动期间 hold(true)：光标拖出面板时主进程先别把浮层收走（落点还没定）。
   没拖动的按下-抬起 = 点一下切标签（mousedown 那条路对拖拽行已让开）。 */
const ROW_SEL = ".vtab[data-id]";
let vdrag = null;
function clearMarks() {
  root.querySelectorAll(".drop-before, .drop-after, .drop-zone, .drop-merge").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "drop-zone", "drop-merge");
    // 合并高亮用 --gc 染色；分组成员自己就带 --gc（组色），不能一起清
    if (!el.classList.contains("grouped")) el.style.removeProperty("--gc");
  });
}
/* 光标旁的小签（与外壳同观感）：松手会发生什么 */
let tipEl = null;
function dragTip(text, x, y, color) {
  if (!text) {
    if (tipEl) { tipEl.remove(); tipEl = null; }
    return;
  }
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "drag-tip";
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  /* 基础样式（面/线/投影/字号）R41 起由 material.css 的 #drag-tip 单源给——
     弹层与外壳加载同一份；这里只按组色设 --gc（环线与投影随它变色） */
  tipEl.style.setProperty("--gc", color || "var(--hairline)");
  tipEl.style.left = Math.round(x + 14) + "px";
  tipEl.style.top = Math.round(y + 16) + "px";
}
/* 行的组归属（克隆里的 .vgroup[data-gid] 就是它） */
function rowGidOf(el) {
  const g = el && el.closest ? el.closest(".vgroup[data-gid]") : null;
  return g ? Number(g.dataset.gid) : null;
}
function markDrop(row, before) {
  clearMarks();
  if (!row) return;
  row.classList.add(before ? "drop-before" : "drop-after");
  if (row.closest("#vtab-pins")) {
    const pins = root.querySelector("#vtab-pins");
    if (pins) pins.classList.add("drop-zone");
    return;
  }
  /* 分组块：落点行所在的整块 .vgroup 一起高亮（与外壳同一套观感） */
  const grp = row.closest(".vgroup");
  if (grp) grp.classList.add("drop-zone");
}
function endDrag(commit) {
  const d = vdrag;
  vdrag = null;
  if (!d) return;
  d.el.classList.remove("dragging");
  dragTip(null);
  if (window.lgPopup.hold) window.lgPopup.hold(false);
  clearMarks();
  if (!d.moved) {
    // 没拖动 = 点了一下：把行上的动作键回传给外壳（切换标签 + 收起浮层）
    const k = d.el.getAttribute("data-pop");
    if (commit && k) window.lgPopup.pick(k);
    return;
  }
  if (!commit) return;
  /* 整组拖动（R39 补齐，与外壳同语义）：只报锚点，主进程搬整块 */
  if (d.gid != null) {
    if (d.merge && d.merge.anchorId != null) window.lgPopup.groupMove(d.gid, d.merge.anchorId, d.merge.before);
    return;
  }
  /* 拖到标签上 / 拖到组头上（Edge 的建组手势，R38）：与外壳共用主进程通道 */
  if (d.merge && d.merge.kind === "tab") {
    window.lgPopup.groupDrop({ id: d.id, targetId: d.merge.targetId, before: d.merge.before });
    return;
  }
  if (d.merge && d.merge.kind === "group") {
    window.lgPopup.groupDrop({ id: d.id, targetGid: d.merge.targetGid });
    return;
  }
  let next = d.el.nextElementSibling;
  while (next && !next.getAttribute("data-id")) next = next.nextElementSibling;
  let prev = d.el.previousElementSibling;
  while (prev && !prev.getAttribute("data-id")) prev = prev.previousElementSibling;
  const zone = d.el.closest("#vtab-pins") ? "pinned" : "normal";
  /* 邻接进出组推断（R39 补齐，与外壳同语义）：落在某个组块正中间 = 入组；
     拖离自己的组块（两侧都没有本组成员）= 出组。先归属后重排。 */
  const cur = rowGidOf(d.el);
  const prevG = prev ? rowGidOf(prev) : null;
  const nextG = next ? rowGidOf(next) : null;
  (async () => {
    if (zone === "pinned") {
      if (cur != null && window.lgPopup.groupLeave) await window.lgPopup.groupLeave(d.id);
    } else if (prevG != null && prevG === nextG && cur !== prevG && window.lgPopup.groupJoin) {
      await window.lgPopup.groupJoin(d.id, prevG);
    } else if (cur != null && prevG !== cur && nextG !== cur && window.lgPopup.groupLeave) {
      await window.lgPopup.groupLeave(d.id);
    }
    window.lgPopup.tabReorder(d.id, next ? Number(next.getAttribute("data-id")) : null, zone);
  })();
}
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  /* 组头：整组拖动（与外壳同一套语义） */
  const head = e.target.closest ? e.target.closest(".vghead[data-gid]") : null;
  if (head) {
    vdrag = { gid: Number(head.dataset.gid), el: head, sx: e.clientX, sy: e.clientY, moved: false, merge: null, mergeRow: null, mergeKind: null };
    return;
  }
  const row = e.target.closest ? e.target.closest(ROW_SEL) : null;
  if (!row || !row.hasAttribute("data-drag-row")) return;
  if (e.target.closest(".t-close")) return;
  vdrag = { id: Number(row.getAttribute("data-id")), el: row, sx: e.clientX, sy: e.clientY, moved: false, merge: null, mergeRow: null, mergeKind: null };
});
document.addEventListener("pointermove", (e) => {
  if (!vdrag) return;
  /* 指针被别的视图抢走（拖出面板）：这里会看到"拖拽中但主键已经抬起"——
     就地收尾，别把 hold / dragging 状态留下。 */
  if (vdrag.moved && e.buttons === 0) { endDrag(true); return; }
  if (!vdrag.moved) {
    if (Math.abs(e.clientX - vdrag.sx) < 4 && Math.abs(e.clientY - vdrag.sy) < 4) return;
    vdrag.moved = true;
    vdrag.el.classList.add("dragging");
    if (window.lgPopup.hold) window.lgPopup.hold(true);
  }
  const over = document.elementFromPoint(e.clientX, e.clientY);
  if (!over || !over.closest) return;
  /* ---- 整组拖动：落点 = 别的组头 / 别的标签（报锚点 + 前/后） ---- */
  if (vdrag.gid != null) {
    const headEl = over.closest(".vghead[data-gid]");
    const rowEl = over.closest(ROW_SEL);
    let anchorEl = null;
    if (headEl && Number(headEl.dataset.gid) !== vdrag.gid) anchorEl = headEl;
    else if (rowEl && rowEl !== vdrag.el && rowGidOf(rowEl) !== vdrag.gid) anchorEl = rowEl;
    if (!anchorEl) { vdrag.merge = null; dragTip(null); return; }
    const r = anchorEl.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const anchorId = anchorEl.getAttribute("data-id") != null
      ? Number(anchorEl.getAttribute("data-id"))
      : Number((anchorEl.querySelector("[data-id]") || { dataset: {} }).dataset.id);
    vdrag.merge = Number.isFinite(anchorId) ? { anchorId, before } : null;
    clearMarks();
    (anchorEl.closest(".vgroup") || anchorEl).classList.add("drop-zone");
    dragTip("移动分组到这里", e.clientX, e.clientY, null);
    return;
  }
  /* ---- 落点类型判定（与外壳同规则，R38/R39）：组头上 = 加入该组（折叠组也能
     当落点）；标签中段 = 与它建组/并组；其余 = 普通插入。中段带迟滞（进入
     0.3~0.7、退出 0.22~0.78），边界上不再来回横跳。 ---- */
  const head = over.closest(".vghead[data-gid]");
  if (head && Number(head.dataset.gid) !== rowGidOf(vdrag.el)) {
    const gid = Number(head.dataset.gid);
    vdrag.merge = { kind: "group", targetGid: gid };
    vdrag.mergeRow = null;
    vdrag.mergeKind = null;
    clearMarks();
    (head.closest(".vgroup") || head).classList.add("drop-zone");
    const grp = head.closest(".vgroup");
    const col = grp ? grp.style.getPropertyValue("--gc") : "";
    const nmEl = head.querySelector(".g-name");
    dragTip("加入「" + ((nmEl && nmEl.textContent) || "分组") + "」", e.clientX, e.clientY, col);
    return;
  }
  const row = over.closest(ROW_SEL);
  if (!row || row === vdrag.el) {
    vdrag.merge = null; vdrag.mergeRow = null; vdrag.mergeKind = null; dragTip(null);
    return;
  }
  const r = row.getBoundingClientRect();
  const frac = (e.clientY - r.top) / Math.max(1, r.height);
  const latched = vdrag.mergeRow === row && vdrag.mergeKind === "tab";
  const inMerge = !row.closest("#vtab-pins") && (latched ? (frac >= 0.22 && frac <= 0.78) : (frac >= 0.3 && frac <= 0.7));
  if (inMerge) {
    const targetId = Number(row.getAttribute("data-id"));
    vdrag.merge = { kind: "tab", targetId, before: frac < 0.5 };
    vdrag.mergeRow = row;
    vdrag.mergeKind = "tab";
    clearMarks();
    const grp = row.closest(".vgroup");
    const col = grp ? grp.style.getPropertyValue("--gc") : (current.nextColorHex || "#3b82f6");
    row.style.setProperty("--gc", col);
    row.classList.add("drop-merge");
    const nmEl = grp ? grp.querySelector(".vghead .g-name") : null;
    dragTip(grp ? "加入「" + ((nmEl && nmEl.textContent) || "分组") + "」" : "新建分组", e.clientX, e.clientY, col);
    return;
  }
  vdrag.merge = null;
  vdrag.mergeRow = null;
  vdrag.mergeKind = null;
  dragTip(null);
  const before = e.clientY < r.top + r.height / 2;
  row.parentElement.insertBefore(vdrag.el, before ? row : row.nextSibling);
  markDrop(row, before);
});
document.addEventListener("pointerup", () => { if (vdrag) endDrag(true); });
document.addEventListener("pointercancel", () => { if (vdrag) endDrag(false); });

window.lgPopup.onShow(show);
// 窗口缩放：主进程补发窗口尺寸，假壁纸几何跟着更新；全窗模式的菜单还要
// 重摆一次（夹取基准换了一整轮，贴右缘的菜单可能因此翻面/换位）
if (window.lgPopup.onWin) window.lgPopup.onWin((win) => {
  setWallWin(win);
  const menu = root.firstElementChild;
  if (menu && current && current.fit !== "rect" && current.kind !== "glance") {
    current = { ...current, win };
    try { place(menu, current); } catch (e) {}
  }
});
/* 联想列表的选中态（外壳发 popup:sug-sel）：只改类名，不重建 DOM */
if (window.lgPopup.onSugSel) {
  window.lgPopup.onSugSel((i) => {
    root.querySelectorAll("[data-sug-i]").forEach((el) => {
      el.classList.toggle("on", Number(el.getAttribute("data-sug-i")) === Number(i));
    });
  });
}
/* 悬停高亮：把行索引回传给外壳（回车要执行鼠标指着的那一行）。弹层是独立
   webContents，外壳的 mouseover 到不了这里。 */
document.addEventListener("mouseover", (e) => {
  const row = e.target && e.target.closest ? e.target.closest("[data-sug-i]") : null;
  if (!row || !window.lgPopup.sugHover) return;
  window.lgPopup.sugHover(Number(row.getAttribute("data-sug-i")));
});

/* 菜单关闭时清掉菜单内容（弹出层视图本体由主进程藏掉，不吃点击） */
if (window.lgPopup.onClear) window.lgPopup.onClear(() => {
  if (current.kind === "find") { try { window.lgPopup.findStop(); } catch (e) {} }
  root.innerHTML = "";
  current = {};
  kbdEls = [];
  kbdIdx = -1;
  document.body.classList.remove("lg-flyout");
});
