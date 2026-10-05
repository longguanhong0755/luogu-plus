/* ============================================================
   Luogu++ — 注入运行时
   暴露 window.__lgGlass.apply(config)，主进程在每次页面加载后调用；
   设置页改配置时也通过主进程实时推送到这里。
   开关一览：pageTheme(auto/light/dark，v3.5.1 起 native 并入 auto) / clean /
            declutter / quickSearch / listTools / contentDesat / ideNative
   ============================================================ */
(function () {
  if (window.__lgGlass) return;

  var BG_ID = "lg-glass-bg";

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

  function ensureBgLayer() {
    /* 视口裁剪壳：壁纸层是 fixed + 负偏移 + 视差 transform 的悬挂盒子，左沿伸出
       视图边界——Chromium 会把这种合成层画出 WebContentsView 外面，在壳层的坞区
       重画一遍（页面对齐时不可见，没对齐就是一条"纱"）。给它套一个视口大小、
       overflow:hidden 的壳，溢出部分一律裁掉，永远画不出视图。壳上的
       translateZ(0) 让 fixed 后代改以壳为包含块（否则 overflow 裁不住 fixed）。 */
    var clip = document.getElementById("lg-glass-clip");
    if (!clip) {
      clip = document.createElement("div");
      clip.id = "lg-glass-clip";
      document.body.insertBefore(clip, document.body.firstChild);
    }
    var el = document.getElementById(BG_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BG_ID;
    }
    /* 材质类：壁纸层的唯一公式（几何/cover/模糊/压暗/视差/视频槽）在
       material.css 的 .lg-wallpaper 里，与外壳 #wall、弹层副本逐字相同。
       页面不再自己写几何 calc 与滤镜链——那是"外壳与页面两层壁纸错位/一个
       清楚一个糊"的来源。 */
    el.className = "lg-wallpaper";
    if (el.parentNode !== clip) clip.appendChild(el);
    applyViewRect(); // 重建的层要立刻贴回权威几何（CSS calc 只是首屏兜底）
    return el;
  }

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

  // 主进程已经把本地路径统一转成 lg-media://（https 页面加载不了 file://），
  // 这里只负责包成 CSS url()。
  function wallpaperUrl(cfg) {
    var u = cfg.wallpaperUrl || "";
    if (!u) return "none";
    return 'url("' + u + '")';
  }

  /* 视频壁纸：塞进背景层里播。muted 必须在 src 之前设好，否则自动播放会被拦。 */
  function ensureBgVideo() {
    var bg = document.getElementById(BG_ID);
    if (!bg) return null;
    var v = bg.querySelector(":scope > video.lg-bg-video");
    if (!v) {
      v = document.createElement("video");
      v.className = "lg-bg-video";
      v.muted = true;
      v.loop = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("disablepictureinpicture", "");
      bg.insertBefore(v, bg.firstChild);
      /* 视频壁纸（Wallpaper Engine 导出的 mp4/webm 就是这一类）在每个标签页
         里都有一份。后台标签不解码，否则开几个标签就是几路视频同时跑，
         CPU 直接被打满——用户看到的"视频壁纸很卡/效果不好"多半是这个。 */
      document.addEventListener("visibilitychange", function () {
        if (!v.getAttribute("data-src")) return;
        if (document.visibilityState === "hidden") {
          try { v.pause(); } catch (e) {}
        } else if (lgTabActive) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        }
      });
    }
    return v;
  }

  function playBgVideoIfActive(vEl) {
    if (lgTabActive) {
      var p = vEl.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  /* 视频就绪：关掉图片/渐变兜底（material.css 只在 data-lg-bgready="1" 时
     才把背景图去掉），并起播（只在活动标签）。 */
  function bgVideoReady(vEl) {
    try { document.documentElement.setAttribute("data-lg-bgready", "1"); } catch (e) {}
    playBgVideoIfActive(vEl);
  }
  /* 视频彻底失败（直放 + blob 兜底都没拿到数据）：退回图片/渐变兜底。
     以前这里静默放弃 → 用户看到的就是"背景直接消失"（R39）。 */
  function bgVideoFail() {
    try {
      var root = document.documentElement;
      root.setAttribute("data-lg-bgready", "0");
      if (root.getAttribute("data-lg-bgvideo") === "1") root.setAttribute("data-lg-bgvideo", "0");
    } catch (e) {}
  }

  /* 视频壁纸喂源：优先直接 src=lg-media://。协议注册时就是 stream:true，
     主进程的 protocol.handle 也实现了 Range——直放成功就省掉"主进程读全量
     字节 → IPC → 页面 blob"的三倍内存放大（视频动辄几十 MB，每个标签一份
     blob 是以前的大头）。媒体加载器对自定义协议不买账的旧问题若仍在
     （MEDIA_ERR_SRC_NOT_SUPPORTED），error 事件一落立刻转 blob 兜底。 */
  function feedBgVideo(vEl, url) {
    if (vEl._lgBlob) { try { URL.revokeObjectURL(vEl._lgBlob); } catch (e) {} vEl._lgBlob = null; }
    var settled = false;
    var timer = 0;
    var cleanup = function () {
      clearTimeout(timer);
      vEl.removeEventListener("error", onErr);
      vEl.removeEventListener("loadedmetadata", onMeta);
    };
    var onErr = function () {
      if (settled) return;
      settled = true;
      cleanup();
      blobFeedBgVideo(vEl);
    };
    var onMeta = function () {
      if (settled) return;
      settled = true;
      cleanup();
      bgVideoReady(vEl);
    };
    vEl.addEventListener("error", onErr);
    vEl.addEventListener("loadedmetadata", onMeta);
    /* 既没 error 也没 loadedmetadata（媒体加载器卡住/协议没注册）时的兜底：
       4s 后转 blob；blob 也失败就回退到图片/渐变兜底 */
    timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      blobFeedBgVideo(vEl);
    }, 4000);
    vEl.src = url;
    try { vEl.load(); } catch (e) {}
  }

  /* blob 兜底（直放 lg-media 失败才走）：字节走 lg-wall:video-blob 专用通道——
     lg-wall:video 本体 R41 起只回流式 URL，不再随载荷附整份视频字节。 */
  function blobFeedBgVideo(vEl) {
    if (!window.lgApp || !(window.lgApp.wallVideoBlob || window.lgApp.wallVideo)) { bgVideoFail(); return; }
    var p = window.lgApp.wallVideoBlob ? window.lgApp.wallVideoBlob() : window.lgApp.wallVideo();
    p.then(function (r) {
        if (!r || !r.ok || !r.data) { bgVideoFail(); return; }
        var u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
        if (vEl._lgBlob) { try { URL.revokeObjectURL(vEl._lgBlob); } catch (e) {} }
        vEl._lgBlob = URL.createObjectURL(new Blob([u8], { type: r.type || "video/webm" }));
        vEl.src = vEl._lgBlob;
        try { vEl.load(); } catch (e) {}
        /* blob 同样要等 loadedmetadata 才算就绪；再给一次 4s 兜底 */
        var t = setTimeout(function () { if (vEl.readyState < 1) bgVideoFail(); }, 4000);
        vEl.addEventListener("loadedmetadata", function () {
          clearTimeout(t);
          bgVideoReady(vEl);
        }, { once: true });
      })
      .catch(function () { bgVideoFail(); });
  }

  /* ---------- 壁纸视差：鼠标移动壁纸层轻微跟随 ----------
     页面盖住窗口的大部分，鼠标事件只有页面层收得到（外壳只在顶栏/侧栏的
     露出区域收得到），所以这里既动自己的壁纸层、也把坐标节流上报给主进程
     转发外壳——两层用同一公式同步动，几何才不会错位。scale(1.04) 是补偿
     平移露出的边缘。 */
  var lgParallaxBound = false;
  var lgParSend = 0;
  function attachParallax() {
    if (lgParallaxBound) return;
    lgParallaxBound = true;
    var tx = 0, ty = 0;
    /* 只上报目标值：缓动、分发由主进程一处做（外壳 / 前台页面 / 弹层收到的是
       同一份 --par-x/y）。页面不再自己算 transform——以前页面与外壳各跑一份
       缓动，运动中两层壁纸永远差半个身位。 */
    function send(force) {
      var now = Date.now();
      if (!force && now - lgParSend < 66) return;
      lgParSend = now;
      if (window.lgApp && window.lgApp.parallax) window.lgApp.parallax(+tx.toFixed(3), +ty.toFixed(3));
    }
    document.addEventListener(
      "mousemove",
      function (e) {
        tx = (e.clientX / window.innerWidth - 0.5) * 2;
        ty = (e.clientY / window.innerHeight - 0.5) * 2;
        send(false);
      },
      { passive: true }
    );
    // 鼠标离开页面（去顶栏/坞/窗外）时页面层再也收不到事件：补发最终目标
    document.addEventListener("mouseleave", function () { send(true); }, { passive: true });
    document.documentElement.addEventListener("mouseleave", function () { send(true); }, { passive: true });
  }

  /* ---------- 静态壁纸：lg-media 协议直出，IPC 字节通道兜底 ----------
     lg-media 注册时带了 bypassCSP:true（main.js 协议注册处），洛谷 meta 里的
     CSP 管不住它——壁纸 URL 可以直接当 CSS 背景用，零拷贝零 IPC，首屏不再
     "先实色卡片、等 590KB 字节传到才变玻璃"。万一策略收紧加载失败（旧版本
     实测被 meta CSP 拦过），回退到 IPC 字节通道拼 data URL（data: 实测放行）。 */
  var lgWallSrc = null;      // 缓存对应的 wallpaperUrl
  var lgWallDataUrl = null;  // 拼好的 data URL（IPC 兜底路径）
  var lgWallCss = "";        // 'url("…")' 成品：反复 apply 时直接贴
  var lgWallBusy = false;
  var lgWallErr = "";

  /* 直接写元素的内联 background-image，而不是塞进 --lg-bg-image：
     兜底路径拼出来是 ~590KB 的 data URL，作为自定义属性值写进 <html> 的
     inline style 太重。元素内联样式覆盖规则里的那一行，
     代价只是丢掉兜底渐变 —— 有壁纸时本来也不需要它。 */
  function setBgImage(cssValue) {
    var bg = document.getElementById(BG_ID);
    if (bg) bg.style.backgroundImage = cssValue;
  }

  /* 注意 cfg 是 apply() 的**形参**，持久副本在 state.cfg —— 这里不能直接写 cfg
     （会 Uncaught ReferenceError，把整个注入脚本连同后面的 apply 一起打断）。 */
  function applyWallpaperImage(wall) {
    var cfg = state.cfg || {};
    if (wall === "none" || !cfg.wallpaperUrl) {
      if (lgWallSrc) { lgWallSrc = null; lgWallDataUrl = null; lgWallCss = ""; setBgImage(""); }
      return;
    }
    if (lgWallSrc === cfg.wallpaperUrl && lgWallCss) {
      setBgImage(lgWallCss);
      return;
    }
    if (lgWallBusy) return;
    var want = cfg.wallpaperUrl;
    // 快道：lg-media 直出。探针 Image 与 CSS 背景走同一条加载策略，
    // 探针能开背景就能开；探针失败立刻转 IPC 兜底，用户无感。
    if (/^lg-media:\/\//i.test(want)) {
      lgWallBusy = true;
      var probe = new Image();
      probe.onload = function () {
        lgWallBusy = false;
        if ((state.cfg || {}).wallpaperUrl !== want) return; // 期间换过壁纸
        lgWallSrc = want;
        lgWallCss = 'url("' + want + '")';
        setBgImage(lgWallCss);
        lgWallErr = "";
      };
      probe.onerror = function () {
        lgWallBusy = false;
        applyWallpaperImageIpc(want);
      };
      probe.src = want;
      return;
    }
    applyWallpaperImageIpc(want);
  }

  /* IPC 字节通道（兜底）：主进程读字节（有缓存），页面拼 data URL。 */
  function applyWallpaperImageIpc(want) {
    if (!window.lgApp || !window.lgApp.wallImage) return;
    lgWallBusy = true;
    window.lgApp
      .wallImage()
      .then(function (r) {
        lgWallBusy = false;
        if (!r || !r.ok || !r.data) { lgWallErr = "no-data"; return; }
        if ((state.cfg || {}).wallpaperUrl !== want) return; // 期间换过壁纸，这份作废
        try {
          var u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
          var bin = "";
          // 分块 fromCharCode：441KB 一次性 apply 会顶破参数上限
          for (var i = 0; i < u8.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          }
          lgWallSrc = want;
          lgWallDataUrl = "data:" + (r.type || "image/png") + ";base64," + btoa(bin);
          lgWallCss = 'url("' + lgWallDataUrl + '")';
          setBgImage(lgWallCss);
          lgWallErr = "";
        } catch (e) {
          lgWallErr = String(e);
        }
      })
      .catch(function (e) { lgWallBusy = false; lgWallErr = String(e); });
  }

  /* 本页是不是前台标签。切标签时由外壳通过 __lgGlass.setTabActive 通知 ——
     页面自己感知不到：WebContentsView.setVisible(false) 不会把页面切成
     hidden（实测 visibilityState 一直是 visible），光靠 visibilitychange
     会让每个标签都留一路视频在解码。 */
  var lgTabActive = false;

  function setTabActive(v) {
    lgTabActive = !!v;
    try { document.documentElement.setAttribute("data-lg-tabactive", lgTabActive ? "1" : "0"); } catch (e) {}
    var bg = document.getElementById(BG_ID);
    var el = bg ? bg.querySelector(":scope > video.lg-bg-video") : null;
    if (!el || !el.getAttribute("data-src")) return;
    if (lgTabActive) {
      var p = el.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      try { el.pause(); } catch (e) {}
    }
  }

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

  /* Ctrl+滚轮缩放：Chromium 在 Electron 里默认不做 ctrl+wheel 页面缩放、
     也不发 zoom-changed，所以在页面里拦 wheel（capture + preventDefault），
     转给主进程按当前标签步进。每次完整导航后本脚本重跑，监听跟着重建。 */
  window.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (window.lgApp && window.lgApp.zoomBy) window.lgApp.zoomBy(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false, capture: true }
  );

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

  function apply(cfg) {
    cfg = cfg || {};
    state.cfg = cfg;
    var root = document.documentElement;
    var path = location.pathname;

    // IDE 页特殊处理：Monaco 自带完整配色，强行套主题/滤镜会导致色彩错乱。
    // R38：题目页自带的「进入 IDE 模式」（页面内分屏，URL 还是 /problem/xxx）也算
    // IDE 页——编辑器面板按原生不透明渲染（不再透出壁纸），应用侧同时进真·全屏。
    var isIde = /\/ide(\/|$)/.test(path) || inPageIde;
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
    s.setProperty("--lg-radius", clampNum(cfg.radius, 0, 24, 8) + "px");
    // 壁纸：只要用户显式选过就铺（否则"设了壁纸却看不到"会被当成 bug）。
    // 原色模式只是不去动颜色，但用户自己挑的壁纸必须兑现。IDE 页除外。
    // 站外 http(s) 页默认什么都不铺（视频、静态都不铺，连壁纸层元素都不建）：
    // 人家的层色是自己画的半透明色（DeepSeek 浅色主题整叠 rgba 白），本该坐在
    // 人家不透明的底色上；而我们 z-index:-1 的壁纸层恰好垫在"画布"之上——
    // body 背景会上传播到画布、画在负 z 层之下——乱垫壁纸整页就透成筛子。
    // 白名单玻璃站（glassSite）除外：配好可读的令牌透明度再垫壁纸（ext.css）。
    var bgVideo = !!cfg.wallpaperIsVideo && !!cfg.wallpaperUrl && !ideNative && !extHttpPage;
    var wall = ideNative || bgVideo || (extHttpPage && !glassSite) ? "none" : wallpaperUrl(cfg);
    s.setProperty("--lg-wall-image", wall);
    applyWallpaperImage(wall);
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
  var vEl = ensureBgVideo();
  if (vEl) {
      if (bgVideo) {
        if (vEl.getAttribute("data-src") !== cfg.wallpaperUrl) {
          vEl.setAttribute("data-src", cfg.wallpaperUrl);
          /* 换源：先退回图片/渐变兜底（bgready=0），等新源 loadedmetadata
             再切到视频面——加载期不再是一片空白 */
          root.setAttribute("data-lg-bgready", "0");
          vEl.muted = true;
          /* 直放 lg-media:// 优先（零拷贝），失败自动转 blob 兜底（feedBgVideo） */
          feedBgVideo(vEl, cfg.wallpaperUrl);
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
    /* 面材质扫描跟随皮肤切换：开玻璃→重扫贴上，关玻璃→把贴过的类摘干净 */
    if (isLuoguPage) {
      setTimeout(function () { sweepGlassSurfaces(); }, 60);
    } else {
      try { unglassAll(); } catch (e) {}
    }
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

    // 壁纸层只给本地页（洛谷页/应用本地页）和白名单玻璃站建；其余站外
    // http(s) 页不碰人家的层叠（原因见上面 wall 的注释）。
    if (!extHttpPage || glassSite) {
      ensureBgLayer();
      // 壁纸视差：鼠标移动壁纸层轻微跟随（外壳层经 IPC 同一公式同步动）。
      // 关掉时把 transform 复位，不然停在上次偏移的位置。
      if (cfg.wallpaperParallax === false) {
        s.setProperty("--par-x", "0px");
        s.setProperty("--par-y", "0px");
      } else {
        attachParallax();
      }
    }
    if (isLuoguPage) {
      // 代码块复制按钮立刻挂上（别等 2.5s 的巡检）
      if (typeof sweepCodeCopy === "function") sweepCodeCopy();
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
      teardownListTools();
      teardownQuickSearch();
    } else if (/\/problem\/[A-Za-z]+\d+/.test(path)) {
      teardownListTools();
      teardownQuickSearch();
    } else if (/\/(problem|training|contest|record)\/list/.test(path) || /^\/problem\/?$/.test(path)) {
      setupListTools();
      /* 题单广场不挂快速筛选（R40 用户点名删）：从别的列表页 SPA 切过来时
         这里负责把已经挂着的那条摘掉，attribute 也已被压成 0。 */
      if (/^\/training\/list\/?$/.test(path)) teardownQuickSearch();
      else setupQuickSearch();
    } else {
      teardownListTools();
      teardownQuickSearch();
    }

    // 题目页自带 IDE 模式的判定（R38）：apply 后复核一次（DOM 已就绪时立刻生效）
    ideInPageQueue();
  }

  /* ============================================================
     功能一：列表页快捷工具（难度 / 状态 / 排序 / 题号跳转）
     ============================================================ */
  /* 难度表不能写死：洛谷 2025 年改过一轮（新增青色「提高」一级、全级别改名、
     顶级升为 NOI/NOI+/CTSC，id 5 的名字从「提高+/省选−」变成「提高」）。
     策略：内置表按当前实况兜底 + 运行时从页面徽章自学习——
     当前 URL 带 difficulty=N 时，本页行的难度徽章就是 id N 的名字；
     学到的名字存 localStorage，洛谷以后再改难度也能自动跟上。 */
  var DIFF_BUILTIN = [
    [1, "入门"], [2, "普及−"], [3, "普及"], [4, "普及+/提高−"],
    [5, "提高"], [6, "提高+/省选−"], [7, "省选/NOI−"], [8, "NOI/NOI+/CTSC"],
  ];
  function diffMapGet() {
    try {
      return JSON.parse(localStorage.getItem("lg-diff-map") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function diffMapLearn(name, id) {
    if (!name || typeof name !== "string") return;
    var m = diffMapGet();
    if (m[name] === id) return;
    m[name] = id;
    try {
      localStorage.setItem("lg-diff-map", JSON.stringify(m));
    } catch (e) {}
  }
  /* 全表（内置 ∪ 学习），按 id 升序；同 id 以页面实况（学习值）为准 */
  function diffTable() {
    var byId = {};
    var i;
    for (i = 0; i < DIFF_BUILTIN.length; i++) byId[DIFF_BUILTIN[i][0]] = DIFF_BUILTIN[i][1];
    var learned = diffMapGet();
    for (var name in learned) {
      // 含空白的一定是早年误学的来源标签（「NOIP 提高组」之类），永久忽略
      if (/\s/.test(name)) continue;
      if (learned[name] >= 1) byId[learned[name]] = name;
    }
    var rows = [];
    for (var id in byId) rows.push([Number(id), byId[id]]);
    rows.sort(function (a, b) { return a[0] - b[0]; });
    // 还没学到 id 的新名字（在非筛选页见过徽章）：附在表尾，筛选与匹配照常用
    for (var n in learned) {
      if (/\s/.test(n)) continue;
      if (!(learned[n] >= 1)) rows.push([99, n]);
    }
    return rows;
  }
  /* 从列表行里学难度：URL 带 difficulty=N 时，本页行徽章就是 id N 的名字。
     徽章特征：行内短文本 span + 实心底色（洛谷难度标签的渲染形态），
     不依赖写死的名字清单——这就是"洛谷加了新难度能自动匹配"的那条路。 */
  function learnDiffs(rows) {
    var m = location.search.match(/[?&]difficulty=(\d+)/);
    var fid = m ? Number(m[1]) : 0;
    if (!(fid >= 1)) return;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var spans = rows[i].querySelectorAll("span");
      for (var j = 0; j < spans.length; j++) {
        var s = spans[j];
        if (s.childElementCount !== 0) continue;
        var t = (s.textContent || "").trim();
        if (t.length < 2 || t.length > 12) continue;
        // 难度名字是单 Token：含空白的必属「NOIP 提高组」这类来源标签
        if (/\s/.test(t)) continue;
        // 来源/年份标签都是链接（a[href*=tag=]），难度徽章是链接外的 span
        if (s.closest("a")) continue;
        var bg = "";
        try {
          bg = getComputedStyle(s).backgroundColor;
        } catch (e) {}
        if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
        diffMapLearn(t, fid);
        break; // 每行第一个实心底色短文本就是难度徽章
      }
    }
  }
  var listUI = null;

  function rowText(r) { return (r.textContent || "").replace(/\s+/g, " ").trim(); }

  function findListRows() {
    /* 洛谷新前端的"表格"不是 table：列头是 .header-wrap，
       数据行是 .list-wrap .row-wrap > .row（50 条/页）。
       不拦这一档，下面的启发式会把行里的单元格当行抓（256 个格子），
       筛选时半个格子消失、行布局直接烂掉 */
    var rowWrap = document.querySelector(".list-wrap .row-wrap");
    if (rowWrap) {
      var rrows = rowWrap.querySelectorAll(":scope > .row");
      if (rrows.length >= 3) return { kind: "list", rows: Array.prototype.slice.call(rrows), box: rowWrap };
    }
    var tables = document.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var trs = tables[i].querySelectorAll("tbody tr");
      if (trs.length >= 5) return { kind: "table", rows: Array.prototype.slice.call(trs), box: tables[i] };
    }
    // 非表格：找"同类兄弟节点 >= 5"的最长一组
    var best = null;
    var kids = document.querySelectorAll("div, li, article");
    var groups = {};
    for (var j = 0; j < kids.length; j++) {
      var el = kids[j];
      var p = el.parentNode;
      if (!p || !el.className || typeof el.className !== "string") continue;
      var key = "";
      var cur = el;
      var depth = 0;
      while (cur && depth < 6) { key = ">" + cur.tagName + "." + String(cur.className); cur = cur.parentNode; depth++; }
      (groups[key] = groups[key] || []).push(el);
    }
    for (var k in groups) {
      var g = groups[k];
      if (g.length >= 5 && (!best || g.length > best.rows.length)) best = { kind: "list", rows: g, box: g[0].parentNode };
    }
    return best;
  }

  /* 筛选关键字来自原生筛选行的搜索框（合并后只有这一个搜索框）；
     没有原生搜索框的页面退回旧的快速筛选框 */
  function quickQuery() {
    var e = document.querySelector("input.search-text");
    if (e) return (e.value || "").trim().toLowerCase();
    var l = document.querySelector("#lg-quicksearch input");
    return l ? l.value.trim().toLowerCase() : "";
  }
  /* 原生搜索框 → 统一筛选：输入时实时筛当前列表（回车仍是洛谷自己的全站搜索，
     一个框两种行为，不再是上下两个搜索栏） */
  var nativeSearchHooked = false;
  function hookNativeSearch() {
    if (nativeSearchHooked) return;
    nativeSearchHooked = true;
    document.addEventListener(
      "input",
      function (e) {
        if (e.target && e.target.matches && e.target.matches("input.search-text") && listUI) {
          applyListFilter();
        }
      },
      true
    );
  }

  /* 原生筛选行只补一个能力：搜索框输入即筛当前列表（原生要回车走服务器），
     并在行尾挂一枚计数徽章 */
  function applyListFilter() {
    if (!listUI) return;
    var rows = listUI.rows;
    var q = quickQuery();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = rowText(rows[i]);
      var ok = !q || t.toLowerCase().indexOf(q) >= 0;
      rows[i].style.display = ok ? "" : "none";
      if (ok) shown++;
    }
    var c2 = document.getElementById("lg-listtools-count");
    if (c2) c2.textContent = q ? "筛选 " + shown + " / " + rows.length : "本页 " + rows.length + " 条";
  }

  /* 原生筛选行（题目难度范围 / 算法来源状态 / 关键词搜索那一排）：
     用户要求——原生已有的（难度、状态、排序、搜索）一个都不许重复造，
     我们的增强只补原生没有的能力：① 输入即筛当前列表（原生要回车走服务器）
     ② 一枚计数徽章。没有原生筛选行的列表页（题单/比赛/记录等）什么都不造——
     曾经在没有原生筛选行的页面造一条独立的难度/状态/排序/跳题号工具条，
     被用户否决（"在题单页面要这个功能干什么"），那里不挂任何控件。 */
  function nativeFilterHost() {
    return document.querySelector(".block.filter-tags");
  }
  function setupListTools() {
    if (document.documentElement.getAttribute("data-lg-listtools") !== "1") return;
    var host = nativeFilterHost();
    if (!host) return;
    hookNativeSearch();
    var probe0 = findListRows();
    if (probe0) {
      if (!listUI || probe0.rows.length !== listUI.rows.length) listUI = probe0;
      learnDiffs(probe0.rows);
    }
    // 计数徽章：贴在筛选行末尾（SPA 重建筛选行后要跟着挪回去）
    var cnt = document.getElementById("lg-listtools-count");
    if (!cnt) {
      cnt = document.createElement("span");
      cnt.id = "lg-listtools-count";
    }
    if (cnt.parentNode !== host) host.appendChild(cnt);
    applyListFilter();
  }
  function teardownListTools() {
    var c = document.getElementById("lg-listtools-count");
    if (c) c.remove();
    listUI = null;
  }

  /* ============================================================
     功能二：列表页快速搜索
     有原生搜索框（input.search-text）的页面不再单独造框——用户要求
     "上方不能有两个搜索栏"：原生框输入时实时筛当前列表（见 hookNativeSearch），
     回车仍是洛谷自己的全站搜索。没有原生框的页面才退回独立筛选框。
     ============================================================ */
  function setupQuickSearch() {
    if (document.documentElement.getAttribute("data-lg-quicksearch") !== "1") return;
    if (document.querySelector("input.search-text")) {
      hookNativeSearch();
      return;
    }
    if (document.getElementById("lg-quicksearch")) return;
    if (!findListRows()) return;
    var box = document.createElement("div");
    box.id = "lg-quicksearch";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>';
    var inp = document.createElement("input");
    inp.type = "search";
    // 占位符按页面类型来：题单/比赛/记录列表里没有"题号"可筛
    inp.placeholder = /\/problem/.test(location.pathname)
      ? "快速筛选当前列表（题号 / 标题 / 关键词）"
      : "快速筛选当前列表（标题 / 关键词）";
    box.appendChild(svg);
    box.appendChild(inp);
    var host = document.querySelector(".columba-content-wrap .main, .main-container main, main") || document.body;
    try { host.insertBefore(box, host.firstChild); } catch (e) { document.body.insertBefore(box, document.body.firstChild); }
    inp.addEventListener("input", function () {
      if (listUI) { applyListFilter(); return; } // 筛选行增强在场 → 走统一筛选
      var q = inp.value.trim().toLowerCase();
      var found = findListRows();
      if (!found) return;
      for (var i = 0; i < found.rows.length; i++) {
        var t = rowText(found.rows[i]).toLowerCase();
        found.rows[i].style.display = !q || t.indexOf(q) >= 0 ? "" : "none";
      }
    });
  }
  function teardownQuickSearch() {
    var el = document.getElementById("lg-quicksearch");
    if (el) el.remove();
  }

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
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && readerHost) {
      readerClose();
      e.stopPropagation();
    }
  }, true);

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

  window.__lgGlass = {
    apply: apply,
    detectTheme: detectTheme,
    listRows: findListRows,
    filterList: applyListFilter,
    /* 阅读模式 / 翻译（命令面板、快捷键、右键菜单都调这三个） */
    readerToggle: readerToggle,
    translateSelection: translateSelection,
    translatePage: translatePage,
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
    setTabActive: setTabActive,
    /* 视图在窗口里的真实矩形（主进程 layout() 每次重排后下发）。壁纸层按它
       把自己摆到"整个窗口"的几何上——外壳、页面、弹层因此画的是同一张画。
       注意：这个导出曾经漏掉，layout() 的调用静默无效，页面一直靠 CSS 兜底
       几何（普通布局碰巧一致，分屏/IDE 抽屉下就错位）。 */
    setViewRect: setViewRect,
    /* 当前登录用户（uid / 昵称 / 头像）。外壳推给 chrome 层画账号芯片。 */
    userInfo: userInfo,
    /* 静态壁纸 data URL 的装配状态（探针用：CSP 拦了 lg-media: 和 blob:，
       只剩 data: 一条路，出问题要能一眼看出卡在哪一步） */
    wallDebug: function () {
      return {
        src: lgWallSrc ? String(lgWallSrc).slice(0, 32) : null,
        len: lgWallDataUrl ? lgWallDataUrl.length : 0,
        busy: lgWallBusy,
        err: lgWallErr,
        hasApi: !!(window.lgApp && window.lgApp.wallImage),
        inline: (function () {
          var bg = document.getElementById(BG_ID);
          return bg ? String(bg.style.backgroundImage || "").slice(0, 40) : null;
        })(),
      };
    },
  };
  apply(null); // 先用默认值兜底，主进程随后会用真实配置覆盖

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

  /* ---------- 问题搜索优化 ----------
     照抄 Luogu-Plus 的 betterSearch：首页那个「问题跳转」盒子改成
     「问题搜索」，回车/点击都走同一套题号判定：
       4 位以上纯数字  → P<数字>
       数字+字母       → CF<数字><字母>
       已知前缀的题号  → 原样
       其余            → 全文搜索 /problem/list?keyword=…
     题号走新标签页打开（外壳接管），关键词搜索在原地跳转。 */
  function searchTarget(raw) {
    var t = String(raw || "").trim();
    if (!t) return "";
    var u = t.toUpperCase();
    if (/^[1-9]\d{3,}$/.test(t)) return "P" + t;
    if (/^\d{1,4}[A-Z]\d?$/.test(u)) return "CF" + u;
    // 与 extractPids 同款修正：洛谷的 AtCoder 题号全小写（AT_abc300_a），
    // 大写开过去是 404——这里漏了这条，划词识别有、搜索框没有
    if (/^AT_/.test(u)) u = "AT_" + u.slice(3).toLowerCase();
    if (isPid(u)) return u;
    return "";
  }
  function runSearch(raw) {
    var t = String(raw || "").trim();
    if (!t) return;
    var pid = searchTarget(t);
    if (pid) openProblem(pid);
    else location.href = "/problem/list?keyword=" + encodeURIComponent(t) + "&content=true";
  }
  var RANDOM_RATINGS = ["3"];
  var RANDOM_SOURCES = ["P"];
  /* 难度选项跟 diffTable() 走（内置 ∪ 页面自学习）：洛谷 2025 年把 id 5
     改名为「提高」并新增顶级，写死的旧表已经对不上了 */
  function randomDifficulties() {
    var rows = [["0", "暂无评定"]];
    var t = diffTable();
    for (var i = 0; i < t.length; i++) {
      if (t[i][0] >= 1 && t[i][0] < 99) rows.push([String(t[i][0]), t[i][1]]);
    }
    return rows;
  }
  var SOURCES = [["P", "洛谷题库"], ["CF", "CodeForces"], ["SP", "SPOJ"], ["AT", "AtCoder"], ["UVA", "UVa"]];

  // 洛谷题库列表接口把数据塞在 #lentille-context 里（扩展也是这么解析的）
  function lentilleJson(html) {
    var m = String(html).match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }
  /* 兼容两种返回：_contentOnly 有时直接回 JSON，有时回包着
     #lentille-context 的 HTML——两种都试，别赌一种。 */
  function parseListPayload(html) {
    var d = null;
    try { d = JSON.parse(html); } catch (e) {}
    if (!d) d = lentilleJson(html);
    return d;
  }
  function jumpToRandomProblem(ratings, sources, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "加载中…"; }
    /* 多选 = 逗号分隔（洛谷列表接口原生支持 difficulty=2,3&type=P,CF，
       实测 P+CF+AT × 难度 1~3 → 1172 条）；一组一个都没选 = 该组不限 */
    var q = [];
    if (ratings && ratings.length) q.push("difficulty=" + ratings.join(","));
    if (sources && sources.length) q.push("type=" + sources.join(","));
    var base = "/problem/list?" + (q.length ? q.join("&") + "&" : "") + "page=";
    fetch(base + "1&_contentOnly=1", { credentials: "include" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = parseListPayload(html);
        var pr = d && d.data && d.data.problems;
        if (!pr || !pr.count) throw new Error("no count");
        var pages = Math.max(1, Math.ceil(pr.count / 50));
        var page = Math.floor(Math.random() * pages) + 1;
        return fetch(base + page + "&_contentOnly=1", { credentials: "include" }).then(function (r) { return r.text(); });
      })
      .then(function (html) {
        var d = parseListPayload(html);
        var list = (d && d.data && d.data.problems && d.data.problems.result) || [];
        if (!list.length) throw new Error("empty list");
        var pid = list[Math.floor(Math.random() * list.length)].pid;
        // 这里在 fetch 回调里，既没有用户手势（window.open 会被当弹窗拦掉），
        // 也不能用 location.href 走 luogu-glass://（该 scheme 没注册成 privileged，
        // Chromium 直接掐掉导航，连 will-navigate 都不发）。唯一可靠的是 preload
        // 暴露的 IPC 桥。
        if (pid) {
          openProblem(pid);
          // 题目在新标签打开了，选择框该收掉：不然回本标签后蒙层还在、
          // 按钮永远卡在"加载中…"（复位原来只写在失败分支里）
          hideRandomPicker();
          if (btn) { btn.disabled = false; btn.textContent = "跳转"; }
        } else if (btn) { btn.disabled = false; btn.textContent = "跳转"; }
      })
      .catch(function () {
        // 接口形态变了就退回洛谷自带的随机跳题，至少不会点了没反应
        location.href = "/problem/random";
      });
  }
  function hideRandomPicker() {
    var m = document.getElementById("lg-random");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function showRandomPicker() {
    hideRandomPicker();
    var mask = document.createElement("div");
    mask.id = "lg-random";
    var card = document.createElement("div");
    card.className = "lg-random-card";
    var h = document.createElement("div");
    h.className = "lg-random-title";
    h.textContent = "按难度随机跳题";
    card.appendChild(h);

    /* 难度/来源都可多选（用户要求）：点一下选中、再点取消，可同时选多个；
       一组一个都不选 = 该组不限 */
    var mkRow = function (label, items, getSel, toggle) {
      var row = document.createElement("div");
      row.className = "lg-random-row";
      var lb = document.createElement("div");
      lb.className = "lg-random-label";
      lb.textContent = label;
      row.appendChild(lb);
      var wrap = document.createElement("div");
      wrap.className = "lg-random-opts";
      for (var i = 0; i < items.length; i++) {
        (function (val, text) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "lg-random-opt" + (getSel().indexOf(val) >= 0 ? " on" : "");
          b.textContent = text;
          b.setAttribute("data-v", val);
          b.addEventListener("click", function (e) {
            e.preventDefault();
            toggle(val);
            b.classList.toggle("on", getSel().indexOf(val) >= 0);
          });
          wrap.appendChild(b);
        })(items[i][0], items[i][1]);
      }
      row.appendChild(wrap);
      return row;
    };
    card.appendChild(mkRow("难度", randomDifficulties(), function () { return RANDOM_RATINGS; }, function (v) {
      var i = RANDOM_RATINGS.indexOf(v);
      if (i >= 0) RANDOM_RATINGS.splice(i, 1); else RANDOM_RATINGS.push(v);
    }));
    card.appendChild(mkRow("来源", SOURCES, function () { return RANDOM_SOURCES; }, function (v) {
      var i = RANDOM_SOURCES.indexOf(v);
      if (i >= 0) RANDOM_SOURCES.splice(i, 1); else RANDOM_SOURCES.push(v);
    }));
    var hint = document.createElement("div");
    hint.className = "lg-random-hint";
    hint.textContent = "都能多选；一组都不选 = 不限";
    card.appendChild(hint);

    var acts = document.createElement("div");
    acts.className = "lg-random-acts";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "lg-random-btn";
    cancel.textContent = "取消";
    cancel.addEventListener("click", hideRandomPicker);
    var go = document.createElement("button");
    go.type = "button";
    go.className = "lg-random-btn primary";
    go.textContent = "跳转";
    go.addEventListener("click", function () {
      jumpToRandomProblem(RANDOM_RATINGS, RANDOM_SOURCES, go);
    });
    acts.appendChild(cancel);
    acts.appendChild(go);
    card.appendChild(acts);

    mask.appendChild(card);
    mask.addEventListener("click", function (e) { if (e.target === mask) hideRandomPicker(); });
    document.body.appendChild(mask);
  }

  function sweepBetterSearch() {
    var on = state.cfg.betterSearch !== false;
    var box = document.querySelector(".lg-article.lg-index-stat");
    if (!box) return;
    var input = box.querySelector('input[name="toproblem"]') || box.querySelector(".am-form-field");
    var goBtn = box.querySelector('button[name="goto"]');
    var randBtn = box.querySelector('button[name="gotorandom"]');
    var title = box.querySelector("h2");
    if (!on) {
      if (box.getAttribute("data-lg-search") === "1") {
        // 监听器必须真的摘掉：只删属性的话，捕获阶段的 kill/fire 还在拦截
        // 原生按钮（功能实际关不掉），而且再开启时会在旧监听器上再叠一套，
        // 点一次搜索跳两次。引用存在 box 上，摘的时候按原样 removeEventListener。
        var bound = box._lgBound;
        if (bound) {
          if (bound.goBtn) bound.goBtn.removeEventListener("click", bound.fire, true);
          if (bound.randBtn) bound.randBtn.removeEventListener("click", bound.randFire, true);
          if (bound.input) {
            bound.input.removeEventListener("keydown", bound.kd, true);
            bound.input.removeEventListener("keyup", bound.ku, true);
          }
          box._lgBound = null;
        }
        if (input && input.getAttribute("data-lg-ph")) input.placeholder = input.getAttribute("data-lg-ph");
        if (title && title.getAttribute("data-lg-tt")) title.textContent = title.getAttribute("data-lg-tt");
        if (goBtn && goBtn.getAttribute("data-lg-gt") != null) goBtn.textContent = goBtn.getAttribute("data-lg-gt");
        if (goBtn && goBtn.getAttribute("data-lg-gc") != null) goBtn.className = goBtn.getAttribute("data-lg-gc");
        if (randBtn && randBtn.getAttribute("data-lg-rt") != null) randBtn.textContent = randBtn.getAttribute("data-lg-rt");
        if (randBtn && randBtn.getAttribute("data-lg-rc") != null) randBtn.className = randBtn.getAttribute("data-lg-rc");
        box.removeAttribute("data-lg-search");
        box.removeAttribute("data-lg-bound");
      }
      return;
    }
    if (!input) return;
    if (box.getAttribute("data-lg-search") !== "1") {
      box.setAttribute("data-lg-search", "1");
      if (title) { title.setAttribute("data-lg-tt", title.textContent); title.textContent = "问题搜索"; }
      if (input) {
        input.setAttribute("data-lg-ph", input.placeholder || "");
        input.placeholder = "输入题号或题目名";
      }
      // 原文与类名留档，关闭功能时要原样还回去
      if (goBtn) {
        goBtn.setAttribute("data-lg-gt", goBtn.textContent);
        goBtn.setAttribute("data-lg-gc", goBtn.className);
        goBtn.textContent = "搜索";
        goBtn.classList.remove("am-btn-danger");
        goBtn.classList.add("lg-search-go");
      }
      if (randBtn) {
        randBtn.setAttribute("data-lg-rt", randBtn.textContent);
        randBtn.setAttribute("data-lg-rc", randBtn.className);
        randBtn.textContent = "随机跳题";
        randBtn.classList.remove("am-btn-primary");
        randBtn.classList.add("lg-search-rand");
      }
    }
    // 事件只挂一次：洛谷是整页刷新，这里用属性做幂等标记
    if (box.getAttribute("data-lg-bound") !== "1") {
      box.setAttribute("data-lg-bound", "1");
      // 必须用捕获阶段 + stopImmediatePropagation：洛谷自己的按钮处理器是
      // addEventListener 挂的，onclick 赋值和 stopPropagation 都拦不住它——
      // 结果"随机跳题"的选择框刚弹出，洛谷的原生跳转同时把页面跳走，
      // 表现就是"还没等我选择就跳了"。捕获阶段先于所有冒泡监听器执行，
      // stopImmediatePropagation 再掐掉同元素上的后续监听器。
      var kill = function (e) {
        if (!e) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      };
      var fire = function (e) {
        kill(e);
        runSearch(input.value);
      };
      var randFire = function (e) {
        kill(e);
        showRandomPicker();
      };
      var kd = function (e) {
        if (e.key === "Enter" || e.keyCode === 13) fire(e);
      };
      var ku = function (e) {
        if (e.key === "Enter" || e.keyCode === 13) kill(e);
      };
      if (goBtn) {
        goBtn.onclick = null; // 清掉可能残留的旧处理器，避免叠加
        goBtn.addEventListener("click", fire, true);
      }
      if (randBtn) {
        randBtn.onclick = null;
        randBtn.addEventListener("click", randFire, true);
      }
      input.addEventListener("keydown", kd, true);
      input.addEventListener("keyup", ku, true);
      // 引用留档：关闭功能时按原样摘除（见 !on 分支）
      box._lgBound = { fire: fire, kill: kill, randFire: randFire, kd: kd, ku: ku, goBtn: goBtn, randBtn: randBtn, input: input };
    }
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
        copyText(src.innerText || src.textContent || "");
        e.currentTarget.textContent = "已复制";
        setTimeout(function () {
          if (e.currentTarget) e.currentTarget.textContent = "复制";
        }, 1200);
      });
      pre.appendChild(btn);
    }
  }

  /* 巡检：sweep 都是幂等的便宜 DOM 扫描，照常跑；但**不再每 2.5s 无条件
     全量 apply()**——那是常驻性能开销（每次都重挂/重拆功能块、重写一串
     setProperty），也是页面"晚到修正再闪一次"的来源。配置变化由主进程推
     （applyConfigToPages）、SPA 换路由由 did-navigate-in-page 触发 apply；
     这里只兜"URL 变了但主进程没通知到"的漏。 */
  /* 壁纸自愈（R39）：无规律"背景直接消失"、刷新或重开就好 = 运行期状态丢失
     （层被站点脚本清掉 / 视频挂了 / 样式丢了）。每拍（2.5s）做一次便宜体检，
     不健康就重跑 apply 把层与视频重建回来；带退避与次数上限，不刷屏。 */
  var healLast = 0;
  var healTries = 0;
  function wallpaperUnhealthy() {
    if (document.documentElement.getAttribute("data-lg-wall") !== "1") return false;
    var bg = document.getElementById(BG_ID);
    if (!bg) return true;
    if (document.documentElement.getAttribute("data-lg-bgvideo") === "1") {
      var v = bg.querySelector(":scope > video.lg-bg-video");
      if (!v) return true;
      if (v.getAttribute("data-src") && v.readyState < 1) return true;
      return false;
    }
    var bi = "";
    try { bi = getComputedStyle(bg).backgroundImage || ""; } catch (e) {}
    return !bi || bi === "none";
  }
  function healWallpaper() {
    var now = Date.now();
    if (now - healLast < 8000 || healTries >= 5) return;
    healLast = now;
    healTries++;
    try { apply(state.cfg); } catch (e) {}
    try { window.__lgWallHeal = healTries; } catch (e) {}
  }
  var lastHref = location.href;
  var glassTick = 0;
  setInterval(function () {
    glassTick++;
    // 壁纸层体检（所有页面都做：本地页也有壁纸）
    if (wallpaperUnhealthy()) healWallpaper();
    else healTries = 0;
    if (isLuoguPage) {
      ideInPageQueue(); // 题目页自带 IDE 模式的兜底巡检（观察者漏拍时补）
      sweepPromos();
      sweepDeclutter();
      sweepCodeCopy();
      sweepHomeHello();
      sweepLucky();
      sweepBetterSearch();
      /* 面材质巡检：Vue 异步渲染常整块换 DOM 而没触发可见的属性变化，
         observer 会漏；每第 12 拍（约 30s，R41 从 5 拍放宽）全量补扫一次，
         新增节点的即时补扫由 MutationObserver（250ms 去抖）负责 */
      if (glassTick % 12 === 0) sweepGlassSurfaces();
      /* 列表工具也要巡检：apply 只在注入/换路由时跑一遍，洛谷的列表是
         Vue 异步渲染，那一遍常常早于筛选行与表格——功能块就此错过整页。
         两个 setup 都是幂等的（已挂载立即返回），巡检拿来兜底重挂载与难度自学习。 */
      var lp = location.pathname;
      if (/\/(problem|training|contest|record)\/list/.test(lp) || /^\/problem\/?$/.test(lp)) {
        if (document.documentElement.getAttribute("data-lg-listtools") === "1") setupListTools();
        if (document.documentElement.getAttribute("data-lg-quicksearch") === "1") setupQuickSearch();
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
      if (glassTick % 5 === 0) roundGlassSiteSidebar();
    }
  }, 2500);

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
  if (glassSite) setTimeout(roundGlassSiteSidebar, 1200);

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
  function sweepGlassSurfaces(rootEl) {
    /* 两种皮肤都扫：扫出来的面消费的是同一组变量——flat 拿到的就是素面
       （纯色 + 细线），liquid 拿到玻璃。以前只在 liquid 下扫，flat 用户的
       站点面板就只能保持站点自己的实心色，"里面实心、外面素面"两回事。 */
    if (!isLuoguPage) return;
    /* IDE 页"保持原生"（R37）：Monaco 那类不透明深色面以前会被扫成 .lg-glass
       （挂上 backdrop-filter + 半透明卡片）——用户截图里"壁纸透过深色模糊"的
       编辑器就是它。原生模式下一个面都不许动；已经贴上的类顺手摘干净。 */
    if (document.documentElement.getAttribute("data-lg-ide") === "1") {
      if (document.querySelector(".lg-glass,.lg-glass-soft,.lg-noveil")) unglassAll();
      return;
    }
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
      for (var i = 0; i < batch.length; i++) sweepGlassSurfaces(batch[i]);
    }, 250);
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
      if (inPageIde) return exitOn;
      if (!exitOn) return false;
      /* 打开方向再加一道容器可见的门，防别的页面元素撞文案误判 */
      var box = document.querySelector(".ide-container, .panel-layout.ide-container, .ide-toolbar, .code-editor-container, .editor-top-bar, .io-editor-container");
      if (!box) return false;
      var r = box.getBoundingClientRect();
      return !!(r.width > 0 && r.height > 0);
    } catch (e) { return false; }
  }
  var inPageIde = false;
  var ideQueueTimer = 0;
  function ideInPageSync() {
    var on = ideInPageDetect();
    if (on === inPageIde) return;
    inPageIde = on;
    try { if (window.lgApp && window.lgApp.ideMode) window.lgApp.ideMode(on); } catch (e) {}
    apply(state.cfg); // 面板按原生渲染 / 退出后把玻璃还回来（data-lg-ide 在 apply 里定）
  }
  function ideInPageQueue() {
    clearTimeout(ideQueueTimer);
    ideQueueTimer = setTimeout(ideInPageSync, 250);
  }
  /* 调试出口（探针/实测用）：直接看判定与桥，不用等防抖 */
  window.__lgIdeInPage = function () {
    return { on: ideInPageDetect(), state: inPageIde, bridge: !!(window.lgApp && window.lgApp.ideMode) };
  };
  window.__lgIdeSync = ideInPageSync;

  var glassObserver = new MutationObserver(function (muts) {
    /* 清扫循环整段兜底：某个节点让 queueGlass 抛错时，后面的推广/IDE 判定
       不能跟着被跳过（曾经一次抛错就让整批队列哑掉） */
    try {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) queueGlass(m.addedNodes[j]);
        } else if (m.target && !/\blg-(glass|noveil)/.test(m.target.className || "")) {
          queueGlass(m.target); // 类名/内联样式变了：重新评估这一块
        }
      }
    } catch (e) {}
    queuePromo();
    ideInPageQueue(); // 编辑器容器是 Vue 异步插进来的：DOM 一变就复核 IDE 模式
  });
  // 调试出口：探针/实测可以直接触发一次全量扫面看结果
  window.__lgGlassSweep = sweepGlassSurfaces;

  // SPA/动态渲染兜底：背景层若被页面脚本移除则自动补回。只补一个空 div 不够
  // （R39）——视频子元素、图片样式、几何都得跟着回来，所以补完立刻重跑一次
  // apply（幂等）；这也覆盖"站点整块重渲染把壁纸层清掉"导致的背景消失。
  var mo = new MutationObserver(function () {
    if (!document.getElementById(BG_ID)) {
      ensureBgLayer();
      try { apply(state.cfg); } catch (e) {}
    }
  });
  function startObserve() {
    if (document.body) {
      mo.observe(document.body, { childList: true });
      glassObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
      // 首屏与异步渲染各扫一遍；液态玻璃皮肤下才动手
      setTimeout(function () { sweepGlassSurfaces(); }, 400);
      setTimeout(function () { sweepGlassSurfaces(); }, 1800);
    } else setTimeout(startObserve, 200);
  }
  startObserve();
})();

