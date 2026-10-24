/* ============================================================
   Luogu++ — 注入运行时（内核）
   暴露 window.__lgGlass.apply(config)，主进程在每次页面加载后调用；
   设置页改配置时也通过主进程实时推送到这里。
   开关一览：pageTheme(auto/light/dark，v3.5.1 起 native 并入 auto) / clean /
            declutter / quickSearch / listTools / contentDesat / ideNative

   本文件只留内核：共享状态（window.__lgInjectCtx）、apply() 主干、2.5s 巡检、
   DOM 观察者与启动时序。各项能力拆在 src/inject/*.js：
     viewrect   缩放与视口补偿        material  材质与玻璃面（含能力注册表）
     wallpaper  壁纸与视差            reader     阅读模式
     translate  翻译                  selection  划词与选区
     luogu-list 列表页工具            luogu-page 洛谷页增强
   注入是「内核 + 模块」按固定顺序拼成的一段脚本：内核先跑并建好 ctx，各模块
   再把自己登记到 ctx.features；**最后一个模块登记完才启动**（见 bootInject），
   所以顶层副作用的先后与拆分前逐条一致。拆分是纯搬移，不改逻辑、不改选择器、
   不改时序。
   ============================================================ */
(function () {
  if (window.__lgGlass) return;
  if (window.__lgInjectCtx) return;

  var BG_ID = "lg-glass-bg";

  // 变量唯一来源：全部由 apply() 以内联样式写到 <html> 上
  // 黑白单色 / 线条风：无彩色、无渐变、发丝边框
  //
  // 配色预设由主进程解析后随 cfg 下发（presetLight / presetDark）。
  // 这里只留一份"墨白"兜底：页面偶尔会被独立调用 apply（例如调试时手敲
  // executeJavaScript），没有下发值也要能画出来。
  var THEME_VARS = {
    light: { tint: "255, 255, 255", bgBase: "#f7f7f8", ink: "#18181b", border: "rgba(0, 0, 0, 0.12)" },
    dark: { tint: "23, 24, 28", bgBase: "#101013", ink: "#e7e7ea", border: "rgba(255, 255, 255, 0.12)" },
  };

  var FONT_VARS = {
    sans:
      '"MiSans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", ' +
      '"Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
    mono:
      '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, ' +
      '"Sarasa Mono SC", monospace',
  };


  var state = { cfg: {}, mode: "light" };

  /* 页面分流：洛谷站跑完整功能；其它页（应用本地页 file:// / 站外映射页）
     只做玻璃壁纸层，洛谷专属的清扫/工具条一概不跑（DOM 根本不匹配，
     白白全文档扫描）。location 在页面生命周期里不变，这里算一次就够。 */
  var isLuoguPage = /(^|\.)luogu\.(com\.cn|org|com)$/i.test(location.hostname || "");
  var extHttpPage = !isLuoguPage && /^https?:$/i.test(location.protocol);
  /* 站外玻璃白名单：只对这些站铺壁纸+透明化+令牌重定义。对未知站点乱开
     透明等于拆人家 UI（v3.4.2 的教训），没进名单的站外页一律原生渲染。 */
  var glassSite = extHttpPage && /^chat\.deepseek\.com$/i.test(location.hostname || "");

  /* 站外页玻璃化（R51 用户口径）：只要是一个网站就自动玻璃化，
     不再按"内容型/应用型"探测挑站；排除名单（cfg.glassExclude）里的
     域名保持原生。域名匹配包含子域：example.com 同时排除 a.example.com。
     技术保护仍在 material.js：含 position:fixed 后代的容器不挂 blur，
     只给半透明底，避免劫持 fixed 包含块。 */
  function glassExcluded() {
    var list = state.cfg && Array.isArray(state.cfg.glassExclude) ? state.cfg.glassExclude : [];
    var host = String(location.hostname || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var d = String(list[i] || "").trim().toLowerCase().replace(/^\./, "");
      if (!d) continue;
      if (host === d || host.slice(-(d.length + 1)) === "." + d) return true;
    }
    return false;
  }
  function detectAutoGlass() {
    if (!extHttpPage) return false;
    if (state.cfg && state.cfg.autoGlass === false) return false;
    return !glassExcluded();
  }

  function clamp01(v) { v = Number(v); if (isNaN(v)) v = 0; return Math.min(1, Math.max(0, v)); }
  function clampNum(v, min, max, dft) {
    v = Number(v); if (isNaN(v)) v = dft;
    return Math.min(max, Math.max(min, v));
  }
  // 把 rgba(...) 的透明度按倍数缩放——"边框强度"滑杆用它，颜色本体不变
  function scaleAlpha(color, k) {
    var m = String(color).match(
      /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/
    );
    if (!m) return color;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    a = Math.min(1, Math.max(0, a * k));
    return "rgba(" + m[1] + ", " + m[2] + ", " + m[3] + ", " + a.toFixed(3) + ")";
  }

  /* 玻璃站（DeepSeek）明暗嗅探：正文色亮度 < 128 说明是浅色站（深字），
     否则深色站。SPA 首屏样式可能没就绪，巡检会复嗅，变了再 apply。 */
  function dsThemeSniff() {
    try {
      var m = getComputedStyle(document.body).color.match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/
      );
      if (m) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 128 ? "light" : "dark";
    } catch (e) {}
    return "";
  }

  /* ---------- 共享上下文 ----------
     注入层的共享状态只有这一份。内核建 ctx 挂到 window.__lgInjectCtx；各能力
     模块（src/inject/*.js）拿到它，把入口登记进 ctx.features；内核的 apply()、
     巡检与观察者再回头调 ctx.features.*。模块之间不互相 require，也不各自造
     状态——真正被多处读写的量（autoGlass）一律走 ctx.x，不取局部
     别名，免得各抄一份真值。 */
  var ctx = {
    BG_ID: BG_ID,
    state: state,
    /* 能力模块要能主动重跑一次 apply（壁纸解码完成）：
       wallpaper.js 调 ctx.apply，之前只定义了局部 apply 没挂到 ctx，
       调用会抛 "ctx.apply is not a function"。 */
    apply: apply,
    isLuoguPage: isLuoguPage,
    extHttpPage: extHttpPage,
    glassSite: glassSite,
    /* 真值在 apply() 里重算（外部站内容异步到达） */
    autoGlass: false,
    features: {},
    booted: false,
  };
  window.__lgInjectCtx = ctx;
  var F = ctx.features;
  /* 模块清单：注入端按同一顺序拼装（main.js 的 INJECT_MODULES）。少一个模块就
     永远等不到启动——宁可整层不注入，也不在半装载状态下跑页面。
     两份清单是同一个清单的两处落笔（文件名 vs 登记 id），加模块时必须一起改；
     真漏了也不会静默：兜底定时器会把差哪几个写进 console，不留"页面看着没样式
     又查不出原因"的坑。 */
  var EXPECTED = ["viewrect", "wallpaper", "material", "reader", "translate", "selection", "luoguList", "luoguPage"];
  var registered = 0;
  ctx.register = function (id, api) {
    F[id] = api;
    registered++;
    if (registered >= EXPECTED.length) bootInject();
  };
  /* 漏装载的自检：清单与实际登记对不上时 bootInject 永远不会被调，症状是页面
     完全没有玻璃/壁纸（像"注入没生效"）。这里在注入后的同一拍里把差集喊出来，
     免得下次只能靠猜。定时器不阻塞同步注入路径，到点还没启动才说明真少了。 */
  setTimeout(function () {
    if (ctx.booted) return;
    var missing = [];
    for (var i = 0; i < EXPECTED.length; i++) if (!F[EXPECTED[i]]) missing.push(EXPECTED[i]);
    console.error("[Luogu++] 注入层模块装载不全，已启动的模块：" + Object.keys(F).join(",") + "；缺失：" + missing.join(","));
  }, 0);

  function luminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function detectTheme() {
    // 优先使用主进程在 CSS 注入前嗅探到的原生底色（window.__lgNativeTheme），
    // 避免采到本样式表写上去的半透明玻璃造成循环误判。
    if (window.__lgNativeTheme === "dark" || window.__lgNativeTheme === "light") {
      return window.__lgNativeTheme;
    }
    var sels = [".theme-page", ".main-container", "main", "body"];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (!el) continue;
      var m = getComputedStyle(el).backgroundColor.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/
      );
      if (!m) continue;
      var a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (a < 0.9) continue;
      return luminance(+m[1], +m[2], +m[3]) < 0.5 ? "dark" : "light";
    }
    return "light";
  }

  /* 剪贴板：https 页面优先用 clipboard API，老环境回退 execCommand */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) {}
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
        return;
      }
    } catch (e) {}
    legacyCopy(text);
  }

  ctx.copyText = copyText;
  ctx.detectTheme = detectTheme;

  function apply(cfg) {
    cfg = cfg || {};
    state.cfg = cfg;
    var root = document.documentElement;
    var path = location.pathname;
    /* 页面类型：圆角/内块策略按它分档（题目、题单、比赛、用户中心、讨论、
       文章、IDE）。站点改版/未知路由落 other，不猜。 */
    var pageType = !isLuoguPage ? "ext"
      : /^\/problem\//.test(path) ? "problem"
      : /^\/training\//.test(path) ? "training"
      : /^\/contest\//.test(path) ? "contest"
      : /^\/user\//.test(path) ? "user"
      : /^\/discuss\//.test(path) ? "discussion"
      : /^\/article\//.test(path) ? "article"
      : /^\/ide(\/|$)/.test(path) ? "ide"
      : "other";
    root.setAttribute("data-lg-page-type", pageType);
    /* 站外页是不是"内容型站点"**每次 apply 都重算**：外部站多是异步渲染
       （骨架屏 → 内容），注入那一刻正文可能还没到，判成"内容量不足"就
       再也不会玻璃化了。apply 在换路由、配置变更、巡检发现 URL 变了时
       都会重跑，重算即可跟上。 */
    if (extHttpPage) ctx.autoGlass = detectAutoGlass();

    // IDE 页特殊处理：只认 /ide 路由（独立 IDE 页）。洛谷题目页里的
    // 「进入 IDE 模式」不再触发整窗全屏，也不再强制原生渲染——按玻璃主题走。
    var isIde = /\/ide(\/|$)/.test(path);
    var ideNative = isIde && cfg.ideNative !== false;
    root.setAttribute("data-lg-ide", ideNative ? "1" : "0");
    // 非洛谷页标记：inject 的外部样式表按它决定给不给玻璃（壁纸层）。
    // data-lg-local 区分"应用本地页"（file:// 首页/设置/历史，我们自己的 UI，
    // 敢透明）和"站外 http(s) 页"（人家的 UI，默认不动底色——v3.4.2 曾重定义
    // DeepSeek 的 --dsw-* 令牌 + 给根容器挂 backdrop-filter，结果壁纸从整页
    // 打穿、fixed 元素包含块被劫持，用户实测即坏）。
    // data-lg-glasssite：白名单玻璃站（见 glassSite）——壁纸层回归、body 及
    // 一级容器放透明，但透明度走"可读玻璃"（ext.css 里 0.8+ 的令牌），且
    // 绝不给人家容器挂 backdrop-filter（那是 fixed 包含块被劫持的根源）。
    // data-lg-dstheme：玻璃站的明暗。读人家的**正文色**判断（我们只动背景，
    // 正文色永远是人家自己的，不受透明化影响）——浅色站配半透明白玻璃，
    // 深色站配半透明黑玻璃，跟着人家的主题切换走。
    root.setAttribute("data-lg-ext", isLuoguPage ? "0" : "1");
    root.setAttribute("data-lg-local", extHttpPage ? "0" : "1");
    root.setAttribute("data-lg-glasssite", glassSite ? "1" : "0");
    /* 自动探测命中的内容型站外页：铺静态壁纸 + 淡玻璃底（ext.css 消费）。
       白名单站（glassSite）另走令牌重定义那套更彻底的路。 */
    root.setAttribute("data-lg-glassauto", ctx.autoGlass ? "1" : "0");
    /* 玻璃站的明暗：读人家**正文色**判断（我们只动背景，正文色永远是人家自己的，
       不受透明化影响）——浅色站配浅色玻璃、深色站配深色玻璃，跟人家主题走。
       这个判定同时决定下面 resolved 的取值（玻璃变量与洛谷页同源同算法）。 */
    var dsTheme = glassSite ? dsThemeSniff() : "";
    if (glassSite) root.setAttribute("data-lg-dstheme", dsTheme);

    /* ---------- 页面主题：auto（跟随全应用统一明暗）/ light / dark ----------
       v3.5.1 起"页面配色"三态从设置里撤掉：页面不再有"原色"可选，始终跟随
       全应用统一主题——原色页正是"里面一个颜色、外面一个颜色"的根因。
       旧配置里的 light/dark 显式值仍然认；native 一律并入 auto。 */
    var pageTheme = cfg.pageTheme || "auto";
    if (pageTheme !== "light" && pageTheme !== "dark") pageTheme = "auto";
    if (ideNative) pageTheme = "native"; // IDE 页保持洛谷原生配色
    root.setAttribute("data-lg-page", pageTheme);

    var resolved;
    if (pageTheme === "light" || pageTheme === "dark") {
      resolved = pageTheme;
    } else {
      // 明暗全应用一个答案：主进程 resolvedTheme 随配置下发（与外壳同源），
      // 页面不再自己嗅探/猜系统主题——以前页面嗅洛谷 DOM、外壳读 lastNative、
      // 本地页看系统深色，三套口径就是"页面玻璃和外壳玻璃不同色"的根因。
      // 玻璃站也不再按 dstheme 自选玻璃色（DeepSeek 深色、外壳浅色的分裂
      // 就是这么来的）；dstheme 只作配置未到手时的兜底。
      resolved = glassSite
        ? cfg.resolvedTheme || dsTheme || "light"
        : cfg.resolvedTheme || (isLuoguPage ? (window.__lgNativeTheme || detectTheme()) : "light");
    }
    // 站点名：ext.css 按 host 给特定站写增强规则（如 DeepSeek 的变量重定义）
    try { root.setAttribute("data-lg-host", String(location.hostname || "")); } catch (e) {}
    // 暗色走"整页反转重绘"：变量仍用浅色一套，反转后即深色，
    // 这样连洛谷自带样式里没被我们接管的部分也一并变暗。
    // 只有洛谷页吃反转——本地页有自己的暗色变量，站外页/玻璃站不动人家配色。
    var darkRepaint = pageTheme === "dark" || (pageTheme === "auto" && resolved === "dark" && isLuoguPage);
    root.setAttribute("data-lg-repaint", darkRepaint ? "1" : "0");
    root.setAttribute("data-lg-theme", darkRepaint ? "light" : resolved);

    // 开关
    root.setAttribute("data-lg-clean", cfg.clean === false ? "0" : "1");
    root.setAttribute("data-lg-frameless", cfg.frameless === false ? "0" : "1");
    root.setAttribute("data-lg-declutter", cfg.declutter ? "1" : "0");
    /* 快速筛选框：题单广场（/training/list）是卡片墙、没有可筛的行列表，R40
       用户点名删掉该页顶部的筛选条——把开关在这一页直接压成 0，setup 的两条
       路径（apply 与 2.5s 巡检）都会跟着跳过，SPA 从别的列表页切过来时
       apply 里的 teardown 负责把已挂的那条摘掉。 */
    var quickOff = cfg.quickSearch === false || /^\/training\/list\/?$/.test(path);
    root.setAttribute("data-lg-quicksearch", quickOff ? "0" : "1");
    root.setAttribute("data-lg-listtools", cfg.listTools === false ? "0" : "1");

    // 视觉参数（全部内联下发，含主题变量）
    // 变量跟随 data-lg-theme 而不是 resolved：暗色走整页反转时，这一套必须
    // 是浅色值，反转后才正好是深色（原实现取 resolved，遇到原生深色站点会反成浅色）。
    var mode = darkRepaint ? "light" : resolved === "dark" ? "dark" : "light";
    var tv = (mode === "dark" ? cfg.presetDark : cfg.presetLight) || THEME_VARS[mode] || THEME_VARS.light;
    root.setAttribute("data-lg-preset", cfg.preset || "ink");
    var s = root.style;
    s.setProperty("--lg-tint", tv.tint);
    s.setProperty("--lg-ink", tv.ink);
    s.setProperty("--lg-bg-base", tv.bgBase);
    s.setProperty("--lg-text-boost", tv.textBoost);
    s.setProperty("--lg-border", scaleAlpha(tv.border, clampNum(cfg.borderStrength, 0.4, 3, 1)));
    s.setProperty("--lg-accent", cfg.accentResolved || cfg.accent || tv.ink);
    root.setAttribute("data-lg-anim", cfg.animations === false ? "0" : "1");
    root.setAttribute("data-lg-diff", cfg.diffMono ? "mono" : "native");
    root.setAttribute("data-lg-codecopy", cfg.codeCopy === false ? "0" : "1");
    root.setAttribute("data-lg-bsearch", cfg.betterSearch === false ? "0" : "1");
    // 注意别用 data-lg-lucky：那是 sweepLucky 给运势节点打的"已改写"标记，
    // restoreLucky 按 [data-lg-lucky="1"] 全文档找元素，根节点会被一起误伤。
    root.setAttribute("data-lg-luckyday", cfg.luckyDay === true ? "1" : "0");
    s.setProperty("--lg-sans", FONT_VARS.sans);
    s.setProperty("--lg-mono", FONT_VARS.mono);
    s.setProperty("--lg-overlay-w", cfg.frameless === false ? "0px" : "148px");
    s.setProperty("--lg-blur", clampNum(cfg.blur, 0, 40, 26) + "px");
    s.setProperty("--lg-radius", clampNum(cfg.radius, 0, 28, 8) + "px");
    // 壁纸：只要用户显式选过就铺（否则"设了壁纸却看不到"会被当成 bug）。
    // 原色模式只是不去动颜色，但用户自己挑的壁纸必须兑现。IDE 页除外。
    // 站外 http(s) 页默认不铺：人家的层色是自己画的半透明色（DeepSeek 浅色
    // 主题整叠 rgba 白），本该坐在人家不透明的底色上；而我们 z-index:-1 的
    // 壁纸层恰好垫在"画布"之上——body 背景会上传播到画布、画在负 z 层之下——
    // 乱垫壁纸整页就透成筛子。
    // 两个例外：
    //   ① 白名单玻璃站（glassSite）：配好可读的令牌透明度再垫壁纸（ext.css）。
    //   ② 自动探测命中的内容型站外页（ctx.autoGlass）：铺**静态**壁纸 + 淡玻璃底，
    //      让站外页也有统一的观感；视频壁纸仍然不铺（动态底 + 人家页面更乱）。
    var bgVideo = !!cfg.wallpaperIsVideo && !!cfg.wallpaperUrl && !ideNative && !extHttpPage;
    var wall = ideNative || bgVideo || (extHttpPage && !glassSite && !ctx.autoGlass)
      ? "none" : ctx.features.wallpaper.wallpaperUrl(cfg);
    s.setProperty("--lg-wall-image", wall);
    ctx.features.wallpaper.applyWallpaperImage(wall);
    /* 壁纸参数（模糊/压暗）由主进程 wallpaperPayload() 一次算好（与外壳同一
       份 clamp），几何由 setViewRect 写成 --lg-wall-x/y/w/h——外壳、页面、
       弹层三层画的因此是同一张画、同一几何。 */
    var wpl = cfg.wall || {};
    s.setProperty("--lg-wall-blur", clampNum(wpl.blurPx != null ? wpl.blurPx : cfg.wallpaperBlur, 0, 30, 0) + "px");
    s.setProperty("--lg-wall-dim", String(clamp01(wpl.dim != null ? wpl.dim : cfg.wallpaperDim != null ? cfg.wallpaperDim : 0)));
    /* 首屏兜底几何：主进程 layout() 的权威矩形还没到之前，壁纸层用 inset 把
       自己撑到整个窗口（与外壳那层同坐标系）；到了就被 --lg-wall-* 覆盖。 */
    s.setProperty("--lg-inset-x", (cfg.insetX != null ? cfg.insetX : 58) + "px");
    s.setProperty("--lg-inset-y", (cfg.insetY != null ? cfg.insetY : 78) + "px");
    s.setProperty("--lg-footer", (cfg.footer != null ? cfg.footer : 0) + "px");
    // 有壁纸时页面底色必须透明，否则壁纸被挡住（此前壁纸开关失效的根因）
    root.setAttribute("data-lg-wall", wall !== "none" || bgVideo ? "1" : "0");
    root.setAttribute("data-lg-bgvideo", bgVideo ? "1" : "0");
    if (!bgVideo) root.setAttribute("data-lg-bgready", "0");
  var vEl = ctx.features.wallpaper.ensureBgVideo();
  if (vEl) {
      if (bgVideo) {
        if (vEl.getAttribute("data-src") !== cfg.wallpaperUrl) {
          vEl.setAttribute("data-src", cfg.wallpaperUrl);
          /* 换源：先退回图片/渐变兜底（bgready=0），等新源 loadedmetadata
             再切到视频面——加载期不再是一片空白 */
          root.setAttribute("data-lg-bgready", "0");
          vEl.muted = true;
          /* 直放 lg-media:// 优先（零拷贝），失败自动转 blob 兜底（ctx.features.wallpaper.feedBgVideo） */
          ctx.features.wallpaper.feedBgVideo(vEl, cfg.wallpaperUrl);
        }
        vEl.muted = cfg.wallpaperMute !== false;
        /* 播不播完全由 setTabActive 说了算，这里不碰 —— 否则每次配置下发
           （页面导航、改设置）都会把后台标签的视频重新播起来，几个标签就是
           几路解码同时跑。 */
      } else if (vEl.getAttribute("data-src")) {
        vEl.removeAttribute("data-src");
        try { vEl.pause(); } catch (e) {}
        vEl.removeAttribute("src");
        if (vEl._lgBlob) { try { URL.revokeObjectURL(vEl._lgBlob); } catch (e) {} vEl._lgBlob = null; }
        try { vEl.load(); } catch (e) {}
      }
    }

    /* 玻璃皮肤：页面卡片折射背后的壁纸，和外壳层用同一套语言 */
    var glass = cfg.glass === "liquid" ? "liquid" : "flat";
    root.setAttribute("data-lg-glass", glass);
    /* 面材质扫描跟随皮肤切换：开玻璃→重扫贴上，关玻璃→把贴过的类摘干净。
       两种策略（洛谷页 / 站外页）都收敛到能力注册表，enable/mount/unmount
       只在状态翻转时触发——下面那句巡检可以随便重复调。 */
    setTimeout(ctx.features.material.syncAdapters, 60);
    /* 材质变量恒下发：玻璃皮肤吃 glassLight/Dark（主进程 glassVars 推导），
       素面皮肤吃 glassFlatLight/Dark（同一张映射的"无模糊、无高光"版）。
       与外壳 --glass-* 是同一份值——页面不再本地推导、更不手写
       rgba(255,255,255,0.92) / 62%+blur(18) 那种"自己调的一杯料"，页面 CSS
       只消费变量。以前只在 liquid 下发，flat 皮肤的本地页就只能退回各页
       自己写死的值——设置页"外面的框是玻璃、里面的卡片是实心"就是这么来的。
       mode 是"变量模式"：暗色走整页反转时变量仍是浅色一套，反转后自然变深。
       玻璃站（DeepSeek）与其它页面**同一套**（皮肤选值）——以前它恒吃 liquid
       一套，flat 用户的 DeepSeek 与外壳是两种料。ext.css 的 --dsw-* 令牌
       重定义消费 glassSoft/glassSolid（两种皮肤里都有这两个档）。 */
    var mat = cfg.material || null;
    var gv = mat ? (mode === "dark" ? mat.dark : mat.light) : null;
    if (gv) {
      var names = (mat && mat.vars) || {};
      var keys = (mat && mat.keys) || Object.keys(gv);
      for (var ki = 0; ki < keys.length; ki++) {
        var nm = names[keys[ki]] || "--lg-glass-" + String(keys[ki]).replace(/^glass/, "").toLowerCase();
        s.setProperty(nm, gv[keys[ki]]);
      }
    }
    // 去色：默认 0（保持原色）；>0 才挂灰度滤镜（避免 filter:0 仍创建合成层）
    var desat = ideNative || pageTheme === "native" ? 0 : clamp01(cfg.contentDesat != null ? cfg.contentDesat : 0);
    s.setProperty("--lg-desat", String(desat));
    root.setAttribute("data-lg-desat", desat > 0.01 ? "1" : "0");

    // 壁纸层：本地页、白名单玻璃站，以及 R51 起所有非排除名单的站外页
    // （全站玻璃化 = 页面透明 + 壁纸层 + 玻璃纱）。
    if (!extHttpPage || glassSite || ctx.autoGlass) {
      ctx.features.wallpaper.ensureBgLayer();
      // 壁纸视差：鼠标移动壁纸层轻微跟随（外壳层经 IPC 同一公式同步动）。
      // 关掉时把 transform 复位，不然停在上次偏移的位置。
      if (cfg.wallpaperParallax === false) {
        s.setProperty("--par-x", "0px");
        s.setProperty("--par-y", "0px");
      } else {
        ctx.features.wallpaper.attachParallax();
      }
    }
    if (isLuoguPage) {
      // 代码块复制按钮立刻挂上（别等 2.5s 的巡检）
      if (typeof ctx.features.luoguPage.sweepCodeCopy === "function") ctx.features.luoguPage.sweepCodeCopy();
    }

    /* 用户自定义 CSS：设置页"自定义 CSS"卡片里写，全页面生效。样式表常驻
       <head>，内容变了才重写（避免每次 apply 都触发全页重排）。 */
    var userCssEl = document.getElementById("lg-user-css");
    if (!userCssEl) {
      userCssEl = document.createElement("style");
      userCssEl.id = "lg-user-css";
      (document.head || document.documentElement).appendChild(userCssEl);
    }
    var userCssText = typeof cfg.customCSS === "string" ? cfg.customCSS : "";
    if (userCssEl.textContent !== userCssText) userCssEl.textContent = userCssText;

    /* 本地页（首页/设置/历史）吃配置的方式是 lgConfig.get() 一次性拉取，
       之后设置变了没人通知它们——广播一个事件让它们在 apply 时顺势重读
       （首页板块开关、时钟样式就是靠这个做到"设置里一勾、首页立刻变"）。 */
    if (!extHttpPage) {
      try { document.dispatchEvent(new CustomEvent("lg-config", { detail: cfg })); } catch (e) {}
    }
    state.mode = pageTheme;

    // 功能模块按开关挂载/卸载（洛谷页专属；其它页不碰人家的 DOM）
    if (!isLuoguPage) {
      /* 无洛谷 DOM 可扫，全部跳过 */
    } else if (isIde || pageTheme === "native") {
      ctx.features.luoguList.teardownListTools();
      ctx.features.luoguList.teardownQuickSearch();
    } else if (/\/problem\/[A-Za-z]+\d+/.test(path)) {
      ctx.features.luoguList.teardownListTools();
      ctx.features.luoguList.teardownQuickSearch();
    } else if (/\/(problem|training|contest|record)\/list/.test(path) || /^\/problem\/?$/.test(path)) {
      ctx.features.luoguList.setupListTools();
      /* 题单广场不挂快速筛选（R40 用户点名删）：从别的列表页 SPA 切过来时
         这里负责把已经挂着的那条摘掉，attribute 也已被压成 0。 */
      if (/^\/training\/list\/?$/.test(path)) ctx.features.luoguList.teardownQuickSearch();
      else ctx.features.luoguList.setupQuickSearch();
    } else {
      ctx.features.luoguList.teardownListTools();
      ctx.features.luoguList.teardownQuickSearch();
    }

    /* 首帧主题底色已完成使命：真实主题变量与背景规则都落地了，移除 #lg-boot
       与 preload 写在 html/body 上的 inline 背景；站点自己的 inline 背景
       从 data-lg-boot-bg 还原。 */
    var bootEl = document.getElementById("lg-boot");
    if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
    var restoreBootBg = function (el) {
      if (!el || !el.hasAttribute("data-lg-boot-bg")) return;
      var orig = el.getAttribute("data-lg-boot-bg") || "";
      try {
        if (orig) el.style.setProperty("background", orig, "important");
        else el.style.removeProperty("background");
        el.style.removeProperty("color-scheme");
      } catch (e) {}
      el.removeAttribute("data-lg-boot-bg");
    };
    restoreBootBg(root);
    restoreBootBg(document.body);
  }

  /* 巡检：sweep 都是幂等的便宜 DOM 扫描，照常跑；但**不再每 2.5s 无条件
     全量 apply()**——那是常驻性能开销（每次都重挂/重拆功能块、重写一串
     setProperty），也是页面"晚到修正再闪一次"的来源。配置变化由主进程推
     （applyConfigToPages）、SPA 换路由由 did-navigate-in-page 触发 apply；
     这里只兜"URL 变了但主进程没通知到"的漏。 */
  var lastHref = location.href;
  var glassTick = 0;
  function startPatrol() {
    setInterval(function () {
      glassTick++;
      // 壁纸层体检（所有页面都做：本地页也有壁纸）
      if (ctx.features.wallpaper.wallpaperUnhealthy()) ctx.features.wallpaper.healWallpaper();
      else healTries = 0;
      if (isLuoguPage) {
        ctx.features.luoguPage.sweepPromos();
        ctx.features.luoguPage.sweepDeclutter();
        ctx.features.luoguPage.sweepCodeCopy();
        ctx.features.luoguPage.sweepHomeHello();
        ctx.features.luoguPage.sweepLucky();
        ctx.features.luoguList.sweepBetterSearch();
        /* 面材质巡检：Vue 异步渲染常整块换 DOM 而没触发可见的属性变化，
           observer 会漏；每第 12 拍（约 30s，R41 从 5 拍放宽）全量补扫一次，
           新增节点的即时补扫由 MutationObserver（250ms 去抖）负责 */
        if (glassTick % 12 === 0) ctx.features.material.sweepLuoguFaces();
        /* 列表工具也要巡检：apply 只在注入/换路由时跑一遍，洛谷的列表是
           Vue 异步渲染，那一遍常常早于筛选行与表格——功能块就此错过整页。
           两个 setup 都是幂等的（已挂载立即返回），巡检拿来兜底重挂载与难度自学习。 */
        var lp = location.pathname;
        if (/\/(problem|training|contest|record)\/list/.test(lp) || /^\/problem\/?$/.test(lp)) {
          if (document.documentElement.getAttribute("data-lg-listtools") === "1") ctx.features.luoguList.setupListTools();
          if (document.documentElement.getAttribute("data-lg-quicksearch") === "1") ctx.features.luoguList.setupQuickSearch();
        }
      } else if (extHttpPage) {
        /* 站外页巡检：外部站多为异步渲染，注入时正文还没到齐，"是不是内容型
           站点"的判定也会随后翻转（先判否、正文到了改判是）。所以这里重算
           判定 + 重设作用域属性，再让注册表自己 diff（状态没翻转它就不动手，
           多跑几遍无副作用）。 */
        if (glassTick % 6 === 0) {
          ctx.autoGlass = detectAutoGlass();
          document.documentElement.setAttribute("data-lg-glassauto", ctx.autoGlass ? "1" : "0");
          ctx.features.material.syncAdapters();
        }
      }
      // SPA 前进后退后重新挂载功能块（壁纸层被移除由 MutationObserver 补回）
      if (location.href !== lastHref) {
        lastHref = location.href;
        apply(state.cfg);
      }
      // 玻璃站 SPA 首屏样式可能没就绪（dstheme 嗅错会卡住），复嗅变了就重涂
      if (glassSite) {
        var nt = dsThemeSniff();
        if (nt && nt !== document.documentElement.getAttribute("data-lg-dstheme")) apply(state.cfg);
        /* 圆角巡检是 body * 全量矩形扫描（R41 从每拍 2.5s 放宽到每 5 拍 12.5s）：
           首次挂载仍由下方 1.2s 定时器兜底，SPA 换节点靠 __lgRounded 重扫 */
        if (glassTick % 5 === 0) ctx.features.material.roundGlassSiteSidebar();
      }
    }, 2500);
  }

  /* 面材质观察者：Vue 异步渲染常整块换 DOM，巡检兜底之外还要即时补扫。 */
  var glassObserver = new MutationObserver(function (muts) {
    /* 清扫循环整段兜底：某个节点让 ctx.features.material.queueGlass 抛错时，后面的推广/IDE 判定
       不能跟着被跳过（曾经一次抛错就让整批队列哑掉） */
    try {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) ctx.features.material.queueGlass(m.addedNodes[j]);
        } else if (m.target && !/\blg-(glass|noveil)/.test(m.target.className || "")) {
          ctx.features.material.queueGlass(m.target); // 类名/内联样式变了：重新评估这一块
        }
      }
    } catch (e) {}
    ctx.features.luoguPage.queuePromo();
  });

  /* SPA/动态渲染兜底：背景层若被页面脚本移除则自动补回。只补一个空 div 不够
     （R39）——视频子元素、图片样式、几何都得跟着回来，所以补完立刻重跑一次
     apply（幂等）；这也覆盖"站点整块重渲染把壁纸层清掉"导致的背景消失。 */
  var mo = new MutationObserver(function () {
    if (!document.getElementById(BG_ID)) {
      ctx.features.wallpaper.ensureBgLayer();
      try { apply(state.cfg); } catch (e) {}
    }
  });
  function startObserve() {
    if (document.body) {
      mo.observe(document.body, { childList: true });
      glassObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
      // 首屏与异步渲染各扫一遍；液态玻璃皮肤下才动手
      setTimeout(function () { ctx.features.material.sweepLuoguFaces(); }, 400);
      setTimeout(function () { ctx.features.material.sweepLuoguFaces(); }, 1800);
    } else setTimeout(startObserve, 200);
  }

  /* ---------- 启动时序 ----------
     拆分前所有顶层副作用（监听器 / 定时器 / 观察者）都写在 inject.js 正文里，
     顺序即语义。拆成模块后这些副作用统一收进各模块的 boot()，由这里按**与
     拆分前完全一致的顺序**逐个触发：
       ① Ctrl+滚轮缩放（viewrect）              —— 拆分前 449 行
       ② 阅读模式 Esc 退出（reader）            —— 拆分前 1071 行
       ③ window.__lgGlass 导出                  —— 拆分前 1240 行
       ④ apply(null) 默认值兜底                 —— 拆分前 1283 行
       ⑤ 划词题号 + Glance 速览（selection）    —— 拆分前 1697/1707 行
       ⑥ 2.5s 巡检                              —— 拆分前 2083 行
       ⑦ 玻璃站侧栏圆角定时器（material）       —— 拆分前 2172 行
       ⑨ __lgGlassSweep 导出（material）        —— 拆分前 2499 行
       ⑩ 壁纸层兜底观察者 + 首屏各扫一遍         —— 拆分前 2510 行
     注入端把内核与模块拼成一段脚本一次执行完，最后一个 register 触发即等价于
     「旧文件执行到最后一行的那一刻」。 */
  function bootInject() {
    if (ctx.booted) return;
    ctx.booted = true;
    F.viewrect.boot();
    F.reader.boot();
    window.__lgGlass = {
      apply: apply,
      detectTheme: detectTheme,
      listRows: F.luoguList.findListRows,
      filterList: F.luoguList.applyListFilter,
      /* 阅读模式 / 翻译（命令面板、快捷键、右键菜单都调这三个） */
      readerToggle: F.reader.readerToggle,
      translateSelection: F.translate.translateSelection,
      translatePage: F.translate.translatePage,
      /* 搜索引擎模板（主进程下发，唯一来源）：本地页的搜索框（首页）必须和
         地址栏用同一家——各写一份就是"地址栏搜必应、首页搜洛谷"。 */
      searchUrl: function (q) {
        var tpl = state.cfg && state.cfg.searchTemplate;
        if (typeof tpl !== "string" || tpl.indexOf("%s") < 0) tpl = "https://www.luogu.com.cn/search?keyword=%s";
        return tpl.replace("%s", encodeURIComponent(String(q == null ? "" : q)));
      },
      /* 外壳切标签时通知本页"你是不是前台"。视频壁纸只让前台那份解码：
         WebContentsView.setVisible(false) 不会让页面变成 hidden（visibilityState
         实测仍是 visible），所以页面自己感知不到被切到后台。 */
      setTabActive: F.wallpaper.setTabActive,
      /* 视图在窗口里的真实矩形（主进程 layout() 每次重排后下发）。壁纸层按它
         把自己摆到"整个窗口"的几何上——外壳、页面、弹层因此画的是同一张画。
         注意：这个导出曾经漏掉，layout() 的调用静默无效，页面一直靠 CSS 兜底
         几何（普通布局碰巧一致，分屏/IDE 抽屉下就错位）。 */
      setViewRect: F.viewrect.setViewRect,
      /* 当前登录用户（uid / 昵称 / 头像）。外壳推给 chrome 层画账号芯片。 */
      userInfo: F.luoguPage.userInfo,
      wallDebug: F.wallpaper.wallDebug,
    };
    apply(null); // 先用默认值兜底，主进程随后会用真实配置覆盖
    F.selection.boot();
    startPatrol();
    F.material.boot();
    F.material.exposeSweep();
    startObserve();
  }
})();
