/* ============================================================
   Luogu++ — 注入层能力模块：壁纸与视差
   壁纸层与视口裁剪壳、静态图（lg-media 直出 / IPC 字节兜底）、视频壁纸、视差上报、运行期自愈。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var BG_ID = ctx.BG_ID;
  var state = ctx.state;

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
    ctx.features.viewrect.applyViewRect(); // 重建的层要立刻贴回权威几何（CSS calc 只是首屏兜底）
    return el;
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

  /* ---------- 静态壁纸装配状态（探针用） ----------
     CSP 拦了 lg-media: 和 blob: 时只剩 data: 一条路，出问题要能一眼看出卡在
     哪一步，所以这四项装配状态单独给探针读。 */
  function wallDebug() {
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
  }

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
    try { ctx.apply(state.cfg); } catch (e) {}
    try { window.__lgWallHeal = healTries; } catch (e) {}
  }
  ctx.register("wallpaper", {
    ensureBgLayer: ensureBgLayer,
    wallpaperUrl: wallpaperUrl,
    ensureBgVideo: ensureBgVideo,
    feedBgVideo: feedBgVideo,
    attachParallax: attachParallax,
    applyWallpaperImage: applyWallpaperImage,
    setTabActive: setTabActive,
    wallpaperUnhealthy: wallpaperUnhealthy,
    healWallpaper: healWallpaper,
    wallDebug: wallDebug,
  });
})(window.__lgInjectCtx);
