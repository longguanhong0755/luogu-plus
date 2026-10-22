/* ============================================================
   Luogu++ — 注入层能力模块：洛谷页增强（清扫 / 用户态 / 欢迎块 / 运势 / 代码复制 / IDE 模式）
   只在洛谷页跑（非洛谷页 DOM 根本不匹配），由内核按路由与开关调起。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var state = ctx.state;
  var isLuoguPage = ctx.isLuoguPage;

  /* ---------- 洁净模式加强：商业推广卡清扫 ----------
     保守策略：仅侧栏/右栏内、文本不长、命中商业关键词、且带商业链接或图片的
     卡片。只打 data-lg-promo 标记，由 CSS 在 clean 开启时隐藏——关闭立即还原。
     R37 加强（用户："如果是开着的话就说明你的过滤广告能力不够强"）：
     ① 容器白名单补右栏（.lg-right / .am-u-lg-3）——题解/文章页的推广卡在右栏，
        旧白名单只认侧栏与首页，"省选计划"那张一直漏网；
     ② 关键词补"洛谷推荐 / 省队 / 集训队"；③ 文本上限 60 → 160（那张卡带一段
        介绍文字，被旧上限挡掉）；④ 卡片选择器补 .am-panel/.section（洛谷右栏
        面板的另一种壳）；⑤ 挂到 MutationObserver 的批次里（queuePromo），
        Vue 一渲染就判，不再等 2.5s 巡检那一拍。 */
  var PROMO_RE = /(省选计划|冲刺省队|网校|限时优惠|报名中|训练营|冲刺营|基础组|提高组|洛谷推荐|省队|集训队)/;
  var COMMERCIAL_HREF_RE = /(class\.luogu\.com\.cn|\/class|course|mall|province|olympiad|\.pdf)/i;
  var PROMO_SIDE_SEL = ".side, .sidebar-container, .user-nav, [class*='sidebar'], .lg-right, .am-u-lg-3, .lg-index-content";

  function sweepPromos() {
    if (document.documentElement.getAttribute("data-lg-clean") !== "1") return;
    var cards = document.querySelectorAll(".l-card, .card, .lg-article, .am-panel, .section");
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      if (el.hasAttribute("data-lg-promo")) continue;
      var inSide = el.closest(PROMO_SIDE_SEL);
      if (!inSide) { el.setAttribute("data-lg-promo", "0"); continue; }
      var txt = (el.textContent || "").trim();
      /* 空壳（Vue 还没填内容）先不判死：留着下一拍/下一批再看，
         否则"先渲染壳、后填字"的卡片会被永远记成 0。 */
      if (!txt) continue;
      if (txt.length > 160 || !PROMO_RE.test(txt)) {
        el.setAttribute("data-lg-promo", "0");
        continue;
      }
      var links = el.querySelectorAll("a");
      var hit = false;
      for (var j = 0; j < links.length; j++) {
        if (COMMERCIAL_HREF_RE.test(links[j].getAttribute("href") || "")) { hit = true; break; }
      }
      /* 命中了关键词但还没有商业信号（链接/图还没渲染出来）时也不判死，
         等下一批；判死的只有"文本已渲染且不像推广"的那些。 */
      if (hit || el.querySelector("img")) el.setAttribute("data-lg-promo", "1");
    }
  }

  /* ---------- 精简模式：公告 / 页脚弹窗 / 推荐模块就地标记 ---------- */
  var ANNOY_RE = /(公告|推荐|相关推荐|热门推荐|你可能|限时|活动|订阅)/;

  function sweepDeclutter() {
    var on = document.documentElement.getAttribute("data-lg-declutter") === "1";
    if (!on) return;
    var nodes = document.querySelectorAll('[class*="announce"], [class*="notice"], [class*="recommend"], [class*="footer-pop"], [class*="float"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hasAttribute("data-lg-declutter")) continue;
      var txt = (el.textContent || "").trim();
      var cls = String(el.className || "");
      if (/(announce|notice|recommend)/i.test(cls) || (txt.length > 1 && txt.length < 200 && ANNOY_RE.test(txt))) {
        el.setAttribute("data-lg-declutter", "1");
      } else {
        el.setAttribute("data-lg-declutter", "0");
      }
    }
  }

  /* ---------- 用户头像定位 ----------
     首页 DOM 里到处是别人的头像（侧栏比赛榜一整列 img[src*="usericon"]），
     直接 querySelector 会取到 usericon/1 这种脏值，必须按容器收窄。 */
  var AV_SEL = [
    '.user-nav img[src*="usericon"]',
    '#user-nav img[src*="usericon"]',
    'header img[src*="usericon"]',
    '.lg-punch img[src*="usericon"]',
  ];
  function findAvatar() {
    /* 未登录权威信号：用户区挂着"登录/注册"链接。这时页面上的 usericon 图
       全是别人的内容图（比赛榜/讨论帖），usericon/1 这种脏匹配曾让芯片在
       未登录时显示"已登录"+错头像。 */
    try {
      if (document.querySelector('.user-nav a[href*="/auth/login"], #user-nav a[href*="/auth/login"]')) return null;
    } catch (e) {}
    for (var i = 0; i < AV_SEL.length; i++) {
      var el = null;
      try { el = document.querySelector(AV_SEL[i]); } catch (e) {}
      if (el && el.src) return el;
    }
    var list = document.querySelectorAll('img[src*="usericon"]');
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      // 比赛榜/侧栏面板里的头像都是别人的，跳过
      if (it.closest && it.closest('[class*="contest"],[class*="rank"],[class*="lg-inline-up"],[class*="am-panel"]')) continue;
      if (it.src) return it;
    }
    return null;
  }
  function uidFromAvatar(src) {
    var m = String(src || "").match(/\/usericon\/(\d+)\./);
    return m ? m[1] : "";
  }
  function welcomeName() {
    var m = (document.body.innerText || "").match(/欢迎回来[，,：:\s]*([A-Za-z0-9_]{2,24})/);
    if (m) return m[1];
    // 运势面板标题形如 "u0lkd18fdr 的运势"（没打卡时页面只有这块，没有"欢迎回来"）
    var h = document.querySelector(".lg-punch h2 a, .lg-punch h2");
    if (h) {
      var t = String(h.textContent || "").trim().replace(/的运势$/, "").trim();
      if (/^[A-Za-z0-9_]{2,24}$/.test(t)) return t;
    }
    return "";
  }

  /* 用户态的唯一出口：外壳右上角芯片、首页欢迎块、账号昵称回填都读这里。
     首页 DOM 里"别人的头像"太多（侧栏比赛榜一整列 usericon），提取逻辑散在
     几处就会各错各的 —— 芯片显示 UID、欢迎块显示昵称就是这么来的。 */
  function userInfo() {
    var av = findAvatar();
    var uid = av ? uidFromAvatar(av.src) : "";
    /* uid 1 的头像是未登录骨架的 guest 占位图（SSR 首屏就有，登录/注册链接
       要等 Vue 挂载）——挂载窗口期会漏过上面的登录链接判据，这里兜底掐掉。
       uid 1 的真实用户放弃头像显示，代价可忽略。 */
    if (uid === "1") { uid = ""; av = null; }
    return {
      uid: uid,
      name: welcomeName(),
      avatar: av && av.src ? av.src : "",
    };
  }

  /* 首页欢迎块的落脚点：优先住进首页欢迎卡（.lg-article）的左列——那一格原本
     是促销轮播，用户要求"和运势并排在同一块玻璃卡里"。找不到卡才退回内容区顶部。 */
  function homeHelloHost() {
    var main =
      document.querySelector(".lg-index-content") ||
      document.querySelector(".main-container main") ||
      document.querySelector("#app .main-container");
    if (!main) return null;
    var card = main.querySelector(".lg-article");
    if (!card) return null;
    // 已经认领过的那一格直接复用：认领时把轮播清掉了，之后再按 .am-slider
    // 去找就永远找不到 —— 巡检会当成"宿主不存在"，欢迎块再也回不来。
    var mine = card.querySelector("[data-lg-hello-host]");
    if (mine) return mine;
    // 促销轮播不一定在第一行 .am-g 里，得把每行都过一遍
    var rows = card.querySelectorAll(":scope > .am-g");
    for (var r = 0; r < rows.length; r++) {
      var cols = rows[r].querySelectorAll(":scope > [class*='am-u-']");
      for (var i = 0; i < cols.length; i++) {
        if (cols[i].querySelector(":scope > .am-slider")) {
          // 轮播是促销位：清空它把这格让给欢迎块（洁净模式本来也要藏它）。
          // 已经住着欢迎块时不要清，否则每次巡检都重建、闪一下。
          if (!cols[i].querySelector("#lg-hello")) cols[i].textContent = "";
          cols[i].setAttribute("data-lg-hello-host", "1");
          return cols[i];
        }
      }
    }
    // 找不到那个促销位就别退回 main —— main 是整块内容容器，欢迎块塞进去
    // 会变成横跨整行的独立一行（用户看到的"跑到上面去了、左边空一片"）。
    // 宁可这一轮不放，等 DOM 稳定了下一轮巡检再说。
    return null;
  }

  /* ---------- 首页欢迎区块：头像 + 问候 + 一句吐槽 ---------- */
  var HELLO_LINES = [
    "今天的你：WA → TLE → RE → CE → OLE → …… AC！",
    "编译器不会骗你，只是它说的话很难懂。",
    "先写暴力，再想正解——所有 AC 都是这么来的。",
    "读题三遍，胜过调试三小时。",
    "数组开小是信仰，long long 是保命符。",
    "别人的题解一眼就懂，自己的代码一行都看不懂。",
    "暴力出奇迹，骗分过样例。",
    "今天也要做一只快乐的 OIer。",
    "思路不清就画图，边界不熟就手算。",
    "过了这题，就去吃饭。",
    "与其抱怨样例太水，不如自己造几组。",
    "所有的 WA 都在提醒你：还有边界没想到。",
  ];
  function helloLine() {
    var d = new Date();
    var seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
    return HELLO_LINES[seed % HELLO_LINES.length];
  }
  function sweepHomeHello() {
    var on = state.cfg.homeHello !== false;
    var isHome = location.pathname === "/" || /^\/index/.test(location.pathname);
    var box = document.getElementById("lg-hello");
    if (!on || !isHome) {
      if (box && box.parentNode) box.parentNode.removeChild(box);
      return;
    }
    var host = homeHelloHost();
    // 宿主暂时找不到（洛谷首页的 DOM 会重建）：保留现状、只同步高度，
    // 别把已经在正确位置的块搬走 —— 用户看到的就是"先对了一下然后跑掉"
    if (!host) {
      if (box) syncHelloHeight();
      return;
    }
    if (box && box.parentNode === host) { syncHelloHeight(); return; } // 已经在位：别重建，重建会闪
    if (box && box.parentNode) box.parentNode.removeChild(box);
    var av = findAvatar();
    var name = welcomeName();
    if (!av && !name) return; // 没登录就不放这块

    box = document.createElement("div");
    box.id = "lg-hello";
    if (av) {
      var img = document.createElement("img");
      img.className = "lg-hello-av";
      img.alt = "";
      img.src = av.src;
      box.appendChild(img);
    }
    var body = document.createElement("div");
    body.className = "lg-hello-body";
    var h = document.createElement("div");
    h.className = "lg-hello-title";
    h.textContent = name ? "你好，" + name + "！" : "你好！";
    var sub = document.createElement("div");
    sub.className = "lg-hello-sub";
    sub.textContent = helloLine();
    body.appendChild(h);
    body.appendChild(sub);
    box.appendChild(body);
    host.insertBefore(box, host.firstChild);
    syncHelloHeight();
  }

  /* 欢迎块那列和右侧运势列等高。
     AmazeUI 这一排是 float 栅格，列的 height 是 auto，子元素的 height:100%
     会退化成内容高度 —— 结果左下方留一大块空白。直接量运势列的高度贴上去，
     比在 CSS 里跟栅格较劲可靠。 */
  function syncHelloHeight() {
    var h = document.getElementById("lg-hello");
    if (!h || !h.parentNode) return;
    var card = h.closest ? h.closest(".lg-article") : null;
    if (!card) return;
    var punch = card.querySelector(".lg-punch");
    if (!punch) return;
    var ph = Math.round(punch.getBoundingClientRect().height);
    if (ph < 60) return;
    var row = h.parentNode;
    if (row && row.style.minHeight !== ph + "px") row.style.minHeight = ph + "px";
    if (h.style.height !== ph + "px") h.style.height = ph + "px";
  }

  /* ---------- 逆天改运 ----------
     实现照抄 Luogu-Plus v1.1.1（js/content.js 的「Change Fortune」）：
     运势节点 .lg-punch-result，文案形如 "§ 大吉 §" / "§ 大凶 §"，
     宜/忌两列是 .am-u-sm-6（至少两个）。
     注意：这个节点只在"今日已打卡"之后才出现，没打卡时页面上根本没有，
     所以这里靠轮询兜底，打完卡就被改写。 */
  var FORTUNE_SEL = ".lg-punch-result";
  var ADVICE_SEL = ".am-u-sm-6";
  var GOOD_FORTUNE = "§ 大吉 §";
  var BAD_FORTUNE = "§ 大凶 §";
  var GOOD_COLOR = "#e74c3c";
  var ADVICE_TEXT = "万事皆宜";
  var GOOD_ADVICE = [
    ["卷题", "水平显著提升"],
    ["继续完成WA的题", "下一次就可以AC了"],
  ];
  function goodAdviceHtml() {
    var out = "";
    for (var i = 0; i < GOOD_ADVICE.length; i++) {
      out +=
        '<span style="font-weight:bold">宜：</span>' + GOOD_ADVICE[i][0] +
        '<br><span style="font-size:10px;opacity:.62">' + GOOD_ADVICE[i][1] + "</span><br>";
    }
    return out;
  }
  function restoreLucky() {
    var marked = document.querySelectorAll('[data-lg-lucky="1"]');
    for (var i = 0; i < marked.length; i++) {
      var o = marked[i];
      var oldHtml = o.getAttribute("data-lg-lucky-old");
      if (oldHtml != null) o.innerHTML = oldHtml;
      o.removeAttribute("data-lg-lucky");
      o.removeAttribute("data-lg-lucky-old");
      o.style.removeProperty("color");
      o.style.removeProperty("font-weight");
      if (o.getAttribute("style") === "") o.removeAttribute("style");
    }
  }
  function markLucky(el) {
    if (el.getAttribute("data-lg-lucky") === "1") return;
    el.setAttribute("data-lg-lucky", "1");
    el.setAttribute("data-lg-lucky-old", el.innerHTML);
  }
  function sweepLucky() {
    var on = state.cfg.luckyDay === true;
    if (!on) { restoreLucky(); return; }
    var el = document.querySelector(FORTUNE_SEL);
    if (!el) return; // 还没打卡，页面上没有运势节点
    var adv = document.querySelectorAll(ADVICE_SEL);
    if (adv.length < 2) return;
    var wasBad = el.textContent.trim() === BAD_FORTUNE;
    if (el.textContent.trim() !== GOOD_FORTUNE) {
      markLucky(el);
      el.textContent = GOOD_FORTUNE;
      el.style.setProperty("color", GOOD_COLOR, "important");
    }
    // 宜：把"忌"那一列换成鼓励文案；忌：固定成"万事皆宜"
    if (wasBad) {
      markLucky(adv[0]);
      adv[0].innerHTML = goodAdviceHtml();
    }
    markLucky(adv[1]);
    adv[1].textContent = ADVICE_TEXT;
    adv[1].style.setProperty("color", "rgba(0, 0, 0, .75)", "important");
    adv[1].style.setProperty("font-weight", "bold", "important");
  }

  /* ---------- 代码块一键复制 ----------
     洛谷新前端的代码块（pre.lfe-code）是纯文本、没有 token 元素，
     所以这里做的是"能复制"而不是"能着色"。 */
  function sweepCodeCopy() {
    var on = state.cfg.codeCopy !== false;
    var pres = document.querySelectorAll("pre");
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      var has = pre.getAttribute("data-lg-copyable") === "1";
      if (!on) {
        if (has) {
          var old = pre.querySelector(":scope > .lg-code-copy");
          if (old && old.parentNode) old.parentNode.removeChild(old);
          pre.removeAttribute("data-lg-copyable");
        }
        continue;
      }
      if (has) continue;
      if (pre.querySelector("pre")) continue; // 嵌套的 pre 只保留外层
      pre.setAttribute("data-lg-copyable", "1");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lg-code-copy";
      btn.textContent = "复制";
      btn.title = "复制整段代码";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var host = e.currentTarget.parentNode;
        if (!host) return;
        // 按钮是 append 进 pre 的：pre 里有 code 元素时取 code 就够（按钮不在
        // code 里）；纯文本 pre 只能克隆一份、摘掉按钮再取文本，否则复制结果
        // 尾巴上多个"复制"
        var code = host.querySelector("code");
        var src = code;
        if (!src) {
          src = host.cloneNode(true);
          var btns = src.querySelectorAll(".lg-code-copy");
          for (var b = 0; b < btns.length; b++) btns[b].remove();
        }
        ctx.copyText(src.innerText || src.textContent || "");
        e.currentTarget.textContent = "已复制";
        setTimeout(function () {
          if (e.currentTarget) e.currentTarget.textContent = "复制";
        }, 1200);
      });
      pre.appendChild(btn);
    }
  }

  /* 推广卡也吃同一批 DOM 变化（R37）：右栏那张卡是 Vue 异步渲染出来的，
     只靠 2.5s 巡检会先露出来一两秒。这里 300ms 防抖跑一次幂等清扫。 */
  var promoSweepTimer = null;
  function queuePromo() {
    if (promoSweepTimer) return;
    promoSweepTimer = setTimeout(function () {
      promoSweepTimer = null;
      sweepPromos();
    }, 300);
  }

  /* ---------- 题目页自带 IDE 模式（R38，选择器 R40 实测修正）----------
     洛谷题目页的「进入 IDE 模式」是页面内的分屏（不是 /ide 路由）：URL 仍是
     /problem/xxx，DOM 里冒出编辑器容器 + 「退出 IDE 模式」入口。应用侧据此进
     "真·全屏"（该标签页面视图铺满整窗、外壳与坞让位），编辑器面板也按原生
     不透明渲染（apply 里 data-lg-ide 定夺，与 /ide 页同一套规则）。
     R38 的判定用的是三个**猜的**类名（.code-editor-container/.editor-top-bar/
     .io-editor-container）——真站（2026-10 实测）一个都不存在，判定恒 false，
     全屏与原生渲染从未生效（用户报"切到 IDE 模式还是不全屏"）。真站的容器是
     .panel-layout.layout-horizontal.ide-container（内含 .ide-toolbar /
     .ide-textarea / .cm-editor），退出入口是 .lfe-caption.problem-block-actions
     里的一个 <a>（文案「退出 IDE 模式」）。判定 = 容器可见 + 退出文案在场。 */
  function ideInPageDetect() {
    if (!isLuoguPage || !/^\/problem\//.test(location.pathname || "")) return false;
    try {
      /* 退出入口在编辑器容器**外**（题目卡的 .problem-block-actions 里），
         整页找文案——这是两个方向都权威的信号：进入 IDE 后它出现、退出后
         又变回「进入 IDE 模式」。 */
      var exitOn = false;
      var nodes = document.querySelectorAll("a, button, span");
      for (var i = 0; i < nodes.length && i < 500; i++) {
        var s = (nodes[i].textContent || "").trim();
        if (s.length <= 16 && s.indexOf("退出 IDE") >= 0) { exitOn = true; break; }
      }
      /* 已经开着：只看退出入口（编辑器重排/首帧零尺寸的瞬间不许把全屏抖掉） */
      if (ctx.inPageIde) return exitOn;
      if (!exitOn) return false;
      /* 打开方向再加一道容器可见的门，防别的页面元素撞文案误判 */
      var box = document.querySelector(".ide-container, .panel-layout.ide-container, .ide-toolbar, .code-editor-container, .editor-top-bar, .io-editor-container");
      if (!box) return false;
      var r = box.getBoundingClientRect();
      return !!(r.width > 0 && r.height > 0);
    } catch (e) { return false; }
  }
  var ideQueueTimer = 0;
  function ideInPageSync() {
    var on = ideInPageDetect();
    if (on === ctx.inPageIde) return;
    ctx.inPageIde = on;
    try { if (window.lgApp && window.lgApp.ideMode) window.lgApp.ideMode(on); } catch (e) {}
    ctx.apply(state.cfg); // 面板按原生渲染 / 退出后把玻璃还回来（data-lg-ide 在 apply 里定）
  }
  function ideInPageQueue() {
    clearTimeout(ideQueueTimer);
    ideQueueTimer = setTimeout(ideInPageSync, 250);
  }

  /* 启动时序：顶层副作用收进 boot()，由内核按固定顺序调用（见 inject.js
     的 bootInject）——顺序与这些语句在拆分前的先后完全一致。 */
  function boot() {
    /* 调试出口（探针/实测用）：直接看判定与桥，不用等防抖 */
    window.__lgIdeInPage = function () {
      return { on: ideInPageDetect(), state: inPageIde, bridge: !!(window.lgApp && window.lgApp.ideMode) };
    };
    window.__lgIdeSync = ideInPageSync;
  }

  ctx.register("luoguPage", {
    sweepPromos: sweepPromos,
    sweepDeclutter: sweepDeclutter,
    sweepHomeHello: sweepHomeHello,
    sweepLucky: sweepLucky,
    sweepCodeCopy: sweepCodeCopy,
    userInfo: userInfo,
    ideInPageQueue: ideInPageQueue,
    queuePromo: queuePromo,
    boot: boot,
  });
})(window.__lgInjectCtx);
