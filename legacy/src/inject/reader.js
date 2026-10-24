/* ============================================================
   Luogu++ — 注入层能力模块：阅读模式
   自研正文抽取 + 整页浮层；入口是命令面板 / 快捷键 / 右键菜单。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  /* ==================== 阅读模式（自研正文抽取） ====================
     抽取：克隆 body → 去掉脚本/导航/表单等噪声 → 在候选里找"正文密度"最高的
     容器（段落文本长度 − 链接文本长度 × 1.6）→ 消毒属性（只留 href/src/alt）。
     显示：整页浮层（纯色纸面 + 主题令牌，不碰玻璃配方），字号可调、明暗可切，
     再点一次或 Esc 退出。入口：命令面板 / 可绑定快捷键 / 右键菜单。 */
  var readerHost = null;

  function readerExtract() {
    var clone;
    try { clone = document.body.cloneNode(true); } catch (e) { return null; }
    var drop = "script,style,noscript,iframe,svg,canvas,video,audio,form,button,input,select,textarea,nav,aside,footer,header,link,meta,object,embed";
    Array.prototype.forEach.call(clone.querySelectorAll(drop), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    var best = null, bestScore = 0, seen = 0;
    var all = clone.querySelectorAll("*");
    for (var i = 0; i < all.length && seen < 4000; i++) {
      var el = all[i];
      if (el.children.length < 2) continue;
      seen++;
      var txt = "";
      for (var j = 0; j < el.children.length; j++) {
        var tag = el.children[j].tagName;
        if (tag === "P" || tag === "LI" || tag === "PRE" || tag === "BLOCKQUOTE" || tag === "TD" || tag === "DIV" || tag === "SECTION") {
          txt += el.children[j].textContent || "";
        }
      }
      var len = txt.replace(/\s+/g, "").length;
      if (len < 300) continue;
      var linkLen = 0;
      Array.prototype.forEach.call(el.querySelectorAll("a"), function (a) { linkLen += (a.textContent || "").length; });
      var score = len - linkLen * 1.6;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (!best) return null;
    Array.prototype.forEach.call(best.querySelectorAll("*"), function (n) {
      var keep = {};
      var href = n.getAttribute("href"), src = n.getAttribute("src"), alt = n.getAttribute("alt");
      if (src && !/^data:/.test(src) && !/^https?:/i.test(src) && !/^\//.test(src)) src = null;
      if (href) keep.href = href;
      if (src) keep.src = src;
      if (alt) keep.alt = alt;
      Array.prototype.slice.call(n.attributes).forEach(function (at) { n.removeAttribute(at.name); });
      Object.keys(keep).forEach(function (k) { n.setAttribute(k, keep[k]); });
    });
    return best;
  }

  function readerClose() {
    if (!readerHost) return;
    try { readerHost.remove(); } catch (e) {}
    readerHost = null;
  }

  function readerToggle() {
    if (readerHost) { readerClose(); return "closed"; }
    var body = readerExtract();
    if (!body) return "no-content";
    var host = document.createElement("div");
    host.id = "lg-reader";
    var bar = document.createElement("div");
    bar.className = "lg-reader-bar";
    var title = document.createElement("div");
    title.className = "lg-reader-title";
    title.textContent = document.title || "阅读模式";
    bar.appendChild(title);
    var art = document.createElement("article");
    art.className = "lg-reader-body";
    var size = 18;
    var mkBtn = function (label, tip, fn) {
      var b = document.createElement("button");
      b.className = "lg-reader-btn";
      b.type = "button";
      b.textContent = label;
      b.title = tip;
      b.addEventListener("click", fn);
      return b;
    };
    bar.appendChild(mkBtn("A−", "减小字号", function () { size = Math.max(14, size - 1); art.style.fontSize = size + "px"; }));
    bar.appendChild(mkBtn("A+", "增大字号", function () { size = Math.min(26, size + 1); art.style.fontSize = size + "px"; }));
    bar.appendChild(mkBtn("纸面", "浅色 / 深色切换", function () { host.classList.toggle("lg-reader-dark"); }));
    bar.appendChild(mkBtn("退出", "退出阅读模式（Esc）", readerClose));
    art.style.fontSize = size + "px";
    art.appendChild(body);
    host.appendChild(bar);
    host.appendChild(art);
    document.body.appendChild(host);
    readerHost = host;
    return "opened";
  }

  /* 启动时序：顶层副作用收进 boot()，由内核按固定顺序调用（见 inject.js
     的 bootInject）——顺序与这些语句在拆分前的先后完全一致。 */
  function boot() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && readerHost) {
        readerClose();
        e.stopPropagation();
      }
    }, true);
  }

  ctx.register("reader", {
    readerToggle: readerToggle,
    boot: boot,
  });
})(window.__lgInjectCtx);
