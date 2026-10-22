/* ============================================================
   Luogu++ — 注入层能力模块：翻译（划词气泡 + 整页翻译）
   出网在主进程（页面侧 fetch 会被 CORS 拦）；气泡与悬浮条都用 .lg-face。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  /* ==================== 翻译（划词气泡 + 整页翻译） ====================
     出网在主进程（页面侧 fetch 会被 CORS 拦，见 preload-page 的 translate）。
     划词气泡与整页悬浮条都用 .lg-face（材料单一来源），不写自己的玻璃配方。 */
  function trEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function trAnchorRect() {
    try {
      var s = window.getSelection();
      if (s && s.rangeCount) {
        var r = s.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width || r.height)) return r;
      }
    } catch (e) {}
    return null;
  }
  function translateSelection(text) {
    var t = String(text || "").trim();
    if (!t) {
      try { t = String(window.getSelection() || "").trim(); } catch (e) {}
    }
    if (!t) return "no-text";
    if (!window.lgApp || !window.lgApp.translate) return "no-bridge";
    var old = document.getElementById("lg-tr-bubble");
    if (old) old.remove();
    var bubble = document.createElement("div");
    bubble.id = "lg-tr-bubble";
    bubble.className = "lg-face";
    var head = trEl("div", "lg-tr-head");
    head.appendChild(trEl("span", "lg-tr-src", t.length > 60 ? t.slice(0, 60) + "…" : t));
    var close = trEl("button", "lg-tr-x", "");
    close.type = "button";
    /* 与 icons.js winClose 同线稿（注入层加载不到 icons.js，这里内联） */
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.title = "关闭";
    close.addEventListener("click", function () { bubble.remove(); });
    head.appendChild(close);
    bubble.appendChild(head);
    var out = trEl("div", "lg-tr-out", "翻译中…");
    bubble.appendChild(out);
    var r = trAnchorRect();
    bubble.style.position = "fixed";
    if (r) {
      bubble.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + "px";
      bubble.style.top = Math.min(window.innerHeight - 120, r.bottom + 8) + "px";
    } else {
      bubble.style.right = "18px";
      bubble.style.bottom = "18px";
    }
    document.body.appendChild(bubble);
    window.lgApp
      .translate([t])
      .then(function (res) {
        if (!bubble.parentNode) return;
        out.textContent = res && res.ok && res.texts && res.texts[0] ? res.texts[0] : "翻译失败：" + ((res && res.message) || "未知错误");
        if (!res || !res.ok) out.classList.add("lg-tr-err");
      })
      .catch(function (e) {
        if (bubble.parentNode) { out.textContent = "翻译失败：" + String(e); out.classList.add("lg-tr-err"); }
      });
    return "ok";
  }

  var pageTr = null; // { nodes, originals, restore }
  function translatePage() {
    if (pageTr) {
      pageTr.restore();
      return "restored";
    }
    if (!window.lgApp || !window.lgApp.translate) return "no-bridge";
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var v = node.nodeValue;
          if (!v || v.trim().length < 2) return NodeFilter.FILTER_REJECT;
          var p = node.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          var tag = p.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA" || tag === "CODE" || tag === "PRE" || tag === "OPTION") return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest("#lg-reader,#lg-tr-bubble,#lg-tr-bar,#lg-glass-bg")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (nodes.length >= 1200) break;
      nodes.push(n);
    }
    if (!nodes.length) return "no-text";
    var originals = nodes.map(function (x) { return x.nodeValue; });
    var bar = document.createElement("div");
    bar.id = "lg-tr-bar";
    bar.className = "lg-face";
    var info = trEl("span", "lg-tr-info", "翻译中 0/" + nodes.length);
    bar.appendChild(info);
    var showOrig = false;
    var toggle = trEl("button", "lg-tr-btn", "原文");
    toggle.type = "button";
    toggle.addEventListener("click", function () {
      showOrig = !showOrig;
      toggle.textContent = showOrig ? "译文" : "原文";
      nodes.forEach(function (x, i) {
        if (showOrig) x.nodeValue = originals[i];
        else if (x.__lgTr) x.nodeValue = x.__lgTr;
      });
    });
    var quit = trEl("button", "lg-tr-btn", "退出");
    quit.type = "button";
    var state = {
      restore: function () {
        if (showOrig) toggle.click(); // 先把显示切回译文态，再统一还原
        nodes.forEach(function (x, i) { x.nodeValue = originals[i]; });
        try { bar.remove(); } catch (e) {}
        pageTr = null;
        return "restored";
      },
    };
    quit.addEventListener("click", function () { state.restore(); });
    bar.appendChild(toggle);
    bar.appendChild(quit);
    document.body.appendChild(bar);
    pageTr = state;
    var failed = 0, done = 0, idx = 0;
    var batches = [];
    for (var i = 0; i < nodes.length; i += 20) batches.push(nodes.slice(i, i + 20));
    var step = function () {
      if (!pageTr || idx >= batches.length) {
        info.textContent = failed ? "完成（" + failed + " 段失败）" : "完成 " + nodes.length + " 段";
        return;
      }
      var b = batches[idx++];
      window.lgApp
        .translate(b.map(function (x) { return x.nodeValue; }))
        .then(function (res) {
          if (res && res.ok && res.texts) {
            b.forEach(function (x, k) {
              var tv = res.texts[k];
              if (tv) { x.__lgTr = tv; if (!showOrig) x.nodeValue = tv; }
            });
          } else {
            failed += b.length;
          }
          done += b.length;
          info.textContent = "翻译中 " + Math.min(done, nodes.length) + "/" + nodes.length;
          step();
        })
        .catch(function () {
          failed += b.length;
          done += b.length;
          step();
        });
    };
    step();
    return "started";
  }
  ctx.register("translate", {
    translateSelection: translateSelection,
    translatePage: translatePage,
  });
})(window.__lgInjectCtx);
