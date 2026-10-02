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
  const vw = window.innerWidth;
  const vh = window.innerHeight;
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
     按窄条宽度缩水，面板长到 212 就被裁掉了。 */
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
  // 输入框的值按 class 存下来、重绘后回填，用户正在输的验证码不会被清掉
  const saved = {};
  root.querySelectorAll("input").forEach((inp, i) => {
    if (inp.value) saved[inp.className + "#" + i] = inp.value;
  });
  const hadFocus = root.contains(document.activeElement);
  root.innerHTML = current.html || "";
  root.querySelectorAll("input").forEach((inp, i) => {
    const k = inp.className + "#" + i;
    if (k in saved) inp.value = saved[k];
  });
  const menu = root.firstElementChild;
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
  document.body.classList.toggle("lg-flyout", !!current.flyout);
  /* 两种几何：
     - 矩形模式（fit:"rect"：垂直栏悬停浮层、地址栏联想）：视图只盖面板本身，
       面板外的点击落到网页/外壳上；
     - 全窗模式（命令面板 / 速览壳 / 现有下拉菜单）：覆盖整窗，点空白即关。
     收回：浮层只认主进程的光标裁判（窄条 ∪ 面板并集），这里不做 mouseleave
     自闭合——跨视图的 enter/leave 接力正是当年"悬停闪烁"的来源。 */
  if (current.fit === "rect") fitRect(menu);
  else if (current.kind !== "glance") place(menu, current); // Glance 壳是全屏结构，自己按内联几何定位
  // 验证码输入框一出现就接住焦点；用户已经点进菜单里就别再抢
  if (!hadFocus) {
    const cap = menu.querySelector("input");
    if (cap) setTimeout(() => { try { cap.focus(); } catch (e) {} }, 30);
  }
}

/* 点菜单项 → 回传点击键；点别处 / Esc → 关闭。
   sticky：账号切换或登录验证码进行中，菜单不许被点掉，否则验证码输入被打断。
   data-pop-stay 标记的项走 pickStay：面板不关（分组面板改色这种点了还要
   留在面板里的操作），内容变了外壳会重发一份。 */
document.addEventListener("mousedown", (e) => {
  const hit = e.target.closest ? e.target.closest("[data-pop]") : null;
  if (hit) {
    /* 浮层里的标签行：按下不动作（否则一按下就切走了，根本拖不起来）。
       点一下的动作改在 pointerup 里补（没拖动才算点击）。 */
    if (hit.hasAttribute("data-drag-row")) return;
    // data-pop-value 标记的项要带一个输入框的值回去（验证码提交）
    const sel = hit.getAttribute("data-pop-value");
    let v;
    if (sel) {
      const inp = hit.closest("#pop-root > *").querySelector(sel);
      v = inp ? inp.value : "";
    }
    if (hit.hasAttribute("data-pop-stay")) window.lgPopup.pickStay(hit.getAttribute("data-pop"), v);
    else window.lgPopup.pick(hit.getAttribute("data-pop"), v);
    return;
  }
  if (current.sticky) return;
  if (!e.target.closest || !e.target.closest("#pop-root > *")) window.lgPopup.close();
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !current.sticky) { window.lgPopup.close(); return; }
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
  root.querySelectorAll(".drop-before, .drop-after, .drop-zone").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "drop-zone");
  });
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
  let chip = row.previousElementSibling;
  while (chip && !chip.classList.contains("vgchip")) {
    if (!chip.classList.contains("vtab")) break;
    chip = chip.previousElementSibling;
  }
  if (!chip || !chip.classList.contains("vgchip")) return;
  chip.classList.add("drop-zone");
  for (let el = chip.nextElementSibling; el && !el.classList.contains("vgchip"); el = el.nextElementSibling) {
    if (el.classList.contains("vtab")) el.classList.add("drop-zone");
  }
}
function endDrag(commit) {
  const d = vdrag;
  vdrag = null;
  if (!d) return;
  d.el.classList.remove("dragging");
  if (window.lgPopup.hold) window.lgPopup.hold(false);
  clearMarks();
  if (!d.moved) {
    // 没拖动 = 点了一下：把行上的动作键回传给外壳（切换标签 + 收起浮层）
    const k = d.el.getAttribute("data-pop");
    if (commit && k) window.lgPopup.pick(k);
    return;
  }
  if (!commit) return;
  let next = d.el.nextElementSibling;
  while (next && !next.getAttribute("data-id")) next = next.nextElementSibling;
  const zone = d.el.closest("#vtab-pins") ? "pinned" : "normal";
  window.lgPopup.tabReorder(d.id, next ? Number(next.getAttribute("data-id")) : null, zone);
}
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const row = e.target.closest ? e.target.closest(ROW_SEL) : null;
  if (!row || !row.hasAttribute("data-drag-row")) return;
  if (e.target.closest(".t-close")) return;
  vdrag = { id: Number(row.getAttribute("data-id")), el: row, sx: e.clientX, sy: e.clientY, moved: false };
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
  const row = over && over.closest ? over.closest(ROW_SEL) : null;
  if (!row || row === vdrag.el) return;
  const r = row.getBoundingClientRect();
  const before = e.clientY < r.top + r.height / 2;
  row.parentElement.insertBefore(vdrag.el, before ? row : row.nextSibling);
  markDrop(row, before);
});
document.addEventListener("pointerup", () => { if (vdrag) endDrag(true); });
document.addEventListener("pointercancel", () => { if (vdrag) endDrag(false); });

/* ---------- 悬停卡片（与外壳侧同一套） ----------
   在浮层的标签行上停住约 0.5 秒 → 面板外侧浮出图标 + 完整标题 + 网址。
   浮层文档的坐标原点就是窗口原点（面板左上角 = 窗口左上角），rect 直接可用。 */
let tipTimer = null;
let tipId = null;
function tipCancel() {
  clearTimeout(tipTimer);
  tipId = null;
  if (window.lgPopup.tabTipHide) window.lgPopup.tabTipHide();
}
function tipSchedule(row) {
  const id = row.getAttribute("data-id");
  if (tipId === id) return;
  clearTimeout(tipTimer);
  tipId = id;
  if (vdrag) return;
  tipTimer = setTimeout(() => {
    const tEl = row.querySelector(".t-title");
    const img = row.querySelector(".t-icon img");
    const r = row.getBoundingClientRect();
    window.lgPopup.tabTip({
      title: tEl ? tEl.textContent : "",
      url: row.getAttribute("data-url") || "",
      favicon: img ? img.src : "",
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      cssText: document.documentElement.style.cssText || "",
      theme: document.documentElement.getAttribute("data-theme") || "light",
      glass: document.documentElement.getAttribute("data-glass") || "flat",
    });
  }, 520);
}
document.addEventListener("mouseover", (e) => {
  const row = e.target && e.target.closest ? e.target.closest(ROW_SEL) : null;
  if (row) tipSchedule(row);
  else tipCancel();
});
document.addEventListener("mouseleave", tipCancel);

window.lgPopup.onShow(show);
// 窗口缩放：主进程补发窗口尺寸，假壁纸几何跟着更新
if (window.lgPopup.onWin) window.lgPopup.onWin(setWallWin);

/* 菜单关闭时清掉菜单内容（弹出层视图本体由主进程藏掉，不吃点击） */
if (window.lgPopup.onClear) window.lgPopup.onClear(() => {
  root.innerHTML = "";
  document.body.classList.remove("lg-flyout");
});
