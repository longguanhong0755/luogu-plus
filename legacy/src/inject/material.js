/* ============================================================
   Luogu++ — 注入层能力模块：材质与玻璃面（含能力注册表）
   洛谷页宽松扫、站外页严格扫、玻璃站侧栏圆角，以及把两套策略收敛成一张能力注册表。
   面的**配方**只有 material.css 一处；本文件只负责挑面与贴类。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var BG_ID = ctx.BG_ID;
  var state = ctx.state;
  var isLuoguPage = ctx.isLuoguPage;
  var extHttpPage = ctx.extHttpPage;
  var glassSite = ctx.glassSite;

  /* 玻璃站左侧栏圆角（用户点名 DeepSeek 侧栏没 R 角）：人家的类名是构建
     hash（_9a2f8e4 这种，每次部署都变），CSS 选择器写死必失效——改成按
     **几何签名**找左侧栏：贴左、近通高、栏位宽度；找到后沿祖先爬到最外
     层的同宽容器再统一上圆角+内缩，和设置页左侧栏同一个悬浮玻璃栏语言。
     幂等：__lgRounded 只标已处理的节点；SPA 换掉节点后巡检会重新找。 */
  function roundGlassSiteSidebar() {
    if (!glassSite) return;
    var vh = window.innerHeight;
    if (vh < 200) return; // 视口没就位（后台标签/探针 1×1）不乱贴
    var all = document.querySelectorAll("body *");
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === BG_ID) continue;
      var r = el.getBoundingClientRect();
      if (r.left > 2 || r.top > 90) continue;
      var rail = r.width >= 44 && r.width <= 96 && r.height >= vh * 0.5;
      var wide = r.width > 150 && r.width <= 380 && r.height >= vh * 0.6;
      if (!rail && !wide) continue;
      best = el;
      // 往祖先爬：同样贴左、同宽、通高的取最外层——圆角要给整根栏，
      // 不是里面某一块子容器
      var p = el.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        var pr = p.getBoundingClientRect();
        if (pr.left <= 2 && pr.height >= vh * 0.45 && Math.abs(pr.width - r.width) <= 24) {
          best = p; r = pr; p = p.parentElement;
        } else break;
      }
      break;
    }
    if (!best || best.__lgRounded) return;
    best.__lgRounded = true;
    best.style.borderRadius = "var(--lg-radius, 12px)";
    best.style.overflow = "hidden";
    best.style.margin = "10px 0 10px 10px";
    best.style.maxHeight = "calc(100vh - 20px)";
  }

  /* ------------------------------------------------------------
     不透明面玻璃化（v3.5.7 底层根治"外面玻璃、里面实心"）：
     全站"面"材质只有一个来源（--lg-glass-*，与外壳同源），可站点自己的
     容器类名层出不穷——本轮实锤：题目列表的 .l-card.main 被站点 frosted
     主题自己盖的 ::before 白纱（rgba(255,255,255,0.75)+blur(10px)）涂成
     实心。与其一个个类名打补丁，这里按**计算样式**扫：凡是实心/实心渐变、
     颜色中性（彩色的语义块不动）、尺寸够大的面，自动贴 lg-glass（大面）/
     lg-glass-soft（内块），伪元素白纱再标 lg-noveil（CSS 第Ⅲ层清掉）。
     新增节点/类名变化走 MutationObserver 增量补扫；路由切换与定时巡检兜底。
     ------------------------------------------------------------ */
  var GLASS_TAGS = { DIV: 1, SECTION: 1, ARTICLE: 1, ASIDE: 1, NAV: 1, HEADER: 1, FOOTER: 1, MAIN: 1, FORM: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, UL: 1, OL: 1, LI: 1, DETAILS: 1, SUMMARY: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, BLOCKQUOTE: 1, FIGURE: 1 };
  function firstRgba(str) {
    var m = String(str || "").match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function neutralish(c) {
    var mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
    if (mx < 12) return true;            // 近黑
    return (mx - mn) / mx <= 0.34;       // 灰阶/微彩；语义色（橙/蓝/绿）远高于此
  }
  function pseudoVeil(el, which) {
    var st;
    try { st = getComputedStyle(el, which); } catch (e) { return false; }
    if (!st || st.content === "none") return false;
    var img = String(st.backgroundImage || "");
    if (img.indexOf("url(") === 0) return false; // 图标类伪元素不动
    var bg = firstRgba(st.backgroundColor);
    return !!((bg && bg.a >= 0.45) || /gradient/.test(img));
  }
  function glassifyOne(el) {
    if (!el || el.__lgGlassTag) return;
    if (!GLASS_TAGS[el.tagName]) return;
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) { el.__lgGlassTag = "skip"; return; }
    var st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || +st.opacity < 0.08) { el.__lgGlassTag = "skip"; return; }
    var img = String(st.backgroundImage || "");
    if (img.indexOf("url(") === 0) { el.__lgGlassTag = "skip"; return; }
    var bg = firstRgba(st.backgroundColor);
    var grad = /gradient/.test(img);
    var c = bg || firstRgba(img);
    var alpha = bg ? bg.a : 0;
    if (!grad && alpha < 0.65) { el.__lgGlassTag = "skip"; return; }
    if (grad && (!c || c.a < 0.65)) { el.__lgGlassTag = "skip"; return; }
    if (c && !neutralish(c)) { el.__lgGlassTag = "skip"; return; }
    var soft = /^(INPUT|TEXTAREA|SELECT|TR|TD|TH|LI|SUMMARY)$/.test(el.tagName) ||
      (r.width * r.height < 9000 && r.height < 40);
    el.classList.add(soft ? "lg-glass-soft" : "lg-glass");
    if (pseudoVeil(el, "::before") || pseudoVeil(el, "::after")) el.classList.add("lg-noveil");
    el.__lgGlassTag = soft ? "lg-glass-soft" : "lg-glass";
  }
  function sweepLuoguFaces(rootEl) {
    /* 两种皮肤都扫：扫出来的面消费的是同一组变量——flat 拿到的就是素面
       （纯色 + 细线），liquid 拿到玻璃。以前只在 liquid 下扫，flat 用户的
       站点面板就只能保持站点自己的实心色，"里面实心、外面素面"两回事。

       「是不是洛谷页」「IDE 页要不要动」两件事都已上移到能力注册表的
       enable() 里（见 GLASS_ADAPTERS）——这里只管扫不扫，不再自己判断
       自己该不该跑。这正是注册表要解决的分心：判定散落在各处，越加能力
       越难推理谁在什么条件下动页面。 */
    /* IDE 原生模式：注册表会 unmount 摘类，但 MutationObserver 的增量扫描
       可能晚一步又把类贴回来（queueGlass 直接调本函数，绕过了 enable()）。
       题目页 IDE 模式下面板必须保持洛谷原生不透明——这里再挡一道。 */
    if (document.documentElement.getAttribute("data-lg-ide") === "1") return;
    var root = rootEl && rootEl.nodeType === 1 ? rootEl : document.body;
    if (!root) return;
    glassifyOne(root);
    var all = root.querySelectorAll("div,section,article,aside,nav,header,footer,main,form,table,thead,tbody,tr,ul,ol,li,details,summary,input,textarea,select,blockquote,figure");
    for (var i = 0; i < all.length; i++) glassifyOne(all[i]);
  }
  /* 关玻璃/非洛谷页：把我们贴过的类全摘掉（标记一起清） */
  function unglassAll() {
    var els = document.querySelectorAll(".lg-glass,.lg-glass-soft,.lg-noveil");
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove("lg-glass", "lg-glass-soft", "lg-noveil");
      els[i].__lgGlassTag = null;
    }
  }

  /* ---------- 站外页自动玻璃（.lg-gx）----------
     「自动把网页转换成网页玻璃质感」：站外页的卡片 / 面板 / 容器被换成
     我们的玻璃面，与外壳、洛谷页同一套配方同一份变量。
     站点不是自己的，所以挑面比洛谷页保守得多：
       · 必须有**自己的实心底色**（alpha ≥ 0.5）且是中性色
         ——彩色面不碰（玻璃化会把人家的配色语义洗掉）
       · 尺寸像个卡片（宽 ≥160、高 ≥60），且不超过视口一半
         ——太大的容器不玻璃化（整页发虚，反而看不清）
       · 不是 fixed/sticky（自己会飘的面不给它加模糊）
       · 不是表单控件 / 表格单元 / 代码块 / 导航条 / 页脚
     ⚠️ 关键：**内部含 position:fixed 后代的容器不给挂 backdrop-filter**
     ——backdrop-filter 会成为 fixed 后代的包含块，人家页面里到处是吸顶
     导航、悬浮按钮、弹层，挂上去就整体错位（v3.4.2 教训）。这类容器改
     走 .lg-gx-noblur：半透明底 + 发丝线，观感仍是玻璃面，但不劫持包含块。 */
  var EXT_GLASS_TAGS = { DIV: 1, SECTION: 1, ARTICLE: 1, ASIDE: 1, MAIN: 1, FIGURE: 1, DETAILS: 1, BLOCKQUOTE: 1, DL: 1 };
  /* 页面里的 fixed 元素清单：backdrop-filter 劫持包含块的影响面就靠它判断。
     每 2 秒最多重算一次（站外页多为静态页，不需要更勤）。 */
  var extFixedCache = { list: [], at: 0 };
  function extFixedList() {
    var now = Date.now();
    if (now - extFixedCache.at < 2000 && extFixedCache.list.length) return extFixedCache.list;
    var list = [];
    var all = document.querySelectorAll("body *");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.__lgFx === 1) continue;
      if (getComputedStyle(el).position === "fixed") { list.push(el); el.__lgFx = 1; }
    }
    extFixedCache = { list: list, at: now };
    return list;
  }
  function hasFixedInside(el, list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== el && el.contains(list[i])) return true;
    }
    return false;
  }
  /* 视口够不够"铺开"：新建标签的视图先落在 1×1（隐藏实例里更是全程 1×1），
     这时页面量出来的尺寸全部不达标，玻璃既贴不上也不该贴。160×60 与
     glassifyExtOne 的"像个卡片"门槛一致。 */
  function extViewportReady() {
    return (window.innerWidth || 0) >= 160 && (window.innerHeight || 0) >= 60;
  }
  function glassifyExtOne(el) {
    if (!el || el.__lgGx) return;
    if (!EXT_GLASS_TAGS[el.tagName]) return;
    /* 交互控件与正文承载面不碰：玻璃化它们会既难看又难点 */
    if (el.matches("input,textarea,select,button,code,pre,table,tr,td,th,li,summary,nav,header,footer")) return;
    /* 表单区不玻璃化：里面有 input/textarea/select 的容器，玻璃化会让输入
       区发虚、也让人家的下拉与校验浮层更难看清（按**内容**判，不按标签名
       ——人家常用 div 包表单，标签名靠不住）。 */
    if (el.querySelector("input,textarea,select")) return;
    var r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 60) return;
    var vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    if (r.width * r.height > vw * vh * 0.55) return;
    var st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || +st.opacity < 0.08) return;
    if (st.position === "fixed" || st.position === "sticky") return;
    var img = String(st.backgroundImage || "");
    if (img.indexOf("url(") === 0) return;  /* 图片面不当玻璃（会盖掉人家的图） */
    var bg = firstRgba(st.backgroundColor);
    if (!bg || bg.a < 0.5) return;         /* 必须有自己的实心底色 */
    if (!neutralish(bg)) return;             /* 彩色面不碰 */
    /* 正文承载面不玻璃化：长文容器（文章正文、评论区）保持站点自己的底色，
       可读性最好——玻璃是给"卡片/面板"用的，不是给整篇文章用的。
       两条信号：内部有多段正文（≥3 个 <p>），或自身文字量过大。
       textContent 不触发布局（比 innerText 便宜），且放在最后一步：前面的
       条件已经把绝大多数没有实心底色的容器筛掉了。 */
    if (el.querySelectorAll("p").length >= 3) return;
    if ((el.textContent || "").length > 500) return;
    var blur = !hasFixedInside(el, extFixedList());
    el.classList.add(blur ? "lg-gx" : "lg-gx-noblur");
    el.__lgGx = blur ? "blur" : "noblur";
  }
  function sweepExtGlass(rootEl) {
    if (!extHttpPage || !ctx.autoGlass) return;
    if (!extViewportReady()) return;   /* 视口没铺开：量出来全是 0，扫了也是白扫 */
    /* 页面里若有 background-attachment: fixed 的元素，就整页不做玻璃。
       fixed 背景与 backdrop-filter 叠在一起会让 Chromium 陷入长任务——
       实测：给测试页加一条 fixed 渐变底后，页面的 captureScreenshot 直接
       超时、渲染被卡死（纯色底时一切正常）。这种页面宁可保持原样：
       「页面能动」比「页面好看」重要。 */
    if (hasFixedBackground()) return;
    var root = rootEl && rootEl.nodeType === 1 ? rootEl : document.body;
    if (!root) return;
    var all = root.querySelectorAll("div,section,article,aside,main,figure,details,blockquote,dl");
    /* 数量上限：backdrop-filter 每贴一个面就多一份合成开销，页面很"碎"
       （一堆小卡片）时可能贴出几十个，滚动会明显变卡。超过上限就停——
       前面的通常是页面上方最重要的卡片。 */
    var budget = 40;
    for (var i = 0; i < all.length && i < 400 && budget > 0; i++) {
      if (all[i].__lgGx) continue;
      glassifyExtOne(all[i]);
      if (all[i].__lgGx) budget--;
    }
  }
  /* fixed 背景探测（结果缓存 5 秒：整页 getComputedStyle 不便宜） */
  var extFixedBgCache = { hit: false, at: 0 };
  function hasFixedBackground() {
    var now = Date.now();
    if (now - extFixedBgCache.at < 5000) return extFixedBgCache.hit;
    var hit = false;
    var all = document.querySelectorAll("body, body *");
    for (var i = 0; i < all.length && i < 300; i++) {
      if (getComputedStyle(all[i]).backgroundAttachment === "fixed") { hit = true; break; }
    }
    extFixedBgCache = { hit: hit, at: now };
    return hit;
  }
  /* 撤销：摘类即可，页面自己的样式一行没改过（可逆是这套方案的前提） */
  function unglassExt() {
    var els = document.querySelectorAll(".lg-gx,.lg-gx-noblur");
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove("lg-gx", "lg-gx-noblur");
      els[i].__lgGx = null;
    }
  }

  /* ---------- 能力注册表（adapter registry）----------
     "把页面换成玻璃"现在有两种策略：洛谷页宽松扫（自己的站）、站外页
     严格扫（别人的站）。之前是两套平行函数，启停条件散落在 apply() 与
     2.5s 巡检里各写一遍，加第三种能力就得再抄一遍这套 if/else——
     分心且难推理。现在统一成注册表：
       enable()   现在该不该对这个页面做这件事（纯判定，可反复调用）
       mount()    挂上（贴类）
       unmount()  撤销（摘类）
     syncAdapters() 只在"状态翻转"的那一次动手（diff 后再调），所以巡检
     可以随便多跑，不会重复贴类，也不会漏掉撤场。 */
  var GLASS_ADAPTERS = [
    {
      id: "lg-face",
      enable: function () {
        if (!isLuoguPage) return false;
        /* IDE 页"保持原生"（R37）：Monaco 那类不透明深色面以前会被扫成
           .lg-glass（挂上 backdrop-filter + 半透明卡片）——用户截图里
           "壁纸透过深色模糊"的编辑器就是它。原生模式下一个面都不许动。 */
        return document.documentElement.getAttribute("data-lg-ide") !== "1";
      },
      mount: function () { sweepLuoguFaces(); },
      unmount: function () { unglassAll(); }
    },
    {
      id: "ext-face",
      enable: function () {
        if (!extHttpPage || !ctx.autoGlass || state.cfg.autoGlass === false) return false;
        /* 视口没铺开就不算"能做"：页面在 1×1 的视图里量尺寸必然全部落空，
           挂一次面就再也扫不到东西了——注册表只在状态翻转时动手，不会自己
           再扫一遍。视口恢复后由巡检 diff 出翻转、再补挂一次。 */
        return extViewportReady();
      },
      mount: function () { sweepExtGlass(); },
      unmount: function () { unglassExt(); }
    }
  ];
  var adaptersOn = {};
  function syncAdapters() {
    for (var i = 0; i < GLASS_ADAPTERS.length; i++) {
      var a = GLASS_ADAPTERS[i];
      var want = false;
      try { want = !!a.enable(); } catch (e) { want = false; }
      if (want && !adaptersOn[a.id]) { adaptersOn[a.id] = 1; try { a.mount(); } catch (e) {} }
      else if (!want && adaptersOn[a.id]) { delete adaptersOn[a.id]; try { a.unmount(); } catch (e) {} }
    }
  }
  var glassSweepTimer = null;
  var glassDirty = [];
  function queueGlass(node) {
    if (!node || node.nodeType !== 1) return;
    glassDirty.push(node);
    if (glassSweepTimer) return;
    glassSweepTimer = setTimeout(function () {
      glassSweepTimer = null;
      var batch = glassDirty;
      glassDirty = [];
      for (var i = 0; i < batch.length; i++) sweepLuoguFaces(batch[i]);
    }, 250);
  }
  /* 启动时序：顶层副作用收进 boot()，由内核按固定顺序调用（见 inject.js
     的 bootInject）——顺序与这些语句在拆分前的先后完全一致。 */
  function boot() {
    if (glassSite) setTimeout(roundGlassSiteSidebar, 1200);
  }

  /* 调试出口（探针/实测用）：暴露**注册表同步**而不是某一个扫描函数——
     探针看到的是"当前该启用的能力都启用了吗"，而不是"洛谷那套扫没扫"。
     新增能力不必再改探针。 */
  function exposeSweep() {
    /* 探针/排障出口：先跑一次注册表同步，再按传入节点做一次增量扫描。 */
    window.__lgGlassSweep = function (node) {
      syncAdapters();
      if (node && node.nodeType === 1) {
        try { sweepLuoguFaces(node); } catch (e) {}
      }
    };
  }

  ctx.register("material", {
    syncAdapters: syncAdapters,
    sweepLuoguFaces: sweepLuoguFaces,
    queueGlass: queueGlass,
    roundGlassSiteSidebar: roundGlassSiteSidebar,
    boot: boot,
    exposeSweep: exposeSweep,
  });
})(window.__lgInjectCtx);
