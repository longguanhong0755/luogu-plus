/* LuoguLab — 坞覆盖层运行时（R36）
   坞从外壳层搬到独立覆盖视图：页面内容从它底下穿过（不再让位），坞只是一条
   悬浮在页面之上的栏。外壳仍是渲染者（图标/选中态/文案零重复）：它把坞的
   HTML 与整套主题变量经主进程 dock:sync 推过来，这一层只做三件事——
   照抄主题、量自己的尺寸上报（主进程据此把视图落到胶囊矩形）、把点击回传给
   主进程（业务规则全在主进程，与旧的外壳 dockTarget 逐条一致）。
   材质：面走 .lg-fake（假壁纸 + 与外壳同源的同值上色），与弹层同一条路。 */
const root = document.getElementById("dock");
let viewX = 0;
let viewY = 0;
let winW = 0;
let winH = 0;

function applyGeometry(p) {
  const de = document.documentElement;
  /* 方向跟主进程解析后的位置走：dock:rect 每次落位都带一份（配置刚改、外壳
     还没重发 dock:sync 时，坞不会带着旧方向落位成"两条"）。 */
  if (p.dock === "left" || p.dock === "right" || p.dock === "top" || p.dock === "bottom") {
    document.body.dataset.dock = p.dock;
  }
  winW = Math.round(p.winW || p.w || window.innerWidth);
  winH = Math.round(p.winH || p.h || window.innerHeight);
  viewX = Math.round(p.x || 0);
  viewY = Math.round(p.y || 0);
  de.style.setProperty("--lg-wall-w", winW + "px");
  de.style.setProperty("--lg-wall-h", winH + "px");
  /* 探针面包屑：坞视图自己在窗口里的坐标（断言 --pop-x/y 与壁纸对齐用） */
  de.dataset.lgViewX = String(viewX);
  de.dataset.lgViewY = String(viewY);
  /* 假壁纸偏移 = 每颗胶囊的**padding 盒**在窗口里的坐标（视图原点 + 胶囊在
     视图内的偏移 + 1px 边框）：::before 的 left/top 是相对 padding 盒算的，
     不加 clientLeft/Top 会整体差一个边框宽度。 */
  root.querySelectorAll(".lg-fake").forEach((el) => {
    el.style.setProperty("--pop-x", Math.round(viewX + el.offsetLeft + el.clientLeft) + "px");
    el.style.setProperty("--pop-y", Math.round(viewY + el.offsetTop + el.clientTop) + "px");
  });
}

function render(p) {
  const de = document.documentElement;
  // cssText 赋值会清掉内联变量，必须排在 --lg-wall-* 之前（与 popup/tabtip 同序）
  if (p.cssText) de.style.cssText = p.cssText;
  de.setAttribute("data-theme", p.theme || "light");
  de.setAttribute("data-glass", p.glass || "flat");
  document.body.dataset.layout = p.layout || "vertical";
  document.body.dataset.side = p.side === "right" ? "right" : "left";
  document.body.dataset.dock = p.dock || "bottom";
  root.innerHTML = p.html || "";
  // 每颗胶囊都要吃"假壁纸 + 同值上色"的面（与弹层同一条路）
  root.querySelectorAll(".dock-group, .dock-foot").forEach((el) => el.classList.add("lg-fake", "lg-face-b"));
  applyGeometry(p);
  reportSize();
}

function reportSize() {
  const w = Math.ceil(root.offsetWidth || 0);
  const h = Math.ceil(root.offsetHeight || 0);
  if (w > 0 && h > 0 && window.lgDock) window.lgDock.size(w, h);
}

/* 点击 → 回传 href（@home / @ide / @settings / URL / 站内路径），业务在主进程 */
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest("[data-href]") : null;
  if (!a) return;
  e.preventDefault();
  if (window.lgDock) window.lgDock.cmd(a.getAttribute("data-href"));
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("auxclick", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());

window.lgDock.onSync(render);
if (window.lgDock.onRect) window.lgDock.onRect(applyGeometry);
