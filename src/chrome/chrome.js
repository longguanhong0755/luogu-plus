/* ============================================================
   Luogu++ — chrome 层逻辑（标签条 / 浏览器式工具行 / 侧坞 / 账号）
   数据流：main → onTabs/onUser/onConfig/onAccounts 推送；chrome → invoke 动作。
   ============================================================ */
/* 图标唯一来源：R41 起收口到 src/icons.js（外壳/首页/设置/历史四页共享
   同一份线稿——此前三页各养一份"同一份线稿"实为三套不同路径，坞里画一套、
   设置页预览另一套）。这里只留别名，DOCK_ICONS 名称表保留。 */
const ICONS = window.LGIcons.PATHS;
/* 工具行不再放站点快捷钮（题库/题单等入口移到侧坞，可自定义） */
const DOCK_ICONS = ["home", "list", "book", "trophy", "chat", "clock", "code", "sliders", "star", "download", "page"];

/* 垂直栏几何唯一来源（src/vtab-spec.js，Edge 149 实测）。启动时把同一份值写成
   CSS 变量——CSS 里的字面量只是首帧兜底，运行时以这份为准。 */
const VTAB_SPEC = window.LG_VTAB_SPEC || {
  paneW: 248, railW: 41, edgeW: 4, topBarH: 80, headerH: 40, headerBtn: 32,
  headerPad: 4, tabH: 32, tabInsetX: 4, tabW: 240, closeSize: 16, closeTop: 8,
  closeRight: 8, newTabGap: 9, resizeW: 4, radius: 4, font: 12, minW: 160, maxW: 400,
};
(function applyVtabSpecVars() {
  const vars = {
    "--vtab-w": VTAB_SPEC.paneW,
    "--vtab-rail": VTAB_SPEC.railW,
    "--vtab-edge": VTAB_SPEC.edgeW,
    "--vtab-head-h": VTAB_SPEC.headerH,
    "--vtab-head-btn": VTAB_SPEC.headerBtn,
    "--vtab-head-pad": VTAB_SPEC.headerPad,
    "--vtab-tab-h": VTAB_SPEC.tabH,
    "--vtab-tab-x": VTAB_SPEC.tabInsetX,
    "--vtab-tab-w": VTAB_SPEC.tabW,
    "--vtab-close": VTAB_SPEC.closeSize,
    "--vtab-close-top": VTAB_SPEC.closeTop,
    "--vtab-close-right": VTAB_SPEC.closeRight,
    "--vtab-new-offset": VTAB_SPEC.newTabGap,
    "--vtab-resize-w": VTAB_SPEC.resizeW,
    "--vtab-radius": VTAB_SPEC.radius,
    "--vtab-font": VTAB_SPEC.font,
  };
  const s = document.documentElement.style;
  for (const k of Object.keys(vars)) s.setProperty(k, vars[k] + "px");
})();

function svg(name, attrs) {
  return window.LGIcons.svg(name, attrs);
}

let tabsState = { tabs: [], activeId: null };
let userState = null;
let accountsState = { accounts: [], activeId: "" };
let cfgState = {};

/* ---------- omnibox 解析（纯函数，自测可直接调用） ----------
   优先级：映射词 > 完整URL > luogu域名省写 > 站内路径 > 题号 > UID > 搜索。
   搜索回退吃 cfg.searchTemplate（搜索引擎唯一来源在主进程）：洛谷引擎保持
   站内导航（锁域），其余引擎返回 external（开站外共享会话的新标签）。 */
function resolveOmnibox(raw, mappings, searchTpl, searchIsLuogu) {
  const input = (raw || "").trim();
  if (!input) return null;
  const map = mappings || {};
  if (Object.prototype.hasOwnProperty.call(map, input) && map[input]) {
    return { type: "mapping", url: map[input] };
  }
  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      if (/(^|\.)luogu\.com\.cn$/i.test(u.hostname)) return { type: "luogu", url: input };
      return { type: "external", url: input };
    } catch (e) { /* 继续按文本处理 */ }
  }
  if (/^(www\.)?luogu\.com\.cn(\/|$)/i.test(input)) return { type: "luogu", url: "https://" + input };
  if (input.charAt(0) === "/") return { type: "luogu", url: input };
  /* 裸域名（chat.deepseek.com / github.com）：没有 scheme 但长得像域名，
     之前会掉进"站内搜索"把域名当关键词搜掉 —— 补在这里。含空格/中文的
     搜索词不会误判（它们过不了域名字符集这一关）。 */
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(:\d+)?(\/\S*)?$/i.test(input)) {
    return { type: "external", url: "https://" + input };
  }
  /* localhost / 内网主机名（R39）：单段主机名（没有点）以前一律掉进搜索，
     localhost:3000、my-server:8080 这种明确的地址意图被搜掉。本机与内网
     默认按 http 试（Chrome 同款）；带 scheme 的输入走上面的分支不受影响。 */
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/\S*)?$/i.test(input) ||
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:\d+(\/\S*)?$/i.test(input)) {
    return { type: "external", url: "http://" + input };
  }
  if (/^[a-z]\d+$/i.test(input)) {
    return { type: "luogu", url: "https://www.luogu.com.cn/problem/" + input.toUpperCase() };
  }
  if (/^\d+$/.test(input)) return { type: "luogu", url: "https://www.luogu.com.cn/user/" + input };
  const tpl = typeof searchTpl === "string" && searchTpl.includes("%s")
    ? searchTpl
    : "https://www.luogu.com.cn/search?keyword=%s";
  const luogu = searchIsLuogu !== false && /luogu\.com\.cn/i.test(tpl);
  return { type: luogu ? "luogu" : "external", url: tpl.replace("%s", encodeURIComponent(input)) };
}
window.resolveOmnibox = resolveOmnibox;

/* ---------- 标签：同一份数据渲染两套容器（顶部条 / 垂直栏） ---------- */
function tabTitleOf(t) {
  if (!t) return "";
  return t.title || (t.url || "").replace(/^https?:\/\/[^/]+/, "") || "新标签页";
}
/* 图标来源指纹：增量更新只在来源变了时替换 .t-icon，避免标题/加载态更新
   把正在悬停的 favicon 重新插一遍（会闪，也会重置图片解码）。 */
function tabIconKey(t) {
  if (!t) return "";
  if (t.kind === "settings") return "settings";
  if (t.kind === "home") return "home";
  if (!t.special && t.favicon) return "fav:" + t.favicon;
  return "glyph:" + (t.special ? "code" : "page");
}
function tabIcon(t) {
  const icon = document.createElement("span");
  icon.className = "t-icon";
  if (t.kind === "settings") {
    icon.innerHTML = svg("sliders");
  } else if (t.kind === "home") {
    icon.innerHTML = svg("home");
  } else if (!t.special && t.favicon) {
    const f = document.createElement("img");
    f.src = t.favicon;
    f.onerror = () => {
      f.remove();
      icon.innerHTML = svg("page");
    };
    icon.appendChild(f);
  } else {
    icon.innerHTML = svg(t.special ? "code" : "page");
  }
  return icon;
}
/* ---------- 多选（Edge：Ctrl+点加选 / Shift+点连选 → 右键"用选中的标签新建分组"） ----------
   只在标签行上生效；普通点击 / Esc / 切换标签即清空。选择集是外壳的界面状态，
   主进程不持有——开标签右键菜单时随 IPC 一起递过去（原生菜单由主进程建）。 */
let selIds = [];
let selAnchor = null;
function selPaint() {
  for (const el of document.querySelectorAll(".tab.sel, .vtab.sel")) el.classList.remove("sel");
  for (const id of selIds) {
    for (const el of document.querySelectorAll('.tab[data-id="' + id + '"], .vtab[data-id="' + id + '"]')) el.classList.add("sel");
  }
}
function selClear() {
  if (!selIds.length) return;
  selIds = [];
  selAnchor = null;
  selPaint();
}
function selToggle(id) {
  const i = selIds.indexOf(id);
  if (i >= 0) selIds.splice(i, 1);
  else selIds.push(id);
  selAnchor = id;
  selPaint();
}
function selRange(id) {
  const all = tabsState.tabs.map((t) => t.id);
  const a = all.indexOf(selAnchor == null ? id : selAnchor);
  const b = all.indexOf(id);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  selIds = all.slice(lo, hi + 1);
  selPaint();
}

/* 关闭动画：先让行淡出/收拢 120ms，再真正销毁（主进程侧仍是立即关）。
   拖拽/重渲期间元素可能已被替换，找不到就直接关。 */
function closeTabAnimated(id) {
  const el = document.querySelector('#tabs .tab[data-id="' + id + '"], #vtabs .vtab[data-id="' + id + '"]');
  if (!el) { window.lgChrome.closeTab(id); return; }
  el.classList.add("closing");
  setTimeout(() => window.lgChrome.closeTab(id), 120);
}

function buildTabEl(t, cls) {
  const el = document.createElement("div");
  el.dataset.id = String(t.id);
  el.className = cls + (t.id === tabsState.activeId ? " active" : "") + (t.special ? " special" : "") + (t.loading ? " loading" : "") + (t.pinned ? " pinned" : "");
  // 分组成员：标签底部压一条组色线（Edge 的组色贯穿效果）
  if (t.group != null) {
    const g = groupById(t.group);
    if (g) {
      el.classList.add("grouped");
      el.style.setProperty("--gc", GROUP_COLORS[g.color] || GROUP_COLORS.gray);
      if (g.name) el.dataset.gname = g.name;
    }
  }
  el.title = (t.title || t.url) + (t.pinned ? "（已钉住）" : "");
  el.appendChild(tabIcon(t));
  el.dataset.iconKey = tabIconKey(t);
  // 钉住徽标：钉住行没有 ×（Edge 同款），用一枚小钉子说明身份
  if (t.pinned) {
    const pn = document.createElement("span");
    pn.className = "t-badge t-pin";
    pn.innerHTML = svg("pin");
    pn.title = "已钉住（右键可取消）";
    el.appendChild(pn);
  }
  // 声音指示按用户要求撤掉（静音仍可从标签右键菜单切换，只是不在标签上挂图标）
  if (t.sleeping) {
    el.classList.add("sleeping");
    const sl = document.createElement("span");
    sl.className = "t-badge t-sleep";
    sl.innerHTML = svg("sleep"); // R41：💤 emoji → 统一线稿的月牙
    sl.title = "已休眠（点击唤醒）";
    el.appendChild(sl);
  }
  if (t.splitPeer != null) {
    const sp = document.createElement("span");
    sp.className = "t-badge t-split";
    sp.innerHTML = svg("split");
    sp.title = t.splitSide === "left"
      ? "左右分屏 · 左格（右键可关闭左/右格、反转位置、退出分屏）"
      : t.splitSide === "right"
        ? "左右分屏 · 右格（右键可关闭左/右格、反转位置、退出分屏）"
        : "左右分屏中（右键可关闭左/右格、反转位置、退出分屏）";
    el.appendChild(sp);
    /* 成对两格共享一个圆角底（Chromium split tab 的标签条表示）：相邻的
       左右两格用同一条组色带连起来，一眼看出是一个分屏对 */
    el.classList.add("split-pair");
    if (t.splitSide === "left") el.classList.add("split-first");
    if (t.splitSide === "right") el.classList.add("split-last");
  }
  // 缩放百分比不再挂在标签上（R36 用户要求标签只留图标+文字）：比例改在
  // 窗口右上角的 #zoomhud 实时显示（见 zoomHudSync）
  const title = document.createElement("span");
  title.className = "t-title";
  title.textContent = tabTitleOf(t);
  el.appendChild(title);
  const close = document.createElement("button");
  close.className = "t-close";
  close.innerHTML = svg("winClose"); // R41：文本 × → 统一线稿
  close.title = "关闭标签页 (Ctrl+W)";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTabAnimated(t.id);
  });
  if (!t.pinned) el.appendChild(close);
  el.addEventListener("click", (e) => {
    if (drag && drag.moved) return; // 刚拖完不要顺手切标签
    if (Date.now() - justDragged < 150) return; // pointerup 先于 click 清空 drag，靠时间戳兜底
    /* Ctrl/⌘+点 = 加选，Shift+点 = 连选（Edge 的多选建组）；普通点 = 清空选择并切换 */
    if (e.ctrlKey || e.metaKey) { selToggle(t.id); return; }
    if (e.shiftKey) { selRange(t.id); return; }
    selClear();
    window.lgChrome.activateTab(t.id);
  });
  el.addEventListener("mousedown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      // 必须截住冒泡：#tabstrip 上有"中键点空白新建标签"，不拦会关一个又开一个
      e.stopPropagation();
      closeTabAnimated(t.id);
    }
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    /* 右键的标签在多选集里：把整份选择递过去，主进程的菜单里会多出
       "用选中的 N 个标签新建分组"（Edge 的建组入口） */
    window.lgChrome.tabContextMenu(t.id, selIds.includes(t.id) ? selIds.slice() : []);
  });
  return el;
}

/* ---------- 拖拽排序（水平标签条与垂直标签栏共用） ----------
   R38 起带 Edge 的分组语义：拖到某个标签上 = 与它建组/并组；拖到组头/组牌上 =
   加入该组；拖组头 = 整组移动。drag 形状：
     标签拖动 { id, el, vertical, sx, sy, moved, merge }
       merge = null（普通插入）| {kind:"tab",targetId,before} | {kind:"group",targetGid}
     整组拖动 { gid, el, vertical, sx, sy, moved, merge:{anchorId,before} } */
let drag = null;
let justDragged = 0; // 拖完瞬间的时间戳：click 在 pointerup 之后才派，drag 已被清空
/* 标签的组归属 / 组的第一位成员（整组拖动拿它当锚点） */
function tabGidOf(id) {
  const t = tabsState.tabs.find((tt) => tt.id === id);
  return t && t.group != null ? t.group : null;
}
function firstMemberIdOf(gid) {
  const t = tabsState.tabs.find((tt) => tt.group === gid);
  return t ? t.id : null;
}
/* 拖拽期间让主进程暂停浮层收回：拖到面板外/窄条外时浮层不该被光标裁判收走
   （否则拖到一半面板就没了，落点也没了）。 */
let flyoutHold = false;
function setFlyoutHold(on) {
  if (flyoutHold === on) return;
  flyoutHold = on;
  try { window.lgChrome.holdPopup(on); } catch (e) {}
}
/* 落点标记：插入位置线（落点行的上/下缘）+ 放置区高亮（钉住区 / 分组块）。
   每次移动只保留当前落点的一套标记。 */
function clearDropMarks() {
  for (const el of document.querySelectorAll(".drop-before, .drop-after, .drop-zone, .drop-merge")) {
    el.classList.remove("drop-before", "drop-after", "drop-zone", "drop-merge");
    // 合并高亮用 --gc 染色；分组成员自己就带 --gc（组色），不能一起清
    if (!el.classList.contains("grouped")) el.style.removeProperty("--gc");
  }
}
function markDrop(row, before) {
  clearDropMarks();
  if (!row) return;
  row.classList.add(before ? "drop-before" : "drop-after");
  if (row.closest("#vtab-pins")) {
    const pins = document.getElementById("vtab-pins");
    if (pins) pins.classList.add("drop-zone");
    return;
  }
  /* 分组块：落点行所在的整块 .vgroup 一起高亮（Edge：拖到组上整组亮起来） */
  const grp = row.closest(".vgroup");
  if (grp) grp.classList.add("drop-zone");
}
/* 调试出口（探针用）：拖拽状态 / 临时展开的现场 */
window.__lgDragDbg = function () {
  return {
    drag: drag ? { moved: !!drag.moved, hoverGid: drag.hoverGid, autoExpanded: drag.autoExpanded, dwell: Date.now() - (drag.hoverSince || 0) } : null,
    groups: (tabsState.groups || []).map((g) => ({ id: g.id, collapsed: !!g.collapsed })),
    members: tabsState.tabs.filter((t) => t.group != null).map((t) => t.id + ":" + t.group),
    chipCollapsed: !!document.querySelector("#tabs .gchip.collapsed"),
    temp: document.querySelectorAll("[data-temp-member]").length,
  };
};
function initDrag(box, vertical) {
  box.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".t-close")) return;
    /* 组头/组牌：整组拖动（Edge：拖动组把整块挪走） */
    const head = e.target.closest(".vghead[data-gid], .gchip[data-gid]");
    if (head) {
      drag = { gid: Number(head.dataset.gid), el: head, vertical, sx: e.clientX, sy: e.clientY, moved: false, merge: null, mergeRow: null, mergeKind: null, autoExpanded: null, hoverGid: null, hoverSince: 0 };
      return;
    }
    const el = e.target.closest(".tab, .vtab");
    if (!el) return;
    drag = { id: Number(el.dataset.id), el, vertical, sx: e.clientX, sy: e.clientY, moved: false, merge: null, mergeRow: null, mergeKind: null, autoExpanded: null, hoverGid: null, hoverSince: 0 };
  });
}

/* ---------- 拖拽手感三件（R39，对齐 Edge/Chromium 的可观察行为） ---------- */
/* ① FLIP：DOM 变动前后各量一次矩形，位移过的行从旧位置滑到新位置（170ms）。
   隐藏窗口里动画不推进没关系——这里只是"发出去"，不依赖 animationend；
   探针用 window.__lgFlipCount 计数。 */
let flipCount = 0;
function flipSnapIn(box) {
  const m = new Map();
  if (!box) return m;
  for (const el of box.querySelectorAll("[data-id]")) {
    try { m.set(el.dataset.id, el.getBoundingClientRect()); } catch (e) {}
  }
  return m;
}
function flipPlayIn(box, snap) {
  if (!box || !snap || !snap.size) return;
  for (const el of box.querySelectorAll("[data-id]")) {
    if (el.classList.contains("dragging")) continue;
    const prev = snap.get(el.dataset.id);
    if (!prev) continue;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left, dy = prev.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    try {
      el.animate(
        [{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
        { duration: 170, easing: "cubic-bezier(.2,.7,.3,1)" }
      );
      flipCount++;
    } catch (e) {}
  }
  try { window.__lgFlipCount = flipCount; } catch (e) {}
}
/* ② 光标旁的小签：松手会发生什么（加入哪个组 / 新建分组），颜色就是结果组色 */
let dragTipEl = null;
function dragTip(text, x, y, color) {
  if (!text) {
    if (dragTipEl) { dragTipEl.remove(); dragTipEl = null; }
    return;
  }
  if (!dragTipEl) {
    dragTipEl = document.createElement("div");
    dragTipEl.id = "drag-tip";
    document.body.appendChild(dragTipEl);
  }
  dragTipEl.textContent = text;
  dragTipEl.style.setProperty("--gc", color || "var(--ink)");
  const tw = dragTipEl.offsetWidth || 160;
  const th = dragTipEl.offsetHeight || 24;
  const x0 = Math.max(8, Math.min(Math.round(x + 14), window.innerWidth - tw - 8));
  const y0 = Math.max(8, Math.min(Math.round(y + 16), window.innerHeight - th - 8));
  dragTipEl.style.left = x0 + "px";
  dragTipEl.style.top = y0 + "px";
}
/* 新建组会用的颜色（主进程下发下一个调色板色，和 makeGroup 同一份游标） */
function nextGroupColor() {
  const k = tabsState.nextGroupColor;
  return (k && GROUP_COLORS[k]) || GROUP_COLORS.blue;
}
/* ③ 拖到标签条边缘自动滚（长列表里拖到看不见的位置） */
function autoScrollStrip(axis, e) {
  const sc = document.getElementById(axis === "y" ? "vtabs" : "tabs");
  if (!sc) return;
  const r = sc.getBoundingClientRect();
  const EDGE = 26, STEP = 16;
  if (axis === "y") {
    if (r.height <= 0) return;
    if (e.clientY < r.top + EDGE) sc.scrollTop -= STEP;
    else if (e.clientY > r.bottom - EDGE) sc.scrollTop += STEP;
  } else {
    if (r.width <= 0) return;
    if (e.clientX < r.left + EDGE) sc.scrollLeft -= STEP;
    else if (e.clientX > r.right - EDGE) sc.scrollLeft += STEP;
  }
}
/* ④ 折叠组悬停 450ms 临时展开（Edge：拖到折叠组上会展开让你挑插入位置）。
   renderTabs 在拖拽期间挂起（重建 DOM 会打断手势），所以这里做纯 DOM 的临时
   展开；拖完由主进程推送的新快照统一重建，临时状态自然消失。
   两种形态都管：垂直栏 = .vgroup（补成员行），水平条 = .gchip（在组牌后补成员牌）。 */
let hoverExpandTimer = null;
/* 两套容器都渲染同一份分组（#tabs 与 #vtab 同时存在，只是其中一个被 CSS 藏着）：
   临时展开必须落到**当前拖拽的那一条**上，否则会展开隐藏的那份（探针实测过）。 */
function dragStripRoot(vertical) {
  return document.getElementById(vertical ? "vtab" : "tabs");
}
function expandTempGroup(gid, vertical) {
  const root = dragStripRoot(vertical);
  if (!root) return false;
  const members = tabsState.tabs.filter((t) => t.group === gid);
  const box = root.querySelector('.vgroup[data-gid="' + gid + '"]');
  if (box) {
    if (!box.classList.contains("collapsed")) return false;
    box.classList.remove("collapsed");
    const snap = flipSnapIn(box);
    for (const t of members) box.appendChild(buildTabEl(t, "vtab"));
    flipPlayIn(box, snap);
    return true;
  }
  const chip = root.querySelector('.gchip[data-gid="' + gid + '"]');
  if (!chip || !chip.classList.contains("collapsed")) return false;
  chip.classList.remove("collapsed");
  chip.dataset.tempOpen = "1";
  const boxEl = chip.parentElement;
  const snap = flipSnapIn(boxEl);
  let anchor = chip;
  for (const t of members) {
    const el = buildTabEl(t, "tab");
    el.dataset.tempMember = "1";
    anchor.after(el);
    anchor = el;
  }
  flipPlayIn(boxEl, snap);
  return true;
}
function collapseTempGroup(d) {
  const gid = d && d.autoExpanded;
  if (gid == null) return;
  d.autoExpanded = null;
  const root = dragStripRoot(d.vertical);
  const box = root ? root.querySelector('.vgroup[data-gid="' + gid + '"]') : null;
  if (box) {
    box.classList.add("collapsed");
    for (const el of Array.from(box.querySelectorAll("[data-id]"))) el.remove();
    return;
  }
  const chip = root ? root.querySelector('.gchip[data-gid="' + gid + '"]') : null;
  if (chip) {
    chip.classList.add("collapsed");
    delete chip.dataset.tempOpen;
  }
  if (root) for (const el of Array.from(root.querySelectorAll('[data-temp-member="1"]'))) el.remove();
}
/* 拖拽小日志（环形 40 条，只在拖拽期间写）：排障"折叠组悬停没展开"这类
   时序问题用（探针读 window.__lgDragLog）。 */
window.__lgDragLog = [];
function dragLog(s) {
  try {
    window.__lgDragLog.push(Date.now() % 100000 + " " + s);
    if (window.__lgDragLog.length > 40) window.__lgDragLog.shift();
  } catch (e) {}
}
function dragHoverExpand(gid) {
  const d = drag;
  if (!d) { dragLog("hover gid=" + gid + " no-drag"); return; }
  if (d.autoExpanded != null && d.autoExpanded !== gid) collapseTempGroup(d);
  if (gid == null || d.autoExpanded === gid) { clearTimeout(hoverExpandTimer); dragLog("hover gid=" + gid + " auto=" + d.autoExpanded + " -> clear"); return; }
  const root = dragStripRoot(d.vertical);
  const box = root ? root.querySelector('.vgroup[data-gid="' + gid + '"]') : null;
  const chip = root ? root.querySelector('.gchip[data-gid="' + gid + '"]') : null;
  const el = box || chip;
  dragLog("hover gid=" + gid + " vert=" + d.vertical + " box=" + !!box + " chip=" + !!chip + " collapsed=" + (el ? el.classList.contains("collapsed") : "n/a") + " since=" + (Date.now() - (d.hoverSince || 0)));
  if (!el || !el.classList.contains("collapsed")) { clearTimeout(hoverExpandTimer); return; }
  if (d.hoverGid !== gid) { d.hoverGid = gid; d.hoverSince = Date.now(); }
  const tryExpand = () => {
    if (!drag || drag.autoExpanded === gid) { dragLog("try skip auto=" + (drag && drag.autoExpanded)); return; }
    if (!groupById(gid)) { dragLog("try no-group " + gid); return; }
    const r = expandTempGroup(gid, drag.vertical);
    dragLog("try gid=" + gid + " vert=" + drag.vertical + " ret=" + r);
    if (r) drag.autoExpanded = gid;
  };
  /* 两条路都留着：指针继续动时由"停留时长"判定（渲染器定时器被节流也不怕），
     指针停住时由定时器兜底。 */
  if (Date.now() - (d.hoverSince || 0) >= 450) { tryExpand(); return; }
  clearTimeout(hoverExpandTimer);
  hoverExpandTimer = setTimeout(tryExpand, 450);
}
/* 拖拽落定：只报"放到谁前面"（move 语义）+ 落点区（钉住/普通）。窄条里钉住
   标签在独立区、折叠组只画一块组牌，外壳手里的顺序天生缺这些标签——回传全量
   顺序的旧做法让主进程把这些"漏发的"补到末尾，垂直拖拽于是把钉住/折叠组整批
   甩到最后。改成只报锚点后，主进程在权威 tabOrder 上落位，缺谁都不影响。 */
function finishDrag(d) {
  if (!d || !d.moved) return;
  clearTimeout(hoverExpandTimer);
  dragTip(null);
  collapseTempGroup(d);
  setFlyoutHold(false);
  clearDropMarks();
  justDragged = Date.now();
  d.el.classList.remove("dragging");
  document.body.classList.remove("dragging");
  /* 整组拖动（Edge：拖组头移动整块）：只报锚点，主进程把整块搬过去 */
  if (d.gid != null) {
    const m = d.merge;
    if (m && m.anchorId != null) window.lgChrome.groupMove(d.gid, m.anchorId, m.before);
    return;
  }
  /* 拖到标签上 / 拖到组头上（Edge 的建组手势，R38）：主进程按落点建组或并组。
     这两种不做实时换位——落点靠高亮表示，最终位置由主进程按锚点算。 */
  if (d.merge && d.merge.kind === "tab") {
    window.lgChrome.groupDrop({ id: d.id, targetId: d.merge.targetId, before: d.merge.before });
    return;
  }
  if (d.merge && d.merge.kind === "group") {
    window.lgChrome.groupDrop({ id: d.id, targetGid: d.merge.targetGid });
    return;
  }
  const idOf = (el) => (el && el.dataset && el.dataset.id ? Number(el.dataset.id) : NaN);
  let next = d.el.nextElementSibling;
  while (next && isNaN(idOf(next))) next = next.nextElementSibling;
  let prev = d.el.previousElementSibling;
  while (prev && isNaN(idOf(prev))) prev = prev.previousElementSibling;
  const beforeId = next ? idOf(next) : null;
  /* 落点区（Edge 行为）：停在钉住区里 = 钉住，停在标签列表里 = 取消钉住。
     只有垂直栏有钉住区；水平条永远按原样（zone=null）。 */
  const zone = d.vertical ? (d.el.closest("#vtab-pins") ? "pinned" : "normal") : null;
  /* 分组归属（Edge 语义）：落进某个组的正中间（左右邻居同组）= 入组；
     拖离自己的组块（两侧都没有本组成员）= 出组。先归属后重排：
     join 会把标签挪到组块末尾，reorder 再按精确落点摆回来。 */
  const cur = tabGidOf(d.id);
  const prevG = prev ? tabGidOf(idOf(prev)) : null;
  const nextG = next ? tabGidOf(idOf(next)) : null;
  (async () => {
    if (zone === "pinned") {
      if (cur != null) await window.lgChrome.groupLeave(d.id); // 钉住区不属于任何组
    } else if (prevG != null && prevG === nextG && cur !== prevG) {
      await window.lgChrome.groupJoin(d.id, prevG);
    } else if (cur != null && prevG !== cur && nextG !== cur) {
      await window.lgChrome.groupLeave(d.id);
    }
    window.lgChrome.reorderTabs({ id: d.id, beforeId, zone });
  })();
}
document.addEventListener("pointermove", (e) => {
  if (!drag || drag.el.parentElement == null) return;
  /* 指针事件丢失兜底：弹层/别的视图抢走 pointerup 时，这里会看到"拖拽中但
     主键已经抬起"。不收尾的话 drag 永远非空，renderTabs 会一直提前 return，
     标签列表从此冻结（改由拖动位置落定，但不会丢状态）。 */
  if (drag.moved && e.buttons === 0) {
    const d = drag;
    drag = null;
    finishDrag(d);
    return;
  }
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.sx) < 4 && Math.abs(e.clientY - drag.sy) < 4) return;
    drag.moved = true;
    drag.el.classList.add("dragging");
    document.body.classList.add("dragging");
    setFlyoutHold(true);
  }
  const over = document.elementFromPoint(e.clientX, e.clientY);
  if (!over || !over.closest) return;
  autoScrollStrip(drag.vertical ? "y" : "x", e);
  /* 折叠组悬停展开：拖到折叠组（组头/组牌/**组内成员行**）上停 450ms 自动展开。
     成员行也算"停在组上"：临时展开的那一瞬，指针底下的元素会从组牌变成展开出来
     的成员行——只认组牌的话，展开后第一个 pointermove 就判成"离开"→ 立刻收回 →
     下一拍又展开 → 抖个不停（R40 探针实测到 expand 后 0.6s 被 collapse）。
     离开组（指针到别的行/组）时 gid 变化，收回逻辑照旧。 */
  const overGroupEl = over.closest(".vghead[data-gid], .gchip[data-gid], .vgroup[data-gid]");
  const overRowEl = overGroupEl ? null : over.closest("[data-id]");
  const hoverGid = overGroupEl
    ? Number(overGroupEl.dataset.gid)
    : overRowEl && overRowEl.dataset.id != null
      ? tabGidOf(Number(overRowEl.dataset.id))
      : null;
  dragHoverExpand(hoverGid);

  /* ---- 整组拖动：落点 = 别的标签 / 别的组头（报锚点 + 前/后） ---- */
  if (drag.gid != null) {
    const headEl = over.closest(".vghead[data-gid], .gchip[data-gid]");
    const rowEl = over.closest(".tab[data-id], .vtab[data-id]");
    let anchorEl = null;
    if (headEl && Number(headEl.dataset.gid) !== drag.gid) anchorEl = headEl;
    else if (rowEl && rowEl !== drag.el && tabGidOf(Number(rowEl.dataset.id)) !== drag.gid) anchorEl = rowEl;
    if (!anchorEl) { drag.merge = null; dragTip(null); return; }
    const r = anchorEl.getBoundingClientRect();
    const before = drag.vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
    const anchorId = anchorEl.dataset.id != null ? Number(anchorEl.dataset.id) : firstMemberIdOf(Number(anchorEl.dataset.gid));
    drag.merge = { anchorId, before };
    clearDropMarks();
    (anchorEl.closest(".vgroup") || anchorEl).classList.add("drop-zone");
    dragTip("移动分组到这里", e.clientX, e.clientY, null);
    return;
  }

  /* ---- 落点类型判定（Edge 语义，R38；R39 加迟滞与实时预览）----
     ① 悬在别的组头/组牌上 → 加入该组（折叠组也能当落点，Edge 同款）；
     ② 悬在别的标签的**中段** → 与它建组/并组（"拖到标签上"手势）；
     ③ 其余位置 → 普通插入（插入线 + 实时换位 + FLIP 开缝）。 */
  const headEl = over.closest(".vghead[data-gid], .gchip[data-gid]");
  if (headEl && Number(headEl.dataset.gid) !== tabGidOf(drag.id)) {
    const gid = Number(headEl.dataset.gid);
    drag.merge = { kind: "group", targetGid: gid };
    drag.mergeRow = null;
    drag.mergeKind = null;
    clearDropMarks();
    (headEl.closest(".vgroup") || headEl).classList.add("drop-zone");
    const g = groupById(gid);
    dragTip("加入「" + ((g && g.name) || "分组") + "」", e.clientX, e.clientY, g ? GROUP_COLORS[g.color] : null);
    return;
  }
  const row = over.closest(drag.vertical ? ".vtab[data-id]" : ".tab[data-id]");
  if (!row || row === drag.el) {
    drag.merge = null; drag.mergeRow = null; drag.mergeKind = null; dragTip(null);
    return;
  }
  const r = row.getBoundingClientRect();
  const frac = drag.vertical
    ? (e.clientY - r.top) / Math.max(1, r.height)
    : (e.clientX - r.left) / Math.max(1, r.width);
  /* 迟滞：已经在合并态的行要走到 0.22/0.78 才退出——边界上来回抖一下不会
     在"合并/插入"之间反复横跳（Edge 的手感差别主要在这）。 */
  const latched = drag.mergeRow === row && drag.mergeKind === "tab";
  const inMerge = !row.closest("#vtab-pins") &&
    (latched ? (frac >= 0.22 && frac <= 0.78) : (frac >= 0.3 && frac <= 0.7));
  if (inMerge) {
    const targetId = Number(row.dataset.id);
    const tg = tabGidOf(targetId);
    drag.merge = { kind: "tab", targetId, before: frac < 0.5 };
    drag.mergeRow = row;
    drag.mergeKind = "tab";
    clearDropMarks();
    const g = tg != null ? groupById(tg) : null;
    const col = g ? (GROUP_COLORS[g.color] || GROUP_COLORS.gray) : nextGroupColor();
    row.style.setProperty("--gc", col);
    row.classList.add("drop-merge");
    dragTip(g ? "加入「" + (g.name || "分组") + "」" : "新建分组", e.clientX, e.clientY, col);
    return;
  }
  drag.merge = null;
  drag.mergeRow = null;
  drag.mergeKind = null;
  dragTip(null);
  if (drag.vertical) {
    /* 垂直：允许跨"钉住区 ↔ 标签列表"（Edge 的拖进/拖出钉住），所以不再要求
       同容器——落点行在哪个容器里，落下去就是哪个区（zone 见 finishDrag）。 */
    const before = e.clientY < r.top + r.height / 2;
    const boxEl = row.parentElement;
    const snap = flipSnapIn(boxEl);
    boxEl.insertBefore(drag.el, before ? row : row.nextSibling);
    flipPlayIn(boxEl, snap);
    markDrop(row, before);
  } else {
    if (row.parentElement !== drag.el.parentElement) return;
    const before = e.clientX < r.left + r.width / 2;
    const boxEl = row.parentElement;
    const snap = flipSnapIn(boxEl);
    boxEl.insertBefore(drag.el, before ? row : row.nextSibling);
    flipPlayIn(boxEl, snap);
    markDrop(row, before); // 水平条也补插入指示线（R38）
  }
});
document.addEventListener("pointerup", () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  finishDrag(d);
});
/* 手势被打断（触控取消 / 窗口失焦）：复位状态，不提交落点 */
function cancelDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  clearTimeout(hoverExpandTimer);
  dragTip(null);
  collapseTempGroup(d);
  d.el.classList.remove("dragging");
  document.body.classList.remove("dragging");
  clearDropMarks();
  setFlyoutHold(false);
}
document.addEventListener("pointercancel", cancelDrag);
window.addEventListener("blur", cancelDrag);
/* ---------- 水平标签宽度自适应（Chrome 式） ----------
   标签多了等比收窄：先压标题（省略号兜底），窄到 76px 以下转纯图标态
   （.tiny）——用户要求"标签数量增多时自动调整宽度，保证图标一直可见"。
   钉住标签固定 40px 不参与收窄。保底宽度都放不下时开横向滚动，
   总比把最右的标签裁没强（裁掉的标签点都点不到）。 */
function fitTabs() {
  const box = document.getElementById("tabs");
  if (!box || !box.clientWidth) return;
  // 只算标签：分组牌不参与收窄，也不被压（它不是 .tab）
  const all = Array.from(box.children).filter((el) => el.classList.contains("tab"));
  const normal = all.filter((el) => !el.classList.contains("pinned"));
  const pinnedW = (all.length - normal.length) * 42; // 40 + 2px gap
  // 组牌（gchip）也占标签条宽度：扣掉再均分，否则标签总体溢出被裁
  let chipW = 0;
  for (const el of box.children) if (el.classList.contains("gchip")) chipW += el.offsetWidth;
  const n = normal.length;
  let w = n ? Math.min(200, Math.floor((box.clientWidth - chipW - pinnedW - (n - 1) * 2) / n)) : 200;
  const MIN = 36; // 纯图标下限：图标 12px + 两侧留白，任何情况图标完整可见
  box.classList.toggle("scroll", w < MIN);
  w = Math.max(MIN, w);
  for (const el of all) {
    if (el.classList.contains("pinned")) {
      el.style.width = ""; // 钉住标签交给 CSS 的 40px
      el.classList.remove("tiny");
      continue;
    }
    el.style.width = w + "px";
    el.classList.toggle("tiny", w < 76);
  }
}
window.addEventListener("resize", fitTabs);
// 标签条滚轮纵转横：只要实际有横向溢出就生效（不再要求 .scroll 类；
// Edge/Chrome 在标签多时滚轮直接横滚，不需要先"进入某个模式"）。
document.getElementById("tabs").addEventListener(
  "wheel",
  (e) => {
    const box = e.currentTarget;
    if (box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft += e.deltaY || e.deltaX;
    e.preventDefault();
  },
  { passive: false }
);

/* ---------- 标签悬停预览卡片（Edge 式）----------
   悬停某个标签时，在标签条下方弹一张小卡：页面缩略图 + 标题 + 网址。
   这是 Edge 最有辨识度的手感之一——不用点过去就知道那个标签是什么。
   刻意做成 chrome 视图里的普通浮层（不走 popup 弹层）：标签条本来就在
   chrome 视图里，卡片锚在标签下方即可，省掉一次跨 webContents 的传图。
   缩略图由主进程 capturePage 出（窗口遮挡时会失败，失败就只显示标题与
   网址，**不让卡片空着或卡住**）。 */
const THUMB_DELAY = 320;   // 悬停多久才弹：太短会误触发（鼠标路过）
let thumbTimer = null;
let thumbHideTimer = null;
let thumbToken = 0;
let thumbShownId = 0;

/* 标签悬停预览：卡片实体放**弹层覆盖视图**（R51）。以前画在外壳层，网页
   WebContentsView 永远盖在外壳之上，卡片只剩顶部几十像素可见；搬到弹层后
   它天然压过网页。缩略图仍走主进程 capturePage（20s 缓存）。 */
function hideThumbCard() {
  clearTimeout(thumbTimer);
  thumbTimer = null;
  clearTimeout(thumbHideTimer);
  thumbHideTimer = null;
  thumbToken++;
  if (thumbShownId) {
    thumbShownId = 0;
    /* 预览还开着时用户可能已经点开了菜单/浮层：这时 popup 里装的已经是
       菜单，不能再 popupHide 把菜单一起关掉。 */
    if (!menuOpenId && !flyoutOpen) {
      try { window.lgChrome.popupHide(); } catch (e) {}
    }
  }
}

async function showThumbCard(tabId, anchorEl) {
  if (menuOpenId || flyoutOpen) return;
  const t = tabsState.tabs.find((x) => x.id === tabId);
  if (!t || !anchorEl) return;
  const token = ++thumbToken;
  let thumb = null;
  try {
    if (typeof window.lgChrome.tabThumb === "function") thumb = await window.lgChrome.tabThumb(tabId);
  } catch (e) {}
  if (token !== thumbToken) return;
  const r = anchorEl.getBoundingClientRect();
  const img = thumb && thumb.ok && thumb.dataUrl
    ? `<img class="tc-img" alt="" src="${thumb.dataUrl}">`
    : '<div class="tc-img tc-empty"></div>';
  const html =
    `<div id="thumb-card">${img}<div class="tc-meta">` +
    `<div class="tc-title">${escHtml(t.title || "（无标题）")}</div>` +
    `<div class="tc-url">${escHtml(t.url || "")}</div></div></div>`;
  thumbShownId = tabId;
  try {
    await window.lgChrome.popupShow({
      html,
      fit: "rect",
      preview: true,
      al: Math.max(8, Math.round(r.left)),
      ay: Math.round(r.bottom + 8),
      fitPad: { l: 8, t: 8, r: 8, b: 8 },
      ...popupThemePayload(),
    });
  } catch (e) {
    thumbShownId = 0;
  }
}

function bindTabPreview(root) {
  if (!root) return;
  root.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".tab[data-id], .vtab[data-id]");
    if (!el) return;
    const id = Number(el.dataset.id);
    if (id === thumbShownId) return;
    clearTimeout(thumbHideTimer);
    thumbHideTimer = null;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => showThumbCard(id, el), THUMB_DELAY);
  });
  root.addEventListener("mouseout", (e) => {
    const el = e.target.closest(".tab[data-id], .vtab[data-id]");
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    clearTimeout(thumbTimer);
    thumbTimer = null;
    clearTimeout(thumbHideTimer);
    thumbHideTimer = setTimeout(() => hideThumbCard(), 160);
  });
}
bindTabPreview(document.getElementById("tabs"));
bindTabPreview(document.getElementById("vtabs"));
/* 标签条重渲（开/关/移动标签）后旧卡片锚点已失效 */
const _origRenderTabs = renderTabs;
renderTabs = function () {
  hideThumbCard();
  return _origRenderTabs.apply(this, arguments);
};

/* ---------- 标签分组（Edge Tab Groups） ----------
   主进程持有分组状态，快照里带 groups 元数据；这里负责：组牌渲染
   （连续同组标签前面插一块色牌）、折叠时组牌带计数、点击折叠/展开、
   右键开组面板、拖拽落进组中间入组 / 拖离组块出组。
   调色板键与主进程 GROUP_PALETTE 一一对应（主进程只存键，颜色值是 UI 的事）。 */
const GROUP_COLORS = {
  blue: "#3b82f6", teal: "#14b8a6", green: "#22c55e", yellow: "#eab308", orange: "#f97316",
  red: "#ef4444", pink: "#ec4899", purple: "#a855f7", cyan: "#06b6d4", gray: "#8a8d91",
};
const GROUP_COLOR_KEYS = Object.keys(GROUP_COLORS);
const GROUP_COLOR_NAMES = {
  blue: "蓝", teal: "青", green: "绿", yellow: "黄", orange: "橙",
  red: "红", pink: "粉", purple: "紫", cyan: "湖蓝", gray: "灰",
};
function groupById(gid) {
  return (tabsState.groups || []).find((g) => g.id === gid) || null;
}
function buildGroupChip(g, count, cls) {
  const el = document.createElement("div");
  el.className = cls + (g.collapsed ? " collapsed" : "");
  el.dataset.gid = String(g.id); // 浮层里克隆出来的组牌要靠它找回组
  el.style.setProperty("--gc", GROUP_COLORS[g.color] || GROUP_COLORS.gray);
  const dot = document.createElement("span");
  dot.className = "g-dot";
  el.appendChild(dot);
  const name = document.createElement("span");
  name.className = "g-name";
  name.textContent = g.name || "";
  el.appendChild(name);
  if (g.collapsed) {
    const n = document.createElement("span");
    n.className = "g-count";
    n.textContent = String(count);
    el.appendChild(n);
  }
  el.title =
    (g.name || "未命名组") + "（" + count + " 个标签）\n点击" + (g.collapsed ? "展开" : "折叠") + "，右键打开组菜单";
  el.addEventListener("click", () => {
    if (drag && drag.moved) return; // 刚拖完不要顺手折叠（整组拖动的落点）
    if (Date.now() - justDragged < 150) return;
    window.lgChrome.groupUpdate(g.id, { collapsed: !g.collapsed });
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupMenu(g.id, el);
  });
  return el;
}

/* 组头（垂直栏，Edge 式）：折叠三角 + 色点 + 组名 + 计数（折叠时）。
   整组包在 .vgroup 里（左缘一条连续组色线贯穿整组，见 chrome.css）。
   点击折叠/展开、双击组名就地改名、右键开组面板。 */
function buildGroupHead(g, count) {
  const el = document.createElement("div");
  el.className = "vghead";
  el.dataset.gid = String(g.id);
  const ar = document.createElement("span");
  ar.className = "g-arrow";
  ar.innerHTML = svg("tabMore");
  el.appendChild(ar);
  const dot = document.createElement("span");
  dot.className = "g-dot";
  el.appendChild(dot);
  const name = document.createElement("span");
  name.className = "g-name";
  name.textContent = g.name || "";
  el.appendChild(name);
  if (g.collapsed) {
    const n = document.createElement("span");
    n.className = "g-count";
    n.textContent = String(count);
    el.appendChild(n);
  }
  el.title =
    (g.name || "未命名组") + "（" + count + " 个标签）\n点击" + (g.collapsed ? "展开" : "折叠") +
    "，双击改名，右键打开组菜单";
  el.addEventListener("click", () => {
    if (drag && drag.moved) return; // 刚拖完不要顺手折叠（整组拖动的落点）
    if (Date.now() - justDragged < 150) return;
    window.lgChrome.groupUpdate(g.id, { collapsed: !g.collapsed });
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupMenu(g.id, el);
  });
  name.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startGroupRename(g.id, name);
  });
  return el;
}

/* 就地改名（双击组名）：Enter 提交 / Esc 取消 / 失焦提交。
   改名期间挂住 renderTabs —— 标签标题推送会把这块 DOM 重建，输入框当场没了。 */
let renaming = false;
function startGroupRename(gid, nameEl) {
  const g = groupById(gid);
  if (!g || !nameEl || nameEl.isContentEditable) return;
  renaming = true;
  nameEl.setAttribute("contenteditable", "true");
  nameEl.textContent = g.name || "";
  try {
    nameEl.focus();
    const r = document.createRange();
    r.selectNodeContents(nameEl);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch (e) {}
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    renaming = false;
    nameEl.removeAttribute("contenteditable");
    const v = (nameEl.textContent || "").trim().slice(0, 40);
    if (commit && v !== (g.name || "")) window.lgChrome.groupUpdate(gid, { name: v });
    else nameEl.textContent = g.name || "";
  };
  nameEl.addEventListener("keydown", (e) => {
    e.stopPropagation(); // 别让外壳的全局快捷键把输入吃掉
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  nameEl.addEventListener("blur", () => finish(true));
}

/* 普通标签按"相邻同组切块"分 runs（钉住的不参与：垂直栏在独立图标区、
   水平条在条首）。renderTabs 与悬停浮层共用这一份，两处的分组呈现才不会
   各画各的。非连续的同组（拖拽途中暂时出现）各自成块，不强行合并。 */
function tabRuns() {
  const runs = [];
  for (const t of tabsState.tabs) {
    if (t.pinned) continue;
    const g = t.group != null ? t.group : null;
    const last = runs[runs.length - 1];
    if (last && last.gid === g) last.tabs.push(t);
    else runs.push({ gid: g, tabs: [t] });
  }
  return runs;
}

/* 结构签名：决定“必须整条重画”的那部分数据。标题/图标/加载态/激活态都不在内
   ——它们只 patch 现有行，加载期不再把鼠标下的 DOM 拆掉重建。 */
function tabsStructSig() {
  const tabsPart = tabsState.tabs
    .map((t) =>
      [
        t.id,
        t.pinned ? 1 : 0,
        t.group == null ? "" : t.group,
        t.splitPeer == null ? "" : t.splitPeer,
        t.splitSide || "",
        t.sleeping ? 1 : 0,
      ].join(":")
    )
    .join(",");
  const groupsPart = (tabsState.groups || [])
    .map((g) => [g.id, g.name || "", g.color || "", g.collapsed ? 1 : 0].join(":"))
    .join(",");
  return tabsPart + "||" + groupsPart;
}

/* 只翻转由 tabs 数据决定的类名；sel / dragging / drop-* / tiny 属于交互状态，
   必须原样保留——增量更新就是为了不打断它们。 */
function patchTabEl(el, t) {
  if (!el || !t) return;
  const g = t.group != null ? groupById(t.group) : null;
  const split = t.splitPeer != null;
  el.classList.toggle("active", t.id === tabsState.activeId);
  el.classList.toggle("loading", !!t.loading);
  el.classList.toggle("special", !!t.special);
  el.classList.toggle("pinned", !!t.pinned);
  el.classList.toggle("sleeping", !!t.sleeping);
  el.classList.toggle("grouped", !!g);
  el.classList.toggle("split-pair", split);
  el.classList.toggle("split-first", split && t.splitSide === "left");
  el.classList.toggle("split-last", split && t.splitSide === "right");
  if (g) {
    el.style.setProperty("--gc", GROUP_COLORS[g.color] || GROUP_COLORS.gray);
    if (g.name) el.dataset.gname = g.name;
    else delete el.dataset.gname;
  } else {
    el.style.removeProperty("--gc");
    delete el.dataset.gname;
  }
  el.title = (t.title || t.url || "") + (t.pinned ? "（已钉住）" : "");
  const titleEl = el.querySelector(".t-title");
  if (titleEl) titleEl.textContent = tabTitleOf(t);
  const key = tabIconKey(t);
  if (el.dataset.iconKey !== key) {
    const old = el.querySelector(".t-icon");
    const fresh = tabIcon(t);
    if (old) el.replaceChild(fresh, old);
    else el.insertBefore(fresh, el.firstChild);
    el.dataset.iconKey = key;
  }
}

let tabStructSigLast = null;
function renderTabs() {
  if (drag && drag.moved) return; // 拖拽进行中：重建 DOM 会打断手势
  if (renaming) return; // 就地改名中：重建 DOM 会把输入框吞掉
  const strip = document.getElementById("tabs");
  const rail = document.getElementById("vtabs");
  const pins = document.getElementById("vtab-pins");
  const sig = tabsStructSig();
  const rebuild = sig !== tabStructSigLast;
  if (rebuild) {
    /* FLIP 快照：结构变化（开/关/重排/分组）后让位移过的行从旧位置滑过去 */
    const snapStrip = flipSnapIn(strip);
    const snapRail = flipSnapIn(rail);
    const snapPins = flipSnapIn(pins);
    strip.textContent = "";
    fillVtab(pins, rail);
    /* 水平条：钉住的照旧排在最前（条内纯图标小标签） */
    for (const t of tabsState.tabs) if (t.pinned) strip.appendChild(buildTabEl(t, "tab"));
    for (const run of tabRuns()) {
      const g = run.gid != null ? groupById(run.gid) : null;
      if (g) {
        strip.appendChild(buildGroupChip(g, run.tabs.length, "gchip"));
        if (g.collapsed) continue;
      }
      for (const t of run.tabs) strip.appendChild(buildTabEl(t, "tab"));
    }
    flipPlayIn(strip, snapStrip);
    flipPlayIn(rail, snapRail);
    flipPlayIn(pins, snapPins);
    tabStructSigLast = sig;
  } else {
    /* meta 类更新（标题/favicon/loading/激活）走原地 patch：不删节点、不跑
       FLIP，悬停与点击目标在加载期间保持同一个元素。 */
    const byId = new Map(tabsState.tabs.map((t) => [t.id, t]));
    for (const el of document.querySelectorAll('#tabs .tab[data-id], #vtabs .vtab[data-id], #vtab-pins .vtab[data-id]')) {
      patchTabEl(el, byId.get(Number(el.dataset.id)));
    }
  }
  document.body.classList.toggle("loading", tabsState.tabs.some((t) => t.loading));
  renderNavBtns();
  renderVtabCurrent();
  renderDock();
  syncOmni();
  fitTabs();
  scrollActiveTabIntoView();
  // 悬停浮层开着时标签变了要同步（签名没变就不重发——避免鼠标下的元素
  // 被重建触发浮层的 mouseleave 误关闭）
  if (flyoutOpen) renderTabFlyout();
}
/* 水平条：切标签/新建/恢复后把活动标签滚进视野（否则它可能完全在滚动区外，
   用户看到的是"切了但不知道切到哪"）。用 scrollLeft 微调，不触发 scrollIntoView
   把外层容器一起滚。 */
function scrollActiveTabIntoView() {
  const strip = document.getElementById("tabs");
  if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
  const el = strip.querySelector('.tab.active[data-id="' + tabsState.activeId + '"]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const br = strip.getBoundingClientRect();
  if (r.left < br.left) strip.scrollLeft -= Math.ceil(br.left - r.left) + 8;
  else if (r.right > br.right) strip.scrollLeft += Math.ceil(r.right - br.right) + 8;
}

/* 垂直侧栏的内容（钉住区 + 分组块 + 普通标签行）——外壳与悬停浮层共用这一份：
   浮层直接克隆外壳的 #vtab 节点，结构/行序/行高逐像素一致，所以"两处同构"
   是结构性保证（悬停展开只是横向加宽，同一标签在两处的行中心 y 一致——
   鼠标贴哪一行、点下去还是哪一行）。
   分组按 Edge 式包成 .vgroup（组头一行 + 成员缩进 + 左缘连续组色线）。 */
function fillVtab(pins, list) {
  if (pins) pins.textContent = "";
  /* 新建按钮在列表末尾（Edge：紧跟最后一行 9px）：整份重建时先摘出来，
     行都插完再放回去——否则 textContent="" 会把它一起清掉 */
  const newBtn = list.querySelector("#vtab-new");
  list.textContent = "";
  if (pins) for (const t of tabsState.tabs) if (t.pinned) pins.appendChild(buildTabEl(t, "vtab"));
  for (const run of tabRuns()) {
    const g = run.gid != null ? groupById(run.gid) : null;
    if (!g) {
      for (const t of run.tabs) list.appendChild(buildTabEl(t, "vtab"));
      continue;
    }
    const box = document.createElement("div");
    box.className = "vgroup" + (g.collapsed ? " collapsed" : "");
    box.dataset.gid = String(g.id);
    box.style.setProperty("--gc", GROUP_COLORS[g.color] || GROUP_COLORS.gray);
    box.appendChild(buildGroupHead(g, run.tabs.length));
    if (!g.collapsed) for (const t of run.tabs) box.appendChild(buildTabEl(t, "vtab"));
    list.appendChild(box);
  }
  if (newBtn) list.appendChild(newBtn);
}

/* ---------- 工具行：前进后退可用态 / omnibox ---------- */
function activeSnapshot() {
  return tabsState.tabs.find((x) => x.id === tabsState.activeId) || null;
}
function renderNavBtns() {
  const t = activeSnapshot();
  document.getElementById("btn-back").disabled = !t || !t.canBack;
  document.getElementById("btn-fwd").disabled = !t || !t.canFwd;
  // 加载中：刷新键换成停止键（Chrome 语义）；本地页没有可停的加载
  const loading = !!(t && t.loading);
  const reload = document.getElementById("btn-reload");
  const stop = document.getElementById("btn-stop");
  if (reload) reload.hidden = loading;
  if (stop) stop.hidden = !loading;
  syncSiteGlassBtn();
}
/* 当前站点的可玻璃化 host（只对站外 http(s) 页面出现按钮；洛谷走自己的
   登记表，不需要"本站关闭"）。 */
function currentExternalHost() {
  const t = currentTab();
  if (!t || !/^https?:/i.test(t.url || "")) return "";
  let host = "";
  try { host = new URL(t.url).hostname.toLowerCase(); } catch (e) { return ""; }
  if (!host || /(^|\.)luogu\.(com\.cn|org|com)$/i.test(host)) return "";
  return host;
}
function hostInList(host, list) {
  return (Array.isArray(list) ? list : []).some((d) => {
    const x = String(d || "").trim().toLowerCase().replace(/^\.+/, "");
    return x && (host === x || host.endsWith("." + x));
  });
}
function syncSiteGlassBtn() {
  const btn = document.getElementById("btn-site-glass");
  if (!btn) return;
  const host = currentExternalHost();
  if (!host) { btn.hidden = true; return; }
  const off = hostInList(host, cfgState.glassExclude);
  btn.hidden = false;
  btn.innerHTML = svg(off ? "glassOff" : "glassOn");
  btn.title = off ? "本站已关闭玻璃（点击恢复）" : "本站玻璃化（点击关闭）";
  btn.setAttribute("aria-label", btn.title);
  btn.classList.toggle("on", !off);
}
/* 垂直模式的窗口标题牌：跟着活动标签走（图标/标题/加载态），
   水平模式不渲染也没人看（CSS 藏着） */
function renderVtabCurrent() {
  const box = document.getElementById("vtab-current");
  if (!box) return;
  const t = activeSnapshot();
  const key = tabIconKey(t);
  if (box.dataset.iconKey !== key) {
    const ic = box.querySelector(".vc-icon");
    if (ic) {
      ic.textContent = "";
      if (t) ic.appendChild(tabIcon(t));
    }
    box.dataset.iconKey = key;
  }
  box.querySelector(".vc-title").textContent = tabTitleOf(t);
  box.title = t ? t.title || t.url || "" : "";
  box.classList.toggle("loading", !!(t && t.loading));
}
function omniDisplayUrl(u, kind) {
  // 本地页不能把 file:// 的绝对路径摊在地址栏上
  if (kind === "settings") return "Luogu++ 设置";
  if (kind === "home") return "首页";
  if (kind === "history") return "浏览历史";
  if (/^(file|luogu-glass):/i.test(u || "")) return "Luogu++ 本地页";
  try {
    const x = new URL(u);
    return x.hostname + x.pathname + x.search;
  } catch {
    return u || "";
  }
}
function syncOmni() {
  const inp = document.getElementById("omni-input");
  if (!inp || document.activeElement === inp) return;
  const t = activeSnapshot();
  inp.value = t ? omniDisplayUrl(t.url, t.kind) : "";
}
function omniSubmit(newTab) {
  const inp = document.getElementById("omni-input");
  const raw = inp.value.trim();
  if (!raw) return;
  closeSuggest();
  const r = resolveOmnibox(raw, cfgState.mappings, cfgState.searchTemplate, cfgState.searchIsLuogu !== false);
  if (!r) return;
  inp.value = "";
  inp.blur();
  if (r.type === "luogu") {
    // Alt+Enter（Chrome 同款）：按输入内容新标签打开
    if (newTab && window.lgChrome.openTab) window.lgChrome.openTab(r.url);
    else window.lgChrome.navigate(r.url);
  } else {
    // 映射词、站外网址与站外搜索引擎 → 应用内新标签（该标签不锁域名）
    window.lgChrome.openExternalTab(r.url);
  }
}

/* ---------- 地址栏联想（矩形弹层里的下拉） ----------
   数据：映射词（主进程）+ 历史（主进程）+ 打开的标签（外壳本地）+ 搜索行；
   键盘 ↑↓ 选择 / Enter 执行 / Esc 关，鼠标点行也执行。面板走矩形弹层
   （面板外的点击照常落到网页上）。 */
let sugItems = [];
let sugSel = -1;
let sugOpen = false;
let sugTimer = null;
let sugSeq = 0;
function closeSuggest() {
  clearTimeout(sugTimer);
  if (!sugOpen) { sugItems = []; sugSel = -1; return; }
  sugOpen = false;
  sugItems = [];
  sugSel = -1;
  window.lgChrome.popupHide();
}
function openTarget(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch {}
  if (/(^|\.)luogu\.com\.cn$/i.test(host)) window.lgChrome.navigate(url);
  else window.lgChrome.openExternalTab(url);
}
function runSuggest(it) {
  const inp = document.getElementById("omni-input");
  closeSuggest();
  if (it.kind === "tab") { window.lgChrome.activateTab(it.tabId); return; }
  inp.value = "";
  inp.blur();
  if (it.kind === "search") {
    if (cfgState.searchIsLuogu !== false && /luogu\.com\.cn/i.test(it.url)) window.lgChrome.navigate(it.url);
    else window.lgChrome.openExternalTab(it.url);
    return;
  }
  openTarget(it.url);
}
function renderSuggest() {
  const box = document.createElement("div");
  box.id = "omni-sug";
  box.className = "lg-fake lg-face-b";
  sugItems.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "sug-row" + (i === sugSel ? " on" : "");
    /* 悬停高亮：弹层是独立 webContents，鼠标事件只有那边收得到——行上带
       索引，popup.js 悬停时把索引回传（popup:sug-hover → chrome:sug-hover）。 */
    row.setAttribute("data-sug-i", String(i));
    const ic = document.createElement("span");
    ic.className = "sug-ic";
    ic.innerHTML = svg(it.icon || "page");
    row.appendChild(ic);
    const label = document.createElement("span");
    label.className = "sug-label";
    label.textContent = it.label;
    row.appendChild(label);
    const sub = document.createElement("span");
    sub.className = "sug-sub";
    sub.textContent = it.sub || "";
    row.appendChild(sub);
    popBind(row, () => runSuggest(it));
    box.appendChild(row);
  });
  const r = document.getElementById("omnibox").getBoundingClientRect();
  window.lgChrome.popupShow({
    html: box.outerHTML,
    fit: "rect",
    al: Math.round(r.left),
    ay: Math.round(r.bottom + 4),
    ...popupThemePayload(),
  });
  sugOpen = true;
}
async function fetchSuggest() {
  const inp = document.getElementById("omni-input");
  if (!inp) return;
  const q = inp.value.trim();
  if (!q || document.activeElement !== inp) { closeSuggest(); return; }
  const seq = ++sugSeq;
  let data = { history: [], mappings: [] };
  try { data = (await window.lgChrome.navSuggest(q)) || data; } catch (e) {}
  if (seq !== sugSeq) return; // 过期响应丢掉（打字快时后到的旧结果会把新结果盖掉）
  const ql = q.toLowerCase();
  const items = [];
  /* 首行 = 对"输入内容本身"的默认动作（Edge/Chrome 的默认行）：URL 类输入
     显示「打开 xxx」，让"回车会去哪"一眼可见。回车本身（没显式选中建议时）
     永远按输入内容走 omniSubmit，建议行只是补充入口。 */
  const direct = resolveOmnibox(q, cfgState.mappings, cfgState.searchTemplate, cfgState.searchIsLuogu !== false);
  if (direct && (direct.type === "luogu" || direct.type === "external")) {
    items.push({ kind: "url", icon: "page", label: "打开 " + q, sub: direct.url, url: direct.url });
  }
  for (const m of data.mappings || []) {
    items.push({ kind: "url", icon: "page", label: m.key, sub: m.url, url: m.url });
  }
  for (const t of tabsState.tabs) {
    if (items.length >= 5) break;
    const url = t.url || "";
    if (!url || url.startsWith("file:")) continue;
    if ((t.title || "").toLowerCase().includes(ql) || url.toLowerCase().includes(ql)) {
      items.push({ kind: "tab", icon: "page", label: t.title || url, sub: "已打开的标签", tabId: t.id });
    }
  }
  for (const h of data.history || []) {
    if (items.length >= 8) break;
    if (items.some((x) => x.url === h.url)) continue;
    items.push({ kind: "url", icon: "historyClock", label: h.title || h.url, sub: h.url, url: h.url });
  }
  const tpl = cfgState.searchTemplate || "";
  if (tpl.includes("%s")) {
    items.push({
      kind: "search",
      icon: "searchTab",
      label: "搜索 “" + q + "”",
      sub: cfgState.searchName || "",
      url: tpl.replace("%s", encodeURIComponent(q)),
    });
  }
  sugItems = items;
  /* 默认不选中任何一行（R39）：以前默认选 0，回车到底走"建议 0"还是
     "输入内容"取决于联想是否已返回——同一串输入两次回车行为不一样。
     现在回车恒等于"提交输入内容"，只有显式按 ↓/↑/Tab/悬停才走建议行。 */
  sugSel = -1;
  renderSuggest();
}
/* 选中态只改类名（不再整份重发 HTML 走 popupShow）：方向键/悬停每动一下
   都重排一次弹层视图的话，列表看起来就"不跟手"。 */
function paintSugSel() {
  if (window.lgChrome.sugSel) window.lgChrome.sugSel(sugSel);
}

/* ---------- 侧坞（水平模式） ----------
   内容完全由 cfg.dockItems 驱动（设置页「侧坞」卡片可增删改排序）。
   href 语义：@home=应用首页 / 洛谷路径 / 映射词或站外 URL（开不锁域新标签）。
   两颗胶囊（导航 / 设置）整体垂直居中，不再一上一下拉满左侧。 */
function dockTarget(href) {
  const s = String(href || "").trim();
  if (!s) return null;
  if (s === "@home") return { type: "home" };
  if (s === "@ide") return { type: "ide" };
  if (/^https?:\/\//i.test(s)) {
    // 洛谷全 URL（v3.5.1 起默认写全，如 https://www.luogu.com.cn/discuss）：
    // 按站内导航处理（当前标签跳过去），而不是开新标签——与路径写法行为一致
    try {
      const u = new URL(s);
      if (/(^|\.)luogu\.com\.cn$/i.test(u.hostname)) return { type: "luogu", url: u.pathname + u.search };
    } catch (e) {}
    return { type: "url", url: s };
  }
  if (/^[/]/.test(s)) return { type: "luogu", url: s };
  const map = (cfgState.mappings || {});
  if (map[s]) return { type: "url", url: map[s] };
  return { type: "luogu", url: "/" + s.replace(/^\/+/, "") };
}
function renderDock() {
  const dock = document.getElementById("dock");
  if (!dock) return;
  dock.textContent = "";
  const t = currentTab();
  const path = t && t.kind === "home" ? "@home" : (() => {
    try { return t && !/^file:/i.test(t.url || "") ? new URL(t.url).pathname : ""; } catch { return ""; }
  })();
  /* 坞「首页」按钮（R39）改为"总是新建标签打开洛谷首页"，高亮判据跟着改：
     当前标签是洛谷首页（www.luogu.com.cn/）时才亮，本地玻璃首页不算。 */
  const luoguHome = !!(t && t.kind !== "home" && /^https?:\/\/(www\.)?luogu\.com\.cn\/?$/i.test(t.url || ""));
  const items = Array.isArray(cfgState.dockItems) ? cfgState.dockItems.filter((it) => it && it.href) : [];
  /* 坞的渲染仍在外壳（图标/选中态/文案一处都不重复）：这份 HTML 推给坞覆盖
     视图显示（R36：坞浮在页面之上、页面内容从它底下穿过，不再让位）。
     点击不在这里绑——坞视图按 data-href 回传主进程，映射规则
     （@home / @ide / URL / 站内路径 / @settings）在主进程 dockTargetOf。 */
  if (items.length) {
    const group = document.createElement("div");
    group.className = "dock-group";
    for (const it of items) {
      const a = document.createElement("a");
      a.innerHTML = svg(DOCK_ICONS.includes(it.icon) ? it.icon : "page");
      a.title = (it.title || it.href) + "（Ctrl+点击 / 中键：新标签打开）";
      a.setAttribute("data-href", it.href);
      const target = dockTarget(it.href);
      let active = false;
      if (target) {
        if (target.type === "home") active = luoguHome;
        else if (target.type === "ide") active = path.indexOf("/ide") === 0;
        else if (target.type === "luogu") active = path.indexOf(target.url) === 0 && !(target.url === "/" && path && path !== "/");
        if (active) a.classList.add("active");
      }
      group.appendChild(a);
    }
    dock.appendChild(group);
  }

  const foot = document.createElement("div");
  foot.className = "dock-foot";
  const gear = document.createElement("a");
  gear.innerHTML = svg("sliders");
  gear.title = "Luogu++ 设置 (F2)";
  gear.setAttribute("data-href", "@settings");
  foot.appendChild(gear);
  dock.appendChild(foot);
  dockSyncToMain();
}

/* 把坞的 HTML + 整套主题变量推给主进程（转发坞覆盖视图）。签名不变不重发：
   renderDock 会被每次 tabs 推送调到（标题变化很频繁），重发等于重建坞视图的
   DOM——坞会闪。窗口尺寸/位置变化不用管：落位是主进程的事，它自己会重算。 */
let dockSig = "";
function dockSyncToMain() {
  const dock = document.getElementById("dock");
  if (!dock || !window.lgChrome.dockSync) return;
  const de = document.documentElement;
  const dp = document.body.dataset.dock;
  const dockPosNow = dp === "left" || dp === "right" || dp === "top" || dp === "bottom"
    ? dp
    : (cfgState.verticalTabs ? "bottom" : "left");
  /* 位置必须进签名：坞视图的排布方向由它决定（左/右 = 竖排、上/下 = 横排）。
     漏了它时"只改位置、HTML 与主题都没变"会被去重挡掉——坞视图留着旧方向，
     主进程却按新位置落位（R38 修的"坞两条"的另一半根因）。 */
  const sig = dockPosNow + "||" + dock.innerHTML + "||" + (de.style.cssText || "") + "||" + (de.getAttribute("data-theme") || "") + "||" + (de.getAttribute("data-glass") || "");
  if (sig === dockSig) return;
  dockSig = sig;
  window.lgChrome.dockSync({ html: dock.innerHTML, dock: dockPosNow, ...popupThemePayload() });
}

/* ---------- 用户区 + 账号下拉 ---------- */
function renderUser() {
  const chip = document.getElementById("user-chip");
  chip.textContent = "";
  const active = accountsState.accounts.find((a) => a.id === accountsState.activeId);
  const expired = !!(userState && userState.expired);
  let label = "未登录";
  chip.classList.toggle("anon", !(userState && userState.uid));
  chip.classList.toggle("expired", expired);
  if (userState && userState.uid) {
    const img = document.createElement("img");
    img.src = userState.avatar || "";
    chip.appendChild(img);
    // 芯片只显示昵称，永远不显示 UID：UID 是数字串，认不出是谁；
    // 昵称一时读不到就退回账号记录里的名字/邮箱前缀（都是人认得的）。
    label = expired ? "已过期 · 重新登录" : userState.name || (active && (active.name || active.email.split("@")[0])) || "已登录";
  } else if (expired) {
    label = "已过期 · 重新登录";
  } else if (active) {
    label = active.name || active.email.split("@")[0];
  }
  const nm = document.createElement("span");
  nm.className = "uname" + (userState && userState.uid ? "" : " anon");
  nm.textContent = label;
  chip.appendChild(nm);
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.innerHTML = svg("tabMore"); // R41：CSS border 三角 → 统一线稿 chevron
  chip.appendChild(caret);
  chip.title = expired ? "登录已过期 · 点击重新登录" : label + " · 点击切换账号";
}
/* ---------- 账号切换进度（菜单内联面板） ----------
   切换可能在后台要求输验证码：主进程把 job.captcha 塞进 lg-account:list，
   这里轮询后在菜单里画一个验证码输入行。切换期间菜单不许被外面点掉。 */
let switchJob = null;
let switchPoll = null;
let switchErr = "";

function renderAccountMenu() {
  /* 打开账号菜单时催主进程刷一次用户态（头像/昵称）。主进程那边
     ipcMain.on("user:nudge") 早就挂着，注释也写着"账号菜单打开时即时抓"，
     但从来没有触发方——头像只能等定时兜底才更新，这里把链路接上。 */
  try { window.lgChrome.userNudge(); } catch (e) {}
  // 静态的"管理账号…"是写死在 chrome.html 里的，不归 list 管。它也得登记点击键：
  // 菜单 HTML 是复制到覆盖层里执行的，直接挂在原节点上的监听器对副本无效。
  const manage = document.getElementById("am-manage");
  if (manage) popBind(manage, () => { hideAccountMenu(); window.lgChrome.openSettings(); });
  const list = document.getElementById("am-list");
  list.textContent = "";
  if (switchErr) {
    const er = document.createElement("div");
    er.className = "am-empty am-err";
    er.textContent = switchErr;
    list.appendChild(er);
  }
  if (switchJob) {
    const p = document.createElement("div");
    p.className = "am-job";
    const msg = document.createElement("div");
    msg.className = "am-job-msg";
    msg.textContent = switchJob.message || "正在切换…";
    p.appendChild(msg);
    if (switchJob.captcha) {
      const img = document.createElement("img");
      img.className = "am-job-cap";
      img.src = switchJob.captcha;
      img.alt = "验证码";
      p.appendChild(img);
      const row = document.createElement("div");
      row.className = "am-job-row";
      const input = document.createElement("input");
      input.className = "am-job-input";
      input.placeholder = "输入验证码";
      input.maxLength = 6;
      const ok = document.createElement("button");
      ok.className = "am-job-btn";
      ok.textContent = "提交";
      /* 菜单实体在覆盖层（HTML 副本），直接 addEventListener 的监听器根本不存在。
         提交走 popBind：data-pop-value 让覆盖层读回输入框的值一起回传，
         data-pop-submit 让覆盖层把输入框里的 Enter 转发到这颗按钮。
         （覆盖层负责输入值的重绘保持与自动聚焦。） */
      ok.setAttribute("data-pop-value", ".am-job-input");
      ok.setAttribute("data-pop-submit", "1");
      popBind(ok, (v) => window.lgChrome.accountAnswer(typeof v === "string" ? v : ""));
      const no = document.createElement("button");
      no.className = "am-job-btn quiet";
      no.textContent = "取消";
      popBind(no, () => window.lgChrome.accountCancel());
      row.appendChild(input);
      row.appendChild(ok);
      row.appendChild(no);
      p.appendChild(row);
    }
    list.appendChild(p);
    return;
  }
  if (userState && userState.expired && accountsState.activeId) {
    const re = document.createElement("button");
    re.className = "am-item am-relogin";
    re.textContent = "登录已过期 · 重新登录";
    popBind(re, () => doSwitchAccount(accountsState.activeId, true));
    list.appendChild(re);
    const sep = document.createElement("div");
    sep.className = "am-sep";
    list.appendChild(sep);
  }
  if (!accountsState.accounts.length) {
    const e = document.createElement("div");
    e.className = "am-empty";
    e.textContent = "还没有保存的账号。到设置页添加（验证成功才会保存）。";
    list.appendChild(e);
    return;
  }
  for (const a of accountsState.accounts) {
    const b = document.createElement("button");
    b.className = "am-item";
    const nm = document.createElement("span");
    nm.className = "am-name";
    nm.textContent = a.name || a.email.split("@")[0];
    b.appendChild(nm);
    const mail = document.createElement("span");
    mail.className = "am-mail";
    mail.textContent = a.email;
    b.appendChild(mail);
    if (a.id === accountsState.activeId) {
      const tick = document.createElement("span");
      tick.className = "am-tick";
      tick.textContent = "✓";
      b.appendChild(tick);
    }
    popBind(b, () => {
      if (a.id !== accountsState.activeId) doSwitchAccount(a.id);
      else hideAccountMenu();
    });
    list.appendChild(b);
  }
  if (accountsState.accounts.length > 1) {
    const out = document.createElement("button");
    out.className = "am-item am-logout";
    out.textContent = "退出登录（回到未登录会话）";
    popBind(out, () => doSwitchAccount(""));
    list.appendChild(out);
  }
}
async function doSwitchAccount(id, force) {
  if (switchJob) return;
  switchErr = "";
  switchJob = { stage: "starting", message: force ? "正在重新登录…" : "正在切换…", captcha: null };
  refreshAccountMenu();
  /* 只在 job 真变了才重绘：验证码阶段每 700ms 整份重发会把输入框 DOM 换掉，
     即使覆盖层保焦，输入法组字也会被打断。 */
  let lastJobSig = "";
  switchPoll = setInterval(async () => {
    try {
      const st = await window.lgChrome.accountState();
      if (st && st.job) {
        const sig = JSON.stringify(st.job);
        if (sig !== lastJobSig) {
          lastJobSig = sig;
          switchJob = { ...switchJob, ...st.job };
          refreshAccountMenu();
        }
      }
    } catch {}
  }, 700);
  let r = null;
  try {
    r = await window.lgChrome.switchAccount(id, force ? { force: true } : undefined);
  } catch (e) {
    r = { ok: false, message: "切换失败：" + e };
  }
  if (switchPoll) { clearInterval(switchPoll); switchPoll = null; }
  const failed = !r || !r.ok;
  if (failed) {
    switchErr = (r && r.message) || "自动登录失败，请到设置页重新验证账号";
    switchJob = null;
    refreshAccountMenu();
    setTimeout(() => { if (switchErr && !switchJob) { switchErr = ""; refreshAccountMenu(); } }, 6000);
  } else {
    switchJob = null;
    switchErr = "";
    hideAccountMenu();
  }
}
/* 三个顶栏下拉（账号 / 书签 / 下载）
   外壳层永远渲染在所有网页视图之下，所以在外壳里画的下拉会被网页盖住
   （用户报的"切换账号的弹窗被背景遮住"就是这个）。现在统一交给弹出层覆盖
   视图渲染：这里只负责生成 HTML、登记点击动作、把锚点位置交给覆盖层。 */
const MENU_IDS = ["account-menu", "download-menu", "tabmore-menu", "group-menu"];
const MENU_ANCHORS = {};
let menuOpenId = null;
let popSeq = 0;
let popActions = {};

/* 把一次点击登记成覆盖层能回传的键 */
function popBind(el, fn) {
  const k = "pk" + ++popSeq;
  popActions[k] = fn;
  el.setAttribute("data-pop", k);
  return el;
}
/* 顶栏高度：垂直模式两行 = 80（38 标题行 + 42 工具行），水平模式 76。
   右侧模式的悬停浮层顶边要等于常驻侧栏的 top（= 让开右上角三键的那条线），
   从 CSS 变量读回来，别再写死 44。 */
function headerH() {
  // --header-h 是 body 上的规则（垂直模式 80 / 水平 76），computed 读 body 才拿得到
  const v = parseFloat(getComputedStyle(document.body).getPropertyValue("--header-h"));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 80;
}
function popupThemePayload() {
  const de = document.documentElement;
  return {
    cssText: de.style.cssText || "",
    theme: de.getAttribute("data-theme") || "light",
    glass: de.getAttribute("data-glass") || "flat",
    layout: document.body.dataset.layout || "horizontal",
    side: document.body.dataset.side || "left",
  };
}
function menuAt(id, anchor) {
  MENU_ANCHORS[id] = anchor;
  // 菜单要接管弹层：联想下拉让它先退场（否则面板内容被换掉、状态还挂着）
  sugOpen = false;
  sugItems = [];
  const menu = document.getElementById(id);
  const wasHidden = menu.hidden;
  menu.hidden = false; // 取 outerHTML 时不能带 hidden
  const html = menu.outerHTML;
  menu.hidden = wasHidden;
  /* 旧键作废，但要**按这份 HTML 保留**：渲染函数（renderAccountMenu 等）在
     调用 menuAt 之前才用 popBind 登记好动作，这里若无条件清空，等于把刚登记
     的键全抹掉 —— 菜单能看见、点下去毫无反应（"无法切换账号"就是这个）。
     只保留这份 HTML 里真正带 data-pop 的键，其它才丢。 */
  const keep = new Set();
  try {
    menu.querySelectorAll("[data-pop]").forEach((el) => keep.add(el.getAttribute("data-pop")));
  } catch (e) {}
  for (const k of Object.keys(popActions)) if (!keep.has(k)) delete popActions[k];
  menuOpenId = id;
  const r = anchor.getBoundingClientRect();
  /* 锚点没布局（隐藏/脱离文档/尺寸全零）时 rect 全零——原样发出去会把菜单
     定位到窗口左上角（用户截图的"点右上角账号，菜单弹到左边"就是这个路径
     的一个入口）。退化为贴窗口右缘、工具行下沿：账号芯片本来就在那附近，
     观感上只是"没对齐"，不会跑到对面去。 */
  const degenerate = !anchor.isConnected || (r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0);
  const ax = degenerate ? Math.max(8, Math.round(window.innerWidth - 8)) : Math.round(r.right);
  const ay = degenerate ? headerH() : Math.round(r.bottom + 6);
  window.lgChrome.popupShow({
    html,
    ax,
    ay,
    focus: "view",
    // 账号切换 / 登录验证码进行中时，点空白不许关菜单
    sticky: id === "account-menu" && !!switchJob,
    ...popupThemePayload(),
  });
}
/* 菜单正开着时，数据变了要重发一份（否则覆盖层还是旧内容） */
function refreshMenu(id) {
  if (menuOpenId !== id || !MENU_ANCHORS[id]) return;
  menuAt(id, MENU_ANCHORS[id]);
}
function hideAllMenus() {
  menuOpenId = null;
  for (const m of MENU_IDS) document.getElementById(m).hidden = true;
  window.lgChrome.popupHide();
}

/* ---------- 标签页操作菜单（Edge 式 1:1） ----------
   结构对齐 Edge 垂直标签页菜单：
     关闭/打开垂直标签页
     钉住侧栏（常驻展开）
     整理标签页 ▸（按站点分组排序 / 关闭重复标签）
     搜索标签页            Ctrl+Shift+A
     打开标签页 ▸（当前全部标签，点谁切谁）
     最近关闭 ▸（会话内关闭栈，点谁恢复谁）
   展开状态存在 tmExpanded：点区段行只开合不触发动作，展开后重发菜单 HTML。 */
let tmExpanded = {};
let tmClosedCache = [];

function tmRow(label, opts) {
  opts = opts || {};
  const b = document.createElement("button");
  b.className = "am-item tm-item" + (opts.open ? " tm-open" : "");
  const ico = document.createElement("span");
  ico.className = "tm-ico";
  ico.innerHTML = svg(opts.icon || "page");
  b.appendChild(ico);
  const txt = document.createElement("span");
  txt.className = "tm-label";
  txt.textContent = label;
  b.appendChild(txt);
  if (opts.hint) {
    const h = document.createElement("span");
    h.className = "tm-hint";
    h.textContent = opts.hint;
    b.appendChild(h);
  }
  if (opts.expandable) {
    const a = document.createElement("span");
    a.className = "tm-arrow";
    a.innerHTML = svg("chevronR");
    b.appendChild(a);
  }
  popBind(b, () => {
    if (opts.expandable) {
      tmExpanded[opts.expandable] = !tmExpanded[opts.expandable];
      renderTabMoreMenu();
      /* 不能用 refreshMenu：覆盖层的 pick 流程先 hidePopup（chrome:popup-hidden
         把 menuOpenId 清成 null）再回传点击键，refreshMenu 一看 menuOpenId 不符
         就静默放弃——区段永远展不开、菜单还被悄悄关掉。这里直接按锚点重开。 */
      const anchor = MENU_ANCHORS["tabmore-menu"];
      if (anchor) menuAt("tabmore-menu", anchor);
      return;
    }
    if (opts.run) opts.run();
  });
  return b;
}
function tmSub() {
  const box = document.createElement("div");
  box.className = "tm-sub";
  return box;
}
function tmSubItem(label, opts) {
  opts = opts || {};
  const b = document.createElement("button");
  b.className = "tm-subitem";
  if (opts.iconEl) b.appendChild(opts.iconEl);
  const txt = document.createElement("span");
  txt.className = "tm-label";
  txt.textContent = label;
  b.appendChild(txt);
  popBind(b, () => opts.run && opts.run());
  return b;
}
/* ---------- 整理标签页：结果提示（toast）+ 一步撤销 ----------
   整理是破坏性动作（关重复），执行完必须给反馈和后悔药。toast 画在弹出层
   （矩形模式）：外壳层在网页视图之下，画在外壳里会被网页盖住；矩形模式又保证
   面板之外的点击照常落到网页上。8 分钟内可撤销（主进程只留最后一份现场），
   超时后菜单里的「撤销」行与 toast 一起消失。 */
let lastOrgUi = null; // { at, canUndo, msg }
let toastTimer = null;
function orgMessage(r) {
  if (!r || !r.ok) return "整理失败";
  if (r.action === "close-duplicates") {
    return r.closed > 0
      ? "已关闭 " + r.closed + " 个重复标签" + (r.skipped ? "（" + r.skipped + " 个受保护已跳过）" : "")
      : r.skipped ? "重复标签都在分屏里，已跳过" : "没有找到重复标签";
  }
  if (r.action === "group-by-domain") return r.groups > 0 ? "已按域名建了 " + r.groups + " 个分组" : "没有可建组的同域标签";
  return r.changed > 0 ? "已按站点整理 " + r.changed + " 个标签" : "已经是整理好的顺序";
}
function showToast(msg, canUndoOrOpts) {
  const opts = canUndoOrOpts && typeof canUndoOrOpts === "object" ? canUndoOrOpts : { undo: !!canUndoOrOpts };
  const box = document.createElement("div");
  box.id = "lg-toast";
  box.className = "lg-fake lg-face-b";
  const t = document.createElement("span");
  t.className = "tst-msg";
  t.textContent = msg;
  box.appendChild(t);
  if (opts.undo) {
    const undo = document.createElement("button");
    undo.className = "tst-btn";
    undo.textContent = "撤销";
    popBind(undo, async () => {
      const r = await window.lgChrome.organizeUndo();
      window.lgChrome.popupHide();
      if (r && r.ok) { lastOrgUi = null; toast("已撤销整理"); }
      else toast("撤销失败");
    });
    box.appendChild(undo);
  } else if (opts.action) {
    /* 失败提示不能只是"知道了"：加载失败给重试、下载中断给入口、写盘失败给诊断 */
    const labels = { "retry-load": "重试", downloads: "查看下载", diagnostics: "诊断" };
    const acts = {
      "retry-load": () => window.lgChrome.reload(),
      downloads: () => showDownloadMenu(),
      diagnostics: () => window.lgChrome.openSettings("其他/关于与数据"),
    };
    if (labels[opts.action]) {
      const btn = document.createElement("button");
      btn.className = "tst-btn";
      btn.textContent = labels[opts.action];
      popBind(btn, () => {
        window.lgChrome.popupHide();
        try { acts[opts.action](); } catch (e) {}
      });
      box.appendChild(btn);
    }
  }
  const x = document.createElement("button");
  x.className = "tst-x";
  x.textContent = "×";
  x.title = "关闭提示";
  popBind(x, () => window.lgChrome.popupHide());
  box.appendChild(x);
  window.lgChrome.popupShow({ html: box.outerHTML, fit: "rect", center: true, bottom: true, bottomGap: 18, ...popupThemePayload() });
  clearTimeout(toastTimer);
  // 写盘失败这类"还没好"的提示常驻，直到用户处理（或同一文件写成功后主进程换掉它）
  if (!opts.sticky) {
    toastTimer = setTimeout(() => {
      // 只有 toast 还在台面上才收（期间开了菜单/浮层就别打扰它们）
      if (menuOpenId == null && !flyoutOpen) window.lgChrome.popupHide();
    }, 8000);
  }
}
function toast(msg) {
  showToast(msg, false);
}
function shortName(p) {
  const s = String(p || "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i >= 0 ? s.slice(i + 1) : s;
}
async function runOrganizeUi(action) {
  const r = await window.lgChrome.organizeTabs(action);
  const msg = orgMessage(r);
  lastOrgUi = { at: Date.now(), canUndo: !!(r && r.canUndo), msg };
  showToast(msg, lastOrgUi.canUndo);
}
const orgUndoFresh = () => !!(lastOrgUi && lastOrgUi.canUndo && Date.now() - lastOrgUi.at < 8 * 60 * 1000);

function renderTabMoreMenu() {
  const m = document.getElementById("tabmore-menu");
  m.textContent = "";
  /* 1. 布局开关 */
  m.appendChild(
    tmRow(cfgState.verticalTabs ? "关闭垂直标签页" : "打开垂直标签页", {
      icon: cfgState.verticalTabs ? "railClose" : "railOpen",
      hint: keyHint("vtab-layout"),
      run: () => {
        hideAllMenus();
        window.lgChrome.setConfig({ verticalTabs: !cfgState.verticalTabs });
      },
    })
  );
  /* 1a. 展开 / 收起：与顶部那颗箭头同动作（常驻展开 = 不自动收回、真加宽挤压网页） */
  if (cfgState.verticalTabs) {
    const pinned = cfgState.vtabCollapsed === false;
    m.appendChild(
      tmRow((pinned ? "✓ " : "") + "展开侧栏（常驻，不自动收回）", {
        icon: pinned ? "nailOn" : "nailOff",
        hint: keyHint("vtab"),
        run: () => {
          hideAllMenus();
          togglePin();
        },
      })
    );
  }
  /* 1b. 紧凑模式（Zen Compact）：侧栏收没只留左缘热区，悬停浮出 */
  if (cfgState.verticalTabs) {
    m.appendChild(
      tmRow((cfgState.vtabCompact ? "✓ " : "") + "紧凑模式（自动隐藏侧栏）", {
        icon: "railClose",
        run: () => {
          hideAllMenus();
          window.lgChrome.setConfig({ vtabCompact: !cfgState.vtabCompact });
        },
      })
    );
  }
  /* 1c. 休眠其它标签页（Zen 式卸载后台标签，省内存） */
  m.appendChild(
    tmRow("休眠其它标签页", {
      icon: "sleep",
      run: async () => {
        hideAllMenus();
        await window.lgChrome.sleepOthers();
      },
    })
  );
  /* 2. 整理标签页（三个动作都在分区/保护规则下执行，执行完 toast 报结果+撤销） */
  m.appendChild(tmRow("整理标签页", { icon: "organize", expandable: "org", open: !!tmExpanded.org }));
  if (tmExpanded.org) {
    const sub = tmSub();
    sub.appendChild(tmSubItem("按站点排序（保分组）", { run: () => { hideAllMenus(); runOrganizeUi("sort-domain"); } }));
    sub.appendChild(tmSubItem("关闭重复标签", { run: () => { hideAllMenus(); runOrganizeUi("close-duplicates"); } }));
    sub.appendChild(tmSubItem("按域名自动建组", { run: () => { hideAllMenus(); runOrganizeUi("group-by-domain"); } }));
    m.appendChild(sub);
  }
  if (orgUndoFresh()) {
    m.appendChild(
      tmRow("撤销上一次整理", {
        icon: "organize",
        run: async () => {
          hideAllMenus();
          const r = await window.lgChrome.organizeUndo();
          if (r && r.ok) { lastOrgUi = null; toast("已撤销整理"); }
          else toast("没有可撤销的整理");
        },
      })
    );
  }
  const sep = document.createElement("div");
  sep.className = "am-sep";
  m.appendChild(sep);
  /* 4. 搜索标签页 */
  m.appendChild(
    tmRow("搜索标签页", {
      icon: "searchTab",
      hint: keyHint("tab-search", "Ctrl+Shift+A"),
      run: () => {
        hideAllMenus();
        openTabSearch();
      },
    })
  );
  /* 4b. 设置：面板里的设置键已按 Edge 移除，菜单补一个入口 */
  m.appendChild(
    tmRow("Luogu++ 设置", {
      icon: "sliders",
      hint: keyHint("settings", "F2"),
      run: () => {
        hideAllMenus();
        window.lgChrome.openSettings();
      },
    })
  );
  /* 4c. 关闭类操作：Edge 的标签操作菜单里最常用的三项，不再只藏在
     标签右键原生菜单里。 */
  m.appendChild(
    tmRow("关闭其他标签页", {
      icon: "winClose",
      run: () => { hideAllMenus(); window.lgChrome.closeOthers(); },
    })
  );
  m.appendChild(
    tmRow("关闭右侧标签页", {
      icon: "winClose",
      run: () => { hideAllMenus(); window.lgChrome.closeRight(); },
    })
  );
  /* 5. 打开标签页 */
  m.appendChild(tmRow("打开标签页", { icon: "page", expandable: "tabs", open: !!tmExpanded.tabs }));
  if (tmExpanded.tabs) {
    const sub = tmSub();
    for (const t of tabsState.tabs) {
      sub.appendChild(
        tmSubItem((t.id === tabsState.activeId ? "● " : "") + (t.title || t.url || "新标签页"), {
          iconEl: tabIcon(t),
          run: () => { hideAllMenus(); window.lgChrome.activateTab(t.id); },
        })
      );
    }
    m.appendChild(sub);
  }
  /* 6. 最近关闭 */
  m.appendChild(
    tmRow("重新打开关闭的标签页", {
      icon: "historyClock",
      hint: keyHint("reopen-tab", "Ctrl+Shift+T"),
      run: () => { hideAllMenus(); window.lgChrome.reopenTab(); },
    })
  );
  m.appendChild(tmRow("最近关闭", { icon: "historyClock", expandable: "closed", open: !!tmExpanded.closed }));
  if (tmExpanded.closed) {
    const sub = tmSub();
    if (!tmClosedCache.length) {
      const e = document.createElement("div");
      e.className = "tm-empty";
      e.textContent = "没有最近关闭的标签页";
      sub.appendChild(e);
    }
    for (const c of tmClosedCache) {
      sub.appendChild(
        tmSubItem(c.title || c.url || "标签页", {
          run: () => { hideAllMenus(); window.lgChrome.closedOpen(c.i); },
        })
      );
    }
    m.appendChild(sub);
  }
}
async function openTabMoreMenu(anchor) {
  if (menuOpenId === "tabmore-menu") {
    hideAllMenus();
    return;
  }
  /* 菜单接管弹层：先摘掉浮层的视觉状态（窄条画回来），再让 popupShow 换内容。
     不先 popupHide——那会在菜单出现前空一帧，看起来像闪一下。 */
  handoffFlyout();
  /* 最近关闭在主进程手里：开菜单时现拉（失败就给空表，菜单照常能用） */
  try {
    const r = await window.lgChrome.closedList();
    tmClosedCache = (r && r.list) || [];
  } catch (e) {
    tmClosedCache = [];
  }
  renderTabMoreMenu();
  menuAt("tabmore-menu", anchor);
}

/* ---------- 标签分组面板（Edge 式组菜单） ----------
   组牌右键打开：组名输入（回车/✓ 生效）、10 色选择（data-pop-stay，
   改色不关面板——主进程推新快照后这里按原锚点重发一份）、组中新建、
   取消分组、关闭分组标签页。
   Edge 面板里还有「移动到新窗口」：本应用是单窗口多视图架构，没有
   第二个窗口可移，该能力不照搬（设计日志有记）。 */
let openGroupId = null; // 面板当前开着的组（快照刷新时按它重发面板）
function renderGroupMenu(gid) {
  const g = groupById(gid);
  const menu = document.getElementById("group-menu");
  menu.textContent = "";
  if (!g) return;
  openGroupId = gid;
  /* 组名行：输入框 + ✓（弹出层把输入框回车转到 data-pop-submit 按钮） */
  const nameRow = document.createElement("div");
  nameRow.className = "gm-namerow";
  const inp = document.createElement("input");
  inp.className = "grp-name";
  inp.type = "text";
  inp.maxLength = 40;
  inp.placeholder = "为此组命名";
  inp.value = g.name || "";
  nameRow.appendChild(inp);
  const ok = document.createElement("button");
  ok.className = "gm-ok";
  ok.textContent = "✓";
  ok.title = "确认组名";
  ok.setAttribute("data-pop-submit", "");
  ok.setAttribute("data-pop-value", "input.grp-name");
  popBind(ok, (v) => window.lgChrome.groupUpdate(gid, { name: String(v || "").trim() }));
  nameRow.appendChild(ok);
  menu.appendChild(nameRow);
  /* 10 色选择：stay 键，点了不关面板 */
  const colors = document.createElement("div");
  colors.className = "gm-colors";
  for (const key of GROUP_COLOR_KEYS) {
    const c = document.createElement("button");
    c.className = "gm-color" + (g.color === key ? " sel" : "");
    c.style.setProperty("--gc", GROUP_COLORS[key]);
    c.title = GROUP_COLOR_NAMES[key];
    c.setAttribute("data-pop-stay", "");
    popBind(c, () => window.lgChrome.groupUpdate(gid, { color: key }));
    colors.appendChild(c);
  }
  menu.appendChild(colors);
  const sep = document.createElement("div");
  sep.className = "am-sep";
  menu.appendChild(sep);
  /* 组操作 */
  const acts = [
    ["组中新建标签页", () => window.lgChrome.groupNewTab(gid)],
    [g.collapsed ? "展开分组" : "折叠分组", () => window.lgChrome.groupUpdate(gid, { collapsed: !g.collapsed })],
    ["取消分组", () => window.lgChrome.groupUngroup(gid)],
    ["关闭分组标签页", () => window.lgChrome.groupClose(gid)],
  ];
  for (const [label, run] of acts) {
    const b = document.createElement("button");
    b.className = "am-item gm-item";
    const txt = document.createElement("span");
    txt.className = "tm-label";
    txt.textContent = label;
    b.appendChild(txt);
    popBind(b, run);
    menu.appendChild(b);
  }
}
function showGroupMenu(gid, anchor) {
  if (menuOpenId === "group-menu" && openGroupId === gid) {
    hideAllMenus();
    return;
  }
  handoffFlyout();
  renderGroupMenu(gid);
  menuAt("group-menu", anchor);
}

/* ---------- 垂直栏悬停浮层（Edge 式：悬停 = 整条侧栏长出来） ----------
   站点视图永远画在外壳之上：窄条若只是 CSS 加宽，扩出来的部分会被网页盖住，
   所以展开的那一份画在弹出层（浮在所有视图之上）。关键是**同构**——浮层直接
   克隆外壳的 #vtab（结构/行序/行高/头尾按钮逐像素一致），于是悬停展开只是
   横向加宽、不重排：同一标签在窄条与浮层里的行中心 y 一致，鼠标贴哪一行、
   点下去还是哪一行（上一版"两截并排、点错行"的根因就在这里）。
   页面 inset 仍按窄条算 —— 悬停展开不挤压网页（常驻展开才挤压）。 */
let flyoutOpen = false;
let flyoutTimer = null;
let flyoutGuard = null; /* 兜底：浮层"画好了"的信号没回来时也要把窄条收掉 */
let flyoutSig = "";

/* 头部箭头 = "常驻展开/收起"开关（Edge 顶部那颗；原「钉住」并入它）：
   展开态 = 常驻（不自动收回、真加宽挤压网页）；收起态 = 窄条 + 悬停浮出。
   头按钮与浮层里的箭头共用这一套动作与状态。 */
function syncPinUI() {
  const pin = document.getElementById("btn-vpin");
  if (!pin) return;
  // 紧凑模式下侧栏收没（只留热区），视作"未展开"——点一下就是常驻展开
  const expanded = !document.body.classList.contains("rail") && !document.body.classList.contains("compact");
  pin.classList.toggle("on", expanded);
  /* 图标是一枚钉子：固定（常驻展开）= 竖直实心；未固定（窄条/悬停浮层里）= 斜着。
     Edge 实测：这颗是 pin 开关（固定/自动收起），不是"点一下立即折叠"。 */
  pin.innerHTML = svg(expanded ? "nailOn" : "nailOff");
  pin.title = expanded ? "取消固定（回到窄条，悬停自动展开）" : "固定侧栏（常驻展开，不自动收回）";
}
function togglePin() {
  /* 乐观落定（R36）：本帧就把姿态翻到目标值，主进程的配置回程只做校正。
     等 IPC 回来才动类名的话，悬停浮层先收、常驻侧栏后长——中间会闪一条
     窄条，点钉子也像"没反应"。判据与主进程 toggleVtabPin 完全一致：
     rail / compact 都不算展开。 */
  // 菜单开着时点固定键：先把菜单收掉，别让两层弹层抢同一个视图
  if (menuOpenId) hideAllMenus();
  const expandedNow = !document.body.classList.contains("rail") && !document.body.classList.contains("compact");
  const wantExpanded = !expandedNow;
  document.body.classList.toggle("rail", !wantExpanded);
  if (wantExpanded) document.body.classList.remove("compact");
  syncPinUI();
  // 无论展开还是收起，浮层都收掉：展开=真侧栏接管；收起=回到窄条等悬停
  closeTabFlyout();
  window.lgChrome
    .toggleVtab()
    .then((r) => {
      if (!r) return;
      document.body.classList.toggle("rail", !!r.collapsed);
      // 常驻展开与紧凑互斥（主进程里展开会顺手关掉紧凑）：按回程校正
      if (typeof r.compact === "boolean") {
        document.body.classList.toggle("compact", !!r.compact && !!cfgState.verticalTabs);
      }
      syncPinUI();
    })
    .catch(() => {});
}

function renderTabFlyout(force, anim) {
  /* 内容签名：没变就不重发（重发会重建鼠标下的 DOM，浮层闪烁）。钉住/休眠/
     分组折叠/激活这些结构状态算进签名。loading 不算：它每次加载翻两次，
     重发只会把鼠标下的行换掉；加载态本身已经没有转圈动画，浮层不需要跟着刷。 */
  const sig =
    tabsState.tabs
      .map((t) => [t.id, t.title || "", t.id === tabsState.activeId ? "a" : "", t.pinned ? "p" : "", t.sleeping ? "s" : "", t.group != null ? "g" + t.group : ""].join(":"))
      .join("|") +
    "||" +
    (tabsState.groups || []).map((g) => g.id + ":" + (g.collapsed ? "c" : "") + ":" + (g.name || "")).join(",");
  if (!force && sig === flyoutSig) return;
  flyoutSig = sig;
  const src = document.getElementById("vtab");
  if (!src) return;
  const box = src.cloneNode(true);
  box.id = "tab-flyout";
  const rz = box.querySelector("#vtab-resize");
  if (rz) rz.remove(); // 浮层不是可拖宽的那一层（宽度跟外壳同一个值）
  if (anim) box.dataset.anim = "1"; // popup 量完尺寸后打 .tf-anim（只在首开播）
  /* 行（含钉住行）：点谁切谁、中键关、右键原生菜单、× 关闭。弹层是独立
     webContents，外壳的事件到不了这里：点击靠 data-pop 回传，右键/中键由
     popup 侧按 data-tab-id 走主进程（原生菜单）。 */
  for (const el of box.querySelectorAll(".vtab[data-id]")) {
    const id = Number(el.dataset.id);
    el.dataset.tabId = String(id);
    el.dataset.dragRow = "1"; // popup 侧按它接管拖拽（点一下仍是切换标签）
    const t = tabsState.tabs.find((x) => x.id === id);
    if (t) el.dataset.url = t.url || ""; // 悬停卡片要网址
    const closeEl = el.querySelector(".t-close");
    if (closeEl) {
      /* 关闭叉只关标签，不关浮层：浮层是整条侧栏，用户正在里面连着关几个
         标签时不该每关一个就缩回窄条。data-pop-stay 让弹层走"执行但不 hide"
         的通道；标签快照回来后 renderTabs 会重发浮层内容。 */
      closeEl.setAttribute("data-pop-stay", "");
      popBind(closeEl, () => window.lgChrome.closeTab(id));
    }
    popBind(el, () => { window.lgChrome.activateTab(id); closeTabFlyout(); });
  }
  /* 组头：点一下折叠/展开该组（与侧栏同一个动作）；右键开组面板——面板是外壳
     渲染的 HTML 菜单，锚点必须用外壳里的那块组头（弹层文档里的元素给不出窗口
     坐标）。两处 DOM 同序，按下标配对。 */
  const shellHeads = document.querySelectorAll("#vtab .vghead");
  Array.prototype.forEach.call(box.querySelectorAll(".vghead"), (h, i) => {
    const gid = Number(h.dataset.gid);
    popBind(h, () => {
      const g = groupById(gid);
      window.lgChrome.groupUpdate(gid, { collapsed: !(g && g.collapsed) });
    });
    const shellHead = shellHeads[i];
    if (shellHead) {
      const k = "pk" + ++popSeq;
      popActions[k] = () => showGroupMenu(gid, shellHead);
      h.setAttribute("data-pop-ctx", k);
    }
  });
  /* 头部两颗（⌄ 标签页操作 / 箭头 常驻展开）+ 底部 +、设置：与外壳同一套动作。
     浮层盖住了窄条，这些按钮必须在浮层里点得到——盖住 ≠ 点不到。 */
  /* 头部左键 = 搜索标签页（Edge 实测；不再是「标签页操作」下拉） */
  const searchBtn = box.querySelector("#btn-vsearch");
  if (searchBtn) {
    popBind(searchBtn, () => {
      handoffFlyout(); // 浮层让位给搜索面板（同一视图替换，不先 hide）
      openTabSearch();
    });
  }
  const pinBtn = box.querySelector("#btn-vpin");
  if (pinBtn) popBind(pinBtn, togglePin);
  const newBtn = box.querySelector("#vtab-new");
  if (newBtn) popBind(newBtn, () => { window.lgChrome.newTab(); closeTabFlyout(); });
  /* 矩形弹层（fit:"rect"）：视图只盖住面板本身，面板外的点击直接落到网页/
     外壳上。锚点：左侧模式 = 窗口左上角（al/ay = 0）；右侧模式 = 窗口右缘
     （ar = 0、ay 让开右上角的窗口三键）——两种模式下面板与外壳侧栏同起点，
     行 y 才对得上。
     fullH：整条模式——面板从窗口最顶一直到最底，把窄条完全盖住，和点箭头常驻
     展开的那条侧栏逐像素一致（宽/高由主进程按同一份 inset 裁定，不按内容收）。
     fitPad 全 0：视图与面板严丝合缝，面板外那圈透明投影余量不再盖在网页上吃点击。 */
  const rightSide = document.body.dataset.side === "right";
  window.lgChrome.popupShow({
    html: box.outerHTML,
    fit: "rect",
    fitPad: { l: 0, t: 0, r: 0, b: 0 },
    fullH: true,
    /* 新建分组的预览色（浮层里的"新建分组"小签用它上色）：主进程的调色板
       游标在外壳这边只知道下一个色键，映射成色值一起下发 */
    nextColorHex: GROUP_COLORS[tabsState.nextGroupColor] || GROUP_COLORS.blue,
    /* 两种侧别都从顶栏下沿开始（Edge 结构）：浮层顶边 = 80，
       与外壳 #vtab 的 top:var(--header-h) 完全同矩形 */
    ...(rightSide ? { ar: 0, ay: headerH() } : { al: 0, ay: headerH() }),
    flyout: true,
    ...popupThemePayload(),
  });
}
/* 浮层开着时把外壳窄条整条隐去（CSS 只认这个类）。visibility 不改布局：
   菜单锚点、--vtab-cur、页面 inset 全按原样算，只是不再画——浮层就是那条侧栏，
   两层玻璃叠着会透出窄条的图标与按钮（用户报的"左边窄条还露着、两块拼不上"）。 */
function setFlyoutOpen(on) {
  document.body.classList.toggle("flyout-open", !!on);
}
function openTabFlyout() {
  if (flyoutOpen) return;
  /* 两种"收起来"的姿态都吃悬停浮层：窄条（rail）与紧凑（compact，只剩 4px
     热区）。早先只认 rail，紧凑模式下热区悬停永远不弹——用户说的"侧栏没了、
     鼠标贴上也没反应"。 */
  const shellHidden = document.body.classList.contains("rail") || document.body.classList.contains("compact");
  if (!cfgState.verticalTabs || !shellHidden) return;
  if (menuOpenId) return; // 菜单开着就别抢弹层
  flyoutOpen = true;
  flyoutSig = "";
  /* 窄条先别收：浮层是另一个视图，它第一帧还没画出来就把窄条隐掉，中间那
     一两帧两侧都没有侧栏——用户报的"鼠标放上去闪一下"就是这里。浮层画好会
     回一声 chrome:flyout-shown（popup → 主进程 → 这里）：那一刻浮层与窄条
     是同一份像素（浮层就是 #vtab 的克隆、同矩形），交接零闪烁。
     信号万一没回来（弹层没起来/文档没跑脚本）也有兜底，不许一直露着窄条。 */
  clearTimeout(flyoutGuard);
  flyoutGuard = setTimeout(() => {
    if (!flyoutOpen) return;
    document.body.dataset.flyoutHandoff = "timeout"; // 兜底路径（探针会报这件事）
    setFlyoutOpen(true);
  }, 320);
  renderTabFlyout(true, true); // anim：首次打开播"整条长出来"
}
/* 复位浮层状态，并把窄条立刻画回来。
   旧实现故意保留 flyout-open 等菜单接管，但 closeTabFlyout 在 flyoutOpen
   已经为 false 时早退 → flyout-open 永远留着 → 菜单浮在壁纸上、侧栏整条
   hidden（用户报的"窄条点箭头"bug）。现在任何非浮层弹层接管前都走这里，
   状态与类名不会再分叉。 */
function dismissFlyoutState() {
  flyoutOpen = false;
  flyoutSig = "";
  clearTimeout(flyoutTimer);
  clearTimeout(flyoutGuard);
  setFlyoutOpen(false);
}
function closeTabFlyout() {
  if (!flyoutOpen && !document.body.classList.contains("flyout-open")) return;
  dismissFlyoutState();
  window.lgChrome.popupHide();
}
/* 浮层要把弹层让给菜单/搜索：只复位状态与视觉，不 popupHide——
   下一条 popupShow 会整块替换内容，少一次 hide/show 就没有中间空帧 */
function handoffFlyout() {
  if (!flyoutOpen && !document.body.classList.contains("flyout-open")) return;
  dismissFlyoutState();
  document.body.dataset.flyoutHandoff = "handoff";
}
function anyMenuOpen() {
  return !!menuOpenId;
}
function showAccountMenu() {
  renderAccountMenu();
  menuAt("account-menu", document.getElementById("user-chip"));
}
function hideAccountMenu() {
  if (menuOpenId === "account-menu") hideAllMenus();
}
function refreshAccountMenu() {
  renderAccountMenu();
  refreshMenu("account-menu");
}
function accountMenuOpen() {
  return menuOpenId === "account-menu";
}

/* ---------- 下载 / 历史 ---------- */
let downloadsState = [];

function currentTab() {
  return tabsState.tabs.find((x) => x.id === tabsState.activeId) || null;
}
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function renderDownloadBtn() {
  const btn = document.getElementById("btn-downloads");
  const active = downloadsState.filter((d) => d.state === "progressing").length;
  const failed = downloadsState.filter((d) => d.state === "interrupted").length;
  btn.hidden = downloadsState.length === 0;
  btn.classList.toggle("on", active > 0);
  btn.classList.toggle("dl-err", failed > 0);
  btn.innerHTML = svg("download") + (failed ? '<span class="dl-badge">' + (failed > 9 ? "9+" : failed) + "</span>" : "");
  btn.title = active ? active + " 个下载进行中" : failed ? failed + " 个下载失败" : "下载记录";
}
function showDownloadMenu() {
  if (menuOpenId === "download-menu") { hideAllMenus(); return; }
  hideAllMenus();
  renderDownloadMenu();
  menuAt("download-menu", document.getElementById("btn-downloads"));
}
function renderDownloadMenu() {
  // 「清除已完成的记录」是静态节点，但每次渲染都要重新登记点击键：
  // 覆盖层拿的是 HTML 副本，只认 data-pop 键（menuAt 会按 HTML 修剪键表）
  const clr = document.getElementById("dl-clear");
  if (clr) popBind(clr, async () => {
    const r = await window.lgChrome.downloadClear();
    if (r && r.ok) {
      downloadsState = r.downloads;
      renderDownloadMenu();
      renderDownloadBtn();
      refreshMenu("download-menu"); // 覆盖层同步一份新的（空列表）
    }
  });
  const box = document.getElementById("dl-list");
  box.textContent = "";
  if (!downloadsState.length) {
    const e = document.createElement("div");
    e.className = "am-empty";
    e.textContent = "暂无下载记录。";
    box.appendChild(e);
    return;
  }
  for (const d of downloadsState.slice().reverse()) {
    const row = document.createElement("div");
    row.className = "am-item dl-row";
    const main = document.createElement("div");
    main.className = "dl-main";
    const nm = document.createElement("div");
    nm.className = "dl-name";
    nm.textContent = d.filename;
    nm.title = d.savePath || d.filename;
    const st = document.createElement("div");
    st.className = "dl-state";
    if (d.state === "progressing") {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : null;
      st.textContent = pct == null ? fmtBytes(d.received) : pct + "% · " + fmtBytes(d.received) + " / " + fmtBytes(d.total);
    } else if (d.state === "completed") {
      st.textContent = "已完成 · " + fmtBytes(d.received);
    } else if (d.state === "cancelled") {
      st.textContent = "已取消";
    } else if (d.state === "paused") {
      st.textContent = "已暂停 · " + fmtBytes(d.received);
    } else if (d.state === "interrupted") {
      st.textContent = "已中断";
    } else {
      st.textContent = d.state;
    }
    main.appendChild(nm);
    main.appendChild(st);
    row.appendChild(main);
    /* 按状态给动作（Chrome 语义）：在飞=暂停/取消；暂停=继续/取消；
       完成=打开/另存为；中断=重试。每个动作都是短标签按钮。 */
    const act = (label, title, fn) => {
      const b = document.createElement("button");
      b.className = "dl-open";
      b.textContent = label;
      b.title = title;
      popBind(b, async () => {
        await fn();
        hideAllMenus();
      });
      row.appendChild(b);
    };
    if (d.state === "progressing" && d.canPause) {
      act("暂停", "暂停下载", () => window.lgChrome.downloadPause(d.id));
      act("取消", "取消下载", () => window.lgChrome.downloadCancel(d.id));
    } else if (d.state === "paused") {
      act("继续", "继续下载", () => window.lgChrome.downloadResume(d.id));
      act("取消", "取消下载", () => window.lgChrome.downloadCancel(d.id));
    } else if (d.state === "completed") {
      act("打开", "在文件夹中显示", () => window.lgChrome.downloadReveal(d.id));
      if (d.canSaveAs) act("另存为", "把文件另存到别处", () => window.lgChrome.downloadSaveAs(d.id));
    } else if (d.state === "interrupted" || d.state === "cancelled") {
      act("重试", "重新下载", () => window.lgChrome.downloadRetry(d.id));
      act("移除", "从列表移除记录", () => window.lgChrome.downloadRemove(d.id).then(() => window.lgChrome.downloadList()).then((r) => {
        downloadsState = (r && r.downloads) || [];
        renderDownloadMenu();
        refreshMenu("download-menu");
      }));
    } else {
      act("移除", "从列表移除记录", () => window.lgChrome.downloadRemove(d.id).then(() => window.lgChrome.downloadList()).then((r) => {
        downloadsState = (r && r.downloads) || [];
        renderDownloadMenu();
        refreshMenu("download-menu");
      }));
    }
    box.appendChild(row);
  }
}

/* ---------- 命令面板（Ctrl+Shift+P）与快捷键总览（F1） ---------- */
const SHORTCUTS = [
  ["Ctrl+T", "新建标签页"],
  ["Ctrl+W", "关闭当前标签页"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "下一个 / 上一个标签页"],
  ["Ctrl+R / F5", "重新加载"],
  ["Ctrl+L", "聚焦地址栏"],
  ["Ctrl+I", "打开或切到 IDE 标签页"],
  ["Ctrl+Alt+I", "分屏编辑器（题目右侧并排 IDE）"],
  ["Ctrl+滚轮", "放大 / 缩小页面"],
  ["Ctrl+H", "浏览历史记录"],
  ["Ctrl+=", "放大页面"],
  ["Ctrl+-", "缩小页面"],
  ["Ctrl+0", "重置页面缩放"],
  ["Alt+← / Alt+→", "后退 / 前进"],
  ["F2", "打开 Luogu++ 设置"],
  ["Ctrl+Shift+P", "命令面板"],
  ["F1", "本快捷键总览"],
  ["Ctrl+Q", "退出"],
];
let palItems = [];
let palIndex = 0;
/* 面板两种模式：cmd=命令面板 / keys=快捷键总览（F1）。
   快捷键模式下输入与方向键不许触发命令重渲染，否则列表被刷成命令 */
let palMode = "cmd";
const PAL_PLACEHOLDER = "输入命令…（↑↓ 选择，Enter 执行，Esc 关闭）";

function commands() {
  const list = [
    { title: "新建标签页", hint: keyHint("new-tab", "Ctrl+T"), run: () => window.lgChrome.newTab() },
    {
      title: "关闭当前标签页",
      hint: keyHint("close-tab", "Ctrl+W"),
      run: () => {
        const t = currentTab();
        if (t) window.lgChrome.closeTab(t.id);
      },
    },
    { title: "复制当前标签页", run: () => { const t = currentTab(); if (t) window.lgChrome.duplicateTab(t.id); } },
    { title: "关闭其他标签页", run: () => window.lgChrome.closeOthers() },
    { title: "关闭右侧标签页", run: () => window.lgChrome.closeRight() },
    { title: "重新加载", hint: keyHint("reload", "Ctrl+R"), run: () => window.lgChrome.reload() },
    { title: "打开 IDE 标签页", hint: keyHint("ide", "Ctrl+I"), run: () => window.lgChrome.toggleIde() },
    /* 题目页工具条已删（R36 用户要求）：分屏编辑器改从命令面板进 */
    { title: "分屏编辑器：题目右侧并排 IDE（进入 / 退出）", run: () => window.lgChrome.toggleDrawer() },
    { title: "打开应用首页", hint: keyHint("new-tab", "Ctrl+T"), run: () => window.lgChrome.openHome() },
    { title: "浏览历史记录", hint: keyHint("history", "Ctrl+H"), run: () => window.lgChrome.openHistory() },
    { title: "打开 Luogu++ 设置", hint: keyHint("settings", "F2"), run: () => window.lgChrome.openSettings() },
    { title: "恢复最近关闭的标签页", hint: keyHint("reopen-tab", "Ctrl+Shift+T"), run: () => window.lgChrome.reopenTab() },
    { title: "页内查找", hint: keyHint("find", "Ctrl+F"), run: () => window.lgChrome.findStart() },
    {
      title: "截图当前页",
      hint: keyHint("screenshot", "Ctrl+Shift+S"),
      run: async () => {
        toast("正在截图…");
        const r = await window.lgChrome.screenshot();
        if (r && r.ok) toast("截图已保存：" + shortName(r.file));
        else toast("截图失败：" + ((r && r.message) || "未知错误"));
      },
    },
    {
      title: "截图：完整网页（含滚动）",
      run: async () => {
        toast("正在截取整页，长页面需要几秒…");
        const r = await window.lgChrome.fullshot();
        if (!r || !r.ok) toast("整页截图失败：" + ((r && r.message) || "未知错误"));
        else if (r.full === false) toast("CDP 失败，已保存可视区域截图：" + shortName(r.file));
        else toast("已保存整页截图：" + shortName(r.file));
      },
    },
    { title: "画中画：播放页面视频", run: async () => { const r = await window.lgChrome.pip(); if (!r || !r.ok) toast(r && r.result === "no-video" ? "这个页面没有视频" : "画中画启动失败"); } },
    { title: "阅读模式（进入 / 退出）", hint: keyHint("reader"), run: async () => { const r = await window.lgChrome.reader(); if (r && r.result === "no-content") toast("这个页面没找到正文"); } },
    { title: "翻译整页（原文 / 译文）", hint: keyHint("translate-page"), run: async () => { const r = await window.lgChrome.translatePage(); if (r && !r.ok) toast("翻译启动失败：" + ((r && r.message) || "")); } },
    { title: "整理标签页：按站点排序（保分组）", hint: keyHint("organize", "Ctrl+Shift+O"), run: () => runOrganizeUi("sort-domain") },
    { title: "整理标签页：关闭重复标签", run: () => runOrganizeUi("close-duplicates") },
    { title: "整理标签页：按域名自动建组", run: () => runOrganizeUi("group-by-domain") },
    { title: "撤销上一次整理", run: async () => { const r = await window.lgChrome.organizeUndo(); toast(r && r.ok ? "已撤销整理" : "没有可撤销的整理"); if (r && r.ok) lastOrgUi = null; } },
    {
      title: cfgState.muteAll ? "恢复声音（当前已全局静音）" : "一键全局静音",
      run: async () => {
        const r = await window.lgChrome.muteAll(!cfgState.muteAll);
        if (r && r.ok) cfgState.muteAll = r.muted;
      },
    },
    {
      title: "全屏切换",
      hint: "F11",
      run: () => window.lgChrome.toggleFullscreen(),
    },
    {
      title: "切换标签栏形态（垂直 / 水平）",
      hint: keyHint("vtab-layout"),
      run: async () => {
        // 名实相符：切换垂直/水平布局（以前误接成折叠开关）
        await window.lgChrome.setConfig({ verticalTabs: !cfgState.verticalTabs });
      },
    },
    {
      // 分屏主入口是标签右键菜单（"与当前标签分屏显示"），这里给个顺手默认：
      // 把当前标签与相邻标签左右并排
      title: "分屏：与相邻标签并排显示",
      run: () => {
        const t = currentTab();
        if (!t) return;
        const i = tabsState.tabs.findIndex((x) => x.id === t.id);
        const next = tabsState.tabs[i + 1] || tabsState.tabs[i - 1];
        if (next) window.lgChrome.splitTab(next.id);
      },
    },
    {
      title: "退出分屏",
      run: () => window.lgChrome.unsplitTab(),
    },
    {
      title: "分屏：关闭左侧窗格",
      run: () => {
        const t = currentTab();
        if (t) window.lgChrome.splitCloseSide(t.id, "left");
      },
    },
    {
      title: "分屏：关闭右侧窗格",
      run: () => {
        const t = currentTab();
        if (t) window.lgChrome.splitCloseSide(t.id, "right");
      },
    },
    {
      title: "分屏：反转左右位置",
      run: () => {
        const t = currentTab();
        if (t) window.lgChrome.splitReverse(t.id);
      },
    },
    {
      title: "紧凑模式（自动隐藏垂直侧栏）",
      run: async () => {
        await window.lgChrome.setConfig({ vtabCompact: !cfgState.vtabCompact, verticalTabs: true });
      },
    },
    {
      title: "休眠其它标签页",
      run: () => window.lgChrome.sleepOthers(),
    },
    { title: "放大页面", hint: "Ctrl+=", run: () => window.lgChrome.zoom(1) },
    { title: "缩小页面", hint: "Ctrl+-", run: () => window.lgChrome.zoom(-1) },
    { title: "重置页面缩放", hint: "Ctrl+0", run: () => window.lgChrome.zoom(0) },
    {
      title: "复制当前页面地址",
      run: () => {
        const t = currentTab();
        if (t && t.url) window.lgChrome.copyText(t.url);
      },
    },
    {
      title: "聚焦地址栏",
      hint: "Ctrl+L",
      run: async () => {
        try { await window.lgChrome.focusShell(); } catch (e) {}
        document.getElementById("omni-input").focus();
      },
    },
    { title: "回到洛谷首页", run: () => window.lgChrome.navigate("/") },
    { title: "打开题库", run: () => window.lgChrome.navigate("/problem/list") },
    { title: "打开题单", run: () => window.lgChrome.navigate("/training/list") },
    { title: "打开比赛", run: () => window.lgChrome.navigate("/contest/list") },
    { title: "打开讨论", run: () => window.lgChrome.navigate("/discuss") },
    { title: "打开评测记录", run: () => window.lgChrome.navigate("/record/list") },
    { title: "查看键盘快捷键", hint: "F1", run: () => showShortcuts() },
  ];
  for (const a of accountsState.accounts || []) {
    list.push({
      title: "切换到账号 " + (a.name || a.email),
      hint: a.id === accountsState.activeId ? "当前" : "",
      run: () => window.lgChrome.switchAccount(a.id),
    });
  }
  // 快速切换任意标签：命令面板里直接列出所有打开的页面
  for (const c of tabCommands(false)) list.push(c);
  return list;
}
/* 标签切换条目：命令面板（不含当前标签）与「搜索标签页」面板（含当前标签）共用 */
let tabSearchClosed = [];   // 最近关闭的标签（主进程持有，现拉现用）
function tabCommands(includeCurrent) {
  const out = [];
  for (const t of tabsState.tabs || []) {
    if (!includeCurrent && t.id === tabsState.activeId) continue;
    out.push({
      title: (includeCurrent ? "" : "切换到标签 ") + (t.title || t.url || ""),
      hint: (t.url || "").replace(/^https?:\/\//, "").slice(0, 30),
      /* 搜索标签页（Ctrl+Shift+A）按 Edge 的样子排：图标 + 标题 + 网址 */
      tab: t,
      sub: (t.url || "").replace(/^https?:\/\//, ""),
      run: () => window.lgChrome.activateTab(t.id),
    });
  }
  /* Edge 的标签搜索是两块：已打开的标签 + 「最近关闭」。已关闭的那些常常
     才是真正想找回的（"刚才那个页面叫什么来着"）。closedStack 在主进程
     手里（会话内 20 条），这里现拉现用。 */
  if (includeCurrent) {
    for (const e of tabSearchClosed) {
      out.push({
        title: e.title || e.url || "",
        hint: (e.url || "").replace(/^https?:\/\//, "").slice(0, 30),
        sub: "最近关闭",
        closed: true,
        run: () => window.lgChrome.closedOpen(e.i),
      });
    }
  }
  return out;
}

/* ---------- 命令面板 / 标签搜索 / 快捷键总览（实体在覆盖层） ----------
   外壳层永远在网页视图之下，面板画在这里会被网页盖住（和下拉菜单同一个根因）。
   现在外壳只负责「数据 + 命令」，popup 负责 DOM / 输入 / 键盘：
   - 这里生成带 data-pop="pal:<index>" 的 HTML，push 给覆盖层；
   - popup 本地过滤、↑↓ 选、Enter 回传键；
   - 外壳收到键后执行 palItems[index].run()。
   过滤在 popup 内完成，不跨进程往返，输入法组字不会被重绘打断。 */
let palShown = false;
function escHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function palItemHtml(c, i) {
  const hintText = c.tab ? c.sub : c.hint;
  const text = String((c.title || c.sub || "") + " " + (hintText || "")).toLowerCase();
  const cls = "pal-item" + (i === 0 ? " on" : "") + (c.closed ? " closed" : "");
  let inner = "";
  if (c.tab) { try { inner += tabIcon(c.tab).outerHTML; } catch (e) {} }
  inner += '<span class="pal-title">' + escHtml(c.title || c.sub || "") + "</span>";
  if (hintText) inner += '<span class="pal-hint">' + escHtml(hintText) + "</span>";
  if (palMode === "keys") {
    return '<div class="' + cls + '" data-pal-text="' + escHtml(text) + '">' + inner + "</div>";
  }
  return '<button type="button" class="' + cls + '" data-pop="pal:' + i +
    '" data-pal-text="' + escHtml(text) + '">' + inner + "</button>";
}
function paletteHtml() {
  const all = palMode === "tabs" ? tabCommands(true) : commands();
  palItems = all;
  if (palIndex >= all.length) palIndex = 0;
  let list = "";
  if (palMode === "tabs") {
    list += '<div class="pal-head" id="pal-head" data-total="' + all.length + '">共 ' + all.length + " 个标签</div>";
  }
  if (!all.length) {
    list += '<div class="pal-empty">' + (palMode === "tabs" ? "没有匹配的标签页" : "没有匹配的命令") + "</div>";
  }
  let closedHead = false;
  all.forEach((c, i) => {
    if (c.closed && !closedHead) {
      list += '<div class="pal-head pal-head-closed">最近关闭</div>';
      closedHead = true;
    }
    list += palItemHtml(c, i);
  });
  const ph = palMode === "tabs" ? "搜索标签页（↑↓ 选择，Enter 切换，Esc 关闭）"
    : palMode === "keys" ? "键盘快捷键（Esc 关闭）"
      : PAL_PLACEHOLDER;
  return '<div id="palette"' + (palMode === "tabs" ? ' class="pal-tabs"' : "") +
    ' data-mode="' + palMode + '"><div class="pal-box"><input id="pal-input" type="text" spellcheck="false" autocomplete="off" placeholder="' +
    escHtml(ph) + '"><div id="pal-list">' + list + "</div></div></div>";
}
function pushPalette() {
  palShown = true;
  window.lgChrome.popupShow({ html: paletteHtml(), kind: "palette", focus: "input", ...popupThemePayload() });
}
function paletteOpen() { return palShown; }
function closePalette() {
  palShown = false;
  try { window.lgChrome.popupHide(); } catch (e) {}
}
function runPaletteItem(i) {
  const c = palItems[i];
  palShown = false;
  if (c) setTimeout(() => c.run(), 0);
}
function openPalette() {
  palMode = "cmd";
  palIndex = 0;
  pushPalette();
}
/* 搜索标签页（Ctrl+Shift+A，Edge 同款）：面板只列标签，标题/网址都能筛 */
function openTabSearch() {
  /* 从悬停浮层点搜索键时，浮层要让位给搜索面板（同一视图替换） */
  handoffFlyout();
  palMode = "tabs";
  palIndex = 0;
  pushPalette();
  /* 现拉「最近关闭」补进列表（Edge 的标签搜索有两块）。拉取失败就只列
     已打开的标签，面板照常能用——不能因为一个可选数据源失败就废掉搜索。 */
  try {
    Promise.resolve(window.lgChrome.closedList()).then(
      (r) => {
        tabSearchClosed = (r && r.list) || [];
        if (palMode === "tabs" && palShown) pushPalette();
      },
      () => { tabSearchClosed = []; }
    );
  } catch (e) { tabSearchClosed = []; }
}
function showShortcuts() {
  palMode = "keys";
  palIndex = 0;
  pushPalette();
}
/* 页内查找条（实体同样在覆盖层）：矩形模式只盖住查找栏，页面其余区域照常点。 */
function findbarHtml() {
  return '<div id="findbar"><input id="find-input" type="text" spellcheck="false" autocomplete="off" placeholder="在页面中查找…">' +
    '<span id="find-count"></span>' +
    '<button type="button" data-find="prev" title="上一个 (Shift+Enter)">↑</button>' +
    '<button type="button" data-find="next" title="下一个 (Enter)">↓</button>' +
    '<button type="button" data-find="close" title="关闭 (Esc)">×</button></div>';
}
let findShown = false;
function openFindbar() {
  findShown = true;
  window.lgChrome.popupShow({
    html: findbarHtml(),
    kind: "find",
    fit: "rect",
    ar: 170,
    ay: headerH() + 2,
    focus: "input",
    ...popupThemePayload(),
  });
}
/* 外部（探针/命令）关闭查找条：清高亮 + 收弹层，不能只做一半 */
function closeFindbar() {
  findShown = false;
  try { window.lgChrome.findStop(); } catch (e) {}
  window.lgChrome.popupHide();
}

/* 命令面板 hint：跟真实绑定走（主进程合成表），拿不到才用写死的兜底 */
function keyHint(id, fallback) {
  const rows = cfgState && cfgState.shortcutRows;
  const r = Array.isArray(rows) ? rows.find((x) => x.id === id) : null;
  return r && r.accel ? r.text : fallback || "";
}

/* 水平/垂直切换键：两种布局各挂一颗，图标与提示跟 cfg 走。
   Edge 的入口固定在窗口左上角——水平时是标签条最左，垂直时是标题行最左。 */
function syncVtabToggleUI() {
  const vertical = !!cfgState.verticalTabs;
  const hint = keyHint("vtab-layout");
  for (const btn of document.querySelectorAll(".vtoggle")) {
    btn.innerHTML = svg(vertical ? "railClose" : "railOpen");
    btn.title = (vertical ? "关闭垂直标签页" : "打开垂直标签页") + (hint ? " (" + hint + ")" : "");
    btn.setAttribute("aria-label", vertical ? "关闭垂直标签页" : "打开垂直标签页");
    btn.classList.toggle("on", vertical);
  }
}

/* ---------- 主题 / 布局 ---------- */
function applyConfig(cfg) {
  cfgState = cfg || {};
  const s = document.documentElement.style;
  /* 启动占位（applyConfig({})）不能把主题强制成 light：真实配置到达前先用
     preload 从 additionalArguments 读到的 bootTheme（chrome.html 已透明，
     窗口底色也是主题色）。真实配置到达后仍以 cfg 为准。 */
  const hasCfg = !!(cfg && Object.keys(cfg).length);
  const bootDark = document.documentElement.getAttribute("data-theme") === "dark";
  const dark = hasCfg
    ? (cfg.theme === "dark" || (cfg.theme === "auto" && cfg.resolvedTheme === "dark"))
    : bootDark;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  /* 「映射词」是内部术语：默认 mappings 是空的，写进 placeholder 等于承诺
     一种开箱用不了的输入方式。只有真配了映射才把它显示出来。 */
  const hasMappings = !!(cfg.mappings && Object.keys(cfg.mappings).length);
  const omni = document.getElementById("omni-input");
  if (omni) {
    omni.placeholder = hasMappings
      ? "网址 / 题号 / UID / 搜索词 / 映射词"
      : "网址 / 题号 / UID / 搜索词";
  }
  // 配色预设：主进程按当前明暗算好一组基色随配置下发，这里只负责贴上去。
  // 派生色（--surface-2/--ink-dim/--ink-faint）在 CSS 里由基色 color-mix 得出。
  const pv = cfg.presetVars;
  if (pv) {
    s.setProperty("--bg-base", pv.bgBase);
    s.setProperty("--ink", pv.ink);
  }
  document.documentElement.setAttribute("data-preset", cfg.preset || "ink");
  document.documentElement.setAttribute("data-anim", cfg.animations === false ? "0" : "1");

  /* 材质：主进程 materialPayload() 一次推导（两种皮肤都给同一张映射，键集固定），
     外壳/页面/弹层消费的是**同一份值**——这里的名字就是唯一的 --lg-glass-*，
     --surface / --surface-2 / --hairline 由 material.css 里指回它们。
     以前 flat 皮肤根本不下发（外壳退回不透明的 --surface），页面 flat 又吃
     另一套 → 同一屏两种质感。现在皮肤只改值、不改名字、不改配方。 */
  const mp = cfg.material || null;
  const gv = (mp && (mp.current || (dark ? mp.dark : mp.light))) || null;
  document.documentElement.setAttribute("data-glass", (mp && mp.skin) === "liquid" ? "liquid" : "flat");
  if (gv) {
    for (const k of mp.keys || Object.keys(gv)) {
      const name = (mp.vars && mp.vars[k]) || "--lg-glass-" + String(k).replace(/^glass/, "").toLowerCase();
      s.setProperty(name, gv[k]);
    }
  }
  /* 壁纸基色：材质文件的壁纸层兜底渐变消费它（与页面同一变量） */
  if (pv) s.setProperty("--lg-bg-base", pv.bgBase);

  /* 壁纸：视频走 <video>，静态图走 body::before 的 CSS 变量 */
  const isVideo = !!cfg.wallpaperIsVideo && !!cfg.wallpaperUrl;
  /* 壁纸层 = #wall.lg-wallpaper（material.css 的同一公式、同一组变量，
     与页面/弹层逐字相同）。视频层是它的子元素：静态图与视频共用一层几何、
     一套滤镜、一份视差，外壳与页面不会"一个清楚一个糊"。 */
  document.documentElement.setAttribute("data-lg-bgvideo", isVideo ? "1" : "0");
  const vid = document.getElementById("bg-video");
  if (vid) {
    if (isVideo) {
      if (vid.dataset.src !== cfg.wallpaperUrl) {
        vid.dataset.src = cfg.wallpaperUrl;
        // 优先直接 src=lg-media://（stream:true + 主进程 Range 已实现，直放成功
        // 就省掉整份 blob 内存）；媒体加载器不买账（旧的 MEDIA_ERR_SRC_NOT_SUPPORTED
        // 问题若还在）则 error 一落转 blob 兜底。
        if (vid._lgBlob) { try { URL.revokeObjectURL(vid._lgBlob); } catch (e) {} vid._lgBlob = null; }
        let settled = false;
        const cleanup = () => {
          vid.removeEventListener("error", onErr);
          vid.removeEventListener("loadedmetadata", onMeta);
        };
        const onErr = () => {
          if (settled) return;
          settled = true;
          cleanup();
          /* 字节兜底走 wallVideoBlob 专用通道：lg-wall:video 本体 R41 起只回
             流式 URL，不再随载荷附整份字节 */
          const api = window.lgChrome.wallVideoBlob
            ? window.lgChrome.wallVideoBlob()
            : window.lgChrome.wallVideo();
          api
            .then((r) => {
              if (!r || !r.ok || !r.data) return;
              const u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
              if (vid._lgBlob) { try { URL.revokeObjectURL(vid._lgBlob); } catch (e) {} }
              vid._lgBlob = URL.createObjectURL(new Blob([u8], { type: r.type || "video/webm" }));
              vid.src = vid._lgBlob;
              vid.load();
              const pr = vid.play();
              if (pr && pr.catch) pr.catch(() => {});
            })
            .catch(() => {});
        };
        const onMeta = () => {
          if (settled) return;
          settled = true;
          cleanup();
          const pr = vid.play();
          if (pr && pr.catch) pr.catch(() => {});
        };
        /* 既不 error 也不 loadedmetadata（媒体加载器卡住）的兜底：4s 转 blob，
           与页面注入层 feedBgVideo 同口径 */
        const killer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          window.lgChrome
            .wallVideoBlob()
            .then((r) => {
              if (!r || !r.ok || !r.data) return;
              const u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
              vid._lgBlob = URL.createObjectURL(new Blob([u8], { type: r.type || "video/webm" }));
              vid.src = vid._lgBlob;
              vid.load();
              const pr = vid.play();
              if (pr && pr.catch) pr.catch(() => {});
            })
            .catch(() => {});
        }, 4000);
        vid.addEventListener("error", onErr);
        vid.addEventListener("loadedmetadata", onMeta);
        vid.src = cfg.wallpaperUrl;
        vid.load();
      }
      vid.muted = cfg.wallpaperMute !== false;
      const pr = vid.play();
      if (pr && pr.catch) pr.catch(() => {});
    } else if (vid.dataset.src) {
      vid.dataset.src = "";
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
      // blob URL 也要还回去，否则每切一次壁纸漏一个视频级对象
      if (vid._lgBlob) { try { URL.revokeObjectURL(vid._lgBlob); } catch (e) {} vid._lgBlob = null; }
    }
  }
  s.setProperty("--accent", cfg.accentResolved || cfg.accent || (pv ? pv.ink : dark ? "#e7e7ea" : "#18181b"));
  s.setProperty("--lg-radius", (cfg.radius != null ? cfg.radius : 8) + "px");
  /* 壁纸参数：主进程 wallpaperPayload() 一次算好（同样的 clamp），外壳只贴。
     视频壁纸交给 <video>（在 #wall 里），CSS 背景图让位，两层不叠。 */
  const wp = cfg.wall || { url: cfg.wallpaperUrl, isVideo, blurPx: cfg.wallpaperBlur || 0, dim: cfg.wallpaperDim || 0 };
  s.setProperty("--lg-wall-image", !isVideo && wp.url ? 'url("' + wp.url + '")' : "none");
  s.setProperty("--lg-wall-blur", (wp.blurPx || 0) + "px");
  s.setProperty("--lg-wall-dim", String(wp.dim != null ? wp.dim : 0));
  // 面板里不再放设置入口（Edge 实测没有）：F2 / 命令面板 / 坞齿轮仍在，
  // 「标签页操作」菜单里也补了一行设置。
  // 折叠状态以配置为准（持久化，重启不丢）；展开态下悬停浮层没有存在意义
  document.body.classList.toggle("rail", cfg.vtabCollapsed !== false);
  if (!document.body.classList.contains("rail")) closeTabFlyout();
  renderDownloadBtn();
  /* 头部两颗按 Edge 实测：左=搜索标签页（放大镜），右=固定/自动收起（钉子）。
     「标签页操作」菜单改由侧栏空白处右键打开。 */
  document.getElementById("btn-vsearch").innerHTML = svg("searchTab");
  syncPinUI();
  // 布局：垂直（Edge 式左侧标签栏）/ 水平（顶部标签条）
  const nextLayout = cfg.verticalTabs ? "vertical" : "horizontal";
  /* 布局换了就把浮层/菜单收掉：它们锚在竖栏坐标系里，切到水平后还挂着
     会变成一块浮在壁纸上的旧侧栏。快捷键与按钮两条路径都在这里收口。 */
  if (document.body.dataset.layout && document.body.dataset.layout !== nextLayout) {
    closeTabFlyout();
    if (menuOpenId) hideAllMenus();
  }
  document.body.dataset.layout = nextLayout;
  syncVtabToggleUI();
  syncSiteGlassBtn();
  /* 紧凑模式（Zen Compact）：垂直栏整个收没只留 4px 热区，悬停浮出。
     body.compact 控制 #vtab 隐藏与 #compact-edge 显示（CSS）；页面让位
     由主进程 vtabW()=4 负责（同一份 cfg）。独立一轴：只改宽度，不动钉住态。 */
  document.body.classList.toggle("compact", !!(cfg.verticalTabs && cfg.vtabCompact));
  /* 姿态离开了"收起来"（点箭头钉住 / 切回水平布局）：窄条要露脸接管，浮层标记
     必须摘掉——否则 #vtab 被 flyout-open 一直隐着，界面看着像侧栏没了 */
  if (!document.body.classList.contains("rail") && !document.body.classList.contains("compact")) setFlyoutOpen(false);
  /* 顶栏/底坞/页面共用同一条分界线：--vtab-cur 直接吃主进程 layout 的
     inset().x（紧凑=4 / 窄条=41 / 展开=248）。顶栏现在横跨全宽，
     --vtab-cur 只用于底部坞与旧锚点计算。 */
  document.documentElement.style.setProperty("--vtab-cur", (Number(cfg.vtabCur != null ? cfg.vtabCur : cfg.insetX) || 0) + "px");
  /* 坞的位置（设置页「侧坞」卡片）：left/right 竖列、top/bottom 横条；
     "auto" = 跟随布局（水平左侧 / 垂直底部）。R36：坞是独立覆盖视图——
     这里只写 body[data-dock]（坞视图照抄它决定横/竖排形态），落位在主进程
     dockBounds()；页面不再为它让位，内容从它底下穿过。 */
  const dockPosNow = (cfg.dockPos === "left" || cfg.dockPos === "right" || cfg.dockPos === "top" || cfg.dockPos === "bottom")
    ? cfg.dockPos
    : (cfg.verticalTabs ? "bottom" : "left");
  document.body.dataset.dock = dockPosNow;
  /* 侧栏所在侧（Edge 支持左右）：外壳整体镜像，几何仍吃主进程的 inset */
  document.body.dataset.side = cfg.vtabSide === "right" ? "right" : "left";
  /* 侧栏宽度：展开态吃主进程的 vtabWidth（拖宽窄后主进程是唯一来源）；
     悬停浮层在弹层文档里，靠 cssText 拿到同一个值（两处永远同宽）。
     这里跟主进程 vtabExpandedW() 用同一组夹取（160~400）：外壳那条、浮层那条、
     页面 inset 三者同宽，超出范围的配置值不许在外壳里漏出去 */
  document.documentElement.style.setProperty(
    "--vtab-w",
    Math.min(VTAB_SPEC.maxW, Math.max(VTAB_SPEC.minW, Math.round(Number(cfg.vtabWidth) || VTAB_SPEC.paneW))) + "px"
  );
  renderDock();
  /* 真实配置落地后才解除首帧透明保护（chrome.html 的内联样式按它判断）；
     applyConfig({}) 的启动占位不能解锁，否则又回到白色兜底。 */
  if (cfg && Object.keys(cfg).length) {
    document.documentElement.setAttribute("data-lg-ready", "1");
  }
}

/* ---------- 缩放比例提示（窗口右上角 #zoomhud） ----------
   标签上的缩放徽标已删（R36：标签只留图标+文字），比例改在这里实时显示。
   数据源就是 tabs 快照里活动标签的 zoom（主进程 setZoom → pushTabs），不新增
   IPC。口径：变化时高亮浮出约 1.5 秒；之后只要 ≠100% 留一枚淡色常驻，回到
   100% 整颗隐去。切标签只同步状态、不弹（否则每切一次都闪一下）。 */
const zoomHud = document.getElementById("zoomhud");
let zoomHudLast = null; // null = 还没拿到过任何快照（首份只同步，不弹）
let zoomHudTab = null;
let zoomHudTimer = null;
function zoomHudSync() {
  if (!zoomHud) return;
  const act = (tabsState.tabs || []).find((t) => t.id === tabsState.activeId) || null;
  const z = act && act.zoom ? act.zoom : 1;
  const sameTab = zoomHudTab != null && act && zoomHudTab === act.id;
  const changed = zoomHudLast != null && sameTab && Math.abs(z - zoomHudLast) > 0.001;
  zoomHudLast = z;
  zoomHudTab = act ? act.id : null;
  zoomHud.textContent = Math.round(z * 100) + "%";
  zoomHud.classList.toggle("on", Math.abs(z - 1) > 0.001);
  if (!changed) return;
  zoomHud.classList.add("hot");
  clearTimeout(zoomHudTimer);
  zoomHudTimer = setTimeout(() => zoomHud.classList.remove("hot"), 1500);
}

/* ---------- 事件绑定 ---------- */
function bind() {
  document.getElementById("tab-new").addEventListener("click", () => window.lgChrome.newTab());
  document.getElementById("vtab-new").addEventListener("click", () => window.lgChrome.newTab());
  /* Edge 式布局切换：水平条最左 / 标题行最左各一颗（CSS 按布局互斥显示）。
     点击只写配置，主进程统一落 layout/inset，配置回程再校正图标。 */
  for (const btn of document.querySelectorAll(".vtoggle")) {
    btn.addEventListener("click", () => {
      if (menuOpenId) hideAllMenus();
      closeTabFlyout();
      /* 乐观翻本地值：连点两次不会两次都读到旧的 verticalTabs 而发同一个值 */
      const next = !cfgState.verticalTabs;
      cfgState.verticalTabs = next;
      window.lgChrome.setConfig({ verticalTabs: next });
    });
  }
  const siteGlassBtn = document.getElementById("btn-site-glass");
  if (siteGlassBtn) {
    siteGlassBtn.addEventListener("click", () => {
      const host = currentExternalHost();
      if (!host) return;
      const list = Array.isArray(cfgState.glassExclude) ? cfgState.glassExclude.slice() : [];
      const i = list.findIndex((d) => {
        const x = String(d || "").trim().toLowerCase().replace(/^\.+/, "");
        return x && (host === x || host.endsWith("." + x));
      });
      if (i >= 0) list.splice(i, 1);
      else list.push(host);
      /* 乐观切换按钮态；主进程配置回程会再校正一次 */
      cfgState.glassExclude = list;
      syncSiteGlassBtn();
      window.lgChrome.setConfig({ glassExclude: list });
    });
  }
  initDrag(document.getElementById("tabs"), false);
  /* 垂直拖拽绑在整个侧栏上（不只是标签列表）：钉住区与标签列表之间的拖进/
     拖出也是合法落点（Edge 的拖进钉住区=钉住、拖出=取消钉住）。 */
  initDrag(document.getElementById("vtab"), true);
  /* ---------- 长按后退/前进：弹出访问历史栈（Edge 行为）----------
     按住不放约半秒，弹出一串访问过的页面，点哪条直接跳过去；短按仍是
     单步后退/前进。三个容易漏的点：
       · 长按触发后浏览器仍会补一个 click —— 不抑制的话菜单刚弹出就被
         自己点关（用户看到的现象是"长按没反应"）
       · 按下后手抖/拖动超过 5px 要当取消，否则拖窗口时误弹菜单
       · 那一侧没有历史时（canBack/canFwd 为假）按住也不该弹 */
  const NAV_HOLD_MS = 500;
  const NAV_HOLD_SLOP = 5;
  let navHold = null;
  let navHoldFired = false;

  function navHoldCancel() {
    if (navHold && navHold.timer) clearTimeout(navHold.timer);
    navHold = null;
  }
  function navHoldStart(e, dir) {
    navHoldCancel();
    const tab = (tabsState.tabs || []).find((t) => t.id === tabsState.activeId);
    const canGo = dir < 0 ? tab && tab.canBack : tab && tab.canFwd;
    if (!canGo) return;
    const btn = e.currentTarget;
    navHold = {
      dir,
      btn,
      tabId: tab.id,
      x: e.clientX || 0,
      y: e.clientY || 0,
      timer: setTimeout(function () { navHoldFire(); }, NAV_HOLD_MS),
    };
  }
  async function navHoldFire() {
    if (!navHold) return;
    const h = navHold;
    navHold = null;
    navHoldFired = true; // 抑制紧随其后的那次 click
    try {
      const res = await window.lgChrome.navHistory(h.tabId);
      if (!res || !res.ok || !res.list || !res.list.length) { navHoldFired = false; return; }
      showNavHistory(res, h.btn);
    } catch (e) { navHoldFired = false; }
  }
  /* 主进程只提供单步 back/forward，所以"跳到第 i 条"= 连续走 |i - index| 步。
     每步之间留一点间隔：goBack 是异步的，连着发会被前一次导航打断。 */
  async function jumpNavHistory(index, target) {
    const steps = Math.abs(target - index);
    const dir = target > index ? 1 : -1;
    for (let k = 0; k < steps; k++) {
      if (dir < 0) await window.lgChrome.back();
      else await window.lgChrome.forward();
      await new Promise((r) => setTimeout(r, 70));
    }
  }
  function showNavHistory(res, anchor) {
    const box = document.createElement("div");
    box.className = "nav-hist";
    box.setAttribute("role", "menu");
    res.list.forEach((it) => {
      const row = document.createElement("button");
      row.className = "nh-row" + (it.active ? " on" : "");
      let host = "", path = "";
      try {
        const u = new URL(it.url);
        host = u.hostname;
        path = ((u.pathname || "/") + (u.search || "")).slice(0, 40);
      } catch (e) { path = String(it.url || "").slice(0, 40); }
      row.innerHTML =
        '<span class="nh-mark"></span><span class="nh-text">' +
        '<span class="nh-title"></span><span class="nh-url"></span></span>';
      row.querySelector(".nh-mark").textContent = it.active ? "●" : it.forward ? "›" : "‹";
      row.querySelector(".nh-title").textContent = it.title || host || it.url;
      row.querySelector(".nh-url").textContent = host + path;
      popBind(row, function () {
        window.lgChrome.popupHide();
        jumpNavHistory(res.index, it.i);
      });
      box.appendChild(row);
    });
    const r = anchor.getBoundingClientRect();
    const degenerate = !anchor.isConnected || (r.width === 0 && r.height === 0);
    window.lgChrome.popupShow({
      html: box.outerHTML,
      ax: degenerate ? Math.max(8, Math.round(window.innerWidth - 8)) : Math.round(r.left),
      ay: degenerate ? headerH() : Math.round(r.bottom + 6),
      ...popupThemePayload(),
    });
  }
  function bindNavHoldButton(btn, dir) {
    if (!btn) return;
    btn.addEventListener("pointerdown", (e) => navHoldStart(e, dir));
    btn.addEventListener("pointermove", (e) => {
      if (!navHold) return;
      const dx = Math.abs((e.clientX || 0) - navHold.x);
      const dy = Math.abs((e.clientY || 0) - navHold.y);
      if (dx > NAV_HOLD_SLOP || dy > NAV_HOLD_SLOP) navHoldCancel();
    });
    btn.addEventListener("pointerup", navHoldCancel);
    btn.addEventListener("pointerleave", navHoldCancel);
    btn.addEventListener("pointercancel", navHoldCancel);
    /* 长按时浏览器仍会补一个 click：这一次要吃掉，否则菜单刚弹出就被自己点关 */
    btn.addEventListener("click", () => {
      if (navHoldFired) { navHoldFired = false; return; }
      if (dir < 0) window.lgChrome.back();
      else window.lgChrome.forward();
    });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  bindNavHoldButton(document.getElementById("btn-back"), -1);
  bindNavHoldButton(document.getElementById("btn-fwd"), 1);
  document.getElementById("btn-reload").addEventListener("click", () => window.lgChrome.reload());
  /* 头部左键 = 搜索标签页（Edge 实测） */
  document.getElementById("btn-vsearch").addEventListener("click", (e) => {
    e.stopPropagation();
    openTabSearch();
  });
  document.getElementById("btn-vpin").addEventListener("click", togglePin);
  /* 「标签页操作」菜单：面板里不再放第三颗按钮，右键侧栏空白处打开
     （Edge 的竖栏头也只有搜索 + 固定两颗） */
  document.getElementById("vtab").addEventListener("contextmenu", (e) => {
    if (e.target.closest(".vtab, .vghead, #vtab-head, #vtab-new, #vtab-resize")) return;
    e.preventDefault();
    const anchor = document.createElement("span");
    anchor.style.cssText = "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:1px;height:1px;pointer-events:none";
    document.body.appendChild(anchor);
    Promise.resolve(openTabMoreMenu(anchor)).finally(() => anchor.remove());
  });
  /* 拖侧栏右缘改宽度（Edge）：拖动中本地改 --vtab-w（跟手、不闪烁），
     40ms 节流把宽度报给主进程（页面 inset 由它重算）；松手再落定一次。 */
  const rz = document.getElementById("vtab-resize");
  if (rz) {
    let rzOn = false;
    let rzLast = 0;
    let rzW = Number(cfgState.vtabWidth) || VTAB_SPEC.paneW;
    rz.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      rzOn = true;
      rzW = Number(cfgState.vtabWidth) || VTAB_SPEC.paneW;
      rz.classList.add("dragging");
      try { rz.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    rz.addEventListener("pointermove", (e) => {
      if (!rzOn) return;
      /* 侧栏在右侧时，宽度 = 窗口右缘到光标的距离（手柄贴在左缘） */
      const rightSide = document.body.dataset.side === "right";
      const raw = rightSide ? window.innerWidth - e.clientX : e.clientX;
      rzW = Math.max(VTAB_SPEC.minW, Math.min(VTAB_SPEC.maxW, Math.round(raw)));
      document.documentElement.style.setProperty("--vtab-w", rzW + "px");
      const now = Date.now();
      if (now - rzLast > 40) {
        rzLast = now;
        window.lgChrome.setVtabWidth(rzW);
      }
    });
    const rzEnd = () => {
      if (!rzOn) return;
      rzOn = false;
      rz.classList.remove("dragging");
      window.lgChrome.setVtabWidth(rzW); // 节流可能漏掉最后一帧，落定补一次
    };
    rz.addEventListener("pointerup", rzEnd);
    rz.addEventListener("pointercancel", rzEnd);
  }
  /* 标签页操作菜单（Edge 式）：水平标签条左端保留一颗入口 */
  document.getElementById("tabs-more").innerHTML = svg("tabMore");
  document.getElementById("tabs-more").addEventListener("click", (e) => {
    e.stopPropagation();
    openTabMoreMenu(e.currentTarget);
  });
  syncPinUI();
  /* 垂直窄条悬停浮层（Edge）：鼠标贴上窄条 80ms 浮出完整列表。
     开由外壳负责；关只认主进程的光标轮询（矩形模式下面板不再盖住窄条，
     光标在"窄条 ∪ 面板"并集里来回都不会误判）。外壳不做 mouseleave 关闭、
     浮层自己也不做——跨视图的事件接力正是当年"悬停闪烁"的来源。 */
  const vtabEl = document.getElementById("vtab");
  vtabEl.addEventListener("mouseenter", () => {
    clearTimeout(flyoutTimer);
    /* 鼠标贴上窄条 80ms 浮出：够快（Edge 那一档），又不会"光标只是扫过左缘"
       就误弹——50ms 时误触太频繁，是上一版手感别扭的一半原因 */
    flyoutTimer = setTimeout(openTabFlyout, 80);
  });
  vtabEl.addEventListener("mouseleave", () => {
    clearTimeout(flyoutTimer);
  });
  /* 紧凑模式（Zen Compact）的左缘热区：侧栏收没时只剩这条 4px，贴上就
     浮出完整侧栏（与窄条悬停同一个浮层，收回逻辑也复用） */
  const edgeEl = document.getElementById("compact-edge");
  if (edgeEl) {
    edgeEl.addEventListener("mouseenter", () => {
      clearTimeout(flyoutTimer);
      flyoutTimer = setTimeout(openTabFlyout, 80);
    });
    edgeEl.addEventListener("mouseleave", () => clearTimeout(flyoutTimer));
  }
  /* 分屏分割条池：几何由主进程 chrome:split 推下来（{ bars:[...] }，条数随
     布局变——等分列 2 条、网格 3 条、聚焦时 0 条）。每条独占一个比例字段
     （colRatio/rowRatio/colRatio2/rowRatio2），拖拽按比例换算回传（50ms
     节流），双击回该字段的布局均分默认（发 null）。invert 条（主右/主下
     的主副分界条）换算时取 1-raw。条嵌在窗格之间的缝里，缝里没有视图
     覆盖，所以外壳能直接收到指针事件。 */
  const splitBarsBox = document.getElementById("splitbars");
  const splitBarPool = [];
  const makeSplitBar = () => {
    const el = document.createElement("div");
    el.className = "sb-bar";
    el.hidden = true;
    const line = document.createElement("div");
    line.className = "sb-line";
    el.appendChild(line);
    const bar = { el, rect: null, dragging: false, lastSend: 0 };
    const ratioOf = (e) => {
      if (!bar.rect || !bar.rect.span) return 0.5;
      const pos = bar.rect.vertical ? e.clientX : e.clientY;
      const raw = (pos - bar.rect.base) / bar.rect.span;
      return bar.rect.invert ? 1 - raw : raw;
    };
    el.addEventListener("pointerdown", (e) => {
      if (!bar.rect || e.button !== 0) return;
      bar.dragging = true;
      el.classList.add("drag");
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      if (!bar.dragging || !bar.rect) return;
      const now = Date.now();
      if (now - bar.lastSend < 50) return;
      bar.lastSend = now;
      window.lgChrome.splitRatio(tabsState.activeId, ratioOf(e), bar.rect.field);
    });
    const finish = (e) => {
      if (!bar.dragging) return;
      bar.dragging = false;
      el.classList.remove("drag");
      if (e && e.clientX != null && bar.rect) {
        window.lgChrome.splitRatio(tabsState.activeId, ratioOf(e), bar.rect.field);
      }
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("dblclick", () => {
      if (bar.rect) window.lgChrome.splitRatio(tabsState.activeId, null, bar.rect.field);
    });
    splitBarsBox.appendChild(el);
    return bar;
  };
  window.lgChrome.onSplit((r) => {
    const list = r && Array.isArray(r.bars) ? r.bars : [];
    while (splitBarPool.length < list.length) splitBarPool.push(makeSplitBar());
    for (let i = 0; i < splitBarPool.length; i++) {
      const bar = splitBarPool[i];
      const rect = list[i] || null;
      bar.rect = rect;
      if (!rect) {
        bar.el.hidden = true;
        continue;
      }
      bar.el.hidden = false;
      bar.el.classList.toggle("sb-v", !!rect.vertical);
      bar.el.classList.toggle("sb-h", !rect.vertical);
      bar.el.style.left = rect.x + "px";
      bar.el.style.top = rect.y + "px";
      bar.el.style.width = rect.w + "px";
      bar.el.style.height = rect.h + "px";
    }
  });
  /* 壁纸视差：数值唯一权威在主进程（它缓动一次，把同一份 --par-x/y 发给
     外壳、前台页面、弹层）。外壳不再自己 lerp——以前页面与外壳各跑一份缓动，
     两层壁纸在运动中永远差半个身位，坞边能看出错位。 */
  window.lgChrome.onParallax((p) => {
    const s2 = document.documentElement.style;
    s2.setProperty("--par-x", (p && p.px) || "0px");
    s2.setProperty("--par-y", (p && p.py) || "0px");
  });
  /* 双击标签条空白 = 新建标签页（Edge/Chrome 肌肉记忆）；换壁纸挪到右键，
     避免两个高频手势抢同一个双击。 */
  const stripPad = document.getElementById("strip-pad");
  if (stripPad) {
    stripPad.addEventListener("dblclick", () => window.lgChrome.newTab());
    stripPad.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      window.lgChrome.wallNext();
    });
  }
  document.getElementById("vtabs").addEventListener("dblclick", (e) => {
    if (e.target === e.currentTarget) window.lgChrome.newTab();
  });
  // 窗口控制按钮
  document.getElementById("w-min").innerHTML = svg("winMin");
  document.getElementById("w-max").innerHTML = svg("winMax");
  document.getElementById("w-close").innerHTML = svg("winClose");
  document.getElementById("w-min").addEventListener("click", () => window.lgChrome.winMinimize());
  document.getElementById("w-max").addEventListener("click", () => window.lgChrome.winToggleMax());
  document.getElementById("w-close").addEventListener("click", () => window.lgChrome.winClose());
  /* 页内查找条（Ctrl+F）：实体在覆盖层，外壳只负责开面板 */
  window.lgChrome.onFindShortcut(() => openFindbar());
  // 点空白处收起下拉（菜单与它们各自的按钮都在放行名单里）
  document.addEventListener("click", (e) => {
    if (!anyMenuOpen()) return;
    if (e.target.closest("#account-menu, #download-menu, #user-chip, #btn-downloads")) return;
    hideAllMenus();
  });
  const omni = document.getElementById("omni-input");
  omni.addEventListener("focus", () => omni.select());
  /* 输入法组字期间不发联想、不响应回车/方向键（R39）：
     - input 事件在组字过程中连续触发（拼音串），发出去的是半成品；
     - Enter 是"确认候选词"、↑↓ 是"选候选词"——都不该动联想列表，更不能
       顺手导航（"打中文按回车就跳走"就是这个）。
     compositionend 之后补一次联想，拿的是已上屏的正文。 */
  const omniComposing = () => { try { return !!omni.isComposing; } catch (e) { return false; } };
  omni.addEventListener("input", () => {
    if (omniComposing()) return;
    sugSel = -1; // 输入变化即复位选中：回车按输入内容走，不按建议走
    clearTimeout(sugTimer);
    sugTimer = setTimeout(fetchSuggest, 120);
  });
  omni.addEventListener("compositionend", () => {
    sugSel = -1;
    clearTimeout(sugTimer);
    sugTimer = setTimeout(fetchSuggest, 120);
  });
  omni.addEventListener("blur", () => {
    // 点弹层里的行会先把它 blur 掉：给回传留一点时间，别把点击吞掉
    setTimeout(() => { if (sugOpen) closeSuggest(); }, 220);
  });
  omni.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 组字中的按键一律不算数
    if (e.key === "Enter") {
      if (sugOpen && sugSel >= 0 && sugItems[sugSel]) {
        e.preventDefault();
        runSuggest(sugItems[sugSel]);
        return;
      }
      /* Alt+Enter = 新标签打开（Chrome/Edge 同款；R40） */
      omniSubmit(e.altKey);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!sugOpen || !sugItems.length) return;
      e.preventDefault();
      const n = sugItems.length;
      // sugSel 默认 -1（没选中）：↓ 从第一行开始、↑ 从最后一行开始，之后循环
      if (e.key === "ArrowDown") sugSel = sugSel < 0 ? 0 : (sugSel + 1) % n;
      else sugSel = sugSel < 0 ? n - 1 : (sugSel - 1 + n) % n;
      paintSugSel();
    } else if (e.key === "Tab" && sugOpen && sugItems.length) {
      // Tab / Shift+Tab 也能在建议里走（Edge 同款），不夺焦点
      e.preventDefault();
      const n = sugItems.length;
      if (e.shiftKey) sugSel = sugSel < 0 ? n - 1 : (sugSel - 1 + n) % n;
      else sugSel = sugSel < 0 ? 0 : (sugSel + 1) % n;
      paintSugSel();
    } else if (e.key === "Escape") {
      if (sugOpen) { closeSuggest(); return; }
      omni.blur();
      syncOmni();
    }
  });
  /* 悬停高亮回传（popup.js → 主进程 → 这里）：选中跟着鼠标走，回车执行的
     就是鼠标指着的那一行（Chrome/Edge 同款）。 */
  if (window.lgChrome.onSugHover) {
    window.lgChrome.onSugHover((i) => {
      const idx = Number(i);
      if (!sugOpen || !sugItems[idx]) return;
      if (idx === sugSel) return;
      sugSel = idx;
      paintSugSel();
    });
  }
  document.getElementById("btn-stop").addEventListener("click", () => window.lgChrome.stop());
  // 中键点击空白标签条区域新建（点在标签上不算空白——双保险，标签自己也拦了冒泡）
  document.getElementById("tabstrip").addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
    if (e.target.closest(".tab, .vtab")) return;
    window.lgChrome.newTab();
  });
  // 账号芯片 → 下拉
  document.getElementById("user-chip").addEventListener("click", (e) => {
    e.preventDefault();
    if (accountMenuOpen()) hideAccountMenu();
    else showAccountMenu();
  });
  // 下载面板：按钮此前只渲染不绑定，点下去毫无反应（下载记录无处可看）
  document.getElementById("btn-downloads").addEventListener("click", () => showDownloadMenu());
  document.getElementById("am-manage").addEventListener("click", () => {
    hideAccountMenu();
    window.lgChrome.openSettings();
  });
  document.addEventListener("mousedown", (e) => {
    if (!accountMenuOpen()) return;
    if (switchJob) return; // 切换/登录验证码进行中：菜单不许被外面点掉
    const menu = document.getElementById("account-menu");
    const chip = document.getElementById("user-chip");
    if (!menu.contains(e.target) && !chip.contains(e.target)) hideAccountMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && accountMenuOpen()) hideAccountMenu();
    if (e.key === "Escape") selClear(); // 多选：Esc 清空选择
  });
  // Ctrl+L（菜单加速键）→ 聚焦地址栏
  window.lgChrome.onFocusOmni(() => {
    omni.focus();
    omni.select();
  });
}

if (!window.lgChrome) {
  document.body.innerHTML =
    '<div class="lg-err">chrome 桥接失败：preload-chrome.js 未加载</div>';
} else {
  window.lgChrome.onTabs((s) => {
    tabsState = s;
    zoomHudSync();
    renderTabs();
    // 「打开标签页」区段正展开着：标签变化要实时重发菜单（关了一个还躺在列表里就露馅）
    if (menuOpenId === "tabmore-menu" && tmExpanded.tabs) {
      renderTabMoreMenu();
      refreshMenu("tabmore-menu");
    }
    /* 分组面板开着：改色/改名/折叠后按原锚点重发一份（stay 键不关面板，
       面板里的选中态与输入框由弹出层的 input 回填机制保住） */
    if (menuOpenId === "group-menu" && openGroupId != null) {
      if (!groupById(openGroupId)) hideAllMenus(); // 组没了（关闭/取消分组）
      else {
        renderGroupMenu(openGroupId);
        refreshMenu("group-menu");
      }
    }
  });
  window.lgChrome.onUser((u) => {
    userState = u;
    renderUser();
    renderDock(); // 坞里 uid 相关入口（评测记录/个人主页）跟着登录态换
  });
  window.lgChrome.onAccounts((a) => {
    accountsState = a || { accounts: [], activeId: "" };
    renderUser();
    // 菜单正开着要把新 HTML 重发给覆盖层，光重渲外壳 DOM 覆盖层还是旧列表
    if (accountMenuOpen()) refreshAccountMenu();
  });
  window.lgChrome.onConfig((c) => {
    applyConfig(c);
  });
  window.lgChrome.onDownloads((list) => {
    downloadsState = Array.isArray(list) ? list : [];
    renderDownloadBtn();
    // 外壳文档里的 #download-menu 恒 hidden（实体在覆盖层），不能看 hidden 判断；
    // 菜单开着就重渲一份并推给覆盖层，进度条才不是死的
    if (menuOpenId === "download-menu") {
      renderDownloadMenu();
      refreshMenu("download-menu");
    }
  });
  window.lgChrome.onWinState((s) => {
    const b = document.getElementById("w-max");
    if (!b) return;
    const mx = !!(s && s.maximized);
    b.innerHTML = svg(mx ? "winRestore" : "winMax");
    b.title = mx ? "还原" : "最大化";
  });
  /* F11 全屏：鼠标贴到屏幕顶边时主进程把顶栏让出来，侧栏/坞仍然隐藏。
     外壳只负责在 peek 时把竖栏收掉（顶栏本身由主进程的视图几何露出）。 */
  if (window.lgChrome.onFsPeek) {
    window.lgChrome.onFsPeek((on) => {
      document.body.classList.toggle("fs-peek", !!on);
    });
  }
  window.lgChrome.onPalette(() => (paletteOpen() ? closePalette() : openPalette()));
  window.lgChrome.onTabSearch(() => (paletteOpen() && palMode === "tabs" ? closePalette() : openTabSearch()));
  window.lgChrome.onShortcuts(() => showShortcuts());
  // 覆盖层里的菜单项被点中：按登记的键执行（业务逻辑全留在这一层）。
  // 载荷 {k, v}：v 是 data-pop-value 项顺带读回的输入值（验证码提交用）
  window.lgChrome.onPopupPicked((p) => {
    const k = p && typeof p === "object" ? p.k : p;
    /* 命令面板/标签搜索/快捷键总览的条目：实体在覆盖层，键回到这里执行 */
    if (/^pal:\d+$/.test(String(k || ""))) {
      try { document.body.dataset.lgPicked = String(k); } catch (e) {}
      runPaletteItem(Number(String(k).slice(4)));
      return;
    }
    const fn = popActions[k];
    /* 面包屑（链路第二跳）：键到了外壳没有、外壳手里有没有这个键——
       "菜单看得见点下去没反应"的排查就靠这两条 */
    try {
      document.body.dataset.lgPicked = String(k || "");
      document.body.dataset.lgPickedHit = typeof fn === "function" ? "1" : "0";
    } catch (e) {}
    if (typeof fn === "function") {
      try { fn(p && typeof p === "object" ? p.v : undefined); } catch (e) {}
    }
  });
  // 覆盖层自己关掉了（点空白 / Esc）：外壳的 menuOpenId 要跟着归零，
  // 否则下一次点按钮会被当成"关菜单"空转一次
  /* 浮层画好了（popup → 主进程 → 这里）：这一刻它和窄条逐像素相同，收窄条
     不会露空。悬停"闪一下"的根就是窄条先隐、浮层后到。 */
  if (window.lgChrome.onFlyoutShown) {
    window.lgChrome.onFlyoutShown(() => {
      if (!flyoutOpen) return;
      clearTimeout(flyoutGuard);
      // 面包屑：探针据此断言"是浮层画好才收的窄条"，而不是兜底定时器兜的
      document.body.dataset.flyoutHandoff = "1";
      setFlyoutOpen(true);
    });
  }
  window.lgChrome.onPopupHidden(() => {
    menuOpenId = null;
    palShown = false;
    findShown = false;
    clearTimeout(flyoutGuard);
    openGroupId = null; // 分组面板关了，开着的组 id 一起归零
    // 悬停浮层也是弹层内容：它关了状态要一起复位（光标离开面板被主进程收回）
    flyoutOpen = false;
    setFlyoutOpen(false);
    // 联想面板同理（点空白/Esc 被弹层自己关掉时）
    sugOpen = false;
    sugItems = [];
    glanceState = null; // 速览壳被点掉/Esc：状态归零（视图主进程已收）
    /* 关路径握手（R36）：这一刻窄条/常驻侧栏已经画回来了，回一声主进程才真
       把弹层视图隐掉。原来主进程先隐、这边后摘 flyout-open，中间至少一帧
       侧栏整条消失（悬停收回"闪一下"的根）。 */
    document.body.dataset.flyoutClose = "ack";
    if (window.lgChrome.popupHiddenAck) {
      try { window.lgChrome.popupHiddenAck(); } catch (e) {}
    }
  });
  /* 主进程侧发起的整理（快捷键 / 标签右键的原生子菜单）也走同一套提示 */
  window.lgChrome.onOrganizeDone((r) => {
    const msg = orgMessage(r);
    lastOrgUi = { at: Date.now(), canUndo: !!(r && r.canUndo), msg };
    showToast(msg, lastOrgUi.canUndo);
  });
  /* 主进程侧其它动作的提示（多选建组这类原生菜单里的操作） */
  if (window.lgChrome.onToast) {
    window.lgChrome.onToast((m) => {
      if (m && typeof m === "object") showToast(String(m.msg || ""), { action: m.action, sticky: !!m.sticky });
      else toast(m);
    });
  }

  /* Glance 链接速览（Zen 式）：主进程开好卡片视图后推 chrome:glance，
     外壳画壳（调光遮罩 + 卡片顶栏）；顶栏按钮走 popActions。卡片本体是
     独立 WebContentsView（主进程摆位），壳只负责遮罩与按钮。 */
  let glanceState = null; // { url, rect }
  const glanceEsc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const showGlanceShell = () => {
    if (!glanceState) return;
    const r = glanceState.rect;
    const barH = 34;
    const barY = Math.max(4, Math.round(r.y) - barH);
    let host = glanceState.url;
    try { host = new URL(glanceState.url).host; } catch (e) {}
    const html =
      '<div id="glance-wrap">' +
      '<div class="gl-dim" data-pop="glance-close"></div>' +
      '<div class="gl-bar" style="left:' + Math.round(r.x) + "px; top:" + barY + "px; width:" + Math.round(r.width) +
      'px; --pop-x:' + Math.round(r.x) + "px; --pop-y:" + barY + 'px">' +
      '<span class="gl-title">' + glanceEsc(host) + " · " + glanceEsc(glanceState.url) + "</span>" +
      '<span class="gl-btn primary" data-pop="glance-open">在标签页打开</span>' +
      '<span class="gl-btn" data-pop="glance-close">关闭 ✕</span>' +
      "</div></div>";
    popActions["glance-close"] = () => { glanceState = null; window.lgChrome.glanceClose(); };
    popActions["glance-open"] = () => { glanceState = null; window.lgChrome.glancePromote(); };
    window.lgChrome.popupShow({ html, kind: "glance", ...popupThemePayload() });
  };
  window.lgChrome.onGlance((p) => {
    if (!p || !p.url) return;
    glanceState = { url: p.url, rect: p.rect || { x: 60, y: 60, width: 800, height: 600 } };
    showGlanceShell();
  });
  window.lgChrome.onGlanceRect((p) => {
    if (!glanceState || !p || !p.rect) return;
    glanceState.rect = p.rect;
    showGlanceShell(); // 窗口尺寸变了：壳跟着重摆
  });

  bind();
  /* 真实配置到达前先用主进程传来的首帧主题（preload 从 additionalArguments
     读）。外壳此前的 applyConfig({}) 会强制 light，深色用户会先看到一帧浅色。 */
  const bootTheme = window.lgChrome && window.lgChrome.bootTheme;
  if (bootTheme === "dark" || bootTheme === "light") {
    document.documentElement.setAttribute("data-theme", bootTheme);
  }
  applyConfig({});
  renderDock();
  renderUser();
}
