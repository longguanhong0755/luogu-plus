/* ============================================================
   Luogu++ — 注入层能力模块：划词与选区（题号识别 + Glance 速览）
   选中文字里的题号逐个可点；含页面→外壳动作通道与 Alt+点击链接速览。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var isLuoguPage = ctx.isLuoguPage;
  var state = ctx.state;

  /* ---------- 划词识别题号 ----------
     题号形态照抄 Luogu-Plus 的 Problem Jumper（isProblemId）：
     AT* / CF123A1 / SP123 / P123 / B123 / UVA123 / U123。
     选中一段文字，把里面所有题号都列出来，逐个可点。 */

  /* 页面 → 外壳的动作通道。优先走 preload-page.js 暴露的 window.lgApp
     （标准 IPC，不受弹窗拦截、不受自定义 scheme 限制）；拿不到才退回
     luogu-glass:// 协议——它只在同步点击、走 setWindowOpenHandler 时可靠。 */
  function appCommand(c) {
    try {
      if (window.lgApp && typeof window.lgApp.command === "function") {
        window.lgApp.command(c);
        return true;
      }
    } catch (e) {}
    try { window.open("luogu-glass://" + c, "_self"); return true; } catch (e) { return false; }
  }
  function openProblem(pid) {
    if (!pid) return false;
    try {
      if (window.lgApp && typeof window.lgApp.openProblem === "function") {
        window.lgApp.openProblem(pid);
        return true;
      }
    } catch (e) {}
    try { window.open("luogu-glass://problem/" + pid); return true; } catch (e) { return false; }
  }

  function isPid(u) {
    return (
      // AT 题号在洛谷是全小写（AT_abc300_a），extractPids 里也是先转小写
      // 再校验 —— 这里必须带 i，否则 AT_* 会被整类丢掉
      /^AT_?[A-Z0-9_]{2,}$/i.test(u) ||
      /^CF\d{1,4}[A-Z]\d?$/.test(u) ||
      /^SP\d{1,5}$/.test(u) ||
      /^P\d{1,6}$/.test(u) ||
      /^B\d{1,6}$/.test(u) ||
      /^UVA\d{1,5}$/.test(u) ||
      /^U\d{1,6}$/.test(u)
    );
  }
  function extractPids(text) {
    var words = String(text).split(/[\s,.;?!()[\]{}、，。；：！？（）【】《》"']+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "").toUpperCase();
      if (!w) continue;
      // 纯 4 位以上数字按洛谷题号补 P（与搜索框同一套规则）
      if (/^[1-9]\d{3,}$/.test(w)) w = "P" + w;
      // 洛谷的 AtCoder 题号是全小写（AT_abc300_a），统一大写会 404
      if (/^AT_/.test(w)) w = "AT_" + w.slice(3).toLowerCase();
      if (!isPid(w)) continue;
      if (out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }
  var pidTip = null;
  function hidePidTip() {
    if (pidTip && pidTip.parentNode) pidTip.parentNode.removeChild(pidTip);
    pidTip = null;
  }
  function onSelection() {
    // 划词识别只服务洛谷页：站外页（映射词打开的解锁标签）没有题号语境，
    // 弹个"识别到题目"是打扰
    if (!isLuoguPage) return;
    if (state.cfg.smartPid === false) { hidePidTip(); return; }
    var sel = window.getSelection();
    var txt = sel ? String(sel) : "";
    if (!txt || txt.length > 300) { hidePidTip(); return; }
    var pids = extractPids(txt);
    if (!pids.length) { hidePidTip(); return; }
    var rect = null;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) {}
    if (!rect || (!rect.width && !rect.height)) { hidePidTip(); return; }
    hidePidTip();
    var box = document.createElement("div");
    box.className = "lg-pid-tip";
    var lab = document.createElement("span");
    lab.className = "lg-pid-label";
    lab.textContent = pids.length > 1 ? "识别到 " + pids.length + " 个题目" : "识别到题目";
    box.appendChild(lab);
    for (var i = 0; i < pids.length; i++) {
      (function (pid) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "lg-pid-go";
        b.textContent = pid;
        b.title = "在新标签页打开 " + pid;
        b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          hidePidTip();
          openProblem(pid);
        });
        box.appendChild(b);
      })(pids[i]);
    }
    box.style.top = rect.bottom + window.scrollY + 6 + "px";
    box.style.left = rect.left + window.scrollX + "px";
    document.body.appendChild(box);
    pidTip = box;
  }

  /* 启动时序：顶层副作用收进 boot()，由内核按固定顺序调用（见 inject.js
     的 bootInject）——顺序与这些语句在拆分前的先后完全一致。 */
  function boot() {
    document.addEventListener("mouseup", function () { setTimeout(onSelection, 10); });
    document.addEventListener("scroll", hidePidTip, true);
    document.addEventListener("mousedown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".lg-pid-tip")) return;
      hidePidTip();
    });

    /* ---------- Glance 链接速览（Zen 式） ----------
       Alt+点击链接：不离开当前页，链接开进居中的速览卡片（外壳接管几何与
       遮罩）。捕获阶段拦截，阻止站点自己的跳转/新窗口逻辑。 */
    document.addEventListener(
      "click",
      function (e) {
        if (!e.altKey || e.button !== 0 || e.defaultPrevented) return;
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a) return;
        var href = "";
        try { href = a.href || ""; } catch (err) {}
        if (!/^https?:\/\//i.test(href)) return;
        e.preventDefault();
        e.stopPropagation();
        if (window.lgApp && window.lgApp.glance) window.lgApp.glance(href);
      },
      true
    );
  }

  ctx.register("selection", {
    isPid: isPid,
    openProblem: openProblem,
    boot: boot,
  });
})(window.__lgInjectCtx);
