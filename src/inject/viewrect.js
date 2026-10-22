/* ============================================================
   Luogu++ — 注入层能力模块：缩放与视口补偿
   视图在窗口里的真实矩形 → 壁纸层几何；Ctrl+滚轮缩放转主进程步进。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var BG_ID = ctx.BG_ID;

  /* 视图在窗口里的真实矩形（主进程 layout() 每次重排后下发）。
     壁纸层必须按"整个窗口的几何"摆放才能和外壳那层壁纸对齐：只需要写出
     --lg-wall-x/y/w/h（负的视图偏移 + 整个窗口的宽高），几何公式由
     material.css 的 .lg-wallpaper 一处消费——外壳、弹层用的是同一个 class。 */
  var lgViewRect = null;
  function applyViewRect() {
    if (!lgViewRect) return;
    /* 页面缩放系数（主进程 getZoomFactor 随矩形一起下发）：material.css 的
       壁纸公式把整套几何 ÷ z。页面被 Ctrl+滚轮放大时，CSS px 也跟着变大——
       不补偿的话壁纸层会跟着页面一起被放大/裁掉（用户报的"缩放页面时背景
       也被缩放"）。除以 z 之后它在物理像素上仍等于外壳那张"窗口几何的固定
       画"：缩放只影响网页内容，背景不动。 */
    document.documentElement.style.setProperty("--lg-zoom", String(lgViewRect.z > 0 ? lgViewRect.z : 1));
    var bg = document.getElementById(BG_ID);
    if (!bg) return;
    bg.style.setProperty("--lg-wall-x", -lgViewRect.x + "px");
    bg.style.setProperty("--lg-wall-y", -lgViewRect.y + "px");
    bg.style.setProperty("--lg-wall-w", lgViewRect.w + "px");
    bg.style.setProperty("--lg-wall-h", lgViewRect.h + "px");
  }
  function setViewRect(r) {
    if (!r) return;
    lgViewRect = r;
    applyViewRect();
  }

  /* 启动时序：顶层副作用收进 boot()，由内核按固定顺序调用（见 inject.js
     的 bootInject）——顺序与这些语句在拆分前的先后完全一致。 */
  function boot() {
    window.addEventListener(
      "wheel",
      function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        if (window.lgApp && window.lgApp.zoomBy) window.lgApp.zoomBy(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false, capture: true }
    );
  }

  ctx.register("viewrect", {
    setViewRect: setViewRect,
    applyViewRect: applyViewRect,
    boot: boot,
  });
})(window.__lgInjectCtx);
