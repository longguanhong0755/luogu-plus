/* ============================================================
   Luogu++ — Electron 主进程
   架构：窗口自身页面 = 应用外壳 chrome 层（标签条/工具行/侧坞），
   内容区 = 多个 WebContentsView 标签页（洛谷页面，注入美化层）。
   域名锁 / 持久会话 / 配置面板 / 自测钩子 / 自动登录（验证码辅助）
   ============================================================ */
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, Menu, nativeTheme, clipboard, protocol, net, screen, Notification, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process"); // 验证码识别（ddddocr）走本机 python
const crypto = require("crypto");
const zlib = require("zlib");
const { Readable } = require("stream");
const { pathToFileURL } = require("url");

app.setName("LuoguLab");

/* 命令行参数必须在单实例锁之前解析：
   锁是以 userData 路径为键的，--lg-userdata 要先落定，
   否则预览/测试实例会被正式实例挡在门外（踩过）。 */
const argv = process.argv.slice(1);
const argUserData = (argv.find((a) => a.startsWith("--lg-userdata=")) || "").split("=").slice(1).join("=");
if (argUserData) {
  try {
    fs.mkdirSync(argUserData, { recursive: true });
    app.setPath("userData", argUserData);
  } catch (e) {
    console.error("setPath(userData) failed:", e);
  }
}

/* ---------- 本地媒体协议 ----------
   https 页面（洛谷）不能直接加载 file:// 资源，视频/图片壁纸要送进页面
   必须走自定义协议。stream:true 让视频的 Range 请求能正常工作。 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "lg-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
]);

/* 本地绝对路径 → lg-media:// URL（站外 http(s) 与 data: 原样放行）
   保持 ?p= 查询串形式。R41 起视频壁纸也走这里：协议注册了 stream:true，
   handler 带 Range 精确读盘。当年"<video> 对自定义协议恒报
   MEDIA_ERR_SRC_NOT_SUPPORTED"的旧结论留了兜底——注入层 4s 内 readyState
   没起来就自动回退字节 blob 通道（lg-wall:video-blob），视频壁纸不会白屏。 */
function mediaUrlFor(p) {
  if (!p) return null;
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  return "lg-media://local/?p=" + encodeURIComponent(p);
}
const VIDEO_EXT_RE = /\.(mp4|webm|ogv|mov|m4v)$/i;
const isVideoFile = (p) => VIDEO_EXT_RE.test(String(p || ""));
const wallIsVideo = () =>
  !!(cfg.wallpaperKind === "video" || (cfg.wallpaperKind !== "image" && isVideoFile(cfg.wallpaper)));

const MEDIA_MIME = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/x-m4v", ".mov": "video/quicktime",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

/* 壁纸的数据通道：静态图和视频都走这里，由主进程把文件读出来交给渲染进程
   自己 createObjectURL。两个原因：
   - 视频：<video> 不能直接吃 lg-media://（Chromium 的媒体加载器对自定义协议
     恒报 MEDIA_ERR_SRC_NOT_SUPPORTED，而同一份数据用 blob: 播完全正常，实测过）；
   - 静态图：洛谷页面的 CSP 只写在 <meta> 里，default-src 白名单里没有 lg-media:，
     CSS 背景图会被当成 img-src 拦掉（层在、色块在，就是没有图）。
   blob: 本来就在白名单里，不用动它的策略。 */
/* 文件字节按 path+mtime+size 缓存：以前外壳层和每个站点标签各取一次就
   各 readFileSync 一次（视频壁纸动辄几十 MB，几个标签就是几份全量读盘 +
   几份 IPC 拷贝）。文件不变直接回同一份缓存。 */
let wallByteCache = { key: null, payload: null };
function wallpaperPayload(kind) {
  const p = cfg.wallpaper;
  if (!p) return null;
  if (kind === "video" ? !isVideoFile(p) : isVideoFile(p)) return null;
  try {
    const st = fs.statSync(p);
    const key = kind + "|" + p + "|" + st.mtimeMs + "|" + st.size;
    if (wallByteCache.key === key && wallByteCache.payload) return wallByteCache.payload;
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const payload = {
      ok: true,
      data: new Uint8Array(buf),
      type: MEDIA_MIME[ext] || (kind === "video" ? "video/webm" : "image/png"),
      size: buf.length,
      name: path.basename(p),
    };
    wallByteCache = { key, payload };
    return payload;
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}
/* R41：视频壁纸改走 lg-media:// 流式 URL——主进程不再把整个视频文件常驻
   内存（wallByteCache），每个标签也不再各拷一份整文件 blob。字节 blob 降级
   为按需兜底（lg-wall:video-blob）：注入层 4s 起不来才回旧通道。 */
const wallpaperVideoPayload = () => {
  try {
    if (!cfg.wallpaper) return { ok: false, err: "no wallpaper" };
    return {
      ok: true,
      url: mediaUrlFor(cfg.wallpaper),
      type: MEDIA_MIME[path.extname(cfg.wallpaper).toLowerCase()] || "video/mp4",
      name: path.basename(cfg.wallpaper),
      streamed: true,
    };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
};
const wallpaperVideoBlobPayload = () => wallpaperPayload("video");
const wallpaperImagePayload = () => wallpaperPayload("image");

// 单实例锁：二次启动唤起已有窗口（也避免多实例抢缓存）
if (!app.requestSingleInstanceLock()) {
  /* 抢不到锁就立刻走人：这里在 ready 之前，app.quit() 可能被初始化流程吞掉、
     留下"无窗口的卡死进程"——它还握着 profile 与热应用 watcher，表现就是窗口
     被反复重启弹出来、下次启动又被锁挡在门外（v3.9.0 修）。app.exit 不留尾巴。 */
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

const HOME_URL = "https://www.luogu.com.cn/";
const ALLOWED_HOST_RE = /(^|\.)luogu\.com\.cn$/i;
/* 应用首页（新标签/启动页）：本地单色起始页，不再是洛谷首页 */
const HOME_PAGE_URL =
  "file:///" + path.join(__dirname, "src", "home", "home.html").replace(/\\/g, "/");

/* R41 性能基线：冷启动分段耗时（模块求值 → whenReady → 窗口创建 → chrome 层
   加载完 → ready-to-show）。--lg-perftest 读它落盘，优化前后各跑一次对拍。 */
const perfMarks = { t0: Date.now() };

const DEFAULT_CONFIG = {
  theme: "auto",
  wallpaper: "",
  wallpaperBlur: 0,
  wallpaperDim: 0,
  /* 面不透明度：flat 皮肤唯一一颗滑杆，栏、卡片、面板、内块全用这一个值
     （v6 起合并了旧的 barAlpha/cardAlpha 两颗——同一屏里栏与卡片两种浓度
     就是"内外质感不一样"的直接来源）。
     旧键 barAlpha/cardAlpha **只作迁移输入**，绝不能留在 DEFAULT_CONFIG：
     留着就会被 {…DEFAULT_CONFIG, …raw} 合并进 cfg，于是
     `cfg.faceAlpha == null` 永远为假 → v5→v6 迁移分支成了死代码，
     老用户自己调过的面浓度被静默重置为默认值，且这段代码还留在那儿
     给后人错觉。迁移完会在同一段里 delete 掉这两个键。 */
  faceAlpha: 0.92,
  blur: 26,
  radius: 8,
  clean: true,
  frameless: true,
  contentDesat: 0,
  uiScale: 1,
  /* 每站独立缩放（Edge 语义：某个站放大过，下次去这个站还是那个倍数）。
     键是域名，值是倍率；倍率回到 1 时删掉该条（不留"曾经 1.0"的垃圾）。 */
  zoomByOrigin: {},
  /* 站外页自动玻璃：把别的网站上的卡片/面板自动换成我们的玻璃面。
     只对**自动探测判定为内容型**的页面生效（表单密集/应用型站点不碰），
     且内部含 position:fixed 后代的容器不给挂 backdrop-filter（会劫持
     fixed 包含块，v3.4.2 教训）——那种容器只给半透明底 + 发丝线。 */
  autoGlass: true,
  ideNative: true,
  mappings: {},
  /* 页面配色：auto=跟随全应用统一明暗（唯一支持的语义）。v3.5.1 起"原色/亮/暗"
     三态已撤（原色正是"里面一个颜色、外面一个颜色"的根因），旧配置里的
     native/light/dark 仍认，native 归 auto（见 loadConfig 的 v5 迁移）。
     R42：默认值原先写的是 "native"——一个注入层早就不再接受的死值，
     会让人以为"默认原色"，实际跑的是 auto。这里与真实语义对齐。 */
  pageTheme: "auto",
  /* 配色预设：中性基色，决定明暗两套的底色/墨色骨架 */
  preset: "ink",
  /* 主题色种子：挑一个颜色（比如紫色），所有色块都朝它混色，任何色相自动适配 */
  themeSeed: "",
  themeStrength: 45,       // 混色浓度 0~100
  accent: "",              // 强调色；留空 = 跟随主题色（没设主题色则跟随墨色）
  betterSearch: true,      // 首页「问题搜索」题号直达 + 按难度随机跳题
  borderStrength: 1,       // 边框强度 0.4~3 倍
  animations: true,        // 页面动效（过渡/动画）
  codeCopy: true,          // 代码块悬停显示"复制"
  diffMono: false,         // 难度徽章灰阶化
  /* 玻璃皮肤：flat=线条风素面（默认）/ liquid=Apple 液态玻璃 */
  glass: "flat",
  glassTint: 0.12,         // 玻璃底色不透明度
  glassSat: 180,           // 玻璃饱和度增强（%）
  wallpaperKind: "",       // ""=按扩展名自动判定 / image / video
  wallpaperMute: true,     // 视频壁纸静音
  homeHello: true,         // 首页欢迎区块（头像 + 问候 + 一句吐槽）
  smartPid: true,          // 划词识别题号（选中 P1001 之类就冒出跳转按钮）
  luckyDay: false,         // 逆天改运：把洛谷签到运势改成"大吉"
  declutter: false,
  verticalTabs: true,
  // 垂直标签栏折叠（Edge 式窄条，悬停浮出完整列表）：默认收缩
  vtabCollapsed: true,
  /* 紧凑模式（Zen Compact）：侧栏整个收没只留 4px 热区。独立一轴——只改宽度，
     不动"钉住/收起"（vtabCollapsed），关掉紧凑就回到原来的姿态 */
  vtabCompact: false,
  /* 常驻展开时侧栏的宽度（Edge 能拖宽窄）：拖侧栏右缘改它，160~400 夹取。
     折叠窄条宽度固定 46，不受影响。 */
  vtabWidth: 212,
  /* 垂直标签栏放哪一侧（Edge 支持左/右）：left=默认，right=贴窗口右缘。
     所有几何消费者（页面 inset / 分屏 / 抽屉 / 坞 / 弹层锚点）
     都从 inset() 取，不各写一套。 */
  vtabSide: "left",
  /* 侧坞放哪一边（上/下/左/右）："auto" = 跟随布局（水平布局左侧、垂直布局
     底部，也就是改造前的形态）。外壳的坞与页面的让位都从这一个值算，
     两边永远同一条边（坞不盖网页、页面不多留空档）。 */
  dockPos: "auto",
  /* 整理标签页：关闭重复标签时保留哪一个
     active=当前激活页（默认）/ first=位置最靠前 / mru=最近使用 */
  dedupeKeep: "active",
  /* 搜索引擎：地址栏搜索回退、首页搜索框、联想里的"搜索"行共用一份。
     id 见 SEARCH_ENGINES；custom 时用 searchCustom（必须含 %s 占位）。 */
  searchEngine: "luogu",
  searchCustom: "",
  /* 下载：true=每次弹原生"另存为"；false（默认）=统一存到「下载/Luogu++」 */
  dlAsk: false,
  /* 下完弹系统通知（Edge 行为：通知中心有一条，点一下定位到下载项）。
     关掉后只更新下载面板，不打扰。 */
  downloadNotify: true,
  /* 翻译服务：bing=Edge 同款免费接口（默认，国内可用）/ custom=自定义 GET 模板 */
  translateProvider: "bing",
  translateCustom: "",
  // 自定义快捷键覆盖表：actionId → accelerator（"" = 解绑），见 SHORTCUT_ACTIONS
  shortcuts: {},
  quickSearch: true,
  /* 启动不再恢复上次会话：默认只开一个空的应用首页（用户要求；想恢复可在
     设置「效率功能 → 恢复上次的标签」里重新打开） */
  restoreTabs: false,
  /* R41 性能：后台标签恢复 Chromium 定时器节流。活动/分屏可见/出声标签不节流；
     窗口隐藏的黑首帧由 repaintSiteViews 的强制重绘兜底，与定时器节流无关。 */
  bgThrottle: true,
  /* R41 性能：系统内存吃紧时提前休眠最久未用的后台标签（30 分钟空闲规则不变） */
  memSleep: true,
  /* 闲置标签自动休眠的分钟数（0 = 关）。此前**只有** main.js 里的运行时
     兜底（loadConfig 里判 null 就补 30），配置里根本没有这个键——设置页
     的滑杆读到的值不在 DEFAULT_CONFIG 里，属于"用补丁代替定义"。
     现在它和其它配置一样有正式定义，老配置仍由 loadConfig 的兜底补齐。 */
  tabSleepMinutes: 30,
  /* 自定义 Python 解释器路径（验证码 OCR 用）。空 = 用系统 python。
     此前代码读 cfg.captchaPython 但配置里没有这个键，用户只能改环境变量
     LG_PYTHON；现在能在配置里直接指定。 */
  captchaPython: "",
  listTools: true,
  activeAccountId: "",
  bookmarks: [],           // [{url, title, addedAt}]（收藏功能已删，字段只为兼容旧配置保留）
  /* 自定义基色（preset = "custom" 时生效） */
  customBase: { bg: "#f7f7f8", ink: "#18181b" },
  /* 壁纸集合：多张壁纸 + 播放模式。wallpaper 字段仍是"当前这张"（兼容旧逻辑）。
     mode: single=固定当前 / shuffle=随机轮换 / loop=按列表顺序轮换；
     rotateMin: 自动轮换间隔分钟（0=只在启动时换）。 */
  wallpapers: [],
  wallpaperMode: "single",
  wallpaperRotateMin: 0,
  // 壁纸视差：鼠标移动时壁纸层轻微跟随（页面层与外壳层同一公式同步动）
  wallpaperParallax: true,
  /* 本轮新功能的开关与数据 */
  muteAll: false,          // 一键全局静音
  showHideHotkey: true,    // 全局唤起/隐藏热键 Ctrl+Alt+L
  countdowns: [],          // 首页考试倒计时 [{name, date:"2026-11-28"}]
  /* 应用首页板块开关与时钟样式：首页是本地页，偏好随 cfgForPages 全量下发，
     首页脚本消费（隐藏板块 / 时钟字体 / 秒显）。 */
  homePrefs: {
    clock: true,           // 大时钟
    seconds: false,        // 时钟显示秒
    clockFont: "mono",     // mono=等宽 / sans=无衬线 / serif=衬线
    clockSize: 58,         // 时钟字号 px（40~96）
    date: true,            // 日期行
    search: true,          // 搜索框
    countdowns: true,      // 考试倒计时卡
    links: true,           // 快捷入口
    recent: true,          // 最近访问卡
    contests: true,        // 近期比赛卡
    footer: true,          // 底部快捷键提示
  },
  /* 用户自定义 CSS：原样注入到每个页面（含本地页；洛谷页慎用全局选择器） */
  customCSS: "",
  /* 左侧坞自定义项：{icon, title, href}
     href 语义：@home=应用首页 / 洛谷完整 URL（默认写全，见 v5 迁移）/ 站内路径
     （/problem/list，兼容旧配置）/ 站外完整 URL（开不锁域的新标签）/
     映射词（按 cfg.mappings 解析）。空/非法项渲染时忽略。 */
  dockItems: [
    { icon: "home", title: "首页", href: "@home" },
    { icon: "list", title: "题库", href: "https://www.luogu.com.cn/problem/list" },
    { icon: "book", title: "题单", href: "https://www.luogu.com.cn/training/list" },
    { icon: "trophy", title: "比赛", href: "https://www.luogu.com.cn/contest/list" },
    { icon: "chat", title: "讨论", href: "https://www.luogu.com.cn/discuss" },
    { icon: "clock", title: "记录", href: "https://www.luogu.com.cn/record/list" },
    { icon: "code", title: "IDE", href: "@ide" },
  ],
};

/* ---------- 配色预设（黑白单色约束下的几套中性皮肤） ----------
   三态开关决定"要不要接管页面"，预设决定"接管之后长什么样"。
   每套只给中性灰阶：无彩色、无渐变，差别在色温与对比度——
   这是黑白线条风里唯一诚实的"几套配色"。主进程是权威表，
   inject.js 只留一份墨白兜底（页面被独立 apply 时用）。 */
const PRESETS = {
  ink: {
    label: "墨白",
    desc: "纯中性灰阶，默认",
    light: { tint: "255, 255, 255", bgBase: "#f7f7f8", ink: "#18181b", border: "rgba(0, 0, 0, 0.12)" },
    dark: { tint: "23, 24, 28", bgBase: "#101013", ink: "#e7e7ea", border: "rgba(255, 255, 255, 0.12)" },
  },
  paper: {
    label: "宣纸",
    desc: "微暖米灰，久看不刺眼",
    light: { tint: "253, 251, 247", bgBase: "#f6f2e9", ink: "#241f18", border: "rgba(74, 56, 32, 0.16)" },
    dark: { tint: "26, 24, 20", bgBase: "#141210", ink: "#e9e2d5", border: "rgba(240, 226, 200, 0.14)" },
  },
  slate: {
    label: "青灰",
    desc: "微冷青灰，接近工程灰",
    light: { tint: "253, 254, 255", bgBase: "#f1f4f7", ink: "#141b21", border: "rgba(24, 48, 70, 0.15)" },
    dark: { tint: "19, 23, 27", bgBase: "#0c1013", ink: "#e1e8ee", border: "rgba(205, 226, 242, 0.13)" },
  },
  soft: {
    label: "柔雾",
    desc: "低对比柔灰，弱化边框",
    light: { tint: "255, 255, 255", bgBase: "#fafafb", ink: "#3f3f46", border: "rgba(0, 0, 0, 0.08)" },
    dark: { tint: "24, 24, 27", bgBase: "#17171a", ink: "#d4d4d8", border: "rgba(255, 255, 255, 0.08)" },
  },
  contrast: {
    label: "高对比",
    desc: "纯黑白，边框加重",
    light: { tint: "255, 255, 255", bgBase: "#ffffff", ink: "#000000", border: "rgba(0, 0, 0, 0.42)" },
    dark: { tint: "0, 0, 0", bgBase: "#000000", ink: "#ffffff", border: "rgba(255, 255, 255, 0.42)" },
  },
};
/* ---------- 配色：中性基色 × 主题色种子 ----------
   用户挑一个颜色（比如紫色），所有色块就都跟着变成那个颜色。
   做法不是反转滤镜，而是把"中性基色"按比例朝种子色混：卡片底、页面底、
   正文墨色、边框各混不同的量。任何色相都能这样自动适配，明暗两套都成立。 */
function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbToHex = (r) => "#" + toHex2(r[0]) + toHex2(r[1]) + toHex2(r[2]);
function mixRgb(a, b, k) {
  const t = Math.max(0, Math.min(1, k));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mixTriplet(triplet, seed, k) {
  const base = String(triplet).split(",").map((x) => parseInt(x, 10));
  if (base.length < 3 || base.some((n) => !isFinite(n))) return triplet;
  const m = mixRgb(base, seed, k);
  return Math.round(m[0]) + ", " + Math.round(m[1]) + ", " + Math.round(m[2]);
}
// "rgba(0, 0, 0, 0.12)" → 只换 RGB，alpha 原样保留
function mixRgba(str, seed, k) {
  const m = String(str).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return str;
  const rgb = mixRgb([+m[1], +m[2], +m[3]], seed, k);
  return "rgba(" + Math.round(rgb[0]) + ", " + Math.round(rgb[1]) + ", " + Math.round(rgb[2]) + ", " + (m[4] != null ? m[4] : 1) + ")";
}
function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
// 混入比例：卡片最重（"块变成紫色"看的就是它），文字最轻（保住可读性）
const SEED_MIX = {
  light: { tint: 0.46, bgBase: 0.26, ink: 0.30, border: 0.55 },
  dark: { tint: 0.44, bgBase: 0.32, ink: 0.26, border: 0.55 },
};
function seedActive() {
  return !!hexToRgb(cfg.themeSeed) && clampNum(cfg.themeStrength, 0, 100, 45) > 0;
}
function themeVars(id, mode) {
  /* 自定义基色：用户在设置页自选底色/文字色（cfg.customBase），
     边框从文字色派生；主题色种子照常往上混。 */
  if (id === "custom") {
    const cb = /** @type {{bg?: string, ink?: string}} */ (cfg.customBase || {});
    const ok = (h) => /^#[0-9a-f]{6}$/i.test(String(h || ""));
    const bg = ok(cb.bg) ? cb.bg : "#f7f7f8";
    const ink = ok(cb.ink) ? cb.ink : "#18181b";
    const base = {
      tint: hexToRgb(bg).join(", "),
      bgBase: bg,
      ink: ink,
      border: "rgba(" + hexToRgb(ink).join(", ") + ", 0.12)",
    };
    const out = { ...base, label: "自定义" };
    const seed = hexToRgb(cfg.themeSeed);
    const k = clampNum(cfg.themeStrength, 0, 100, 45) / 100;
    if (!seed || k <= 0.001) return out;
    const mx = SEED_MIX[mode] || SEED_MIX.light;
    out.tint = mixTriplet(base.tint, seed, mx.tint * k);
    out.bgBase = rgbToHex(mixRgb(hexToRgb(base.bgBase) || [255, 255, 255], seed, mx.bgBase * k));
    out.ink = rgbToHex(mixRgb(hexToRgb(base.ink) || [0, 0, 0], seed, mx.ink * k));
    out.border = mixRgba(base.border, seed, mx.border * k);
    return out;
  }
  const p = PRESETS[id] || PRESETS.ink;
  const base = p[mode] || p.light;
  const out = { ...base, label: p.label };
  const seed = hexToRgb(cfg.themeSeed);
  const k = clampNum(cfg.themeStrength, 0, 100, 45) / 100;
  if (!seed || k <= 0.001) return out;
  const mx = SEED_MIX[mode] || SEED_MIX.light;
  out.tint = mixTriplet(base.tint, seed, mx.tint * k);
  out.bgBase = rgbToHex(mixRgb(hexToRgb(base.bgBase) || [255, 255, 255], seed, mx.bgBase * k));
  out.ink = rgbToHex(mixRgb(hexToRgb(base.ink) || [0, 0, 0], seed, mx.ink * k));
  out.border = mixRgba(base.border, seed, mx.border * k);
  return out;
}
/* 强调色：没手填就用主题色种子，再没有才退回墨色 */
function accentFor(vars) {
  if (cfg.accent) return cfg.accent;
  if (seedActive()) return cfg.themeSeed;
  return vars && vars.ink ? vars.ink : "#18181b";
}

/* 材质派生变量：全应用唯一算法、唯一键集（10 个 glass*）。
   外壳、洛谷页、本地页、白名单玻璃站、弹层全部消费同一张映射——配方在
   src/material.css 里也只有一份（.lg-face）。皮肤（flat/liquid）只改变
   映射里的**取值**，不改变配方与名字，所以"里面的块"和"外面的框"不可能
   再是两种料：以前外壳 flat 走 --surface（不透明、衰减混色 tint）、页面
   flat 走 --lg-glass-card（0.92、全量混色 tint），名字、颜色、透明度三处
   分叉，同一屏里就能看出两种质感。
   历史上存在过的三套词汇（--glass-* / --surface 系 / --lg-glass-*）现在
   收敛成一套：material.css 用别名把 --surface/--surface-2/--hairline 指向
   同一份值，谁都不许再写第二种材质。 */
/* 面色唯一来源：预设/自定义基色的 tint，按用户浓度**全量**朝主题色混
   （themeVars 里给文字/边框的是衰减混色——那是可读性妥协；面是装饰层，
   用户明确要求"只有一个主题色"）。没有主题色时就是基色本身。 */
function baseTintTriplet(id, mode) {
  if (id === "custom") {
    const cb = cfg.customBase || {};
    const bg = /^#[0-9a-f]{6}$/i.test(String(cb.bg || "")) ? cb.bg : "#f7f7f8";
    return hexToRgb(bg).join(", ");
  }
  const p = PRESETS[id] || PRESETS.ink;
  return ((p[mode] || p.light).tint);
}
const MATERIAL_KEYS = [
  "glassBg",
  "glassBg2",
  "glassCard",
  "glassSoft",
  "glassSolid",
  "glassLine",
  "glassHi",
  "glassSheen",
  "glassBlur",
  "glassDrop",
];
function materialVars(mode) {
  const light = mode !== "dark";
  const tv = themeVars(cfg.preset, light ? "light" : "dark");
  const seed = hexToRgb(cfg.themeSeed);
  const seedK = clampNum(cfg.themeStrength, 0, 100, 45) / 100;
  const faceTint =
    seed && seedK > 0.001 ? mixTriplet(baseTintTriplet(cfg.preset, light ? "light" : "dark"), seed, seedK) : tv.tint;
  const inkRgb = hexToRgb(tv.ink) || (light ? [24, 24, 27] : [231, 231, 234]);
  const A = (n) => Math.min(1, Math.max(0, n)).toFixed(3);
  const t = faceTint;
  const line = "rgba(" + inkRgb.join(", ") + ", " + (light ? 0.14 : 0.22) + ")";
  /* 素面（flat / 线条素面）：面 = 纯色（同源 faceTint）+ 一颗"面不透明度"，
     无模糊、无高光、无投影。
     四个层级曾**全部同值**（栏、卡片、面板、内块都是 face）——层级差为 0，
     界面上所有面颜色一模一样，只剩 1px 发丝线区分，看上去就是"一堆纸片"。
     现在给四档**各自可辨但依然接近**的浓度：底最淡 → 次级底 → 卡片 →
     内块比卡片更淡（内块是卡片里的次级块），正文承载面最实。
     幅度刻意压得很小（±0.04），守住"素面"的通透感，不做成液态玻璃那种
     明显的层差。下限用 Math.max 兜住，face 被用户调到 0.3 时不会算出负值。 */
  if (cfg.glass !== "liquid") {
    const face = clampNum(cfg.faceAlpha, 0.3, 1, 0.92);
    const faceC = (a) => "rgba(" + t + ", " + A(a) + ")";
    return {
      glassBg: faceC(Math.max(0.18, face - 0.04)),
      glassBg2: faceC(Math.max(0.2, face - 0.02)),
      glassCard: faceC(face),
      glassSoft: faceC(Math.max(0.16, face - 0.06)),
      glassSolid: faceC(Math.min(1, face + 0.06)),
      glassLine: line,
      glassHi: "rgba(255, 255, 255, 0)",
      glassSheen: "rgba(255, 255, 255, 0)",
      glassBlur: "none",
      glassDrop: "none",
    };
  }
  /* 液态玻璃：浓度/模糊/饱和度三颗滑杆推导，颜色仍是同一个 faceTint。 */
  const gt = clampNum(cfg.glassTint, 0, 1, 0.12);
  const gsat = clampNum(cfg.glassSat, 100, 300, 180);
  const blurPx = Math.max(8, Math.round(clampNum(cfg.blur, 0, 40, 26) * 0.85));
  return {
    glassBg: "rgba(" + t + ", " + A(light ? 0.03 + gt * 0.5 : 0.18 + gt * 0.6) + ")",
    glassBg2: "rgba(" + t + ", " + A(light ? 0.07 + gt * 0.55 : 0.24 + gt * 0.55) + ")",
    glassCard: "rgba(" + t + ", " + A(light ? 0.4 + gt * 0.52 : 0.4 + gt * 0.5) + ")",
    // 白名单玻璃站专用"可读玻璃"：人家的容器不能挂 backdrop-filter（会劫持
    // fixed 包含块，v3.4.2 教训），没有模糊兜底，透明度就得高一点正文才坐得住。
    // 颜色与玻璃全家同源（同一个 tint），只是 alpha 加厚。
    glassSoft: "rgba(" + t + ", " + (light ? 0.66 : 0.7) + ")",
    glassSolid: "rgba(" + t + ", " + (light ? 0.86 : 0.85) + ")",
    glassLine: line,
    glassHi: light ? "rgba(255, 255, 255, 0.62)" : "rgba(255, 255, 255, 0.22)",
    glassSheen: light ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.06)",
    glassBlur: "blur(" + blurPx + "px) saturate(" + gsat + "%) brightness(" + (light ? 1.05 : 1.16) + ")",
    glassDrop: light ? "0 10px 30px rgba(0, 0, 0, 0.14)" : "0 10px 30px rgba(0, 0, 0, 0.46)",
  };
}
/* 键 → CSS 变量名：全应用唯一命名表。外壳、页面、探针都从这里取名字，
   不允许任何地方再手写 --lg-glass-* 的字面量。 */
const MATERIAL_VARS = {
  glassBg: "--lg-glass-bg",
  glassBg2: "--lg-glass-bg-2",
  glassCard: "--lg-glass-card",
  glassSoft: "--lg-glass-soft",
  glassSolid: "--lg-glass-solid",
  glassLine: "--lg-glass-line",
  glassHi: "--lg-glass-hi",
  glassSheen: "--lg-glass-sheen",
  glassBlur: "--lg-glass-blur",
  glassDrop: "--lg-glass-drop",
};
/* 一次构建、全家共用：外壳（chrome:config）、页面（__lgGlass.apply）、
   弹层（沿外壳内联变量）拿到的是同一个对象，不存在第二处推导。 */
function materialPayload() {
  const rt = resolvedTheme();
  return {
    theme: rt,
    skin: cfg.glass === "liquid" ? "liquid" : "flat",
    keys: MATERIAL_KEYS,
    vars: MATERIAL_VARS,
    light: materialVars("light"),
    dark: materialVars("dark"),
    current: materialVars(rt === "dark" ? "dark" : "light"),
  };
}
/* 壁纸参数也一次算：模糊/压暗/视差/URL。外壳、页面、弹层不再各自 clamp。
   （名字避开 wallpaperPayload(kind)——那是"壁纸字节载荷"的老函数，两者
   撞名过一次：撞名会让 lg-wall:image 的兜底通道拿到参数对象，v35test 的
   fastPath.byteCacheHit 当场报 false，别改回去。） */
function wallParams() {
  return {
    url: mediaUrlFor(cfg.wallpaper),
    isVideo:
      cfg.wallpaperKind === "video" || (cfg.wallpaperKind !== "image" && isVideoFile(cfg.wallpaper)),
    blurPx: clampNum(cfg.wallpaperBlur, 0, 30, 0),
    dim: clampNum(cfg.wallpaperDim, 0, 1, 0),
    parallax: cfg.wallpaperParallax !== false,
  };
}
/* 下发给页面/外壳的配置：附上算好的配色变量，页面侧不用再维护一份色表 */
/* ---------- 搜索引擎（唯一来源） ----------
   地址栏搜索回退、首页搜索框、地址栏联想里的"搜索"行三处共用下面这份模板；
   以前各处手写 URL，换引擎要改三处、漏一处就"地址栏和首页搜的不是一家"。
   custom 用用户模板（必须含 %s）；洛谷引擎保持站内导航（锁域），其余引擎
   一律开站外共享会话的新标签。 */
const SEARCH_ENGINES = {
  /* 洛谷的站内搜索路径 /search?keyword= 已下线：请求返回的是洛谷自己的
     "出错了 / 该页面未找到"页（HTTP 仍是 200，肉眼像正常页面）。而
     searchEngine 的默认值就是 luogu —— 任何非题号/非 URL 的搜索（中文词、
     算法名、题面关键词）全部走进死路，失败信息还伪装成洛谷自己的错。
     /problem/list?keyword= 才是现在能返回真实题目列表的路径（实测：
     同关键词前者返回"该页面未找到"，后者返回 48 个题目链接）。 */
  luogu: { name: "洛谷", url: "https://www.luogu.com.cn/problem/list?keyword=%s" },
  bing: { name: "必应", url: "https://www.bing.com/search?q=%s" },
  baidu: { name: "百度", url: "https://www.baidu.com/s?wd=%s" },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  ddg: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
};
function searchEngineId() {
  const id = String(cfg.searchEngine || "luogu");
  if (id === "custom") {
    const t = String(cfg.searchCustom || "");
    return t.includes("%s") ? "custom" : "luogu";
  }
  return SEARCH_ENGINES[id] ? id : "luogu";
}
function searchTemplate() {
  const id = searchEngineId();
  return id === "custom" ? String(cfg.searchCustom) : SEARCH_ENGINES[id].url;
}
function searchUrlFor(q) {
  return searchTemplate().replace("%s", encodeURIComponent(String(q == null ? "" : q)));
}

function cfgForPages() {
  const ins = inset();
  const wall = wallParams();
  return {
    ...cfg,
    // 页面视图让出的左上角内边距。页面里的壁纸层要靠它把自己撑到"整个窗口"的
    // 几何上，才能和外壳的壁纸层严丝合缝（否则左侧坞/顶栏透出的壁纸会错位）。
    insetX: ins.x,
    insetY: ins.y,
    footer: ins.footer || 0,
    /* 侧栏分界线（外壳的 --vtab-cur 吃它）：只算侧栏本身那一条。坞已迁到
       独立覆盖视图（R36），页面不再为它让位——inset 里没有坞的份额。
       右侧模式下 ins.x 是 0，顶栏直接吃 ins.x 会铺满、盖住侧栏。 */
    vtabCur: vtabBoundary(),
    // 坞位置的解析结果（auto 已在主进程定死）：外壳照抄，不再自己判一遍
    dockPosResolved: dockPos(),
    // 展开态侧栏宽度（拖宽窄后外壳的 --vtab-w 要吃同一个值）与所在侧
    vtabWidth: vtabExpandedW(),
    vtabSide: vtabSide(),
    // 全应用统一的明暗裁决与材质映射（见 materialVars）：页面侧不再自己嗅探/推导，
    // 保证"洛谷页的面"与"外壳的面"是同一份配置算出来的同一个颜色。
    resolvedTheme: resolvedTheme(),
    material: materialPayload(),
    wall,
    wallpaperUrl: wall.url,
    wallpaperIsVideo: wall.isVideo,
    presetLight: themeVars(cfg.preset, "light"),
    presetDark: themeVars(cfg.preset, "dark"),
    accentResolved: accentFor(themeVars(cfg.preset, "light")),
    /* 搜索引擎：解析成"含 %s 的模板"下发（唯一来源在主进程）——地址栏搜索
       回退、首页搜索框、联想里的搜索行三处共用，不再各写一份 URL */
    searchTemplate: searchTemplate(),
    searchIsLuogu: searchEngineId() === "luogu",
    searchName: searchEngineId() === "custom" ? "自定义" : SEARCH_ENGINES[searchEngineId()].name,
  };
}

const configPath = () => path.join(app.getPath("userData"), "luogu-glass-config.json");

/* lg-media 的 Range 精确读（R41）：只把请求的分片读进内存。旧实现
   readFileSync(整文件).subarray(start,end)——视频壁纸每来一个分片就把整个
   大文件读一遍。仍返回 Buffer body（注释里的 Format error 是"Node 流→
   Web 流"转换踩过的坑，这里不碰那条路）。 */
async function readRange(abs, start, end) {
  const len = end - start + 1;
  const fh = await fs.promises.open(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);
    return buf;
  } finally {
    try { await fh.close(); } catch {}
  }
}

/* ---------- 自写日志（GUI 程序 stdout 不可靠，崩溃必须留痕） ----------
   R41：改缓冲 + 1s 批量落盘。此前每条日志一次同步 appendFileSync，广告拦截
   每个被拦请求都写一次盘——主进程热路径上的同步 IO。崩溃/退出路径走
   dbgFlushSync 保序。 */
const dbgPath = () => path.join(app.getPath("userData"), "luogu-glass-debug.log");
let dbgBuf = [];
let dbgTimer = null;
function dbgFlushSync() {
  if (!dbgBuf.length) return;
  const lines = dbgBuf;
  dbgBuf = [];
  try { fs.appendFileSync(dbgPath(), lines.join("")); } catch {}
}
function dbg(msg) {
  try {
    dbgBuf.push(`[${new Date().toISOString()}] ${msg}\n`);
    if (!dbgTimer) {
      dbgTimer = setTimeout(() => {
        dbgTimer = null;
        if (!dbgBuf.length) return;
        const lines = dbgBuf;
        dbgBuf = [];
        try { fs.appendFile(dbgPath(), lines.join(""), () => {}); } catch { dbgBuf = lines; }
      }, 1000);
    }
  } catch {}
}
process.on("uncaughtException", (e) => {
  try { dbg("uncaughtException: " + (e && e.stack ? e.stack : String(e))); } catch {}
  try { dbgFlushSync(); } catch {}
  app.exit(1);
});
process.on("unhandledRejection", (e) => {
  dbg("unhandledRejection: " + (e && e.stack ? e.stack : String(e)));
});

/* ---------- 诊断报告 ----------
   用户报障时最缺的是"当时到底发生了什么"。此前只有一份自写的调试日志
   躺在 userData 里，用户既不知道它在哪、也不会去看——等于没有。
   这里做一份**人可读**的报告：版本/运行时/内存/配置摘要（脱敏）/标签状态/
   最近一次写盘失败/日志尾部。一键另存为，用户直接发给维护者即可定位问题。
   设计约束：① 不含任何凭据（token/账号/密码一律打码）；② 不写盘（只
   在用户主动点"保存"时才落盘，且写到用户自己选的位置）。 */
function diagValue(v) {
  if (v == null) return String(v);
  const t = typeof v;
  if (t === "number" || t === "boolean") return String(v);
  if (t === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (Array.isArray(v)) return "[" + v.length + " 项]";
  return "{" + Object.keys(v).length + " 键}";
}
function buildDiagnostics() {
  const mem = process.memoryUsage();
  const out = [];
  const push = (s) => out.push(s);
  push("=== LuoguLab 诊断报告 ===");
  push("生成时间: " + new Date().toISOString());
  push("应用版本: " + (app.getVersion ? app.getVersion() : "未知"));
  push("运行时: Electron " + process.versions.electron + " / Chromium " + process.versions.chrome + " / Node " + process.versions.node);
  push("系统: " + process.platform + " " + process.arch + " " + (process.release && process.release.name ? process.release.name : "?"));
  push("内存: rss " + Math.round(mem.rss / 1048576) + "MB / heapUsed " + Math.round(mem.heapUsed / 1048576) + "MB");
  push("标签页: " + tabs.size + " 个（活动 " + activeTabId + "，分组 " + tabGroups.size + "，壁纸目录 " + (wallpapersDir ? "有" : "无") + "）");
  push("配置版本: " + (cfg.configVersion == null ? "?" : cfg.configVersion));
  push("皮肤: " + (cfg.glass || "liquid") + " / 圆角 " + (cfg.radius == null ? "?" : cfg.radius) + "px / 主题 " + (cfg.theme || "auto"));
  push("");
  push("--- 配置摘要（已脱敏：不含 token / 账号 / 密码）---");
  const SECRET = /token|password|passwd|secret|cookie|email|account|mailbox/i;
  for (const k of Object.keys(cfg).sort()) {
    if (SECRET.test(k)) { push("  " + k + " = <已隐藏>"); continue; }
    push("  " + k + " = " + diagValue(cfg[k]));
  }
  push("");
  push("--- 最近一次写盘失败 ---");
  push(lastWriteFailure ? "  " + JSON.stringify(lastWriteFailure) : "  （无）");
  push("");
  push("--- 调试日志尾部（最多 120 行）---");
  try {
    const p = dbgPath();
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      push("  日志文件: " + p + "（" + Math.round(stat.size / 1024) + "KB）");
      const fd = fs.openSync(p, "r");
      try {
        const len = stat.size;
        const readLen = Math.min(len, 64 * 1024);
        const buf = Buffer.alloc(readLen);
        fs.readSync(fd, buf, 0, readLen, len - readLen);
        const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-120);
        for (const l of lines) push("  " + l);
      } finally { fs.closeSync(fd); }
    } else {
      push("  （日志文件尚未生成）");
    }
  } catch (e) { push("  读取失败: " + (e && e.message ? e.message : e)); }
  return out.join("\n");
}
ipcMain.handle("lg-app:diagnostics", () => {
  try { return { ok: true, report: buildDiagnostics() }; }
  catch (e) { return { ok: false, message: String((e && e.message) || e) }; }
});
ipcMain.handle("lg-app:diagnostics-save", async () => {
  try {
    const report = buildDiagnostics();
    const r = await dialog.showSaveDialog(mainWin, {
      title: "保存诊断报告",
      defaultPath: path.join(app.getPath("desktop"), "LuoguLab-诊断报告.txt"),
      filters: [{ name: "文本文件", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(r.filePath, report, "utf8");
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, message: String((e && e.message) || e) }; }
});

/* ============================================================
   持久化地基（R42）：读损坏要留证据、写要原子、失败要说话
   ------------------------------------------------------------
   改造前每个 *.json 各写一套 try/catch，三条隐患都指向"用户数据悄悄没了"：
     1) 读：解析失败 → 静默回退默认值，紧接着一次 save 就把原文件覆盖掉
        （配置/账号/历史"自己变回默认"就是这么发生的，且没有任何痕迹）；
     2) 写：fs.writeFile 直写目标文件，进程在写一半退出 → 文件残缺 →
        下次读失败 → 又回到默认值；
     3) 失败：catch {} 一律吞掉 —— 磁盘满时改设置毫无反应，用户以为改成功了。
   这里收成三条地基，六个持久化点（配置/账号/标签/窗口/历史/下载）全走它：
     1) readJsonSafe：坏文件先备份 .corrupt-<时间戳> 再回退，并进 recoveredFiles
        （外壳首帧后统一提示一次）；
     2) writeTextAtomic(Sync)：写 <file>.tmp-<pid> → rename 覆盖。同盘 rename
        原子，中途崩不会留下半个 JSON；临时名带 pid，探针实例互不干扰；
     3) reportWriteFail：ENOSPC/EACCES 等 → dbg 留痕 + 外壳 toast（60s 冷却），
        窗口还没就绪时挂 pending，did-finish-load 后补发。
   ============================================================ */
const recoveredFiles = [];   // [{file, backup}]：启动时判损坏并已备份的文件
let writeFailPending = "";   // 窗口没就绪时的待发提示
let writeFailNotifiedAt = 0;
/* 最近一次写失败（R42）：toast 是一次性的、pending 发完即清，事后无从查证。
   留一份带时间戳的记录给诊断与探针（v315test 断言它，而不是猜 toast 发没发）。 */
let lastWriteFailure = null;

function reportWriteFail(file, err) {
  const code = String((err && err.code) || "");
  const label = path.basename(file);
  const msg =
    code === "ENOSPC"
      ? "磁盘空间不足，" + label + " 没能保存"
      : code === "EACCES" || code === "EPERM"
        ? "没有写入权限，" + label + " 没能保存"
        : label + " 写入失败（" + (code || "IO") + "）";
  dbg("write fail: " + file + " " + code + " " + ((err && err.message) || ""));
  lastWriteFailure = { file: path.basename(file), code, msg, at: Date.now() };
  writeFailPending = writeFailPending || msg;
  const now = Date.now();
  if (mainWin && !mainWin.isDestroyed() && now - writeFailNotifiedAt > 60000) {
    writeFailNotifiedAt = now;
    writeFailPending = "";
    try { mainWin.webContents.send("chrome:toast", msg); } catch {}
  }
  return msg; // 探针要断言文案（v315test），别让它靠猜
}

function readJsonSafe(file, fallback, label) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    /* 文件不存在 = 首次运行，属于正常；权限/IO 错误要留痕 */
    if (e && e.code !== "ENOENT") dbg("read fail: " + file + " " + ((e && e.code) || (e && e.message)));
    return fallback;
  }
  if (!text.trim()) return fallback; // 空文件（上次写空/占位）当作没有
  try {
    return JSON.parse(text);
  } catch (e) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = file + ".corrupt-" + stamp;
    let saved = false;
    try { fs.writeFileSync(bak, text, "utf8"); saved = true; } catch {}
    dbg("corrupt json: " + file + " → " + (saved ? bak : "backup failed") + " (" + e.message + ")");
    recoveredFiles.push({ file: label || path.basename(file), backup: saved ? path.basename(bak) : "" });
    return fallback;
  }
}

/* 原子写的临时文件名必须**每次调用都唯一**。
   曾经两条链共用 `file.tmp-<pid>`：异步链正在往 tmp 里写时，退出路径的
   saveConfigSync() 用同一个名字同步写并 rename —— 同步的先把这个 tmp 移走，
   异步的 fd 于是对着"已经改名成了正式文件"的句柄继续写，内容交错 → 下次
   启动读到损坏的配置（.corrupt 备份 → 回退全默认），异步的 rename 还会
   ENOENT 凭空弹一条"配置 写入失败"。窗口小但真实。
   现在 tmp 名带自增序号，两条链永远撞不上。 */
let writeSeq = 0;
function tmpPathFor(file) {
  return file + ".tmp-" + process.pid + "-" + (++writeSeq);
}

function writeTextAtomicSync(file, text) {
  const tmp = tmpPathFor(file);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    reportWriteFail(file, e);
    return false;
  }
}

function writeTextAtomic(file, text) {
  const tmp = tmpPathFor(file);
  return fs.promises
    .mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, text, "utf8"))
    .then(() => fs.promises.rename(tmp, file))
    .then(() => true)
    .catch((e) => {
      try { fs.unlinkSync(tmp); } catch {}
      reportWriteFail(file, e);
      return false;
    });
}

/* 首帧后把启动期的坏文件/写失败一次性告诉用户（此前完全静默） */
function flushPersistenceNotes() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const send = (m) => { try { mainWin.webContents.send("chrome:toast", m); } catch {} };
  if (recoveredFiles.length) {
    const names = recoveredFiles.map((r) => r.file).join("、");
    const hasBak = recoveredFiles.some((r) => r.backup);
    send(names + " 内容已损坏，已" + (hasBak ? "备份并" : "") + "回退默认值");
  }
  if (writeFailPending) {
    send(writeFailPending);
    writeFailPending = "";
  }
}

const CONFIG_VERSION = 7;
/** @type {typeof DEFAULT_CONFIG & { configVersion: number, workspaces?: unknown }} */
let cfg = { ...DEFAULT_CONFIG };
function loadConfig() {
  const raw = readJsonSafe(configPath(), null, "配置");
  cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  // v1 → v2 迁移：旧版本默认把内容去色设在 0.8，是"页面灰蒙蒙"的来源，
  // 用户从未主动调过这个滑杆（原话就是抱怨发灰），因此重置为 0=保持原色。
  if (raw && (raw.configVersion || 1) < 2 && raw.contentDesat === 0.8) cfg.contentDesat = 0;
  // v3 → v4 迁移：逆天改运改成默认开（用户要"自动大吉"）。只补这一次，
  // 之后想关可以在设置里自己关掉，不会再被改回来。
  if (raw && (raw.configVersion || 1) < 4) cfg.luckyDay = true;
  if (raw && (raw.configVersion || 1) < 5) {
    // v4 → v5 迁移（v3.5.1 需求轮，全部是用户点名要的默认变化）：
    // 1) 启动不恢复上次标签——只开一个空的应用首页（想恢复去设置里开回来）；
    if (cfg.restoreTabs !== false) cfg.restoreTabs = false;
    // 2) "页面配色"三态撤掉：页面不再允许"原色"，始终跟随全应用统一主题
    //    （native 正是"里面一个颜色、外面一个颜色"的根因）；light/dark 老值保留；
    if (cfg.pageTheme === "native") cfg.pageTheme = "auto";
    // 3) 侧坞链接写全：/discuss → https://www.luogu.com.cn/discuss
    //    （@home/@ide 与站外 URL 不动；点击时全 URL 会解析回洛谷站内导航）；
    if (Array.isArray(cfg.dockItems)) {
      cfg.dockItems = cfg.dockItems.map((it) =>
        it && typeof it.href === "string" && it.href.charAt(0) === "/"
          ? { ...it, href: "https://www.luogu.com.cn" + it.href }
          : it
      );
    }
  }
  // v3.5.6 新键默认值：标签休眠 30 分钟（0=关）；紧凑模式默认关
  if (cfg.tabSleepMinutes == null || !isFinite(Number(cfg.tabSleepMinutes)) || Number(cfg.tabSleepMinutes) < 0) cfg.tabSleepMinutes = 30;
  if (cfg.vtabCompact == null) cfg.vtabCompact = false;
  if (cfg.bgThrottle == null) cfg.bgThrottle = true;
  if (cfg.memSleep == null) cfg.memSleep = true;
  if (!["auto", "left", "right", "top", "bottom"].includes(String(cfg.dockPos))) cfg.dockPos = "auto";
  /* R36：题目页工具条整块删除（用户要求）——旧配置里的 problemEditor 丢掉，
     不 delete 的话会被 saveConfig 一直写回去，成为一段看不见的死数据。 */
  if ("problemEditor" in cfg) delete cfg.problemEditor;
  // v5 → v6 迁移：两颗不透明度合并成一颗"面不透明度"。老配置里用户调过的
  // 卡片值优先（那是页面卡片的浓度），没调过就退栏值；此后栏、卡片、面板、
  // 内块全吃这一个值，内外不再有两种浓度。
  /* 判定必须看 **raw**（磁盘上的原始配置）而不是合并后的 cfg：
     DEFAULT_CONFIG 里若留着 cardAlpha/barAlpha，合并后 cfg.faceAlpha 永远
     非 null → 这段迁移成了死代码，老用户调过的浓度被静默重置。
     现在默认配置里已删掉那两把键，raw 有 faceAlpha 就用它，没有才回退。 */
  const rawFace = raw && typeof raw === "object" ? raw.faceAlpha : undefined;
  if (rawFace == null || !isFinite(Number(rawFace))) {
    const rawCard = raw && typeof raw === "object" ? raw.cardAlpha : undefined;
    const rawBar = raw && typeof raw === "object" ? raw.barAlpha : undefined;
    cfg.faceAlpha = rawCard != null && isFinite(Number(rawCard)) ? Number(rawCard)
      : rawBar != null && isFinite(Number(rawBar)) ? Number(rawBar)
      : 0.92;
  }
  cfg.faceAlpha = clampNum(cfg.faceAlpha, 0.3, 1, 0.92);
  /* 两把旧键到此为止：留在 cfg 里会被 saveConfig 一直写回去，成为永远清不掉的
     死数据（每个新装的用户都会带着它们）。 */
  if ("cardAlpha" in cfg) delete cfg.cardAlpha;
  if ("barAlpha" in cfg) delete cfg.barAlpha;
  /* v6 → v7 迁移：「工作区」功能整体删除（用户要求，配置里本来也是空的）。
     旧配置的 workspaces 字段在这里丢掉，配合下面的版本判定会落盘抹掉——
     不 delete 的话它会一直被 saveConfig 写回去，成为一段看不见的死数据。 */
  delete cfg.workspaces;
  cfg.configVersion = CONFIG_VERSION;
  /* 非法值回退后要**落盘**：否则每次启动都重新判一次非法、每次都记一条
     日志，用户那份坏配置还一直躺在文件里（进设置页看到的还是它）。 */
  const fixedCount = sanitizeConfig();
  if (fixedCount > 0) {
    try { saveConfigSync(); } catch (e) {}
  } else if (raw === null || raw.configVersion !== CONFIG_VERSION) {
    saveConfig();
  }
}

/* ---------- 配置 schema 校验（sanitize）----------
   配置被手改坏时（radius 写成 9999、uiScale 写成 0、某个开关写成字符串
   "true"），此前会一路流到渲染层才炸——最坏是渲染出一屏乱码，而且用户
   完全不知道为什么（设置里也看不出异常）。
   现在启动时按 src/config-schema.json 统一校验：类型不符或超范围 → 回退
   默认值，并记一条日志。

   schema **自动生成**（scripts/gen-config-schema.cjs）：范围取自设置页滑杆
   的 min/max，键名取自 bindSlider/ck 的绑定，类型与默认值取自
   DEFAULT_CONFIG。设置页改了范围，这里跟着变——不会出现"设置页能设的值
   被启动校验拒了"这种自相矛盾。

   注意：schema 只约束**有字面量默认值**的键（54 个）；数组/对象类的键
   （mappings、dockItems、homePrefs…）由各自的代码负责，不在这里管。 */
let configSchema = null;
try {
  configSchema = require(path.join(__dirname, "src", "config-schema.json"));
} catch (e) {
  configSchema = null;
}
function sanitizeConfig() {
  if (!configSchema || !configSchema.keys) return 0;
  const fixed = [];
  for (const [k, rule] of Object.entries(configSchema.keys)) {
    if (!(k in cfg)) continue;           // 缺键是"用默认值"的事，不归这里
    const v = cfg[k];
    if (v == null) continue;             // null 交给各处的默认值兜底
    if (rule.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) { cfg[k] = rule.def; fixed.push(k + "=" + v + "→" + rule.def); continue; }
      if (rule.min !== undefined && (n < rule.min || n > rule.max)) {
        cfg[k] = rule.def;
        fixed.push(k + "=" + n + "→" + rule.def);
        continue;
      }
      cfg[k] = n;
    } else if (rule.type === "boolean") {
      if (typeof v !== "boolean") { cfg[k] = rule.def; fixed.push(k + "=" + JSON.stringify(v) + "→" + rule.def); }
    } else if (rule.type === "enum") {
      if (!Array.isArray(rule.values) || !rule.values.includes(v)) {
        cfg[k] = rule.def;
        fixed.push(k + "=" + JSON.stringify(v) + "→" + rule.def);
      }
    } else if (rule.type === "string") {
      if (typeof v !== "string") { cfg[k] = rule.def; fixed.push(k + "=" + JSON.stringify(v) + "→" + rule.def); }
    }
  }
  if (fixed.length) {
    try { dbg("config sanitize 回退 " + fixed.length + " 个非法值: " + fixed.join(", ")); } catch {}
  }
  return fixed.length;
}
/* R41：落盘改异步（串行链防乱序）。此前每次 saveConfig 同步写整个配置——
   拖滑杆/换壁纸的热路径上是一次同步盘 IO。启动判定与退出补写仍走同步。 */
let saveConfigChain = Promise.resolve();
function saveConfig() {
  /* 异步串行链保留（R41 的"滑杆热路径不做同步盘 IO"）；写入走原子替换，
     失败由 reportWriteFail 统一发声（此前直接 writeFile + .catch(() => {})，
     磁盘满时改设置毫无反应）。 */
  const data = JSON.stringify(cfg, null, 2);
  saveConfigChain = saveConfigChain.then(() => writeTextAtomic(configPath(), data)).catch(() => {});
}
function saveConfigSync() {
  writeTextAtomicSync(configPath(), JSON.stringify(cfg, null, 2));
}

/* ---------- 账号账密库（本地独立文件，不与其它配置混放） ---------- */
const accountsPath = () => path.join(app.getPath("userData"), "accounts.json");
let accounts = [];
function loadAccounts() {
  const raw = readJsonSafe(accountsPath(), [], "账号库");
  accounts = Array.isArray(raw) ? raw : [];
}
function saveAccounts() {
  writeTextAtomicSync(accountsPath(), JSON.stringify(accounts, null, 2));
}
// 只暴露给渲染层的脱敏视图
function publicAccounts() {
  return accounts.map((a) => ({ id: a.id, email: a.email, name: a.name || "", addedAt: a.addedAt }));
}
/* 每个账号独立会话分区，互不串登录态 */
const acctPartition = (id) => "persist:acct-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_");
function acctSession(id) {
  const s = id ? session.fromPartition(acctPartition(id)) : session.defaultSession;
  wireDownloads(s);
  wireAdBlock(s);
  return s;
}
/* 站外共享分区：非洛谷的 http(s) 标签（DeepSeek 等）统一跑这里，与洛谷账号
   分区彻底隔开——切洛谷账号只换洛谷标签的分区，站外标签的登录态不受波及。
   （以前所有站点页都跑账号分区，切洛谷账号把 DeepSeek 拖进新分区=强制登出。） */
const SHARED_PARTITION = "persist:shared";
function sharedSession() {
  const s = session.fromPartition(SHARED_PARTITION);
  wireDownloads(s);
  wireAdBlock(s);
  return s;
}

/* ---------- 标签状态持久化（“恢复上次的标签”） ---------- */
const tabsStatePath = () => path.join(app.getPath("userData"), "tabs.json");
function saveTabsState() {
  try {
    // 分屏组按下标存：恢复时标签 id 全是新的，只有下标对得上
    const splitPairs = [];
    const seenGroups = new Set();
    for (let i = 0; i < tabOrder.length; i++) {
      const g = splits.get(tabOrder[i]);
      if (!g || seenGroups.has(g)) continue;
      seenGroups.add(g);
      const ids = g.ids.map((id) => tabOrder.indexOf(id)).filter((x) => x >= 0);
      if (ids.length >= 2) splitPairs.push({ ids, ratio: g.colRatio });
    }
    writeTextAtomicSync(
      tabsStatePath(),
      JSON.stringify({
        tabs: tabOrder.map((id) => {
          const t = tabs.get(id);
          return { url: t.url, special: !!t.special, kind: t.kind || null, pinned: !!t.pinned, title: t.title, group: t.groupId || null };
        }),
        activeIndex: Math.max(0, tabOrder.indexOf(activeTabId)),
        splits: splitPairs,
        groups: Array.from(tabGroups.values()).map((g) => ({ id: g.id, name: g.name, color: g.color, collapsed: !!g.collapsed })),
      })
    );
  } catch {}
}
let tabsSaveTimer = null;
function scheduleSaveTabs() {
  clearTimeout(tabsSaveTimer);
  tabsSaveTimer = setTimeout(() => { tabsSaveTimer = null; saveTabsState(); }, 700);
}
function loadTabsState() {
  const s = readJsonSafe(tabsStatePath(), null, "标签存档");
  if (s && Array.isArray(s.tabs) && s.tabs.length) return s;
  return null;
}

/* ---------- 窗口尺寸/位置记忆（window-state.json） ----------
   关窗时记普通尺寸与落点，开窗复原；最大化/全屏存的是还原后的尺寸
   （存最大化的边界会让下次启动"一开就是最大化且记不住普通尺寸"）。
   显示器拔插/改分辨率由 ensureOnScreen 兜底，所以这里不做屏幕校验。 */
const winStatePath = () => path.join(app.getPath("userData"), "window-state.json");
function loadWindowState() {
  const s = readJsonSafe(winStatePath(), null, "窗口位置");
  if (s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width >= 400 && s.height >= 300) return s;
  return null;
}
/* 纯函数：把存档折算成 BrowserWindow 的尺寸项（下限=窗口最小尺寸） */
function windowBoundsFor(ws) {
  const out = { width: 1440, height: 920 };
  if (!ws) return out;
  out.width = Math.max(980, Math.min(8000, Math.round(Number(ws.width) || 1440)));
  out.height = Math.max(640, Math.min(8000, Math.round(Number(ws.height) || 920)));
  if (Number.isFinite(ws.x) && Number.isFinite(ws.y)) {
    out.x = Math.round(ws.x);
    out.y = Math.round(ws.y);
  }
  return out;
}
function saveWindowState() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const b = mainWin.isMaximized() || mainWin.isFullScreen() ? mainWin.getNormalBounds() : mainWin.getBounds();
  writeTextAtomicSync(
    winStatePath(),
    JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWin.isMaximized() })
  );
}
let winSaveTimer = null;
function scheduleSaveWindowState() {
  clearTimeout(winSaveTimer);
  winSaveTimer = setTimeout(() => { winSaveTimer = null; saveWindowState(); }, 400);
}

/* ---------- 自测参数（argv 在文件顶部已解析） ---------- */
const selftestShot = (argv.find((a) => a.startsWith("--lg-selftest=")) || "").split("=").slice(1).join("=");
const configtest = argv.includes("--lg-configtest");
const dumpPromo = argv.includes("--lg-dump-promo");
const dumpLogin = argv.includes("--lg-dump-login");
const dumpIde = argv.includes("--lg-dump-ide");
const dumpTokens = argv.includes("--lg-dump-tokens");
const pageTest = argv.includes("--lg-pagetest");
const uiShot = argv.includes("--lg-uishot");
const glassTest = argv.includes("--lg-glasstest");
const dumpHome = argv.includes("--lg-dump-home");
const glassSrc = (argv.find((a) => a.startsWith("--lg-glass-src=")) || "").split("=").slice(1).join("=");
const autoLogin = argv.includes("--lg-autologin");
/* R42：持久化地基 / 假信息清理 / 材质守卫的验收探针 */
const v315test = argv.includes("--lg-v315test");
const argUser = (argv.find((a) => a.startsWith("--lg-user=")) || "").split("=").slice(1).join("=");
const argPass = (argv.find((a) => a.startsWith("--lg-pass=")) || "").split("=").slice(1).join("=");
const argCaptcha = (argv.find((a) => a.startsWith("--lg-captcha=")) || "").split("=").slice(1).join("=");
const START_URL = (argv.find((a) => a.startsWith("--lg-url=")) || "").split("=").slice(1).join("=") || HOME_URL;

let mainWin = null;

/* ---------- 注入素材（开发模式下会被热重载重读） ----------
   洛谷页吃完整的 INJECT_CSS；非洛谷页（应用本地页 / 站外映射页）只吃
   EXT_CSS —— 洛谷专属的清扫选择器对外部站没意义还可能误伤。JS 同一份，
   inject.js 自己按 hostname 分流。 */
/* 素材读取必须容错：热部署是"先拷 main.js、再拷 src/*"两步，主进程一被
   watch 就 relaunch，撞在中间态上会 ENOENT 直接起不来（实测崩过两次：
   src/material.css 还没拷到就重启）。缺文件时给空串，等下一次热更/重启补齐，
   绝不把启动打挂。 */
function readAsset(name) {
  try {
    return fs.readFileSync(path.join(__dirname, "src", name), "utf8");
  } catch (e) {
    try { dbg("readAsset " + name + " failed: " + e); } catch {}
    return "";
  }
}
let INJECT_CSS = readAsset("inject.css");
let EXT_CSS = readAsset("ext.css");
let MATERIAL_CSS = readAsset("material.css");
let COMMON_CSS = readAsset("common.css");
/* ---------- 注入层 JS：内核 + 能力模块 ----------
   src/inject.js 是内核（共享状态 window.__lgInjectCtx、apply() 主干、巡检、
   观察器、启动时序）；各项能力拆在 src/inject/<模块>.js，按下面这份清单拼成
   **一段**脚本一次 executeJavaScript 注入。拼装而不是逐个注入，是为了保住
   原来的时序：内核先建好 ctx，模块按序登记，最后一个登记完才启动
   （内核 bootInject）——等于旧文件一次执行到底，中间没有 await 让页面先跑一拍。
   清单顺序 = 依赖顺序（viewrect 被 wallpaper 调、selection 被 luogu-list 调）；
   内核的 EXPECTED 也是这同一份清单，少一个模块就永远等不到启动，宁可整层不注入
   也不在半装载状态下跑页面。清单与 src/inject/ 目录同处一地，加模块时两处一起改。 */
const INJECT_MODULES = ["viewrect.js", "wallpaper.js", "material.js", "reader.js", "translate.js", "selection.js", "luogu-list.js", "luogu-page.js"];
function injectBundle() {
  return [readAsset("inject.js")].concat(INJECT_MODULES.map((m) => readAsset("inject/" + m))).join("\n;\n");
}
let INJECT_JS = injectBundle();
function reloadInjectAssets() {
  try {
    INJECT_CSS = fs.readFileSync(path.join(__dirname, "src", "inject.css"), "utf8");
    EXT_CSS = fs.readFileSync(path.join(__dirname, "src", "ext.css"), "utf8");
    MATERIAL_CSS = fs.readFileSync(path.join(__dirname, "src", "material.css"), "utf8");
    COMMON_CSS = fs.readFileSync(path.join(__dirname, "src", "common.css"), "utf8");
    INJECT_JS = injectBundle();
    return true;
  } catch (e) {
    dbg("reloadInjectAssets failed: " + e);
    return false;
  }
}
/* 页面侧样式 = 材质文件 + 通用增强 + 站点样式，字节级同一份文本。
   材质（面配方 / 壁纸层 / 别名）只存在 material.css 这一个文件里，
   页面与外壳、弹层加载的是同一份内容——没有构建步骤，也就没有第二份拷贝。
   COMMON_CSS 是**站点无关**的那部分（阅读模式 / 整页翻译 / 代码复制 / 视口
   裁剪壳）：以前它们住在 inject.css 里，而 inject.css 只注入洛谷站，于是
   站外页触发这些能力时建出的是一堆没样式的裸元素。现在无条件拼上。 */
function stylesFor(ext) {
  return MATERIAL_CSS + "\n" + COMMON_CSS + "\n" + (ext ? EXT_CSS : INJECT_CSS);
}

/* ============================================================
   开发模式（--lg-dev）：热应用迭代——改完即见，不手动 sync、不手动重启。
   监听**工作区源码**（--lg-watchsrc 指向工作区 src；不传退回 __dirname/src），
   按文件类型分四档热度：
     inject.css / ext.css  → 真·热应用：换样式表 + apply，页面不刷新（样式迭代秒见）
     inject.js             → 重读素材 + 重灌全部页面（JS 要换运行时，必须刷新）
     chrome/*              → 只刷外壳（页面不动）
     settings/home/history/* → 只刷对应 kind 的标签页
     popup/*               → 刷弹层视图
     main.js / preload-*.js → 拷回 dev 目录后自动重启（热不了的只有这两类）
   ============================================================ */
let devMode = argv.includes("--lg-dev");
let devWatchSrc = (argv.find((a) => a.startsWith("--lg-watchsrc=")) || "").split("=").slice(1).join("=");
/* 常驻热部署：resources/hot-apply.txt 存在时自动进入热应用模式——部署版跑散文件
   （resources/app），改源码即热生效，不必重打 asar、不必加启动参数。
   文件第一行 = 工作区 src 路径；第二行可选 = CDP 调试端口（验证/排障用）。
   标记缺失或路径失效时回落为普通静态运行。 */
if (!devMode) {
  try {
    const marker = path.join(process.resourcesPath || "", "hot-apply.txt");
    if (fs.existsSync(marker)) {
      const lines = fs.readFileSync(marker, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (lines[0] && fs.existsSync(lines[0])) {
        devMode = true;
        devWatchSrc = lines[0];
      }
      if (lines[1] && /^\d+$/.test(lines[1])) app.commandLine.appendSwitch("remote-debugging-port", lines[1]);
    }
  } catch {}
}
function startDevWatch() {
  if (!devMode) return;
  const SRC = devWatchSrc && fs.existsSync(devWatchSrc) ? devWatchSrc : path.join(__dirname, "src");
  const ROOT = path.dirname(SRC); // 工作区根（main.js / preload-*.js 在这层）
  const deb = new Map(); // 每组一个去抖定时器
  const kick = (key, fn, ms = 150) => {
    clearTimeout(deb.get(key));
    deb.set(key, setTimeout(() => { try { fn(); } catch (e) { dbg("[dev] " + key + " failed: " + e); } }, ms));
  };
  const watchDir = (dir, name, fn) => {
    try { fs.watch(dir, { recursive: true }, () => kick(name, fn)); dbg("[dev] watch " + name + " ← " + dir); }
    catch (e) { dbg("[dev] watch " + name + " failed: " + e); }
  };

  /* 真·热应用：样式表整表换（remove+insert），再补一次 apply——页面不刷新，
     滚动位置/输入状态/视频播放全保留，调玻璃/壁纸/圆角秒见 */
  const hotSwapCss = async () => {
    if (!reloadInjectAssets()) return;
    for (const t of tabs.values()) {
      const wc = t.view.webContents;
      if (wc.isDestroyed() || !wc.__lgInjected) continue;
      try {
        let ext = false;
        try { ext = !LUOGU_HOST_RE.test(hostOf(wc.getURL())); } catch {}
        if (wc.__lgCssKey) { try { await wc.removeInsertedCSS(wc.__lgCssKey); } catch {} }
        wc.__lgCssKey = await wc.insertCSS(stylesFor(ext), { cssOrigin: "author" });
        wc.executeJavaScript(
          `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify(cfgForPages())})`,
          true
        ).catch(() => {});
      } catch {}
    }
    dbg("[dev] css hot-swapped (" + tabs.size + " tabs)");
  };
  const reloadPages = () => {
    reloadInjectAssets();
    for (const t of tabs.values()) {
      try { t.view.webContents.reloadIgnoringCache(); } catch {}
    }
    if (drawerView) {
      try { drawerView.webContents.reloadIgnoringCache(); } catch {}
    }
    dbg("[dev] pages reloaded (" + tabs.size + ")");
  };
  const reloadShell = () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.reloadIgnoringCache();
      dbg("[dev] shell reloaded");
    }
  };
  const reloadKind = (kind) => () => {
    let n = 0;
    for (const t of tabs.values()) {
      if (t.kind === kind) {
        try { t.view.webContents.reloadIgnoringCache(); n++; } catch {}
      }
    }
    dbg("[dev] " + kind + " tabs reloaded (" + n + ")");
  };
  /* main.js / preload 热不了：从工作区拷回 dev 目录（自同步），然后自动重启。
     relaunch 保留原 argv（--lg-dev/--lg-watchsrc/--lg-userdata 都在） */
  const syncAndRelaunch = (files) => {
    for (const f of files) {
      try { fs.copyFileSync(path.join(ROOT, f), path.join(__dirname, f)); dbg("[dev] synced " + f); }
      catch (e) { dbg("[dev] sync " + f + " failed: " + e); }
    }
    dbg("[dev] relaunching…");
    app.relaunch();
    app.exit(0);
  };

  watchDir(path.join(SRC, "chrome"), "shell", reloadShell);
  watchDir(path.join(SRC, "settings"), "settings", reloadKind("settings"));
  watchDir(path.join(SRC, "home"), "home", reloadKind("home"));
  watchDir(path.join(SRC, "history"), "history", reloadKind("history"));
  watchDir(path.join(SRC, "popup"), "popup", () => {
    if (popupView && !popupView.webContents.isDestroyed()) {
      try { popupView.webContents.reloadIgnoringCache(); } catch {}
      dbg("[dev] popup reloaded");
    }
  });
  watchDir(path.join(SRC, "dock"), "dock", () => {
    if (dockView && !dockView.webContents.isDestroyed()) {
      try { dockView.webContents.reloadIgnoringCache(); } catch {}
      dbg("[dev] dock reloaded");
    }
  });
  try {
    fs.watch(SRC, (_ev, name) => {
      if (!name) return;
      if (/^inject\.css$/i.test(name) || /^ext\.css$/i.test(name) || /^material\.css$/i.test(name)) kick("css", hotSwapCss);
      else if (/^inject\.js$/i.test(name)) kick("pages", reloadPages);
    });
  } catch (e) { dbg("[dev] watch src root failed: " + e); }
  /* 注入层能力模块（src/inject/*.js）：与 inject.js 同档——改的是运行时，必须
     重灌全部页面（reloadPages 内部会先 reloadInjectAssets 重读整份素材）。 */
  watchDir(path.join(SRC, "inject"), "pages", reloadPages);
  if (ROOT !== __dirname) {
    try {
      fs.watch(ROOT, (_ev, name) => {
        if (!name) return;
        if (/^main\.js$/i.test(name)) kick("relaunch", () => syncAndRelaunch(["main.js"]), 400);
        else if (/^preload-.*\.js$/i.test(name)) kick("relaunch", () => syncAndRelaunch([String(name)]), 400);
      });
      dbg("[dev] watch root ← " + ROOT);
    } catch (e) { dbg("[dev] watch root failed: " + e); }
  }
  dbg("[dev] hot-apply watching " + SRC);
}

/* 原生主题嗅探（R37 重写）：只认"真实不透明的底色"。
   老版直接读 .theme-page/.main-container 的 backgroundColor，而这两条容器被
   inject.css 无条件压成透明（骨架露背景层），正则命中 rgba(0,0,0,0) → 亮度 0
   → 判成 dark：页面有没有这些容器决定整机"有时黑有时白"（用户报的"有的时候
   会突然出现变成了黑夜模式"）。新版：跳过 alpha<0.9 的层、沿选择器链找第一个
   不透明底色、都找不到返回 'unknown'（主进程只在明确 dark/light 时才更新）；
   并且改到 insertCSS **之前**执行——那时站点自己的底色还没被我们压透明。 */
const SNIFFER = `(function(){
  try {
    var L = function (c) {
      var m = c && c.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)/);
      if (!m) return null;
      var a = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (!(a >= 0.9)) return null;
      return (0.2126 * (+m[1]) + 0.7152 * (+m[2]) + 0.0722 * (+m[3])) / 255;
    };
    var sels = ['.theme-page', '.main-container', 'main', '#app', 'body', 'html'];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (!el) continue;
      var v = L(getComputedStyle(el).backgroundColor);
      if (v !== null) { window.__lgNativeTheme = v < 0.5 ? 'dark' : 'light'; return window.__lgNativeTheme; }
    }
    window.__lgNativeTheme = 'unknown';
  } catch (e) { window.__lgNativeTheme = 'unknown'; }
  return window.__lgNativeTheme;
})()`;

async function injectInto(wc) {
  try {
    // 非洛谷页只注入精简样式（壁纸玻璃层）；洛谷页吃全量。
    // CSS 是"每个文档一份"的：主框架一换文档（站点版本更新后的自刷新、二次
    // loadURL、首个 about:blank 的 dom-ready 抢先插过一次），旧样式表随旧文档
    // 一起消失。以前用布尔标记"插过就不再插"，换文档后新页面永远拿不到样式表——
    // 表现是整页没注入：原生顶栏还在、body 不透明、壁纸层没有几何（用户报的
    // "无法正常变透明"；站点自刷新在 Electron 里报 isInPlace=true，靠导航事件
    // 复位也不可靠）。现在每次注入先撤掉上一张再插一张：同一文档里重复调用不会
    // 堆叠，换了文档也能保证有样式（旧 key 在新文档里 remove 是空操作）。
    let ext = false;
    try { ext = !LUOGU_HOST_RE.test(hostOf(wc.getURL())); } catch {}
    if (wc.__lgCssKey) {
      try { await wc.removeInsertedCSS(wc.__lgCssKey); } catch {}
      wc.__lgCssKey = null;
    }
    try {
      wc.__lgCssKey = await wc.insertCSS(stylesFor(ext), { cssOrigin: "author" });
    } catch (e) { dbg("insertCSS failed: " + e); }
    /* 原生主题嗅探在插入样式表**之前**（R37，顺序是修 bug 的一半）：注入后
       inject.css 会把骨架容器压成透明，探针采到 rgba(0,0,0,0) → 判成 dark。
       IDE 页原生就是深色、不代表整机主题，不参与判定（一开 IDE 全应用变黑
       就是这条）。 */
    let idePage = false;
    try { idePage = /\/ide(\/|$)/.test(new URL(wc.getURL()).pathname); } catch {}
    if (!idePage) {
      try { await wc.executeJavaScript(SNIFFER, true); } catch {}
    }
    await wc.executeJavaScript(INJECT_JS, true);
    // tabActive 按标签给：视频壁纸只让前台那份解码，页面自己判断不了前后台
    let isActive = true;
    for (const [tid, t] of tabs) {
      /* t.view 可能是 null：标签被休眠时（makeSleeping 置空）会走到这里。
         不判空 → TypeError 冒泡到本函数最外层的 catch，抛错点恰好在下面
         apply() 之前 —— 于是这一页这次拿不到主题/壁纸/材质，__lgInjected
         也不置位（每次加载都重跑全量注入，首屏闪一下）。
         memSleep 默认开、tabSleep 默认 30 分钟，用户自己就能踩到。
         正确的判空范式在同文件 1704 行（!t || !t.view || ...isDestroyed()）。 */
      if (!t.view) continue;
      if (t.view.webContents === wc) { isActive = tid === activeTabId; break; }
    }
    await wc.executeJavaScript(
      `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify(cfgForPages())})`,
      true
    );
    // 播放状态只由 setTabActive 决定（apply 不再碰），页面加载完必须补一次，
    // 否则新开的标签不会开始播、后台标签也不会停
    await wc.executeJavaScript(
      `window.__lgGlass && window.__lgGlass.setTabActive && window.__lgGlass.setTabActive(${isActive ? "true" : "false"})`,
      true
    ).catch(() => {});
    /* 换文档后页面丢掉了上次的视图矩形：这里补推一次（否则壁纸层要等下一次
       layout 才和外壳对齐——首屏在分屏/抽屉下会错位） */
    for (const [, tt] of tabs) {
      if (!tt.view) continue; // 同上：休眠标签的 view 是 null
      if (tt.view.webContents === wc) { pushViewRect(tt, true); break; }
    }
    // 本文档已完整注入：did-finish-load 只补轻量 apply，不再拔插 CSS
    // （以前两个事件各跑一遍完整流程，CSS 重插两次、apply 两次，是首屏
    // "先原生/半玻璃再闪一次"的来源）。did-start-loading 时复位。
    wc.__lgInjected = true;
  } catch (e) {
    dbg("injectInto failed: " + (e && e.message ? e.message : String(e)));
    console.error("inject failed:", e);
  }
}

/* ============================================================
   标签页管理（WebContentsView）
   ============================================================ */
const tabs = new Map(); // id -> { view, title, url, special }
let tabOrder = [];
let activeTabId = null;
let tabSeq = 0;
let lastNative = "light";

const INSET = { x: 58, y: 78, footer: 0 };
/* 垂直模式顶栏两行（38 标题行 + 42 工具行 = 80）：页面让位的 y 与 chrome.css
   的 --header-h 是同一个常数（改一处必须改另一处，探针有断言）。 */
const VHEAD_H = 80;
/* 垂直标签栏（Edge 式）：展开宽度 / 折叠窄条宽度。折叠状态持久化在
   cfg.vtabCollapsed（默认收缩成窄条；以前只存内存，重启就丢）。
   紧凑模式（Zen Compact，cfg.vtabCompact）：侧栏整个收没，只留 4px
   热区条——鼠标贴上左缘浮出完整侧栏（走弹出层浮层），页面近似全宽。 */
const VTAB_W = 212;
const VTAB_RAIL = 46;
const VTAB_EDGE = 4;
/* 常驻展开宽度可拖（Edge）：160~400 夹取，落在 cfg.vtabWidth。
   折叠窄条与紧凑热区是固定值，不受它影响。 */
const VTAB_MIN_W = 160;
const VTAB_MAX_W = 400;
const vtabExpandedW = () => {
  const n = Number(cfg.vtabWidth);
  return Math.round(Math.min(VTAB_MAX_W, Math.max(VTAB_MIN_W, Number.isFinite(n) && n > 0 ? n : VTAB_W)));
};
const vtabW = () => {
  if (cfg.vtabCompact) return VTAB_EDGE;
  return cfg.vtabCollapsed === false ? vtabExpandedW() : VTAB_RAIL;
};

/* 侧坞（R36：独立覆盖视图 src/dock/）：坞不再让页面让位——页面内容从它底下
   穿过，坞只是一条悬浮在页面之上的栏。落位在主进程 dockBounds()（四位置
   各留 6px 边距），这里只剩"坞在哪一边"这一个语义。 */
const dockHasItems = () => Array.isArray(cfg.dockItems) && cfg.dockItems.some((it) => it && it.href);

/* 坞的位置：auto=跟随布局（水平左侧 / 垂直底部），其余四值即字面位置。
   外壳渲染（body[data-dock] 决定横/竖排形态）与坞视图落位共用这一个值。 */
function dockPos() {
  const p = String(cfg.dockPos || "auto");
  if (p === "left" || p === "right" || p === "top" || p === "bottom") return p;
  return cfg.verticalTabs ? "bottom" : "left";
}
/* 侧栏分界线（外壳顶栏的 left、右侧模式的 right）：只算侧栏那一条。 */
const vtabBoundary = () => (cfg.verticalTabs ? vtabW() : 0);

/* 页面视图的可用矩形：垂直模式把左侧让给标签栏、顶部留工具行。坞不再占边
   （R36）：页面全幅延伸到坞底下（坞浮在页面之上，内容从它底下穿过）。 */
/* 侧栏所在侧（Edge 左/右）：页面 inset 的 x / right 是唯一几何来源 */
const vtabSide = () => (cfg.vtabSide === "right" ? "right" : "left");
function inset() {
  if (cfg.verticalTabs) {
    const w = vtabW();
    const right = vtabSide() === "right";
    return { x: right ? 0 : w, right: right ? w : 0, y: VHEAD_H, footer: 0 };
  }
  // 水平布局：历史值 2px 的缝（以前坞在左侧时是 56+2=58）
  return { x: 2, right: 0, y: INSET.y, footer: 0 };
}

function normalizeUrl(u) {
  try {
    return new URL(u, HOME_URL).href;
  } catch {
    return HOME_URL;
  }
}

/* 题目页分屏编辑器：右侧一块独立的 WebContentsView（直接放洛谷 /ide，
   比 iframe 可靠——站点响应头不允许被嵌入）。 */
let drawerView = null;
let drawerOpen = false;

/* 把视图在窗口里的真实矩形下发给页面：壁纸层要按"整个窗口的几何"摆放
   （负的视图偏移 + 窗口宽高），才能和外壳那层壁纸严丝合缝。分屏/IDE 抽屉/
   底部坞都会让视图不再贴满右下，猜的几何立刻错（用户报的 dock 错位）。
   页面每次换文档（导航/刷新/热重载）都会丢掉收到的矩形，所以 injectInto
   完成后再强制推一次（force），否则首屏要等下一次 layout 才对齐。 */
function pushViewRect(t, force) {
  if (!t || !t.view || !mainWin || mainWin.isDestroyed()) return;
  try {
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return;
    const [w, h] = mainWin.getContentSize();
    const b = t.view.getBounds();
    /* 页面缩放系数一起下发：页面侧的壁纸层要按它反向补偿（缩放页面时背景
       不跟着放大/位移——CSS px 会被页面缩放放大，除以 z 就回到窗口几何）。 */
    let z = 1;
    try { z = wc.getZoomFactor() || 1; } catch {}
    const vr = b.x + "," + b.y + "," + w + "," + h + "," + z;
    if (!force && t._vr === vr) return;
    t._vr = vr;
    wc.executeJavaScript(
      `window.__lgGlass && window.__lgGlass.setViewRect && window.__lgGlass.setViewRect(${JSON.stringify({ x: b.x, y: b.y, w, h, z })})`,
      true
    ).catch(() => {});
  } catch {}
}

function layout() {
  if (!mainWin || mainWin.isDestroyed()) return;
  /* 全屏/IDE 标志的存活校验（R39）：标签已关/已销毁时清掉。以前只有
     leave-html-full-screen 事件清，标签在全屏时被关掉 → 坞永久隐藏、
     视图卡在全窗（"东西不见了"的一条）。 */
  if (htmlFullscreenTabId != null && !tabs.has(htmlFullscreenTabId)) htmlFullscreenTabId = null;
  if (inPageIdeTabId != null && !tabs.has(inPageIdeTabId)) inPageIdeTabId = null;
  const [w, h] = mainWin.getContentSize();
  const ins = inset();
  const fullW = Math.max(1, w - ins.x - (ins.right || 0));
  const fullH = Math.max(1, h - ins.y - (ins.footer || 0));
  /* 题目页自带 IDE 模式（R38）：活动标签铺满整窗，分屏与抽屉一起挂起 */
  const ideFull = inPageIdeFull(activeTabId) && tabs.has(activeTabId);
  const drawerW = !ideFull && drawerOpen && drawerView ? Math.round(fullW * 0.52) : 0;
  const tabW = Math.max(1, fullW - drawerW);
  /* 分屏拼合：活动标签所在组的窗格几何按 splitPanes 排（IDE 抽屉优先，
     抽屉开着分屏暂时挂起）。焦点在窗格间移动只换 activeTabId，几何不变。 */
  const grp = !drawerW && !ideFull && activeTabId != null ? splitGroupOf(activeTabId) : null;
  const paneMap = new Map();
  if (grp) {
    for (const p of splitPanes(grp, tabW, fullH).panes) {
      if (tabs.has(p.id)) paneMap.set(p.id, { x: ins.x + p.x, y: ins.y + p.y, width: Math.max(1, p.w), height: Math.max(1, p.h) });
    }
  }
  for (const [tid, t] of tabs) {
    if (!t.view) continue; // 休眠标签没有视图，等唤醒时再由 layout 摆位
    /* 网页 HTML 全屏（视频）与题目页自带 IDE 模式：该标签视图落整窗——
       外壳（标签条/地址栏/侧栏）与坞都被让开，页面盖满整窗 = 真·全屏 */
    const fullWin = tid === htmlFullscreenTabId || (ideFull && tid === inPageIdeTabId);
    const b = fullWin
      ? { x: 0, y: 0, width: Math.max(1, w), height: Math.max(1, h) }
      : (paneMap.get(tid) || { x: ins.x, y: ins.y, width: tabW, height: fullH });
    try {
      t.view.setBounds(b);
    } catch {}
    pushViewRect(t);
  }
  if (drawerView) {
    try {
      drawerView.setBounds({
        x: ins.x + tabW,
        y: ins.y,
        width: Math.max(1, fullW - tabW),
        height: fullH,
      });
      drawerView.setVisible(drawerOpen && !ideFull);
    } catch {}
  }
  if (popupView) {
    // 菜单开着铺满全窗口
    syncPopupBounds();
  }
  if (glanceView) {
    // 速览卡片跟随窗口尺寸居中
    try { glanceView.setBounds(glanceRect()); } catch {}
    try { mainWin.webContents.send("chrome:glance-rect", { rect: glanceRect() }); } catch {}
  }
  layoutDock();
  pushSplit();
  applyThrottlePolicy();
}

/* ============================================================
   分屏（R39 起只做左右两格，1:1 Chromium 开源 split tab 的 side-by-side）
   splits：tabId → 对对象（两格共享同一引用）：{ ids:[左, 右], colRatio }
   colRatio = 左格占可用宽的比（0.15~0.85），一条竖缝独占这个字段。
   两格在 tabOrder 里必须相邻（makeSplitContiguous），且 moveTabInOrder 会把
   "插到两格之间"的落点吸附到对块外侧（Chromium IsValidInsertionIndex 同款）。
   一个标签同时只在一个分屏里；关掉任意一格 = 分屏解散、幸存那格回全宽。
   窗格之间留 SPLIT_GAP 的缝：缝里没有被任何视图覆盖，外壳的分割条元素直接
   收鼠标事件（不用占用弹出层）。
   ============================================================ */
const splits = new Map(); // tabId -> group
const SPLIT_GAP = 6;
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;
/* R39：分屏只做**左右两格**（对齐 Chromium 开源 split tab 的 side-by-side）。
   一个标签同时只在一个分屏里；两格在标签条里必须相邻，且禁止把别的标签插到
   两格中间（Chromium TabDragContextImpl::IsValidInsertionIndex 同款规则）。
   旧的 3/4 窗格与布局/聚焦模式整支删除。 */

function splitGroupOf(id) {
  const g = id != null ? splits.get(id) : null;
  return g && g.ids.length > 1 ? g : null;
}
/* 把一对分屏在 tabOrder 里排到相邻（Chromium AddToNewSplit："Reorders the tabs
   so they are contiguous"）。钉住标签在独立前缀里，不参与这条约束。 */
function makeSplitContiguous(g) {
  const [a, b] = g.ids;
  if (!tabs.has(a) || !tabs.has(b)) return;
  const ta = tabs.get(a);
  const tb = tabs.get(b);
  if (ta.pinned || tb.pinned) return;
  const i = tabOrder.indexOf(a);
  const j = tabOrder.indexOf(b);
  if (i < 0 || j < 0 || j === i + 1) return;
  const rest = tabOrder.filter((id) => id !== b);
  const k = rest.indexOf(a);
  if (k < 0) return;
  rest.splice(k + 1, 0, b);
  tabOrder = rest;
}
function unsplitSilent(id) {
  const g = splits.get(id);
  if (!g) return false;
  g.ids = g.ids.filter((x) => x !== id);
  splits.delete(id);
  // 只剩 1 人不成组：幸存的标签回到单栏全宽
  if (g.ids.length <= 1) for (const m of g.ids) splits.delete(m);
  return true;
}
function unsplit(id) {
  if (id == null || !unsplitSilent(id)) return false;
  // 重算可见性与几何：退出的成员可能还亮着盖在幸存组的窗格上
  if (activeTabId != null && tabs.has(activeTabId)) setActiveTab(activeTabId);
  else {
    layout();
    pushTabs();
    scheduleSaveTabs();
  }
  return true;
}
/* 结成一对左右分屏（Chromium AddToNewSplit 同款：已在别的分屏里的标签先移出，
   然后两格排到相邻、激活发起者） */
function splitWith(a, b) {
  if (a == null || b == null || a === b || !tabs.has(a) || !tabs.has(b)) return false;
  unsplitSilent(a);
  unsplitSilent(b);
  const g = { ids: [a, b], colRatio: 0.5 };
  splits.set(a, g);
  splits.set(b, g);
  makeSplitContiguous(g);
  setActiveTab(a); // 激活发起者：整组同时点亮（可见性 = 全组成员）
  scheduleSaveTabs();
  return true;
}
/* 拖比例：只有一根竖缝（colRatio）；null = 双击复位均分 */
function setSplitRatio(id, ratio, field) {
  const g = splitGroupOf(id);
  if (!g) return;
  if (ratio == null || !isFinite(Number(ratio))) g.colRatio = 0.5;
  else g.colRatio = clampNum(Number(ratio), RATIO_MIN, RATIO_MAX, 0.5);
  layout(); // 内含 pushSplit
  scheduleSaveTabs();
}
/* 关闭左格 / 右格（Chromium split_tab_menu_model 的 kCloseStartTab/kCloseEndTab）：
   关掉一格后分屏自然解散，剩下那格回到全宽 */
function closeSplitSide(id, side) {
  const g = splitGroupOf(id);
  if (!g) return false;
  const target = side === "left" ? g.ids[0] : g.ids[1];
  if (target == null || !tabs.has(target)) return false;
  closeTab(target);
  return true;
}
/* 反转左右位置（Chromium kReversePosition）：交换两格并保持各自当前宽度 */
function reverseSplit(id) {
  const g = splitGroupOf(id);
  if (!g) return false;
  g.ids = [g.ids[1], g.ids[0]];
  g.colRatio = clampNum(1 - g.colRatio, RATIO_MIN, RATIO_MAX, 0.5);
  if (activeTabId != null && tabs.has(activeTabId)) setActiveTab(activeTabId);
  else layout();
  pushTabs();
  scheduleSaveTabs();
  return true;
}

/* 沿一根轴把 len 切成 segs.length+1 块：segs[i] = { field, ratio }，语义是
   "第 i 块占剩余可分配量的 ratio"。返回 sizes 与每道缝的条几何
   （off=条坐标，base/span 供外壳把指针位置换算回比例）。 */
function splitAxis(len, segs) {
  const n = segs.length + 1;
  const usable = Math.max(n, len - SPLIT_GAP * (n - 1));
  const sizes = [];
  const bars = [];
  let rest = usable;
  let off = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      sizes.push(Math.max(1, rest));
      break;
    }
    const r = clampNum(segs[i].ratio, RATIO_MIN, RATIO_MAX, 1 / (n - i));
    const s = Math.max(1, Math.round(rest * r));
    sizes.push(s);
    bars.push({ field: segs[i].field, off: off + s, base: off, span: rest });
    rest -= s;
    off += s + SPLIT_GAP;
  }
  return { sizes, bars };
}

/* 组的窗格几何（相对标签区左上角）：只做左右两格（Chromium side-by-side）。
   返回 { panes:[{id,x,y,w,h}], bars:[一根竖缝] }；比例语义 = 左格占可用宽的比。 */
function splitPanes(g, tabW, fullH) {
  const [a, b] = g.ids;
  const ax = splitAxis(tabW, [{ field: "colRatio", ratio: g.colRatio }]);
  const panes = [
    { id: a, x: 0, y: 0, w: ax.sizes[0], h: fullH },
    { id: b, x: ax.sizes[0] + SPLIT_GAP, y: 0, w: ax.sizes[1], h: fullH },
  ];
  const bars = [{
    field: "colRatio", vertical: true, invert: false,
    x: ax.bars[0].off, y: 0, w: SPLIT_GAP, h: fullH,
    base: ax.bars[0].base, span: ax.bars[0].span,
  }];
  return { panes, bars };
}

/* 分割条的几何（外壳按它摆分割条池并换算拖拽比例）；分屏未激活/被抽屉挂起时为
   null。R39 起只有一根竖缝（左右分屏），invert 恒 false。 */
function splitRect() {
  if (!mainWin || mainWin.isDestroyed()) return null;
  if (drawerOpen && drawerView) return null;
  if (inPageIdeFull(activeTabId)) return null; // 题目页 IDE 全屏：分割条收掉
  const g = activeTabId != null ? splitGroupOf(activeTabId) : null;
  if (!g) return null;
  const [w, h] = mainWin.getContentSize();
  const ins = inset();
  const fullW = Math.max(1, w - ins.x - (ins.right || 0));
  const fullH = Math.max(1, h - ins.y - (ins.footer || 0));
  const res = splitPanes(g, fullW, fullH);
  return {
    bars: res.bars.map((bb) => ({
      field: bb.field,
      vertical: bb.vertical,
      invert: bb.invert,
      x: ins.x + bb.x,
      y: ins.y + bb.y,
      w: bb.w,
      h: bb.h,
      base: bb.base + (bb.vertical ? ins.x : ins.y),
      span: bb.span,
    })),
  };
}
function pushSplit() {
  if (mainWin && !mainWin.isDestroyed()) {
    try {
      mainWin.webContents.send("chrome:split", splitRect());
    } catch {}
  }
}

/* ============================================================
   Glance 链接速览（Zen 式）：Alt+点击链接 → 居中卡片预览，不离开当前页。
   卡片是独立 WebContentsView（会话分区规则与开标签一致）；遮罩与标题栏
   走弹出层（外壳 chrome:glance 渲染，按钮回传 glance-open/close）。
   Esc / 点遮罩 / 点关闭都收掉视图；「在标签页打开」转正成普通标签。
   ============================================================ */
let glanceView = null;
let glanceUrl = "";
function glanceRect() {
  const [w, h] = mainWin.getContentSize();
  const gw = Math.round(Math.min(w * 0.68, w - 48));
  const gh = Math.round(Math.min(h * 0.8, h - 48));
  return { x: Math.round((w - gw) / 2), y: Math.round((h - gh) / 2), width: gw, height: gh };
}
function openGlance(url) {
  if (!mainWin || mainWin.isDestroyed() || !/^https?:\/\//i.test(String(url || ""))) return false;
  closeGlance();
  glanceUrl = String(url);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      session: isAllowed(glanceUrl) ? acctSession(cfg.activeAccountId) : sharedSession(),
      preload: path.join(__dirname, "preload-page.js"),
    },
  });
  try { view.setBackgroundColor("#f7f7f8"); } catch {}
  mainWin.contentView.addChildView(view);
  glanceView = view;
  try { view.setBounds(glanceRect()); } catch {}
  if (!isAllowed(glanceUrl)) {
    try { view.webContents.setUserAgent(chromeLikeUA()); } catch {}
  }
  view.webContents.loadURL(glanceUrl).catch(() => {});
  raisePopup(); // 卡片压在站点视图之上、弹出层之下
  // 外壳画速览壳（遮罩 + 标题栏按钮），几何与地址一并下发
  try { mainWin.webContents.send("chrome:glance", { url: glanceUrl, rect: glanceRect() }); } catch {}
  return true;
}
/* 视图销毁但地址留着：弹出层 pick 的时序是"先关弹层、键才到外壳"，
   转正动作晚于关闭发生，地址得活到那一刻 */
function closeGlance() {
  if (!glanceView) return;
  try { mainWin.contentView.removeChildView(glanceView); glanceView.webContents.close(); } catch {}
  glanceView = null;
}

/* ============================================================
   坞覆盖视图（R36）
   坞从外壳层搬到独立覆盖视图：页面内容从它底下穿过（不再让位），坞只是一条
   悬浮在页面之上的栏。外壳仍是渲染者（dock:sync 推 HTML + 整套主题变量），
   这一层负责：落位（四位置居中、离页面区 6px）、显隐（网页全屏时隐藏）、
   点击（dockTargetOf 映射，与旧的外壳 dockTarget 逐条一致）。
   栈序：页面视图 < 坞 < 弹层（raisePopup 里一并把坞抬回）。
   ============================================================ */
let dockView = null;
let dockReady = false;
let dockSyncPayload = null;       // 外壳最近一份 HTML/主题：did-finish-load 后补发
let dockCapsule = { w: 0, h: 0 }; // 坞视图上报的胶囊尺寸
let dockShown = false;            // 视图当前可见（raisePopup 里据此重挂）
let htmlFullscreenTabId = null;   // 正处在网页 HTML 全屏的标签：坞隐藏、视图落整窗
/* 题目页自带 IDE 模式（洛谷题目页的「进入 IDE 模式」）：R38 用户要求"IDE 状态
   要真·全屏"。活动标签的页面视图铺满整窗（外壳的标签条/地址栏/侧栏整条让位）、
   坞隐藏、分屏与抽屉挂起；页面里点「退出 IDE 模式」或切走标签即恢复。 */
let inPageIdeTabId = null;
function inPageIdeFull(id) {
  return id != null && inPageIdeTabId != null && inPageIdeTabId === id;
}

function ensureDockView() {
  if (dockView) return dockView;
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload-dock.js"),
    },
  });
  try { v.setBackgroundColor("#00000000"); } catch {}
  try { mainWin.contentView.addChildView(v); } catch {}
  try { v.setVisible(false); } catch {}
  dockView = v;
  v.webContents.loadFile(path.join(__dirname, "src", "dock", "dock.html"));
  v.webContents.on("did-finish-load", () => {
    dockReady = true;
    if (dockSyncPayload) {
      try { v.webContents.send("dock:sync", dockSyncPayload); } catch {}
    }
    layoutDock();
  });
  return v;
}

/* 坞胶囊在页面区里的落位：四种位置各自居中、离页面区边缘 6px（M）。
   坞不再让位（页面内容从它底下穿过），可用矩形就是 inset()。 */
function dockBounds() {
  if (!mainWin || mainWin.isDestroyed()) return null;
  if (!dockCapsule.w || !dockCapsule.h) return null;
  const [w, h] = mainWin.getContentSize();
  const ins = inset();
  const availX = ins.x;
  const availW = Math.max(0, w - ins.x - (ins.right || 0));
  const availY = ins.y;
  const availH = Math.max(0, h - ins.y - (ins.footer || 0));
  const M = 6;
  const p = dockPos();
  let x;
  let y;
  if (p === "left") {
    x = availX + M;
    y = availY + Math.round((availH - dockCapsule.h) / 2);
  } else if (p === "right") {
    x = availX + availW - dockCapsule.w - M;
    y = availY + Math.round((availH - dockCapsule.h) / 2);
  } else if (p === "top") {
    x = availX + Math.round((availW - dockCapsule.w) / 2);
    y = availY + M;
  } else {
    x = availX + Math.round((availW - dockCapsule.w) / 2);
    y = availY + availH - dockCapsule.h - M;
  }
  x = Math.max(availX, Math.min(x, availX + Math.max(0, availW - dockCapsule.w)));
  y = Math.max(availY, Math.min(y, availY + Math.max(0, availH - dockCapsule.h)));
  return { x, y, width: dockCapsule.w, height: dockCapsule.h };
}

/* IDE 模式（R37 用户要求："题目页展开 IDE 的时候要有全屏状态"）：
   ① 分屏编辑器抽屉开着；② 当前标签是多窗格、其中有 /ide 页（题目页 + IDE
   并排）。两种都让坞自动让位——R36 只把"网页自己进全屏"接上了，抽屉这条
   路径当时漏了。F11 窗口全屏不算（外壳仍在，坞跟着外壳一起在才自洽）。 */
function ideModeNow() {
  if (inPageIdeFull(activeTabId)) return true; // 题目页自带 IDE 模式（R38）
  if (drawerOpen && drawerView) return true;
  const g = splitGroupOf(activeTabId);
  if (!g) return false;
  for (const id of g.ids) {
    const t = tabs.get(id);
    if (!t || !t.view || t.view.webContents.isDestroyed()) continue;
    try {
      if (/\/ide(\/|$)/.test(new URL(t.view.webContents.getURL()).pathname)) return true;
    } catch (e) {}
  }
  return false;
}
function layoutDock() {
  const v = dockView;
  if (!v || !dockReady) return;
  /* 标志存活校验（同 layout）：标签没了就清，别让坞被永久藏起来 */
  if (htmlFullscreenTabId != null && !tabs.has(htmlFullscreenTabId)) htmlFullscreenTabId = null;
  if (inPageIdeTabId != null && !tabs.has(inPageIdeTabId)) inPageIdeTabId = null;
  const b = dockBounds();
  /* 网页 HTML 全屏 / IDE 模式（抽屉、题目页+IDE 并排）时坞自动隐藏
     （R36/R37 用户要求） */
  if (!b || htmlFullscreenTabId != null || ideModeNow()) {
    if (dockShown) {
      dockShown = false;
      try { v.setVisible(false); } catch {}
    }
    return;
  }
  try { v.setBounds(b); } catch {}
  if (!dockShown) {
    dockShown = true;
    try { v.setVisible(true); } catch {}
    /* 抬到页面之上（新开的标签视图会盖过它）；弹层随后由 raisePopup 压到坞上 */
    try { mainWin.contentView.removeChildView(v); mainWin.contentView.addChildView(v); } catch {}
    raisePopup();
  }
  /* 假壁纸几何（与弹层同契约）：坞视图要知道自己在窗口里的坐标与窗口尺寸。
     dock 一并下发：每次落位都把方向对齐到主进程解析的位置（配置变了但外壳
     还没来得及重发时，坞不会带着旧方向落位）。 */
  try {
    const [w, h] = mainWin.getContentSize();
    v.webContents.send("dock:rect", { x: b.x, y: b.y, winW: w, winH: h, dock: dockPos() });
  } catch {}
}

/* 坞项点击：规则与旧的外壳 dockTarget 逐条一致（@home/@ide/@settings、洛谷
   全 URL 按站内导航、/路径、映射词、站外 URL 开新标签）。 */
function dockTargetOf(href) {
  const s = String(href || "").trim();
  if (!s) return null;
  if (s === "@home") return { type: "home" };
  if (s === "@ide") return { type: "ide" };
  if (s === "@settings") return { type: "settings" };
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (/(^|\.)luogu\.com\.cn$/i.test(u.hostname)) return { type: "luogu", url: u.pathname + u.search };
    } catch (e) {}
    return { type: "url", url: s };
  }
  if (/^[/]/.test(s)) return { type: "luogu", url: s };
  const map = cfg.mappings || {};
  if (map[s]) return { type: "url", url: map[s] };
  return { type: "luogu", url: "/" + s.replace(/^\/+/, "") };
}
function dockOpen(href, opts) {
  const t = dockTargetOf(href);
  if (!t) return;
  /* R40（用户口径，改自 R39）：坞项 = **书签语义**——默认把当前页换成目标页
     （不再新开标签）；Ctrl/⌘+点、中键（坞视图回传 newTab）才新开标签。
     设置页例外：它是应用自己的工具页（Chrome 的设置也开新标签），维持
     "激活已有 / 新建"。本地玻璃首页仍由 Ctrl+T / 加号 / 命令面板打开。 */
  const newTab = !!(opts && opts.newTab);
  if (t.type === "settings") return openSettingsTab();
  if (t.type === "home") {
    if (newTab) return createTab(HOME_URL, { activate: true });
    return navigateActive(HOME_URL, { unlock: true });
  }
  if (t.type === "ide") {
    /* 已有 IDE 标签：切过去（不新开、也不把当前页换掉）；没有：当前页换成
       /ide（Ctrl+点则新建 special 标签，与旧行为一致）。 */
    const id = tabOrder.find((tid) => {
      const x = tabs.get(tid);
      return x && x.special && !isLocalKind(x.kind);
    });
    if (id != null) return setActiveTab(id);
    if (newTab) return createTab(HOME_URL + "ide", { special: true });
    return navigateActive(HOME_URL + "ide", { unlock: true });
  }
  if (t.type === "url") {
    if (newTab) return createTab(t.url, { unlock: true });
    return navigateActive(t.url, { unlock: true });
  }
  if (newTab) return createTab(normalizeUrl(t.url), { unlock: true });
  return navigateActive(t.url, { unlock: true });
}

ipcMain.on("dock:sync", (_e, p) => {
  if (!p || typeof p !== "object" || !mainWin || mainWin.isDestroyed()) return;
  const v = ensureDockView();
  const [w, h] = mainWin.getContentSize();
  const b = dockBounds();
  dockSyncPayload = {
    html: String(p.html || ""),
    /* 方向唯一来源 = 主进程解析后的位置（R38）：外壳那份是 relay，可能还停在
       旧配置上；坞视图的排布方向必须和 dockBounds() 的落位同源，否则左/右位置
       会出现"两颗竖排胶囊被按行并排"的两条坞（用户截图报的 bug）。 */
    dock: dockPos(),
    cssText: String(p.cssText || ""),
    theme: String(p.theme || "light"),
    glass: String(p.glass || "flat"),
    layout: String(p.layout || "vertical"),
    side: String(p.side || "left"),
    winW: w,
    winH: h,
    x: b ? b.x : 0,
    y: b ? b.y : 0,
  };
  if (dockReady) { try { v.webContents.send("dock:sync", dockSyncPayload); } catch {} }
  layoutDock();
});
ipcMain.on("dock:size", (_e, s) => {
  const w = Math.round(Number(s && s.w) || 0);
  const h = Math.round(Number(s && s.h) || 0);
  if (w <= 0 || h <= 0) return;
  if (w === dockCapsule.w && h === dockCapsule.h) return;
  dockCapsule = { w, h };
  layoutDock();
});
ipcMain.on("dock:cmd", (_e, href, opts) => dockOpen(String(href || ""), opts && typeof opts === "object" ? opts : null));

/* ============================================================
   标签休眠（Zen 式）：后台闲置标签卸载视图省内存（URL/标题/图标保留，
   标签位不动，点回去才重新加载）。手动：右键「休眠此标签页」；自动：
   cfg.tabSleepMinutes（默认 30，0=关）。活动标签、拼合可见成员、
   钉住的、本地页、正在放声音的不睡。
   ============================================================ */
/* 置睡的公共体（R41）：自动休眠与启动惰性恢复共用。导航态缓存一并清零——
   视图没了，快照里的 back/forward 必须回到不可用。 */
function makeSleeping(id) {
  const t = tabs.get(id);
  if (!t || t.sleeping || !t.view) return false;
  if (id === activeTabId) return false;
  try {
    t.url = t.view.webContents.getURL() || t.url;
    mainWin.contentView.removeChildView(t.view);
    t.view.webContents.close();
  } catch {}
  t.view = null;
  t.sleeping = true;
  t.loading = false;
  t.canBack = false;
  t.canFwd = false;
  return true;
}
function sleepTab(id) {
  const t = tabs.get(id);
  if (!t || t.sleeping || !t.view) return false;
  if (splitGroupOf(id)) return false;
  if (t.pinned || isLocalKind(t.kind)) return false;
  try { if (t.view.webContents.isCurrentlyAudible()) return false; } catch {}
  if (!makeSleeping(id)) return false;
  pushTabs();
  scheduleSaveTabs();
  return true;
}
function sleepOtherTabs(id) {
  let n = 0;
  for (const tid of tabOrder.slice()) if (tid !== id && sleepTab(tid)) n++;
  return n;
}
/* 唤醒 = 按建标签的同一套规则重挂视图（分区/preload 与 createTab 一致） */
function wakeTab(id) {
  const t = tabs.get(id);
  if (!t || !t.sleeping) return false;
  const full = t.url;
  const isLocal = isLocalKind(t.kind) || /^file:/i.test(full);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      session: isLocal ? session.defaultSession : isAllowed(full) ? acctSession(cfg.activeAccountId) : sharedSession(),
      /* 本地 kind（home/history/settings）必须带回 preload-config.js：
         preload-page 没有 lgConfig 桥，页面会变死页（与 openClosedEntry 同规） */
      preload: path.join(__dirname, isLocalKind(t.kind) ? "preload-config.js" : "preload-page.js"),
    },
  });
  try { view.setBackgroundColor("#f7f7f8"); } catch {}
  mainWin.contentView.addChildView(view);
  raisePopup();
  t.view = view;
  t.sleeping = false;
  wirePageView(id, view);
  try { view.setBounds({ x: 0, y: 0, width: 1, height: 1 }); } catch {}
  if (/^https?:/i.test(full) && !isAllowed(full)) {
    try { view.webContents.setUserAgent(chromeLikeUA()); } catch {}
  }
  view.webContents.loadURL(full).catch(() => {});
  layout();
  return true;
}
/* ---------- 后台节流策略（R41） ----------
   活动 / 分屏可见成员 / 正在出声的标签不节流；其余后台标签恢复 Chromium 默认
   定时器节流。旧代码全部 backgroundThrottling:false，后台页定时器永远全速跑。
   窗口隐藏的黑首帧是"出帧"问题，由 repaintSiteViews 强制重绘兜底，与这里的
   定时器节流无关。挂进 layout()：几何/激活/分屏任何变化都会路过这里。 */
function applyThrottlePolicy() {
  for (const [id, t] of tabs) {
    if (!t.view || t.view.webContents.isDestroyed()) continue;
    let want = cfg.bgThrottle !== false && id !== activeTabId;
    if (want) {
      const g = splitGroupOf(id);
      if (g && g.ids.includes(activeTabId)) want = false; // 分屏可见成员
    }
    if (want) {
      try { if (t.view.webContents.isCurrentlyAudible()) want = false; } catch {}
    }
    try {
      if (t.view.webContents.backgroundThrottling !== want) t.view.webContents.setBackgroundThrottling(want);
    } catch {}
  }
}

setInterval(() => {
  if (!mainWin || mainWin.isDestroyed()) return;
  /* 常规：闲置 tabSleepMinutes 分钟休眠（0=关） */
  const mins = Number(cfg.tabSleepMinutes);
  if (mins && mins > 0) {
    const limit = mins * 60000;
    const now = Date.now();
    for (const id of tabOrder.slice()) {
      const t = tabs.get(id);
      if (!t || t.sleeping) continue;
      if (now - (t.lastActive || 0) < limit) continue;
      sleepTab(id);
    }
  }
  /* 内存压力兜底（R41）：系统可用内存吃紧时把最久未用的后台标签提前睡掉，
     排除条件与 sleepTab 一致（活动/分屏/钉住/本地/出声），睡到压力缓解。 */
  if (cfg.memSleep === false) return;
  try {
    const si = process.getSystemMemoryInfo();
    /* Electron 的 SystemMemoryInfo 字段就是 total / free（KB）。
       此前还写了 "|| si.totalMem || 0" 的兜底——那个字段**根本不存在**
       （类型检查指出来的），所以它永远读不到，纯属误导性死代码。 */
    const totalKB = si.total || 0;
    const freeKB = si.free || 0;
    if (!totalKB) return;
    const low = freeKB < 1572864 || freeKB * 20 < totalKB * 3; // <1.5GB 或 <15%
    if (!low) return;
    const cands = tabOrder
      .slice()
      .sort((a, b) => ((tabs.get(a) || {}).lastActive || 0) - ((tabs.get(b) || {}).lastActive || 0));
    let n = 0;
    for (const id of cands) {
      if (!tabs.get(id) || tabs.get(id).sleeping) continue;
      if (sleepTab(id)) n++;
    }
    if (n) dbg("memPressure: slept " + n + " tab(s), free=" + Math.round(freeKB / 1024) + "MB");
  } catch {}
}, 60000);

/* 站点视图在窗口还不可见（隐藏 / 最小化）的时候建好并加载完，Chromium 会
   停掉出帧，等窗口显示出来时就停在最后一帧上——表现是整页全黑，手动刷新
   才恢复。显示/恢复之后逼它重画一帧，把首帧补上。 */
function repaintSiteViews() {
  for (const t of tabs.values()) {
    try {
      if (!t.view) continue;
      /* 崩过的视图 invalidate 救不回来（页面与壁纸一起白）：直接重载一次 */
      if (t.view.webContents.isCrashed && t.view.webContents.isCrashed()) {
        if (!t.crashReloading) {
          t.crashReloading = true;
          t.view.webContents.reload();
          setTimeout(() => { t.crashReloading = false; }, 5000);
        }
        continue;
      }
      t.view.webContents.invalidate();
    } catch {}
  }
  try { if (drawerView) drawerView.webContents.invalidate(); } catch {}
}

/* ============================================================
   标签分组（Edge Tab Groups）
   tabGroups：groupId → { id, name, color, collapsed }；成员关系记在标签
   对象上（t.groupId），顺序仍由 tabOrder 唯一决定——加入组时把标签挪到
   组块末尾保持连续，拖出组块即移出（外壳拖拽完回传）。边界规则：
   一个标签最多属一个组；空组自动消亡；分组只是标签的组织方式，不是书签。
   ============================================================ */
const tabGroups = new Map(); // groupId -> { id, name, color, collapsed }
let groupSeq = 0;
const GROUP_PALETTE = ["blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "cyan", "gray"];
let groupColorCursor = 0;

function groupMembers(gid) {
  return tabOrder.filter((id) => {
    const t = tabs.get(id);
    return t && t.groupId === gid;
  });
}
/* 空组自动消亡：任何成员变动后都要过一遍 */
function pruneGroups() {
  for (const gid of Array.from(tabGroups.keys())) {
    if (!groupMembers(gid).length) tabGroups.delete(gid);
  }
}
function leaveGroup(id) {
  const t = tabs.get(id);
  if (!t || t.groupId == null) return false;
  t.groupId = null;
  pruneGroups();
  pushTabs();
  scheduleSaveTabs();
  return true;
}
/* 加入分组（Edge 语义）：anchorId 指定组内锚点（拖到某个组内标签上 → 插到它
   前/后，Edge 的"拖到标签上并入"），不传则落到组块末尾（老行为：菜单加入、
   落到组块中间）。已经在组里也走一遍定位——同组内拖动 = 组内排序。 */
function joinGroup(id, gid, anchorIdRaw, before) {
  const t = tabs.get(id);
  const g = tabGroups.get(gid);
  if (!t || !g) return false;
  // 先算组块（此时自己还没入组，否则 last 会算成自己、
  // indexOf 扑空把标签插到标签条最前）
  const members = groupMembers(gid).filter((x) => x !== id);
  const anchor = anchorIdRaw != null && members.includes(Number(anchorIdRaw)) ? Number(anchorIdRaw) : null;
  if (t.groupId === gid && anchor == null) return true; // 已在组里、没给锚点：原地不动
  t.groupId = gid;
  tabOrder = tabOrder.filter((x) => x !== id);
  if (anchor != null) {
    const at = tabOrder.indexOf(anchor);
    tabOrder.splice(before ? at : at + 1, 0, id);
  } else {
    // 挪到组块末尾保持连续（Edge 语义：组内标签一定连成一片）
    const last = members.length ? members[members.length - 1] : null;
    if (last != null) tabOrder.splice(tabOrder.indexOf(last) + 1, 0, id);
    else tabOrder.push(id);
  }
  pruneGroups();
  pushTabs();
  scheduleSaveTabs();
  return true;
}

/* 拖到某个标签上（Edge 的建组手势）：目标没组 → 用两者新建一个组（按视觉顺序
   排好，拖到目标前 = 拖的在前）；目标已有组 → 并入该组并插到目标前/后。
   钉住区不属于任何组，钉住标签不参与。 */
function mergeTabsIntoGroup(id, targetIdRaw, before) {
  const a = tabs.get(id);
  const targetId = Number(targetIdRaw);
  const b = tabs.get(targetId);
  if (!a || !b || id === targetId) return false;
  if (a.pinned || b.pinned) return false;
  if (b.groupId != null) return joinGroup(id, b.groupId, targetId, before);
  leaveGroupSilently(id);
  const g = makeGroup();
  a.groupId = g.id;
  b.groupId = g.id;
  tabOrder = tabOrder.filter((x) => x !== id);
  const at = tabOrder.indexOf(targetId);
  if (at < 0) tabOrder.push(id);
  else tabOrder.splice(before ? at : at + 1, 0, id);
  pruneGroups();
  pushTabs();
  scheduleSaveTabs();
  return g;
}

/* 整组排序（Edge：拖动组头移动整块）：把成员块整体挪到 anchorId 所在位置的
   前/后（anchorId=null → 末尾）。钉住前缀不许被插队。 */
function reorderGroup(gid, anchorIdRaw, before) {
  const members = groupMembers(gid);
  if (!members.length) return false;
  const anchorId = anchorIdRaw != null ? Number(anchorIdRaw) : null;
  if (anchorId != null && members.includes(anchorId)) return false; // 落到自己身上：不动
  const others = tabOrder.filter((x) => !members.includes(x));
  const pinnedCount = others.filter((x) => { const t = tabs.get(x); return t && t.pinned; }).length;
  let at = others.length;
  if (anchorId != null) {
    const i = others.indexOf(anchorId);
    if (i >= 0) at = before ? i : i + 1;
  }
  at = Math.max(at, pinnedCount);
  tabOrder = others.slice(0, at).concat(members, others.slice(at));
  pushTabs();
  scheduleSaveTabs();
  return true;
}

/* 拖动落点统一入口（外壳与悬停浮层共用）：targetGid = 拖到组头/组牌上（加入该组，
   折叠组也能当落点）；targetId = 拖到某个标签上（建组/并组）；before = 落在目标前。 */
function groupDropApply(p) {
  const id = p && p.id != null ? Number(p.id) : NaN;
  if (!tabs.has(id)) return { ok: false };
  const targetGid = p && p.targetGid != null ? Number(p.targetGid) : null;
  if (targetGid != null) {
    if (!tabGroups.has(targetGid)) return { ok: false };
    return { ok: joinGroup(id, targetGid, null, null) };
  }
  const targetId = p && p.targetId != null ? Number(p.targetId) : null;
  if (targetId == null || !tabs.has(targetId)) return { ok: false };
  return { ok: !!mergeTabsIntoGroup(id, targetId, !!(p && p.before)) };
}
/* 新建组记录（唯一入口）：默认组名对齐 Edge 的「1 组 / 2 组…」（用户没改名时
   组牌上显示的就是它，面板输入框里也是这个名字），颜色按调色板轮转不重复。 */
function makeGroup() {
  const gid = ++groupSeq;
  const g = { id: gid, name: gid + " 组", color: GROUP_PALETTE[groupColorCursor++ % GROUP_PALETTE.length], collapsed: false };
  tabGroups.set(gid, g);
  return g;
}
function newGroupFor(id) {
  if (!tabs.has(id)) return null;
  leaveGroupSilently(id);
  const g = makeGroup();
  // 直接落籍、不挪位置：一个标签的组块天然连续，原位不动
  tabs.get(id).groupId = g.id;
  pushTabs();
  scheduleSaveTabs();
  return g;
}
/* joinGroup 里会 push/save，建组前的脱离不该触发两遍（也不该把刚建的空组剪掉） */
function leaveGroupSilently(id) {
  const t = tabs.get(id);
  if (t) t.groupId = null;
}
/* 用一串标签建组（Edge 的多选建组）：一个组、成员连成一块。
   落点 = 第一个成员的原位（钉住前缀不许被插队），成员保持原相对顺序。 */
function createGroupFromTabs(ids) {
  const list = (ids || []).filter((x) => tabs.has(x) && !tabs.get(x).pinned);
  if (list.length < 2) return null;
  for (const id of list) leaveGroupSilently(id);
  const g = makeGroup();
  for (const id of list) tabs.get(id).groupId = g.id;
  const members = tabOrder.filter((x) => list.includes(x));
  const others = tabOrder.filter((x) => !list.includes(x));
  const firstId = members[0];
  let at = 0;
  for (const x of tabOrder) {
    if (x === firstId) break;
    if (!list.includes(x)) at++;
  }
  const pinnedCount = others.filter((x) => { const t = tabs.get(x); return t && t.pinned; }).length;
  at = Math.max(at, pinnedCount);
  tabOrder = others.slice(0, at).concat(members, others.slice(at));
  pruneGroups();
  pushTabs();
  scheduleSaveTabs();
  return g;
}
/* 主进程侧发起的操作给外壳报一句提示（多选建组这类原生菜单里的动作） */
function sendToast(msg) {
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("chrome:toast", String(msg || ""));
  } catch {}
}
function updateGroup(gid, patch) {
  const g = tabGroups.get(gid);
  if (!g) return false;
  if (patch && typeof patch.name === "string") g.name = patch.name.slice(0, 40);
  if (patch && typeof patch.color === "string" && GROUP_PALETTE.includes(patch.color)) g.color = patch.color;
  if (patch && typeof patch.collapsed === "boolean") g.collapsed = patch.collapsed;
  pushTabs();
  scheduleSaveTabs();
  return true;
}
function ungroupAll(gid) {
  for (const id of groupMembers(gid)) {
    const t = tabs.get(id);
    if (t) t.groupId = null;
  }
  tabGroups.delete(gid);
  pushTabs();
  scheduleSaveTabs();
}
function closeGroupTabs(gid) {
  for (const id of groupMembers(gid).slice()) closeTab(id);
}
/* 组中新建标签页：新标签落在组块末尾并直接入组 */
function newTabInGroup(gid) {
  const g = tabGroups.get(gid);
  if (!g) return null;
  const nid = createTab(START_URL, { activate: true });
  joinGroup(nid, gid);
  return nid;
}

/* ============================================================
   弹出层覆盖视图
   外壳层（窗口自己的 webContents）永远渲染在所有站点视图之下，所以在外壳里
   画的下拉菜单/命令面板会被网页盖住——用户报的"切换账号的弹窗被背景遮住"
   就是这个。这里单独挂一个覆盖整个窗口、背景透明的 WebContentsView 专门承载
   弹出层：它渲染在站点视图之上，打开时全窗口接管鼠标（点空白即关闭）。
   ============================================================ */
let popupView = null;
let popupReady = false;
let popupShown = false;   // 覆盖层当前是不是真的亮着（setVisible 没有读回来的接口）
const popupQueue = [];

function ensurePopupView() {
  if (popupView && !popupView.webContents.isDestroyed()) return popupView;
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload-popup.js"),
      session: session.defaultSession,
    },
  });
  try { v.setBackgroundColor("#00000000"); } catch {}
  mainWin.contentView.addChildView(v);
  v.webContents.on("did-finish-load", () => {
    popupReady = true;
    for (const p of popupQueue.splice(0)) {
      try { v.webContents.send("popup:show", p); } catch {}
    }
  });
  v.webContents.loadFile(path.join(__dirname, "src", "popup", "popup.html")).catch(() => {});
  v.setVisible(false);
  v.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  popupView = v;
  return v;
}

/* addChildView 是"后加的在上"：每开一个标签、每挂一次抽屉视图都会把弹出层
   压到站点视图下面去——用户报的"切换账号的栏被壁纸/网页挡住"就是这个。
   所以无论视图集合怎么变，弹出层一露头就把自己重新挂到最顶上。 */
function raisePopup() {
  if (!popupView || popupView.webContents.isDestroyed()) return;
  /* 坞在页面之上、弹层之下：新挂的标签/抽屉视图会盖过坞，这里顺带把它抬回
     （弹层随后再抬到坞之上）——坞视图只在自己可见时才重挂 */
  if (dockView && dockShown && !dockView.webContents.isDestroyed()) {
    try {
      mainWin.contentView.removeChildView(dockView);
      mainWin.contentView.addChildView(dockView);
    } catch {}
  }
  try {
    mainWin.contentView.removeChildView(popupView);
    mainWin.contentView.addChildView(popupView);
  } catch {}
}

/* 矩形模式的弹层几何（fit:"rect"）：视图只盖住面板本身，面板之外的点击自然
   落到网页/外壳上。Electron 没有视图级点击穿透，覆盖全窗就必然"面板外的第一下
   被吃掉"（v3.5.8 用 pointer-events 想绕过去，实测不行）。popup 渲染后回报内容
   尺寸，这里统一定位：夹进窗口、四周留 12px 给投影；面板在视图内的坐标恒为
   (12,12)，originX/Y 是面板左上角在窗口里的坐标（假壁纸配方 --pop-x/y 要用）。 */
const POPUP_MARGIN = 12;
let popupFit = null; // { al, ay, pad, wantW, wantH, contentW, contentH, originX, originY }
let flyoutHold = false; // 拖拽中：光标裁判暂停收回浮层（popup:hold 控制）
let popupHideAckTimer = null;  // 关路径握手：等外壳把窄条/侧栏画回来的回执（超时兜底）
let popupPickHideTimer = null; // 浮层里的动作先转外壳执行，外壳自己不收时兜底关
let popupHideHandoff = "";     // 最近一次浮层收回走的路径："ack" | "timeout"（探针断言用）
let flyoutHoldTimer = null; // 兜底放行：拖拽中指针被抢走时"放行"可能收不到

const popupPad = (p) => {
  const d = POPUP_MARGIN;
  const src = p && p.fitPad && typeof p.fitPad === "object" ? p.fitPad : {};
  const n = (v, dflt) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : dflt);
  return { l: n(src.l, d), t: n(src.t, d), r: n(src.r, d), b: n(src.b, d) };
};

function applyPopupRect(w, h) {
  if (!popupFit || !popupView || popupView.webContents.isDestroyed() || !mainWin || mainWin.isDestroyed()) return null;
  const [winW, winH] = mainWin.getContentSize();
  const pad = popupFit.pad;
  /* 整高模式（垂直栏悬停浮层）：宽 = 侧栏展开宽、高 = 从 ay 到窗口底——与常驻
     展开的外壳 #vtab（左 top:0/bottom:0，右 top:44）完全同矩形。这条不量内容：
     浮层不是"按内容收的卡片"，是那条侧栏本身；宽高都由主进程裁定（文档量出来
     的尺寸只喂普通菜单）。窗口缩放时 syncPopupBounds 会重调这里，高度跟着重算。 */
  const cw = popupFit.fullH
    ? Math.max(1, Math.min(vtabExpandedW(), Math.max(1, winW - pad.l - pad.r)))
    : Math.max(1, Math.min(Math.round(w) || 1, Math.max(1, winW - pad.l - pad.r)));
  const ch = popupFit.fullH
    ? Math.max(1, winH - Math.max(0, Math.round(popupFit.ay) || 0) - pad.b)
    : Math.max(1, Math.min(Math.round(h) || 1, Math.max(1, winH - pad.t - pad.b)));
  /* 锚点三种：默认按 al/ay 左上角（夹进窗口）；center=水平居中；
     bottom=贴底（bottomGap 距底边）——toast 这类"窗口级通知"用。 */
  const left = popupFit.center
    ? Math.max(pad.l, Math.round((winW - cw) / 2))
    : popupFit.ar != null
      ? Math.max(pad.l, winW - cw - Math.max(0, Math.round(popupFit.ar))) // 贴右缘（侧栏在右侧）
      : Math.max(pad.l, Math.min(Math.round(popupFit.al), Math.max(pad.l, winW - cw - pad.r)));
  const top = popupFit.bottom
    ? Math.max(pad.t, winH - ch - pad.b - Math.max(0, Math.round(popupFit.bottomGap) || 0))
    : popupFit.fullH
      ? Math.max(pad.t, Math.round(popupFit.ay) || 0) // 整高：顶边就是锚点，不再夹取
      : Math.max(pad.t, Math.min(Math.round(popupFit.ay), Math.max(pad.t, winH - ch - pad.b)));
  try { popupView.setBounds({ x: left - pad.l, y: top - pad.t, width: cw + pad.l + pad.r, height: ch + pad.t + pad.b }); } catch {}
  popupFit = { ...popupFit, contentW: cw, contentH: ch, originX: left, originY: top };
  return { padL: pad.l, padT: pad.t, originX: left, originY: top, maxW: cw, maxH: ch };
}

function showPopup(payload) {
  if (!mainWin || mainWin.isDestroyed()) return;
  const v = ensurePopupView();
  raisePopup();
  popupShown = true;
  popupFit = null;
  /* 浮层动作的兜底收回（popup:pick 里那一发 200ms）在这里作废：新弹层要显示
     （最常见的是窄条浮层里点 ⌄ 交接给「标签页操作」菜单）时，旧的兜底定时器
     不许再关它——R40 用户报的"窄条上点 ⌄ 有 bug"就是它：菜单刚画出来就被
     200ms 后的兜底 hidePopup 关掉，看起来像点了没反应/闪一下。 */
  clearTimeout(popupPickHideTimer);
  popupPickHideTimer = null;
  /* 弹层的假壁纸要吃"整个窗口"的尺寸（--lg-wall-w/h）：rect 弹层的视图只是
     面板那一块，CSS 的 100vw/100vh 兜底会把壁纸按视图尺寸铺——悬停浮层那种
     整条面板尤其明显（面板底色只有 3% 白，看上去几乎就是那张被压扁的壁纸，
     和窄条背后的真壁纸对不上）。尺寸随 payload 下发；窗口缩放时 syncPopupBounds 补发。 */
  if (payload && typeof payload === "object") {
    const [w0, h0] = mainWin.getContentSize();
    payload = { ...payload, win: { w: w0, h: h0 } };
  }
  if (payload && payload.fit === "rect") {
    // 先占住锚点附近 1px，等 popup:fit 回报尺寸后落定（避免全窗白闪一下）
    const [w, h] = mainWin.getContentSize();
    const x = Math.min(Math.max(0, Math.round(Number(payload.al) || 0)), Math.max(0, w - 1));
    const y = Math.min(Math.max(0, Math.round(Number(payload.ay) || 0)), Math.max(0, h - 1));
    popupFit = {
      al: x, ay: y, pad: popupPad(payload), wantW: 1, wantH: 1,
      // ar != null：贴右缘（侧栏在右侧时的悬停浮层）
      ar: payload.ar != null ? Math.max(0, Math.round(Number(payload.ar) || 0)) : null,
      center: !!payload.center, bottom: !!payload.bottom, bottomGap: payload.bottomGap,
      // 整高（垂直栏悬停浮层）：矩形由主进程裁定，与常驻展开的侧栏同一条
      fullH: !!payload.fullH,
    };
    // 整高浮层的矩形主进程自己就算得全（展开宽 + 窗口尺寸 + 贴哪边）：直接落定，
    // 不必先缩成 1px 再等文档回报——首帧就是最终矩形，面板不会先按 1px 量一次
    if (popupFit.fullH) applyPopupRect(vtabExpandedW(), h);
    else try { v.setBounds({ x, y, width: 1, height: 1 }); } catch {}
  } else {
    const [w, h] = mainWin.getContentSize();
    try { v.setBounds({ x: 0, y: 0, width: w, height: h }); } catch {}
  }
  if (popupReady) {
    try { v.webContents.send("popup:show", payload); } catch {}
  } else {
    popupQueue.push(payload);
  }
  try { v.setVisible(true); } catch {}
  // 悬停浮层才需要光标轮询收回；普通菜单靠点空白/Esc，轮询反而会误关
  if (payload && payload.flyout) startFlyoutWatch();
  else stopFlyoutWatch();
}

/* 覆盖层自己关掉自己（点菜单外的空白、Esc）时，外壳并不知道 —— 它还以为
   菜单开着，下一次点账号芯片会被当成"关闭菜单"而空转，用户得点两次。
   所以关闭时回报一声，让外壳把"当前打开的菜单"清掉。 */
function hidePopup() {
  stopFlyoutWatch();
  flyoutHold = false; // 拖拽中被打断（点空白/Esc）时别把挂起状态留下
  /* 兜底定时器一起作废：它若留到下一次弹层显示之后再响，会关掉一个跟它
     毫无关系的新弹层（同一类竞态的第二个入口）。 */
  clearTimeout(popupPickHideTimer);
  popupPickHideTimer = null;
  const wasFlyout = !!(popupFit && popupFit.fullH); // 悬停浮层（整条面板）
  popupFit = null;
  if (glanceView) closeGlance(); // 速览壳被点掉/Esc：卡片视图一起收
  if (!popupView || popupView.webContents.isDestroyed()) return;
  try { popupView.webContents.send("popup:clear"); } catch {}
  if (popupShown) {
    popupShown = false;
    try { mainWin.webContents.send("chrome:popup-hidden", true); } catch {}
  }
  if (!wasFlyout) {
    try { popupView.setVisible(false); } catch {}
    return;
  }
  /* 关路径握手（R36）：浮层盖着窄条（外壳用 body.flyout-open 把窄条隐了），
     外壳收到 popup-hidden 先把它画回来、回一声 popup:hidden-ack 之后才真隐
     视图——原来"先隐视图、后摘类"，中间至少一帧两侧都没有侧栏（悬停收回
     "闪一下"的根）。外壳没回（视图没起来/脚本没跑）也有兜底，不许把弹层
     视图永远挂在上面。 */
  popupHideHandoff = "timeout";
  clearTimeout(popupHideAckTimer);
  popupHideAckTimer = setTimeout(() => {
    popupHideAckTimer = null;
    try { popupView && popupView.setVisible(false); } catch {}
  }, 140);
}

/* 弹出层几何：矩形模式按上一次回报的尺寸重夹一遍（窗口缩放/重排时调用）；
   普通菜单恒为全窗口（坞已撤进垂直侧栏，弹出层只在有内容时可见，不可见时
   不吃任何点击） */
function syncPopupBounds() {
  if (!popupView || popupView.webContents.isDestroyed() || !mainWin || mainWin.isDestroyed()) return;
  /* 弹层假壁纸的窗口几何：窗口一改大小就补发一份（rect 弹层的视图只是面板
     那一块，不补发的话壁纸还按旧窗口尺寸铺） */
  if (popupShown) {
    const [w0, h0] = mainWin.getContentSize();
    try { popupView.webContents.send("popup:win", { w: w0, h: h0 }); } catch {}
  }
  if (popupFit && popupFit.wantW != null) {
    applyPopupRect(popupFit.wantW, popupFit.wantH);
    return;
  }
  const [w, h] = mainWin.getContentSize();
  try { popupView.setBounds({ x: 0, y: 0, width: w, height: h }); } catch {}
}

/* 垂直栏悬停浮层的收回裁判：浮层是盖在外壳之上的另一个视图，外壳与浮层之间
   的 mouseenter/mouseleave 交接必然有竞态（用户报的"悬停闪烁"就是这个）。
   这里不玩事件接力，直接以光标真实位置为准：浮层亮着时每 50ms 看一次光标，
   连续离开"窄条 ∪ 浮层面板"超过 200ms 才收回。
   浮层现在盖住窄条（Edge 的整条展开），光标在两块之间来回永远在并集里；
   拖拽中（popup:hold）直接不判——落点还没定，面板不能被收走。 */
let flyoutWatch = null;
function startFlyoutWatch() {
  stopFlyoutWatch();
  let outsideSince = 0;
  flyoutWatch = setInterval(() => {
    if (!mainWin || mainWin.isDestroyed()) { stopFlyoutWatch(); return; }
    try {
      /* 窗口不可见（--lg-hidden 的测试实例 / 最小化）时没有"光标在不在浮层上"
         这回事：直接不判，别把浮层关掉（探针要量它的几何）。 */
      if (!mainWin.isVisible()) return;
      if (flyoutHold) { outsideSince = 0; return; }
      const pt = screen.getCursorScreenPoint();
      const b = mainWin.getContentBounds();
      const railW = Math.max(VTAB_EDGE, vtabW()); // 紧凑=4，窄条=46，展开态不会开浮层
      const railX = vtabSide() === "right" ? b.x + b.width - railW : b.x; // 侧栏在右侧时贴右缘
      const inRail =
        pt.x >= railX - 4 && pt.x <= railX + railW + 4 &&
        pt.y >= b.y - 4 && pt.y <= b.y + b.height + 4;
      let inPanel = false;
      if (popupFit && popupFit.originX != null) {
        const x0 = b.x + popupFit.originX;
        const y0 = b.y + popupFit.originY;
        inPanel =
          pt.x >= x0 - 6 && pt.x <= x0 + popupFit.contentW + 6 &&
          pt.y >= y0 - 6 && pt.y <= y0 + popupFit.contentH + 6;
      }
      if (inRail || inPanel) { outsideSince = 0; return; }
      if (!outsideSince) { outsideSince = Date.now(); return; }
      if (Date.now() - outsideSince > 200) hidePopup();
    } catch (e) {
      stopFlyoutWatch();
    }
  }, 50);
}
function stopFlyoutWatch() {
  if (flyoutWatch) {
    clearInterval(flyoutWatch);
    flyoutWatch = null;
  }
}

function ensureDrawerView() {
  if (drawerView) return drawerView;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      session: acctSession(cfg.activeAccountId),
    },
  });
  mainWin.contentView.addChildView(view);
  raisePopup(); // 抽屉视图同样会盖住弹出层
  drawerView = view;
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  view.webContents.loadURL(HOME_URL + "ide").catch(() => {});
  view.webContents.on("did-finish-load", () => {
    if (!view.webContents.isDestroyed()) injectInto(view.webContents);
  });
  view.webContents.setWindowOpenHandler(({ url, disposition }) => {
    const bg = disposition === "background-tab"; // 中键/Ctrl+点 = 后台标签（同页面视图）
    if (isAllowed(url)) createTab(url, { activate: !bg });
    else shell.openExternal(url);
    return { action: "deny" }; // Electron 只认 allow/deny（旧值 "prevent" 每次都刷警告）
  });
  return view;
}

function toggleDrawer() {
  if (drawerOpen) {
    drawerOpen = false;
    const v = drawerView;
    drawerView = null;
    if (v) {
      try {
        mainWin.contentView.removeChildView(v);
        v.webContents.close();
      } catch (e) {
        /* 视图移除失败（已被别处销毁）不该让整个抽屉关不掉，但要有痕迹：
           此前这里是空 catch，出了"抽屉关不掉"的问题完全查不到。 */
        try { dbg("drawer close: removeChildView failed: " + ((e && e.message) || e)); } catch {}
      }
    }
    layout();
    return { ok: true, open: false };
  }
  ensureDrawerView();
  drawerOpen = true;
  layout();
  return { ok: true, open: true };
}

/* 站内页面 → 应用动作的自定义协议（页面里 window.open("luogu-glass://…")） */
function handleAppCommand(raw) {
  const rest = String(raw).replace(/^luogu-glass:\/\//i, "").replace(/\/+$/, "");
  const cmd = rest.toLowerCase();
  if (cmd === "drawer" || cmd === "drawer/toggle") return toggleDrawer();
  if (cmd === "ide") { toggleIde(); return { ok: true }; }
  // 划词识别的题号跳转：保留原始大小写（P1001 与 AT_abc123 都不能被 lowercase 掉）
  const m = rest.match(/^problem\/([A-Za-z0-9_]+)$/i);
  if (m) {
    createTab(HOME_URL + "problem/" + m[1], { activate: true });
    return { ok: true, pid: m[1] };
  }
  return { ok: false, cmd };
}

/* 导航态缓存（R41）：did-navigate / did-navigate-in-page / did-finish-load 时
   刷新，tabsSnapshot 直接读缓存（makeSleeping 清零），快照不再逐标签做
   canGoBack/canGoForward 两次同步跨进程读。 */
function refreshNavMeta(id) {
  const t = tabs.get(id);
  if (!t || !t.view) return;
  try {
    t.canBack = t.view.webContents.canGoBack();
    t.canFwd = t.view.webContents.canGoForward();
  } catch {}
}

function tabsSnapshot() {
  return {
    activeId: activeTabId,
    /* 新建分组会用的下一个调色板色键（外壳的"新建分组"拖拽预览小签按它上色，
       与 makeGroup 的游标同一份来源） */
    nextGroupColor: GROUP_PALETTE[groupColorCursor % GROUP_PALETTE.length],
    tabs: tabOrder.map((id) => {
      const t = tabs.get(id);
      /* R41：back/fwd/静音读事件缓存，不再每标签每推送做 3 次同步跨进程读 */
      const canBack = !!t.canBack;
      const canFwd = !!t.canFwd;
      const muted = !!t.muted;
      const sg = splitGroupOf(id);
      return {
        id, title: t.title, url: t.url, special: t.special, kind: t.kind || null,
        pinned: !!t.pinned,
        loading: !!t.loading, favicon: t.favicon || "", canBack, canFwd,
        muted, zoom: t.zoom || 1,
        splitPeer: sg ? sg.ids.length : null,
        splitSide: sg ? (sg.ids[0] === id ? "left" : "right") : null,
        sleeping: !!t.sleeping,
        group: t.groupId || null,
      };
    }),
    // 分组元数据按组块在标签条里出现的顺序下发（外壳渲染组牌用）
    groups: (() => {
      const seen = new Set();
      const out = [];
      for (const id of tabOrder) {
        const t = tabs.get(id);
        if (!t || t.groupId == null || seen.has(t.groupId)) continue;
        const g = tabGroups.get(t.groupId);
        if (!g) continue;
        seen.add(t.groupId);
        out.push({ id: g.id, name: g.name, color: g.color, collapsed: !!g.collapsed });
      }
      return out;
    })(),
  };
}

function pushTabs() {
  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.webContents.send("chrome:tabs", tabsSnapshot()); } catch {}
  }
}
/* meta 类推送的 80ms 尾随合并（R41）：页面加载期 loading/标题/图标一拍一个，
   旧代码每拍都全量推快照 + 外壳整条重建标签条。结构变化（开/关/激活/分屏/
   分组）仍走立即的 pushTabs。 */
let pushTabsTimer = null;
function pushTabsSoon() {
  if (pushTabsTimer) return;
  pushTabsTimer = setTimeout(() => { pushTabsTimer = null; pushTabs(); }, 80);
}

// 右上角账号芯片只在"洛谷页面"上才探测得到用户区，设置/历史/站外页面
// 一律探不到。早先每 2s 无脑推一次探测结果，切到站外就把 null 推给外壳，
// 于是显示成"未登录"。现在把最近一次可信的登录态缓存下来：
//   · 非洛谷页面探不到 → 沿用缓存（切页不再掉登录态）
//   · 确实是洛谷页面但探不到用户区 → 说明真的登出了，才清空缓存
let lastUser = null;
const LUOGU_HOST_RE = /(^|\.)luogu\.(com\.cn|org|com)$/i;
function hostOf(u) {
  try { return new URL(String(u || "")).hostname || ""; } catch { return ""; }
}

function sendUser(u) {
  try { mainWin.webContents.send("chrome:user", u); } catch {}
}

/* 用户态的网络兜底：页面刮取只在洛谷标签上成立，头像却要在每个页面都显示
   （用户报"头像只有在洛谷页面才显示"）。裸 fetch 会被洛谷的反爬 JS 盾挡下
   （拿到的是 345 字节的挑战脚本，不是页面），所以用一个**隐藏 WebContentsView
   真实导航**洛谷首页——挑战脚本自己执行完跳转，did-finish-load 后从渲染好的
   DOM 里读用户态（和 pushUser 的页内脚本同一套判据）。
   结果三态：{uid,name,avatar}=已登录 / {loggedOut:true}=确定未登录 /
   null=失败或超时（保持现状，不动缓存）。30s 节流，避免刮空一次就开一次探测。 */
let userProbe = null;   // 进行中的隐藏探测视图
let userNetTriedAt = 0;
function refreshUserNet(force) {
  const now = Date.now();
  if (!force && now - userNetTriedAt < 30000) return;
  if (userProbe || !cfg.activeAccountId || !mainWin || mainWin.isDestroyed()) return;
  userNetTriedAt = now;
  const acctId = cfg.activeAccountId;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      session: acctSession(acctId),
    },
  });
  userProbe = view;
  const started = Date.now();
  let done = false;
  const finish = (u) => {
    if (done) return;
    done = true;
    clearTimeout(killer);
    try { mainWin.contentView.removeChildView(view); view.webContents.close(); } catch {}
    userProbe = null;
    if (!u || acctId !== cfg.activeAccountId) return; // 失败/期间又切了账号：保持现状
    if (u.loggedOut) {
      if (lastUser) { lastUser = null; sendUser(null); }
      return;
    }
    // 网络通道与页面刮取同权：拿到就更新缓存并立刻重涂右上角芯片
    if (!lastUser || lastUser.uid !== u.uid || lastUser.name !== u.name || !lastUser.avatar) {
      lastUser = u;
      sendUser(lastUser);
      if (u.name) {
        const a = accounts.find((x) => x.id === cfg.activeAccountId);
        if (a && a.name !== u.name) { a.name = u.name; saveAccounts(); pushAccountState(); }
      }
    }
  };
  /* 判据（与 inject.js findAvatar 同步维护）：
     - 用户区挂着"登录/注册"链接 = 未登录（权威信号）。页面上的 usericon 图
       全是内容图（比赛榜/讨论帖），usericon/1 这种脏匹配曾让芯片顶着错头像；
     - uid 1 的头像是**未登录骨架**的 guest 占位图（SSR 首屏就有，登录/注册
       链接要等 Vue 挂载才出现）——在挂载窗口期它会被当成"已登录 uid 1"，
       直接当作没定论（uid 1 的真实用户放弃头像显示，代价可忽略）；
     - 头像只认 .user-nav 里的；昵称取"欢迎回来"。 */
  const SCRAPE = `(function(){
    try {
      if (document.querySelector('.user-nav a[href*="/auth/login"], #user-nav a[href*="/auth/login"]')) return { loggedOut: true };
      var av = document.querySelector('.user-nav img[src*="usericon"], #user-nav img[src*="usericon"]');
      if (!av || !av.src) return null;
      var m = av.src.match(/\\/usericon\\/(\\d+)\\./);
      if (!m || m[1] === '1') return null;
      var name = '';
      var w = (document.body.innerText || '').match(/欢迎回来[，,：:\\s]*([A-Za-z0-9_]{2,24})/);
      if (w) name = w[1];
      return { uid: m[1], name: name, avatar: av.src };
    } catch (e) { return null; }
  })()`;
  /* 结论要稳定才采信：同一个判定连续两轮一致才 finish。SPA 挂载窗口期
     判定会翻（骨架 guest 头像 → 登录链接出现），单轮采信就是把窗口期的
     脏值写进缓存（芯片"已登录 uid 1"就是这么来的）。 */
  let lastVerdict = "";
  const scrape = () => {
    if (done) return;
    view.webContents.executeJavaScript(SCRAPE, true)
      .then((u) => {
        const key = u ? (u.loggedOut ? "out" : "in:" + u.uid) : "";
        if (u && key === lastVerdict) { finish(u); return; }
        lastVerdict = key;
        if (Date.now() - started < 12000) setTimeout(scrape, 1000);
        else finish(null); // 超时保持现状
      })
      .catch(() => finish(null));
  };
  const killer = setTimeout(() => finish(null), 15000);
  try {
    mainWin.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 10, height: 10 });
    view.setVisible(false);
  } catch {
    finish(null);
    return;
  }
  view.webContents.on("did-finish-load", () => setTimeout(scrape, 500));
  view.webContents.on("did-fail-load", () => finish(null));
  view.webContents.loadURL("https://www.luogu.com.cn/").catch(() => finish(null));
}

function pushUser() {  if (!mainWin || mainWin.isDestroyed()) return;
  const t = tabs.get(activeTabId);
  // 本地页（设置/历史）没有站点上下文，直接把缓存推回去保持显示
  if (!t || isLocalKind(t.kind)) { sendUser(lastUser); return; }
  t.view.webContents
    .executeJavaScript(
      `(function(){
        try {
          var host = '';
          try { host = location.hostname || ''; } catch (e) {}
          var site = /(^|\\.)luogu\\.(com\\.cn|org|com)$/i.test(host);
          // 用户态一律问注入层要：它按容器收窄头像、还能从"xx 的运势"里取昵称。
          // 这里自己再写一份正则的话，两处结果就会不一致（芯片显示 UID、
          // 欢迎块显示昵称就是这么来的）。
          var u = (window.__lgGlass && window.__lgGlass.userInfo) ? window.__lgGlass.userInfo() : null;
          if (u) return { site: site, host: host, uid: u.uid || '', name: u.name || '', avatar: u.avatar || '' };
          // 注入层还没就位（首帧）：退回最保守的读法。未登录权威信号先看登录链接——
          // 内容图里的 usericon/1 脏匹配曾让芯片在未登录时顶着错头像
          if (document.querySelector('.user-nav a[href*="/auth/login"], #user-nav a[href*="/auth/login"]')) {
            return { site: site, host: host, uid: '', name: '', avatar: '' };
          }
          var av = document.querySelector('.user-nav img[src*="usericon"], #user-nav img[src*="usericon"]');
          var uid = '', avatar = '';
          if (av && av.src) {
            var m = av.src.match(/\\/usericon\\/(\\d+)\\./);
            // uid 1 = 未登录骨架的 guest 占位图，不是真实用户
            if (m && m[1] !== '1') { uid = m[1]; avatar = av.src; }
          }
          var el = (document.body.innerText || '').match(/欢迎回来[，,：:\\s]*([A-Za-z0-9_]{2,24})/);
          return { site: site, host: host, uid: uid, name: el ? el[1] : '', avatar: avatar };
        } catch (e) {}
        return { site: false, host: '', uid: '', name: '', avatar: '' };
      })()`,
      true
    )
    .then((r) => {
      r = r || {};
      // 站点归属优先信页面自报的 hostname，拿不到再退回标签 URL
      const site = r.site || LUOGU_HOST_RE.test(hostOf(t.url));
      if (site) {
        const scraped = r.uid || r.name ? { uid: r.uid || "", name: r.name || "", avatar: r.avatar || "" } : null;
        if (scraped) {
          lastUser = scraped;
        } else {
          /* 洛谷页没扫到用户态（首帧未注入/页面未加载完/真登出）：不再直接
             清空——刮空就清，离开洛谷页头像立刻消失（用户报的正是这个）。
             粘住旧值，同时走网络兜底问一遍：真登出由 refreshUserNet 来清。 */
          refreshUserNet(false);
        }
      }
      sendUser(lastUser);
      // 顺手把登录成功后的真实昵称回填到当前账号记录里
      const name = lastUser && lastUser.name;
      if (name && cfg.activeAccountId) {
        const a = accounts.find((x) => x.id === cfg.activeAccountId);
        if (a && a.name !== name) { a.name = name; saveAccounts(); pushAccountState(); }
      }
    })
    .catch(() => { sendUser(lastUser); });
}

function updateTabMeta(id, patch) {
  const t = tabs.get(id);
  if (!t) return;
  Object.assign(t, patch);
  pushTabsSoon(); // meta 变化高频：80ms 合并（R41）
  if (patch.url) scheduleSaveTabs();
}

function wirePageView(id, view) {
  const wc = view.webContents;
  // 本函数每个 WebContents 只跑一次，但 Electron 内部还会往同一个 wc 上
  // 挂它自己的加载事件，默认阈值 10 会被顶破并刷出 MaxListeners 警告。
  try { wc.setMaxListeners(48); } catch {}

  /* 网页自己进入全屏（Fullscreen API：视频全屏 / 洛谷 IDE 的全屏）：坞自动
     隐藏（R36 用户要求），本标签视图落到整窗——外壳与坞都让开；退出恢复。
     同一时刻只可能有一个标签处于 HTML 全屏（Electron 会把窗口一起带进全屏）。 */
  wc.on("enter-html-full-screen", () => {
    htmlFullscreenTabId = id;
      layoutDock();
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    if (htmlFullscreenTabId === id) htmlFullscreenTabId = null;
    layoutDock();
    layout();
  });

  /* 渲染进程崩溃：页面连同它自己画的壁纸一起白掉，以前没有任何恢复（用户报的
     "有的时候背景会直接消失、重开就好"）。重载一次把文档重建回来；带防重入，
     避免崩溃-重载死循环（R39）。 */
  wc.on("render-process-gone", (_e, details) => {
    if (wc.isDestroyed()) return;
    if (details && details.reason === "clean-exit") return;
    const meta = tabs.get(id);
    if (!meta || meta.crashReloading) return;
    meta.crashReloading = true;
    setTimeout(() => {
      try { if (!wc.isDestroyed()) wc.reload(); } catch {}
      setTimeout(() => { const m = tabs.get(id); if (m) m.crashReloading = false; }, 5000);
    }, 400);
  });

  /* 主框架加载失败给个提示：以前完全静默（地址栏显示新 URL、页面还是旧的），
     用户以为"没反应"。-3 = ERR_ABORTED（被新导航取代/转下载），不提示；
     探针模式下静默（探针故意访问非法域名）。 */
  wc.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (id !== activeTabId) return; // 后台标签的失败不打扰
    if (process.argv.some((a) => /^--lg-[a-z0-9]*test$/.test(a))) return;
    try { mainWin.webContents.send("chrome:toast", "无法加载页面（" + (desc || code) + "）"); } catch {}
  });

  wc.on("did-finish-load", () => {
    if (wc.isDestroyed()) return;
    refreshNavMeta(id);
    const meta = tabs.get(id);
    /* 每站独立缩放：到了这个站就恢复它自己的倍率（用户没为这个站设过就
       保持 1，不动）。恢复时不写回记忆（否则会覆盖用户设的值）。 */
    const zMem = zoomForOrigin(wc.getURL());
    if (zMem && meta && Math.abs((meta.zoom || 1) - zMem) > 0.001) {
      setZoom(meta, zMem, false);
    }
    const isLocal = meta && (isLocalKind(meta.kind) || wc.getURL().startsWith("file:"));
    // 本地页（设置/首页/历史）也要注入：壁纸玻璃层对它们一样成立，只是
    // inject.js 会按页面类型跳过洛谷专属的清扫逻辑（见 apply() 开头的分流）。
    // dom-ready 已完整注入过的文档只补轻量 apply（不重插 CSS），否则兜底全量。
    if (wc.__lgInjected) {
      let isActive = id === activeTabId;
      wc.executeJavaScript(
        `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify(cfgForPages())})`,
        true
      ).catch(() => {});
      wc.executeJavaScript(
        `window.__lgGlass && window.__lgGlass.setTabActive && window.__lgGlass.setTabActive(${isActive ? "true" : "false"})`,
        true
      ).catch(() => {});
    } else {
      injectInto(wc);
    }
    // 加载完还没拿到图标（站点没声明 <link rel=icon> 时 Chromium 不发事件）：
    // 按惯例试 <origin>/favicon.ico，404 时外壳 <img> onerror 会退回默认页标
    const cur = tabs.get(id);
    let favGuess = "";
    if (cur && !cur.favicon && /^https?:/i.test(wc.getURL())) {
      try { favGuess = new URL(wc.getURL()).origin + "/favicon.ico"; } catch {}
    }
    updateTabMeta(id, {
      title: meta && isLocalKind(meta.kind)
        ? (meta.kind === "history" ? "浏览历史" : meta.kind === "home" ? "应用首页" : "Luogu++ 设置")
        : wc.getTitle() || "新标签页",
      url: wc.getURL(),
      loading: false,
      ...(favGuess ? { favicon: favGuess } : {}),
    });
    // 页面缩放是按标签存的，导航回来要重新贴一次（Chromium 会按站点记，但换域就丢）
    if (meta && meta.zoom && meta.zoom !== 1) {
      try { wc.setZoomFactor(meta.zoom); } catch {}
      /* 缩放恢复后必须补推一次视图矩形：--lg-zoom 不更新的话壁纸几何仍按
         旧系数算，页面放大时背景只盖住一部分、露出底色（R39，"背景缺一块"） */
      try { pushViewRect(tabs.get(id), true); } catch {}
    }
    if (!isLocal) recordHistory(wc.getURL(), wc.getTitle());
    if (id === activeTabId) pushUser();
    wc.executeJavaScript("window.__lgNativeTheme || 'unknown'", true)
      .then((t) => {
        // 嗅探结果变了要同时重涂外壳和所有页面：页面的明暗现在也听
        // resolvedTheme（cfgForPages 下发），只推外壳页面就还停在旧色上。
        // R37：只在明确 light/dark 时才认（'unknown' = 底色还没渲染出来/
        // 容器全透明，不许把整机带偏），这是"突然变黑"的另一半根因。
        if ((t === "dark" || t === "light") && t !== lastNative) {
          lastNative = t;
          pushConfigToChrome();
          applyConfigToPages();
        }
      })
      .catch(() => {});
  });
  wc.on("did-navigate", () => {
    if (wc.isDestroyed()) return;
    refreshNavMeta(id);
  });
  wc.on("did-navigate-in-page", () => {
    if (wc.isDestroyed()) return;
    refreshNavMeta(id);
    updateTabMeta(id, { url: wc.getURL() });
    recordHistory(wc.getURL(), wc.getTitle());
    wc.executeJavaScript(
      `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify({ ...cfgForPages(), tabActive: id === activeTabId })})`,
      true
    ).catch(() => {});
    if (id === activeTabId) pushUser();
  });
  // loading 状态与标题分离：标题只认 page-title-updated / did-finish-load，永不回退
  wc.on("did-start-loading", () => {
    // 新文档开始加载：注入标记复位（旧文档的样式表随文档一起没了）
    wc.__lgInjected = false;
    // 旧文档的 IDE 模式判定随文档一起失效（新页面要重新上报）
    if (inPageIdeTabId === id) inPageIdeTabId = null;
    // 图标一并复位：否则地址栏输入新网址跳走后，标签还挂着上一个站的图标
    // （新站的 page-favicon-updated 要等解析到 <link> 才来，中间一直显示旧图标）
    updateTabMeta(id, { loading: true, favicon: "" });
  });
  wc.on("did-stop-loading", () => updateTabMeta(id, { loading: false }));
  wc.on("page-title-updated", (_e, title) => updateTabMeta(id, { title }));
  wc.on("page-favicon-updated", (_e, favs) => {
    // Electron 给的是候选 URL **数组**：整个塞进 t.favicon 会被 img.src 拼成
    // "url1,url2" 永远加载失败 → 图标退回默认页标（用户报的"跳转后图标不变"）
    const favicon = Array.isArray(favs) ? String(favs[0] || "") : String(favs || "");
    if (favicon) updateTabMeta(id, { favicon });
  });
  // Ctrl+滚轮缩放：Chromium 把 ctrl+wheel 请求折算成 zoom-changed 递上来
  wc.on("zoom-changed", (_e, dir) => {
    if (dir === "in" || dir === "out") zoomStepTab(tabs.get(id), dir === "in" ? 1 : -1);
  });
  // 全局静音：新开的标签继承当前状态
  const mt0 = tabs.get(id);
  if (mt0) mt0.muted = !!cfg.muteAll; // 快照的 muted 改吃缓存（R41）
  if (cfg.muteAll) {
    try { wc.setAudioMuted(true); } catch {}
  }
  /* 出声状态变化：节流策略即时跟手（出声的后台标签不节流）+ 静音缓存同步 */
  wc.on("audio-state-changed", () => {
    const mt = tabs.get(id);
    if (mt) { try { mt.muted = wc.isAudioMuted(); } catch {} }
    applyThrottlePolicy();
  });
  // 页内查找结果计数 → 外壳查找条显示"第 x / n 个"
  wc.on("found-in-page", (_e, result) => {
    if (!mainWin || mainWin.isDestroyed()) return;
    try {
      mainWin.webContents.send("chrome:find-result", {
        active: result.activeMatchOrdinal,
        matches: result.matches,
      });
    } catch {}
  });
  // DOM 就绪就注入：用户报"加载时页面大幅度变化"——原流程等 did-finish-load
  // 才注入，加载途中先看到一秒洛谷原生样子（原生顶栏/侧栏全在），注入完
  // 一下子全换掉。dom-ready 时套上样式，原生样子从头就不该出现。
  wc.on("dom-ready", () => {
    if (wc.isDestroyed()) return;
    injectInto(wc).catch(() => {});
    if (id === activeTabId) pushUser();
  });

  // 分屏焦点路由：点击组里另一个窗格，只把 activeTabId 移过去（地址栏/快捷键
  // 跟着焦点走），可见性与分屏几何都不动（窗格位置固定，不换位）。
  wc.on("focus", () => {
    if (id === activeTabId) return;
    const g = activeTabId != null ? splitGroupOf(activeTabId) : null;
    if (g && g.ids.includes(id)) {
      activeTabId = id;
      pushTabs();
      pushUser();
      scheduleSaveTabs();
    }
  });

  // 域名锁 + 新窗口 → 新标签（站外解锁的标签不受域名锁限制）
  wc.on("will-navigate", (e, url) => {
    if (inPageIdeTabId === id) inPageIdeTabId = null; // 导航离开：IDE 全屏判定作废
    if (/^luogu-glass:\/\//i.test(url)) {
      e.preventDefault();
      handleAppCommand(url);
      return;
    }
    const t = tabs.get(id);
    // 本地页标签跳去 http(s)：原地重建成站点标签（见 rebuildTabToSite），
    // 不然标题卡在"设置/历史"、会话也错（洛谷页在 defaultSession 里没登录态）
    if (t && isLocalKind(t.kind) && /^https?:/i.test(url)) {
      e.preventDefault();
      rebuildTabToSite(id, url);
      return;
    }
    if (t && t.unlock) return;
    if (!isAllowed(url)) {
      e.preventDefault();
      // 只把 http(s) 交给系统浏览器：file:// 之类会被 ShellExecute 直接执行
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (/^luogu-glass:\/\//i.test(url)) {
      handleAppCommand(url);
      return { action: "deny" }; // Electron 只认 allow/deny；应用命令走 handleAppCommand
    }
    const t = tabs.get(id);
    /* 中键 / Ctrl+点链接在 Chrome、Edge 里都是**后台**新标签（disposition =
       background-tab）：前台页面不切走。以前一律 activate，中键连点几个链接
       就被切走几次页面。 */
    const bg = disposition === "background-tab";
    if (isAllowed(url)) {
      createTab(url, { activate: !bg });
    } else if (t && t.unlock) {
      createTab(url, { unlock: true, activate: !bg });
    } else if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" }; // Electron 只认 allow/deny（旧值 "prevent" 每次都刷警告）
  });
  /* 网页右键菜单（原生 Menu）：浏览器语义的一组动作，按 params 分支。
     自测/探针里不弹真菜单（会挂在那儿），只把模板标签记下来供断言。 */
  wc.on("context-menu", (_e, params) => {
    try {
      const template = pageContextTemplate(params, id);
      if (!template || !template.length) return;
      if (configtest || argv.includes("--lg-v35test") || argv.includes("--lg-v36test") || argv.includes("--lg-v37test")) {
        lastPageContextMenu = template.map((i) => i.label || i.type);
        return;
      }
      Menu.buildFromTemplate(template).popup({ window: mainWin });
    } catch (e) {
      dbg("context-menu failed: " + e);
    }
  });
}
/* 探针读取用的最近一次网页右键菜单结构 */
let lastPageContextMenu = null;

/* 网页右键菜单模板（按 params 分支：可编辑 / 选中文本 / 链接 / 图片 / 媒体 /
   页面动作）。抽成函数是为了可测：探针直接构造 params 断言条目。 */
function pageContextTemplate(params, tabId) {
  const t = tabs.get(Number(tabId));
  if (!t || !t.view || t.view.webContents.isDestroyed() || !mainWin || mainWin.isDestroyed()) return null;
  const wc = t.view.webContents;
  const p = params && typeof params === "object" ? params : {};
  const items = [];
  const ef = p.editFlags && typeof p.editFlags === "object" ? p.editFlags : {};
  const sel = String(p.selectionText || "").trim();
  const isLocalPage = isLocalKind(t.kind) || /^file:/i.test(t.url || "");
  if (p.isEditable) {
    items.push(
      { label: "撤销", role: "undo", enabled: ef.canUndo !== false },
      { label: "重做", role: "redo", enabled: ef.canRedo !== false },
      { type: "separator" },
      { label: "剪切", role: "cut", enabled: ef.canCut !== false },
      { label: "复制", role: "copy", enabled: ef.canCopy !== false },
      { label: "粘贴", role: "paste", enabled: ef.canPaste !== false },
      { label: "全选", role: "selectAll", enabled: ef.canSelectAll !== false }
    );
  } else if (sel) {
    items.push(
      { label: "复制", role: "copy" },
      { label: "翻译所选内容", click: () => wc.executeJavaScript(`window.__lgGlass && window.__lgGlass.translateSelection && window.__lgGlass.translateSelection(${JSON.stringify(sel)})`, true).catch(() => {}) },
      { label: "用洛谷搜索“" + (sel.length > 16 ? sel.slice(0, 16) + "…" : sel) + "”", click: () => createTab(searchUrlFor(sel)) }
    );
  }
  const link = String(p.linkURL || "");
  if (link) {
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: "在新标签页中打开链接", click: () => openUrlSmart(link) },
      { label: "在后台标签页中打开链接", click: () => openUrlSmart(link, false) },
      { label: "复制链接地址", click: () => clipboard.writeText(link) }
    );
  }
  const src = String(p.srcURL || "");
  const media = String(p.mediaType || "none");
  if (media === "image" && src) {
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: "图片另存为…", click: () => { try { wc.downloadURL(src); } catch {} } },
      { label: "复制图片地址", click: () => clipboard.writeText(src) },
      { label: "在新标签页中打开图片", click: () => openUrlSmart(src) }
    );
  }
  if ((media === "video" || media === "audio") && !/lg-glass-bg/.test(String(p.frameURL || ""))) {
    if (items.length) items.push({ type: "separator" });
    if (media === "video") items.push({ label: "画中画播放", click: () => pipActiveVideo(Number(tabId)) });
    if (src) items.push({ label: "复制媒体地址", click: () => clipboard.writeText(src) });
  }
  if (items.length) items.push({ type: "separator" });
  const nav = wc.navigationHistory || {};
  items.push(
    { label: "后退", enabled: typeof nav.canGoBack === "function" ? nav.canGoBack() : !!wc.canGoBack(), click: () => { try { wc.goBack(); } catch {} } },
    { label: "前进", enabled: typeof nav.canGoForward === "function" ? nav.canGoForward() : !!wc.canGoForward(), click: () => { try { wc.goForward(); } catch {} } },
    { label: "刷新", click: () => { try { wc.reload(); } catch {} } },
    { label: "复制页面地址", enabled: !isLocalPage, click: () => clipboard.writeText(t.url || "") },
    { label: "完整网页截图", click: () => captureFullPage(Number(tabId)) },
    { label: "检查元素", click: () => inspectElementAt(Number(tabId), p.x, p.y) }
  );
  return items;
}
/* 右键里的"打开链接"：洛谷域走站内（锁域），其余走共享会话新标签 */
function openUrlSmart(url, activate = true) {
  const u = String(url || "");
  if (!u) return;
  let host = "";
  try { host = new URL(u).hostname; } catch {}
  if (/(^|\.)luogu\.com\.cn$/i.test(host)) createTab(u, { activate });
  else createTab(u, { activate, unlock: true });
}
/* 检查元素：DevTools 分离窗口 + 定位到点击坐标 */
function inspectElementAt(tabId, x, y) {
  const t = tabs.get(tabId != null ? tabId : activeTabId);
  if (!t || !t.view || t.view.webContents.isDestroyed()) return;
  const wc = t.view.webContents;
  try {
    wc.openDevTools({ mode: "detach" });
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) wc.inspectElement(Math.round(x), Math.round(y));
  } catch (e) { dbg("inspect failed: " + e); }
}
/* 页面里的翻译请求（划词/整页都走这里；CORS 决定了必须主进程出网） */
ipcMain.handle("lg-app:translate", (_e, p) => {
  const req = p && typeof p === "object" ? p : { text: p };
  const texts = Array.isArray(req.texts) ? req.texts : [req.text];
  return translateTexts(texts);
});
/* 阅读模式 / 整页翻译：都是页面侧注入运行时的开关（UI 也跟着页面滚动） */
const runInPage = (tabId, expr) => {
  const t = tabs.get(tabId != null ? tabId : activeTabId);
  if (!t || !t.view || t.view.webContents.isDestroyed()) return Promise.resolve({ ok: false, message: "no-tab" });
  return t.view.webContents.executeJavaScript(expr, true).then((r) => ({ ok: true, result: r })).catch((e) => ({ ok: false, message: String(e) }));
};
ipcMain.handle("lg-app:reader", () => runInPage(null, "window.__lgGlass && window.__lgGlass.readerToggle ? window.__lgGlass.readerToggle() : 'no-runtime'"));
ipcMain.handle("lg-app:translate-page", () => runInPage(null, "window.__lgGlass && window.__lgGlass.translatePage ? window.__lgGlass.translatePage() : 'no-runtime'"));

// 站外标签报标准 Chrome UA：UA 里的 Electron/LuoguLab 令牌会被不少站点的
// 风控逻辑当成异常环境（DeepSeek 实测直接弹"使用环境异常"横幅、微信扫码
// 都盖住），而渲染引擎本来就是同版本的真 Chromium，报 Chrome 名副其实。
// 站内（洛谷系）标签不经过这里，保持原样。
function chromeLikeUA() {
  const chrome = process.versions.chrome || "";
  const plat = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7"
    : process.platform === "linux" ? "X11; Linux x86_64" : "Windows NT 10.0; Win64; x64";
  return "Mozilla/5.0 (" + plat + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + chrome + " Safari/537.36";
}

function createTab(url, { special = false, activate = true, unlock = false, kind = null, preload = null } = {}) {
  const id = ++tabSeq;
  const full = normalizeUrl(url);
  // 会话三分：本地页（设置/首页/历史）走默认会话；洛谷系页面走当前账号的
  // 隔离会话；其他 http(s)（DeepSeek 等站外标签）走站外共享会话——与洛谷
  // 账号分区彻底隔开，切洛谷账号不再波及站外登录态。
  const isLocal = isLocalKind(kind) || /^file:/i.test(full);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 窗口隐藏/最小化时不让 Chromium 掐掉出帧，否则窗口一出来就是全黑首帧
      backgroundThrottling: false,
      session: isLocal ? session.defaultSession : isAllowed(full) ? acctSession(cfg.activeAccountId) : sharedSession(),
      // 站点页也要 preload：注入脚本靠它开题目标签（window.open 在异步
      // 回调里会被弹窗拦截，luogu-glass:// 的 location.href 导航也会被
      // Chromium 掐掉——IPC 是唯一可靠通道）
      preload: preload ? path.join(__dirname, preload) : path.join(__dirname, "preload-page.js"),
    },
  });
  // 视图初始底色用主题纸色：注入生效前哪怕闪出一帧也是素色而不是刺眼白
  try { view.setBackgroundColor("#f7f7f8"); } catch {}
  mainWin.contentView.addChildView(view);
  raisePopup(); // 新站点视图会把弹出层压下去，立即抬回来
  // id 也要存进标签对象：`tabs.get(x.id)` 这种写法依赖它（漏了会导致 closeTab 收到 undefined 后静默返回）
  tabs.set(id, { id, view, title: "新标签页", url: full, special, unlock, kind, zoom: 1, sleeping: false, lastActive: Date.now() });
  tabOrder.push(id);
  wirePageView(id, view);
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  // 站外 http(s) 页在发主文档请求前就得定好 UA（webContents 级，不影响别的标签）
  if (/^https?:/i.test(full) && !isAllowed(full)) {
    try { view.webContents.setUserAgent(chromeLikeUA()); } catch {}
  }
  view.webContents.loadURL(full).catch(() => {});
  if (activate) setActiveTab(id);
  else { layout(); pushTabs(); scheduleSaveTabs(); }
  return id;
}

/* 最近关闭的标签栈（Ctrl+Shift+T 找回；标签页操作菜单「最近关闭」也吃这份） */
const closedStack = [];
function openClosedEntry(last) {
  if (!last) return null;
  if (last.kind === "home") return createHomeTab();
  /* 本地页要走各自的入口重开：直接 createTab(file://) 会带上站点页的
     preload（preload-page.js），本地页的 lgConfig 桥不存在 → 恢复出来的是死页 */
  if (last.kind === "settings") return openSettingsTab();
  if (last.kind === "history") return openHistoryTab();
  return createTab(last.url, { special: !!last.special, activate: true, kind: last.kind || null });
}
function reopenClosedTab() {
  return openClosedEntry(closedStack.pop());
}

function setActiveTab(id) {
  if (!tabs.has(id)) return;
  const tt = tabs.get(id);
  if (tt.sleeping) wakeTab(id); // 睡到自然醒：点回休眠标签先重挂视图
  tt.lastActive = Date.now();
  // 分屏：活动标签所在组全员同显（IDE 抽屉开着时分屏挂起，只显活动标签）。
  // 焦点在窗格之间移动走 webContents focus 事件（只换 activeTabId，不动这里）。
  const g = !(drawerOpen && drawerView) && !inPageIdeFull(id) ? splitGroupOf(id) : null;
  const visSet = g ? g.ids : [id];
  for (const [tid, t] of tabs) {
    if (!t.view) continue; // 休眠标签没有视图
    const vis = visSet.includes(tid);
    try { t.view.setVisible(vis); } catch {}
    // 视频壁纸只让可见标签解码。页面自己感知不到前后台切换
    // （WebContentsView.setVisible(false) 不会把页面切成 hidden），得由外壳通知。
    if (wallIsVideo()) {
      try {
        t.view.webContents
          .executeJavaScript(
            `window.__lgGlass && window.__lgGlass.setTabActive && window.__lgGlass.setTabActive(${vis ? "true" : "false"})`,
            true
          )
          .catch(() => {});
      } catch {}
    }
  }
  activeTabId = id;
  layout();
  pushTabs();
  pushUser();
  scheduleSaveTabs();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  // 记进"最近关闭"，Ctrl+Shift+T 能找回（会话内栈，最多 20 条）
  if (t.url && t.kind !== "home") {
    closedStack.push({ url: t.url, title: t.title, special: !!t.special, kind: t.kind || null });
    if (closedStack.length > 20) closedStack.shift();
  }
  const idx = tabOrder.indexOf(id);
  unsplitSilent(id); // 分屏成员被关：幸存者回到单栏全宽
  if (inPageIdeTabId === id) inPageIdeTabId = null;
  try {
    if (t.view) {
      mainWin.contentView.removeChildView(t.view);
      t.view.webContents.close();
    }
  } catch {}
  tabs.delete(id);
  tabOrder = tabOrder.filter((x) => x !== id);
  pruneGroups(); // 分组成员被关：删完之后空组自动消亡
  layout(); // 关闭的是非活动成员时也要把幸存者的 bounds 收回来
  scheduleSaveTabs();
  if (activeTabId === id) {
    const next = tabOrder[Math.min(idx, tabOrder.length - 1)];
    if (next != null) {
      setActiveTab(next);
    } else {
      app.quit(); // 浏览器语义：关掉最后一个标签 = 退出
      return;
    }
  } else {
    pushTabs();
  }
}

/* 批量换标签用的静默销毁：没有 closeTab 的"关掉最后一个 = 退出"语义。
   切换账号时逐个 closeTab 会在关到最后一个站点标签时把整个应用退出——
   用户看到的"切换失败（应用直接没了）"就是这个。 */
function destroyTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  unsplitSilent(id);
  if (inPageIdeTabId === id) inPageIdeTabId = null;
  try {
    if (t.view) {
      mainWin.contentView.removeChildView(t.view);
      t.view.webContents.close();
    }
  } catch {}
  tabs.delete(id);
  tabOrder = tabOrder.filter((x) => x !== id);
  pruneGroups();
}

/* 本地页（设置/首页/历史）标签被导航到 http(s)：原地重建成正规站点标签。
   不重建的话全是后遗症：kind 停在本地值，did-finish-load 把标题强制写回
   "Luogu++ 设置"（用户报"地址栏输 luogu.com.cn 打开了但栏里还写设置"）；
   而且会话还是本地 defaultSession——洛谷页在账号分区里才是登录态。
   重建=换一个有正确会话的 WebContentsView，kind 清掉，标题/图标交给
   page-title-updated / did-finish-load 正常跟踪。 */
function rebuildTabToSite(id, url) {
  const t = tabs.get(id);
  if (!t || !isLocalKind(t.kind) || !/^https?:/i.test(url || "")) return false;
  unsplitSilent(id);
  try { mainWin.contentView.removeChildView(t.view); t.view.webContents.close(); } catch {}
  const full = normalizeUrl(url);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      session: isAllowed(full) ? acctSession(cfg.activeAccountId) : sharedSession(),
      preload: path.join(__dirname, "preload-page.js"),
    },
  });
  try { view.setBackgroundColor("#f7f7f8"); } catch {}
  mainWin.contentView.addChildView(view);
  raisePopup();
  t.view = view;
  t.kind = null;
  t.special = false;
  t.unlock = !isAllowed(full);
  t.title = "新标签页";
  t.favicon = "";
  t.url = full;
  tabs.set(id, t);
  wirePageView(id, view);
  if (!isAllowed(full)) {
    try { view.webContents.setUserAgent(chromeLikeUA()); } catch {}
  }
  view.webContents.loadURL(full).catch(() => {});
  if (id === activeTabId) {
    try { view.setVisible(true); } catch {}
  }
  layout();
  pushTabs();
  scheduleSaveTabs();
  return true;
}

function toggleIde() {
  /* special 不是 IDE 专属标记：设置/历史页也用 special:true 建标签。
     不加本地页排除的话，设置/历史先于 IDE 存在时 Ctrl+I 全跳到它们头上 */
  const id = tabOrder.find((tid) => {
    const t = tabs.get(tid);
    return t && t.special && !isLocalKind(t.kind);
  });
  if (id != null) {
    // IDE 标签若停在登录页（未登录时被重定向），再次点击则导航回 /ide
    const t = tabs.get(id);
    if (/auth\/login/.test(t.url)) {
      t.url = HOME_URL + "ide";
      t.view.webContents.loadURL(t.url).catch(() => {});
      pushTabs();
    }
    setActiveTab(id);
  } else {
    createTab(HOME_URL + "ide", { special: true });
  }
}

function openSettingsTab(hash) {
  const id = tabOrder.find((tid) => tabs.get(tid).kind === "settings");
  if (id != null) {
    setActiveTab(id);
    if (hash) {
      // 设置页吃 location.hash 定位到某个 section（buildNav 里读的也是它）
      try {
        tabs.get(id).view.webContents
          .executeJavaScript(
            `try{location.hash=${JSON.stringify("#" + encodeURIComponent(hash))};if(typeof showSection==="function")showSection(${JSON.stringify(hash)})}catch(e){}`,
            true
          )
          .catch(() => {});
      } catch {}
    }
    return id;
  }
  const page = path.join(__dirname, "src", "settings", "settings.html");
  const url = "file://" + page.replace(/\\/g, "/") + (hash ? "#" + encodeURIComponent(hash) : "");
  return createTab(url, {
    special: true,
    kind: "settings",
    preload: "preload-config.js",
    activate: true,
  });
}

/* ---------- 启动时的站点标签决定 ----------
   已有洛谷标签就不插手（例如设置页先进来了）；否则按「恢复上次的标签」
   开关决定是还原上次会话，还是开固定的首页 + IDE 双标签。 */
function ensureSiteTabs() {
  if ([...tabs.values()].some((t) => !isLocalKind(t.kind))) return;
  const plainBoot =
    !selftestShot && !configtest && !dumpLogin && !dumpPromo && !dumpIde && !autoLogin &&
    !argv.includes("--lg-tabtest") && !argv.includes("--lg-blobtest");
  const saved = plainBoot && cfg.restoreTabs !== false ? loadTabsState() : null;
  const ids = [];
  if (saved && saved.tabs.length) {
    const idBySavedIdx = new Map(); // 保存时的下标 → 恢复出的新标签 id（分屏对回链用）
    const savedTabs = saved.tabs.slice(0, 12);
    for (let si = 0; si < savedTabs.length; si++) {
      const s = savedTabs[si];
      if (!s.url || s.kind === "settings") continue;
      // 首页/历史这类本地页恢复成对应 kind；file:// 的站点标签（解锁页）照原样开
      if (s.kind === "home" || /\/src\/home\/home\.html$/i.test(s.url || "")) {
        const nid = createHomeTab({ activate: false });
        idBySavedIdx.set(si, nid);
        ids.push(nid);
      } else if (s.kind === "history") {
        /* 历史页是本地页：kind 与 preload-config.js 必须原样带回——通用分支
           重建出来 kind=null + 站点 preload，页面里的 lgConfig 不存在 = 死页 */
        const nid = createTab(s.url, { special: true, kind: "history", preload: "preload-config.js", activate: false });
        idBySavedIdx.set(si, nid);
        ids.push(nid);
      } else if (/^file:/i.test(s.url)) {
        continue;
      } else {
        const nid = createTab(s.url, { special: !!s.special, activate: false });
        const ntab = tabs.get(nid);
        if (ntab) {
          if (s.pinned) ntab.pinned = true;
          // 惰性恢复后标签不再立刻加载：标题先从存档带回，标签条不显示一排"新标签页"
          if (s.title) ntab.title = String(s.title).slice(0, 80);
        }
        idBySavedIdx.set(si, nid);
        ids.push(nid);
      }
    }
    /* 恢复分屏对（R39 起只做左右两格）：新格式 {ids, ratio}；兼容旧格式
       {ids,layout,colRatio..focus}（多格旧存档取前两格、按左右各半降级）与更旧的
       对格式 {i,j,left,ratio}（left 的那位排 ids[0]） */
    for (const sp of Array.isArray(saved.splits) ? saved.splits : []) {
      if (Array.isArray(sp.ids)) {
        const members = sp.ids.map((si) => idBySavedIdx.get(si)).filter((id) => id != null && tabs.has(id));
        if (members.length >= 2) {
          const ratio = sp.ratio != null ? sp.ratio : sp.colRatio;
          const g = { ids: members.slice(0, 2), colRatio: clampNum(ratio, RATIO_MIN, RATIO_MAX, 0.5) };
          for (const m of g.ids) { unsplitSilent(m); splits.set(m, g); }
          makeSplitContiguous(g);
        }
      } else {
        const a = idBySavedIdx.get(sp.i);
        const b = idBySavedIdx.get(sp.j);
        const lf = idBySavedIdx.get(sp.left);
        if (a != null && b != null && tabs.has(a) && tabs.has(b) && (lf === a || lf === b)) {
          const g = { ids: lf === b ? [b, a] : [a, b], colRatio: clampNum(sp.ratio, RATIO_MIN, RATIO_MAX, 0.5) };
          unsplitSilent(a);
          unsplitSilent(b);
          splits.set(g.ids[0], g);
          splits.set(g.ids[1], g);
        }
      }
    }
    /* 恢复标签分组：组元数据按旧 id 建组（换新 id），成员按保存的下标回链 */
    const savedGroups = Array.isArray(saved.groups) ? saved.groups : [];
    if (savedGroups.length) {
      const gidMap = new Map(); // 保存时的 groupId → 恢复出的新 groupId
      for (const sg of savedGroups) {
        const gid = ++groupSeq;
        tabGroups.set(gid, {
          id: gid,
          name: typeof sg.name === "string" ? sg.name.slice(0, 40) : "",
          color: GROUP_PALETTE.includes(sg.color) ? sg.color : GROUP_PALETTE[0],
          collapsed: !!sg.collapsed,
        });
        gidMap.set(sg.id, gid);
      }
      for (let si = 0; si < savedTabs.length; si++) {
        const og = savedTabs[si] && savedTabs[si].group;
        if (og == null || !gidMap.has(og)) continue;
        const nid = idBySavedIdx.get(si);
        const t = nid != null ? tabs.get(nid) : null;
        if (t) t.groupId = gidMap.get(og);
      }
      pruneGroups(); // 成员全丢的组不复活
    }
  }
  if (ids.length) {
    setActiveTab(ids[Math.min(Math.max(0, saved.activeIndex | 0), ids.length - 1)]);
    /* 惰性恢复（R41）：非活动/非分屏/非钉住/非本地的恢复标签直接睡——标签位、
       标题、分组都保留，点回去 wakeTab 重建。省掉启动时 N 路并发加载（网络
       风暴）与十几个渲染进程的冷启动内存。 */
    let lazySlept = 0;
    for (const id of ids.slice()) {
      if (id === activeTabId) continue;
      const t = tabs.get(id);
      if (!t || t.pinned || isLocalKind(t.kind) || splitGroupOf(id)) continue;
      if (makeSleeping(id)) lazySlept++;
    }
    if (lazySlept) {
      pushTabs();
      scheduleSaveTabs();
      dbg("lazyRestore: slept " + lazySlept + "/" + ids.length + " restored tab(s)");
    }
  } else {
    // 常规启动开应用首页（本地起始页）。早先固定开洛谷首页/塞 IDE 标签，
    // IDE 用 Ctrl+I 或快捷入口随用随开。--lg-url 是探针/调试的覆盖入口。
    if (argv.some((a) => a.startsWith("--lg-url="))) createTab(START_URL, { activate: true });
    else createHomeTab();
  }
}

/* 本地页（首页 / 设置 / 历史）不算站点标签：启动逻辑与自测探针都靠这个判断 */
const isLocalKind = (k) => k === "settings" || k === "history" || k === "home";

/* 应用首页统一入口：preload 用本地页桥（lgConfig + lgApp.wallImage） */
function createHomeTab({ activate = true } = {}) {
  return createTab(HOME_PAGE_URL, { activate, kind: "home", preload: "preload-config.js" });
}

function openHistoryTab() {
  const id = tabOrder.find((tid) => tabs.get(tid).kind === "history");
  if (id != null) {
    setActiveTab(id);
    return id;
  }
  const page = path.join(__dirname, "src", "history", "history.html");
  return createTab("file://" + page.replace(/\\/g, "/"), {
    special: true,
    kind: "history",
    preload: "preload-config.js",
    activate: true,
  });
}

function navigateActive(url, { unlock = false } = {}) {
  const t = tabs.get(activeTabId);
  if (!t) return;
  const full = normalizeUrl(url);
  // 不劫持 IDE 特殊标签：站外/映射目标一律开新标签
  if (t.special && !isAllowed(full)) {
    createTab(full, { unlock: true });
    return;
  }
  // 本地页标签（设置/首页/历史）输网址：原地重建成站点标签，
  // 不然标题卡在"Luogu++ 设置"、洛谷页还没登录态（见 rebuildTabToSite）
  if (isLocalKind(t.kind) && /^https?:/i.test(full)) {
    rebuildTabToSite(activeTabId, full);
    return;
  }
  t.url = full;
  t.unlock = unlock && !isAllowed(full);
  t.view.webContents.loadURL(full).catch(() => {});
  pushTabs();
}

function isAllowed(url) {
  try {
    return ALLOWED_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function resolvedTheme() {
  if (cfg.theme === "dark" || cfg.theme === "light") return cfg.theme;
  return lastNative;
}

function pushConfigToChrome() {
  if (!mainWin || mainWin.isDestroyed()) return;
  try {
    const rt = resolvedTheme();
    mainWin.webContents.send("chrome:config", {
      ...cfgForPages(),
      resolvedTheme: rt,
      presetVars: themeVars(cfg.preset, rt === "dark" ? "dark" : "light"),
      // 快捷键表（含用户自定义）：F1 总览与命令面板 hint 用，外壳不再自己抄
      shortcutRows: shortcutRows(),
    });
  } catch {}
}

/* 把所有已注入的页面（标签页 + 分屏编辑器）实时重涂 */
function applyConfigToPages() {
  // tabActive 每个标签不一样（视频壁纸靠它决定播不播），所以不能一份 payload 通吃
  const base = cfgForPages();
  for (const [tid, t] of tabs) {
    const payload = `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify({ ...base, tabActive: tid === activeTabId })})`;
    try { t.view.webContents.executeJavaScript(payload, true).catch(() => {}); } catch {}
  }
  if (drawerView) {
    const payload = `window.__lgGlass && window.__lgGlass.apply(${JSON.stringify({ ...base, tabActive: false })})`;
    try { drawerView.webContents.executeJavaScript(payload, true).catch(() => {}); } catch {}
  }
}

function syncOverlayTheme() {
  if (!mainWin || mainWin.isDestroyed() || cfg.frameless === false) return;
  const dark = resolvedTheme() === "dark";
  try {
    mainWin.setTitleBarOverlay(
      dark
        ? { color: "#171a24", symbolColor: "#e8eaf0" }
        : { color: "#eef2f8", symbolColor: "#2a2f3a" }
    );
  } catch {}
}

/* ============================================================
   主窗口
   ============================================================ */
/* 窗口落点自愈：显示器拔插、分辨率/缩放变化之后，系统给的落点可能整块落在
   所有屏幕之外——表现就是"应用启动了但看不见，任务栏里有进程"。
   只要窗口和任何工作区没有足够交集，就拉回主屏居中。 */
function ensureOnScreen(win) {
  try {
    const b = win.getBounds();
    const ok = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        b.x < a.x + a.width - 120 &&
        b.x + b.width > a.x + 120 &&
        b.y < a.y + a.height - 60 &&
        b.y + b.height > a.y + 60
      );
    });
    if (ok) return;
    const a = screen.getPrimaryDisplay().workArea;
    const w = Math.min(b.width || 1440, a.width);
    const h = Math.min(b.height || 920, a.height);
    win.setBounds({
      x: a.x + Math.round((a.width - w) / 2),
      y: a.y + Math.round((a.height - h) / 2),
      width: w,
      height: h,
    });
  } catch {}
}

function createMainWindow() {
  const winState = loadWindowState();
  const win = new BrowserWindow({
    ...windowBoundsFor(winState),
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: resolvedTheme() === "dark" ? "#101013" : "#f4f4f5",
    title: "Luogu++",
    autoHideMenuBar: true,
    frame: cfg.frameless === false,
    titleBarStyle: cfg.frameless === false ? "default" : "hidden",
    // 不用系统的 titleBarOverlay：它画在窗口右上角，会压住账号芯片。
    // 三个窗口按钮由外壳自绘（#wctl），与芯片同一行排在它右边。
    titleBarOverlay: false,
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload-chrome.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWin = win;
  perfMarks.winCreated = Date.now();
  win.loadFile(path.join(__dirname, "src", "chrome", "chrome.html"));

  win.webContents.on("did-finish-load", () => {
    perfMarks.chromeLoaded = Date.now();
    // chrome 层就绪 → 开第一个标签页
    pushConfigToChrome();
    pushAccountState();
    pushDownloads();
    pushWinState();
    /* R42：启动期"文件损坏已备份"/"写盘失败"在此一次性告诉用户（此前全静默） */
    flushPersistenceNotes();
    ensureSiteTabs();
  });

  /* R41：resize 逐事件同步 layout() 在拖窗时每秒触发几十次（每次全标签
     setBounds + pushViewRect + dock:rect IPC）。改 200ms 首拍直通 + 32ms
     尾随合并——拖动中间不再逐帧全量重排，松手后最终几何必落一次。 */
  let resizeLayoutTimer = null;
  let lastResizeLayoutAt = 0;
  win.on("resize", () => {
    scheduleSaveWindowState();
    const now = Date.now();
    if (now - lastResizeLayoutAt > 200) {
      lastResizeLayoutAt = now;
      layout();
      return;
    }
    if (resizeLayoutTimer) return;
    resizeLayoutTimer = setTimeout(() => {
      resizeLayoutTimer = null;
      lastResizeLayoutAt = Date.now();
      layout();
    }, 32);
  });
  win.on("move", scheduleSaveWindowState);
  win.on("maximize", () => { layout(); pushWinState(); scheduleSaveWindowState(); });
  win.on("unmaximize", () => { layout(); pushWinState(); scheduleSaveWindowState(); });
  win.on("enter-full-screen", layout);
  win.on("leave-full-screen", layout);
  /* 换显示器 / 改 DPI / 分辨率变了：以前没有任何处理，视图几何与壁纸会停在
     旧尺寸上（"背景错位/缺一块"的一条），这里跟着重排一次（R39） */
  win.on("display-metrics-changed", () => { layout(); });

  win.on("close", () => {
    // 防抖可能吞掉最后一次改动：关窗前无条件补写（此刻窗口还活着，读得到边界）
    clearTimeout(winSaveTimer);
    winSaveTimer = null;
    saveWindowState();
    clearTimeout(tabsSaveTimer);
    tabsSaveTimer = null;
    saveTabsState();
    for (const t of tabs.values()) {
      try { t.view.webContents.close(); } catch {}
    }
  });
  win.on("closed", () => { mainWin = null; });

  installAccelerators();
  win.once("ready-to-show", () => {
    perfMarks.readyShown = Date.now();
    ensureOnScreen(win);
    // 这两个探针要自己控制窗口可见性（前台可能在玩游戏），别替它们亮出来；
    // --lg-hidden / LG_HIDDEN=1：后台测试模式，全程不亮窗不抢前台
    const quietProbe =
      argv.includes("--lg-blanktest") ||
      argv.includes("--lg-walltest") ||
      argv.includes("--lg-hidden") ||
      process.env.LG_HIDDEN === "1";
    // 上次是最大化退出 → 复原最大化（隐藏探针不抢焦点，不做）
    if (winState && winState.maximized && !quietProbe) win.maximize();
    if (!quietProbe) win.show();
    // 站点视图是趁窗口不可见的时候加载完的，补两拍把首帧画出来
    setTimeout(repaintSiteViews, 300);
    setTimeout(repaintSiteViews, 1200);
    /* 弹层视图预热：悬停浮层与所有下拉菜单都画在它里面。第一次要用时才新建
       视图的话，文档还没加载完视图就先亮出来 = 白闪一帧（悬停"闪一下"的
       另一半）。启动后在空闲时先把它立起来。 */
    setTimeout(() => { try { ensurePopupView(); } catch (e) {} }, 1500);
  });
  win.on("restore", () => setTimeout(repaintSiteViews, 260));
  win.on("show", () => setTimeout(repaintSiteViews, 260));
  return win;
}

/* ---------- 快捷键（菜单加速器，隐藏菜单栏仍生效） ---------- */
/* ============================================================
   快捷键动作表：id / 显示名 / 默认键位 / 动作。
   菜单加速器、设置页快捷键区、F1 总览、命令面板 hint、全局热键全部从这张表
   派生（以前 SHORTCUT_ROWS 与 chrome.js 各抄一份，总对不上）。
   cfg.shortcuts[id] 覆盖默认键位；值为 "" 表示用户解绑该快捷键。
   ============================================================ */
const SHORTCUT_ACTIONS = [
  ["new-tab", "新建标签页", "CmdOrCtrl+T", () => createHomeTab()],
  ["close-tab", "关闭当前标签页", "CmdOrCtrl+W", () => closeTab(activeTabId)],
  ["next-tab", "下一个标签页", "Ctrl+Tab", () => cycleTab(1)],
  ["prev-tab", "上一个标签页", "Ctrl+Shift+Tab", () => cycleTab(-1)],
  ["reload", "重新加载", "CmdOrCtrl+R", () => { const t = tabs.get(activeTabId); t && t.view.webContents.reload(); }],
  ["reload-f5", "重新加载 (F5)", "F5", () => { const t = tabs.get(activeTabId); t && t.view.webContents.reload(); }],
  ["reopen-tab", "恢复最近关闭的标签页", "CmdOrCtrl+Shift+T", () => reopenClosedTab()],
  ["fullscreen", "全屏切换", "F11", () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    mainWin.setFullScreen(!mainWin.isFullScreen());
    setTimeout(repaintSiteViews, 320);
  }],
  ["focus-omni", "聚焦地址栏", "CmdOrCtrl+L", () => { try { mainWin.webContents.send("chrome:focus-omni"); } catch {} }],
  ["palette", "命令面板", "CmdOrCtrl+Shift+P", () => { try { mainWin.webContents.send("chrome:palette"); } catch {} }],
  ["tab-search", "搜索标签页", "CmdOrCtrl+Shift+A", () => { try { mainWin.webContents.send("chrome:tab-search"); } catch {} }],
  ["shortcut-help", "键盘快捷键总览", "F1", () => { try { mainWin.webContents.send("chrome:shortcuts"); } catch {} }],
  ["find", "页内查找（Esc 退出）", "CmdOrCtrl+F", () => { try { mainWin.webContents.send("chrome:find"); } catch {} }],
  ["screenshot", "截图当前页", "CmdOrCtrl+Shift+S", () => screenshotActiveTab()],
  ["history", "历史记录（历史 / 下载）", "CmdOrCtrl+H", () => openHistoryTab()],
  ["ide", "打开或切到 IDE 标签页", "CmdOrCtrl+I", () => toggleIde()],
  /* 分屏编辑器（题目右侧并排 IDE 的抽屉）：坞在 IDE 模式会自动隐藏，
     这条键是藏起来之后的主要出口（命令面板里也有同一入口） */
  ["drawer", "分屏编辑器（题目右侧并排 IDE）", "CmdOrCtrl+Alt+I", () => toggleDrawer()],
  ["back", "后退", "Alt+Left", () => { const t = tabs.get(activeTabId); t && t.view.webContents.goBack(); }],
  ["forward", "前进", "Alt+Right", () => { const t = tabs.get(activeTabId); t && t.view.webContents.goForward(); }],
  /* 页面缩放：Ctrl+= 与 Ctrl++ 都要接，键盘布局不同报出来的字符也不同 */
  ["zoom-in", "放大页面", "CmdOrCtrl+Plus", () => zoomStep(1)],
  ["zoom-in-eq", "放大页面 (=)", "CmdOrCtrl+=", () => zoomStep(1)],
  ["zoom-out", "缩小页面", "CmdOrCtrl+-", () => zoomStep(-1)],
  ["zoom-reset", "重置页面缩放", "CmdOrCtrl+0", () => { const t = tabs.get(activeTabId); if (t) setZoom(t, 1); }],
  ["settings", "Luogu++ 设置", "F2", () => openSettingsTab()],
  /* 垂直标签栏钉住 / 收起：默认不绑键（设置页可自定义），标签页操作菜单里
     的"布局"开关也吃同一个动作 */
  ["vtab", "垂直标签栏：钉住 / 收起", "", () => toggleVtabPin()],
  /* 整理标签页（按站点排序，保分组）：结果提示与撤销在外壳的 toast 上 */
  ["organize", "整理标签页（按站点排序）", "CmdOrCtrl+Shift+O", () => { try { mainWin.webContents.send("chrome:organize-done", runOrganize("sort-domain")); } catch {} }],
  /* 清除浏览数据：直接打开设置页并定位到那张卡片（Chrome 的 Ctrl+Shift+Del 语义） */
  ["clear-data", "清除浏览数据", "CmdOrCtrl+Shift+Delete", () => { openSettingsTab("其他/清除浏览数据"); }],
  /* 阅读模式与整页翻译：默认不绑键（设置页可自定义） */
  ["reader", "阅读模式（进入 / 退出）", "", () => { runInPage(null, "window.__lgGlass && window.__lgGlass.readerToggle ? window.__lgGlass.readerToggle() : 'no-runtime'"); }],
  ["translate-page", "翻译整页（原文 / 译文）", "", () => { runInPage(null, "window.__lgGlass && window.__lgGlass.translatePage ? window.__lgGlass.translatePage() : 'no-runtime'"); }],
  ["quit", "退出", "CmdOrCtrl+Q", () => app.quit()],
  /* 全局唤起热键：不走应用菜单（globalShortcut 注册），动作是 null */
  ["global-toggle", "全局唤起 / 隐藏应用", "Ctrl+Alt+L", null],
];

/* 生效键位：用户覆盖 > 默认；"" = 已解绑（不注册） */
function accelFor(id) {
  const row = SHORTCUT_ACTIONS.find((r) => r[0] === id);
  if (!row) return "";
  if (cfg.shortcuts && Object.prototype.hasOwnProperty.call(cfg.shortcuts, id)) {
    const o = cfg.shortcuts[id];
    return typeof o === "string" ? o : "";
  }
  return row[2];
}
/* 展示用键位：CmdOrCtrl→Ctrl、方向键画箭头 */
function accelDisplay(accel) {
  const s = String(accel || "");
  if (!s) return "未绑定";
  return s.replace(/CmdOrCtrl/g, "Ctrl").replace(/Plus/g, "+").replace(/Left/g, "←").replace(/Right/g, "→");
}
function shortcutRows() {
  return SHORTCUT_ACTIONS.map(([id, label, def]) => ({
    id,
    label,
    accel: accelFor(id),
    text: accelDisplay(accelFor(id)),
    def,
    overridden: !!(cfg.shortcuts && Object.prototype.hasOwnProperty.call(cfg.shortcuts, id)),
  }));
}

function installAccelerators() {
  const act = (fn) => () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    try { fn(); } catch (e) { dbg("shortcut action failed: " + e); }
  };
  const tabItems = [];
  const appItems = [];
  for (const [id, label, , fn] of SHORTCUT_ACTIONS) {
    if (!fn) continue; // 全局热键不走菜单
    const accel = accelFor(id);
    if (!accel) continue; // 用户解绑
    const item = { label, accelerator: accel, click: act(fn) };
    (id === "settings" || id === "quit" ? appItems : tabItems).push(item);
  }
  let menu = null;
  try {
    menu = Menu.buildFromTemplate([
      { label: "Luogu++", submenu: [{ role: "about" }] },
      { label: "标签", submenu: tabItems },
      { label: "应用", submenu: appItems },
    ]);
  } catch (e) {
    // 用户自定义出了非法键位：回退默认全表保住可用性，并清掉坏覆盖
    dbg("installAccelerators: invalid custom accelerator, reset overrides: " + e);
    cfg.shortcuts = {};
    saveConfig();
    try {
      menu = Menu.buildFromTemplate([
        { label: "Luogu++", submenu: [{ role: "about" }] },
        {
          label: "标签",
          submenu: SHORTCUT_ACTIONS.filter((r) => r[3]).map(([id, label, def, fn]) => ({
            label, accelerator: def, click: act(fn),
          })).filter((it) => it.label !== "Luogu++ 设置" && it.label !== "退出" && it.accelerator),
        },
        {
          label: "应用",
          submenu: SHORTCUT_ACTIONS.filter((r) => r[3] && (r[0] === "settings" || r[0] === "quit")).map(([, label, def, fn]) => ({
            label, accelerator: def, click: act(fn),
          })),
        },
      ]);
    } catch (e2) {
      dbg("installAccelerators fallback failed: " + e2);
      return;
    }
  }
  Menu.setApplicationMenu(menu);
}

/* ---------- 页面缩放（浏览器语义：每标签各自一份） ---------- */
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/* 每站独立缩放：按域名记住倍率（Edge 的行为——在某个站放大过，下次回到
   那个站还是那个倍数，不必每个标签重按一遍）。存 cfg.zoomByOrigin，跨会话
   有效。倍率回到 1 就删掉这一条，不留"曾经是 1.0"的垃圾数据。 */
function originKeyOf(url) {
  try { return new URL(String(url || "")).hostname || ""; } catch (e) { return ""; }
}
function zoomMap() {
  return cfg.zoomByOrigin && typeof cfg.zoomByOrigin === "object" ? cfg.zoomByOrigin : {};
}
function rememberZoomFor(t) {
  if (!t) return;
  const k = originKeyOf(t.url);
  if (!k) return;
  const m = zoomMap();
  const cur = t.zoom || 1;
  if (Math.abs(cur - 1) < 0.001) delete m[k];
  else m[k] = cur;
  cfg.zoomByOrigin = m;
  scheduleSaveConfig();
}
function zoomForOrigin(url) {
  const k = originKeyOf(url);
  if (!k) return null;
  const v = zoomMap()[k];
  return typeof v === "number" && v > 0.25 && v <= 3 ? v : null;
}
function setZoom(t, z, remember) {
  t.zoom = z;
  try { if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.setZoomFactor(z); } catch {}
  /* 缩放变了 → 壁纸的反向补偿系数（--lg-zoom）要跟着更新：立刻推一次，
     渲染器真正应用缩放后再补一次（setZoomFactor 是异步生效的）。 */
  try { pushViewRect(t, true); } catch {}
  setTimeout(() => { try { pushViewRect(t, true); } catch {} }, 180);
  /* 只有**用户主动**缩放才写进每站记忆；导航时按记忆恢复不能反过来覆盖记忆 */
  if (remember) rememberZoomFor(t);
  pushTabs();
}
/* dir: +1 放大 / -1 缩小。菜单加速器作用于活动标签；Ctrl+滚轮的
   zoom-changed 事件带着自己的 webContents，各缩各的。
   本地页（设置/首页/历史）同样可缩：整页视图一起缩，玻璃层跟着走。 */
function zoomStepTab(t, dir) {
  if (!t) return;
  const cur = t.zoom || 1;
  let i = ZOOM_STEPS.indexOf(cur);
  if (i < 0) i = ZOOM_STEPS.indexOf(1);
  setZoom(t, ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))], true);
}
function zoomStep(dir) {
  zoomStepTab(tabs.get(activeTabId), dir);
}

function cycleTab(dir) {
  if (!tabOrder.length) return;
  const i = tabOrder.indexOf(activeTabId);
  const n = (i + dir + tabOrder.length) % tabOrder.length;
  setActiveTab(tabOrder[n]);
}

/* ============================================================
   IPC
   ============================================================ */
// 附带主进程统一裁决的明暗：设置/历史等本地页不再各自 matchMedia 猜一遍
// （外壳用 lastNative、设置页用系统深色，两边曾对不上），全应用一个答案。
ipcMain.handle("lg-config:get", () => ({ ...cfg, resolvedTheme: resolvedTheme() }));

/* 快捷键表（含用户自定义覆盖）：表在主进程一处维护，设置页只渲染 */
ipcMain.handle("lg-config:shortcuts", () => ({ rows: shortcutRows() }));

/* 设置页要拿预设清单渲染色卡——色表只在主进程维护一处。
   顺带把"当前种子混出来的实际色"也发下去，设置页才能预览真实效果。 */
ipcMain.handle("lg-config:presets", () => ({
  list: [
    ...Object.keys(PRESETS).map((id) => ({
      id,
      label: PRESETS[id].label,
      desc: PRESETS[id].desc,
      light: PRESETS[id].light,
      dark: PRESETS[id].dark,
    })),
    /* 自定义基色：取色器改 cfg.customBase，themeVars("custom") 现算 */
    {
      id: "custom",
      label: "自定义",
      desc: "自己挑底色与文字色（选中后用下方的取色器）",
      light: { bgBase: (cfg.customBase && cfg.customBase.bg) || "#f7f7f8", ink: (cfg.customBase && cfg.customBase.ink) || "#18181b" },
      dark: { bgBase: (cfg.customBase && cfg.customBase.bg) || "#f7f7f8", ink: (cfg.customBase && cfg.customBase.ink) || "#18181b" },
    },
  ],
  current: cfg.preset || "ink",
  seed: cfg.themeSeed || "",
  strength: clampNum(cfg.themeStrength, 0, 100, 45),
  derivedLight: themeVars(cfg.preset, "light"),
  derivedDark: themeVars(cfg.preset, "dark"),
  // 本地页贴色要用"主进程裁决的那一套"：与外壳、洛谷页完全一致
  resolvedTheme: resolvedTheme(),
  derivedResolved: themeVars(cfg.preset, resolvedTheme() === "dark" ? "dark" : "light"),
}));

ipcMain.handle("lg-config:set", (_e, patch) => {
  const needRelaunch = patch && "frameless" in patch && patch.frameless !== cfg.frameless;
  /* 旧的两颗不透明度（barAlpha/cardAlpha）已合并成 faceAlpha：老设置页/老
     脚本仍在写旧键时，归一到一个值，不允许材质再出现第二种浓度。 */
  if (patch && patch.faceAlpha == null && (patch.cardAlpha != null || patch.barAlpha != null)) {
    patch = { ...patch, faceAlpha: patch.cardAlpha != null ? patch.cardAlpha : patch.barAlpha };
  }
  cfg = { ...cfg, ...(patch || {}) };
  cfg.faceAlpha = clampNum(cfg.faceAlpha, 0.3, 1, 0.92);
  /* 搜索引擎与去重策略归一：非法 id / 不含 %s 的自定义模板一律退回默认，
     免得地址栏搜出一串坏 URL */
  if (cfg.searchEngine === "custom") {
    if (!String(cfg.searchCustom || "").includes("%s")) cfg.searchEngine = "luogu";
  } else if (!SEARCH_ENGINES[cfg.searchEngine]) {
    cfg.searchEngine = "luogu";
  }
  if (!DEDUPE_POLICIES.includes(cfg.dedupeKeep)) cfg.dedupeKeep = "active";
  /* 翻译服务归一：自定义端点必须含 %s，否则退回必应 */
  if (cfg.translateProvider === "custom") {
    if (!String(cfg.translateCustom || "").includes("%s")) cfg.translateProvider = "bing";
  } else if (cfg.translateProvider !== "bing") {
    cfg.translateProvider = "bing";
  }
  /* 视差归零：关掉视差、或换了壁纸时，三层壁纸一起回到起点——留着旧偏移
     会出现"换了张壁纸但画还是斜的"。 */
  if (cfg.wallpaperParallax === false || (patch && ("wallpaper" in patch || "wallpaperKind" in patch))) {
    parReset();
  }
  /* 紧凑模式现在是独立一轴（只改宽度，不动钉住状态）：以前"开紧凑 = 强制
     未钉住"，导致"钉住 → 开紧凑 → 关紧凑"之后回不到钉住态（用户报的
     "展开状态切来切去丢了"）。钉住动作仍会先关紧凑（见 toggleVtabPin）。 */
  saveConfig();
  pushConfigToChrome();
  // 所有页面标签实时重涂
  applyConfigToPages();
  syncOverlayTheme();
  layout(); // 垂直标签模式切换后页面视图要重新让位
  // 热键开关变化即时生效
  if (patch && "showHideHotkey" in patch) registerGlobalHotkey();
  // 自定义快捷键覆盖表变化：菜单加速器与全局热键都按新表重装
  if (patch && patch.shortcuts && typeof patch.shortcuts === "object") {
    installAccelerators();
    registerGlobalHotkey();
  }
  return { ok: true, needRelaunch };
});

/* 壁纸字节：外壳层和每个站点页各取一次，自己转 blob URL（见上面注释） */
ipcMain.handle("lg-wall:video", () => wallpaperVideoPayload());
ipcMain.handle("lg-wall:video-blob", () => wallpaperVideoBlobPayload());
ipcMain.handle("lg-wall:image", () => wallpaperImagePayload());

/* ---------- 壁纸集合（多张 + 随机/顺序轮换 + md5 去重） ----------
   单一事实来源是 wallpapers 目录本身：导入=复制文件进目录，删除=删文件，
   集合顺序=文件名（导入时用时间戳命名，天然按导入顺序）。cfg.wallpapers
   不再单独维护，避免两处数据不同步。 */
const WALL_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
const wallpapersDir = () => path.join(app.getPath("userData"), "wallpapers");
/* md5 带缓存（path+mtime+size）：lg-wall:list 每次都会跑去重，没缓存的话
   大视频壁纸每次列目录都全量读一遍 */
const md5Cache = new Map(); // path -> { mtimeMs, size, md5 }
function fileMd5(p) {
  const st = fs.statSync(p);
  const hit = md5Cache.get(p);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.md5;
  const md5 = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
  md5Cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, md5 });
  return md5;
}
const isWallFile = (f) => WALL_EXTS.includes(path.extname(f).toLowerCase()) || isVideoFile(f);

function listWallpaperFiles() {
  try {
    return fs.readdirSync(wallpapersDir())
      .filter((f) => !f.startsWith(".") && isWallFile(f))
      .sort()
      .map((f) => path.join(wallpapersDir(), f));
  } catch {
    return [];
  }
}
/* 目录内容有变（导入/删除/手动改）之后把当前壁纸拉回合法值。R39：判据从
   "存在"升级为"可读"——文件在但读不出来（盘掉线/权限/损坏）同样算失效，
   顺延到集合里最后一个可读的文件；一个都没有就清空走渐变兜底。 */
function reconcileWallpaper() {
  const items = listWallpaperFiles();
  const ok = (f) => {
    if (!f) return false;
    try { fs.accessSync(f, fs.constants.R_OK); return true; } catch { return false; }
  };
  if (cfg.wallpaper && !ok(cfg.wallpaper)) {
    let next = "";
    for (let i = items.length - 1; i >= 0; i--) if (ok(items[i])) { next = items[i]; break; }
    cfg.wallpaper = next;
  }
  if (!cfg.wallpaper && items.length) {
    for (let i = items.length - 1; i >= 0; i--) if (ok(items[i])) { cfg.wallpaper = items[i]; break; }
  }
}
function dedupeWallpaperDir() {
  let removed = 0;
  try {
    const files = listWallpaperFiles();
    const seen = new Map();
    for (const f of files) {
      let h;
      try { h = fileMd5(f); } catch { continue; }
      if (seen.has(h)) {
        try {
          if (cfg.wallpaper === f) cfg.wallpaper = seen.get(h);
          fs.unlinkSync(f);
          removed++;
        } catch { /* 文件被占用就留着 */ }
      } else seen.set(h, f);
    }
  } catch { /* 目录不存在 */ }
  reconcileWallpaper();
  if (removed) saveConfig();
  return removed;
}
function rotateWallpaper() {
  const items = listWallpaperFiles();
  if (!items.length) return cfg.wallpaper || "";
  let next;
  if (cfg.wallpaperMode === "shuffle" && items.length > 1) {
    next = cfg.wallpaper;
    let guard = 12;
    while (next === cfg.wallpaper && guard-- > 0) next = items[Math.floor(Math.random() * items.length)];
  } else {
    const i = items.indexOf(cfg.wallpaper);
    next = items[(i + 1) % items.length]; // i=-1（当前不在集合里）时正好落到第一张
  }
  cfg.wallpaper = next;
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return next;
}
let wallTimer = null;
function scheduleWallpaperRotate() {
  if (wallTimer) { clearInterval(wallTimer); wallTimer = null; }
  if (cfg.wallpaperMode !== "single" && Number(cfg.wallpaperRotateMin) > 0) {
    wallTimer = setInterval(rotateWallpaper, Math.max(1, Number(cfg.wallpaperRotateMin)) * 60000);
  }
}

ipcMain.handle("lg-wall:list", () => {
  // 列目录即去重（md5 有缓存，非首次几乎零成本）：以前只在启动/手动/导入时
  // 去重，老版本或旧通道留下的重复文件会一直挂在设置页网格里（"有重复壁纸"）
  dedupeWallpaperDir();
  reconcileWallpaper();
  const items = listWallpaperFiles().map((p) => ({
    path: p,
    name: path.basename(p),
    size: (() => { try { return fs.statSync(p).size; } catch { return 0; } })(),
    video: isVideoFile(p),
  }));
  return {
    ok: true,
    items,
    current: cfg.wallpaper || "",
    mode: cfg.wallpaperMode || "single",
    rotateMin: Number(cfg.wallpaperRotateMin) || 0,
  };
});
/* 导入：多选文件 → 复制进集合目录；内容相同的文件（md5 相同）只留一份 */
ipcMain.handle("lg-wall:import", async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: "导入壁纸到集合",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "图片 / 视频", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm"] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, added: 0, skipped: 0 };
  const dir = wallpapersDir();
  fs.mkdirSync(dir, { recursive: true });
  const known = new Set();
  for (const f of listWallpaperFiles()) {
    try { known.add(fileMd5(f)); } catch { /* 读不动的跳过 */ }
  }
  // 当前壁纸可能不在集合目录里（外部路径直接指用）：它的内容也要计入判重集，
  // 否则导入一张与当前壁纸内容相同的图就重复了
  if (cfg.wallpaper && path.dirname(cfg.wallpaper) !== wallpapersDir() && fs.existsSync(cfg.wallpaper)) {
    try { known.add(fileMd5(cfg.wallpaper)); } catch { /* 读不动算了 */ }
  }
  let added = 0, skipped = 0, firstNew = "";
  for (const src of r.filePaths) {
    try {
      const h = fileMd5(src);
      if (known.has(h)) { skipped++; continue; }
      known.add(h);
      const dest = path.join(dir, Date.now() + "-" + Math.floor(Math.random() * 1e4) + path.extname(src).toLowerCase());
      fs.copyFileSync(src, dest);
      if (!firstNew) firstNew = dest;
      added++;
    } catch { skipped++; }
  }
  reconcileWallpaper();
  if (firstNew) cfg.wallpaper = firstNew;
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true, added, skipped, current: cfg.wallpaper };
});
ipcMain.handle("lg-wall:select", (_e, p) => {
  if (!p || !isWallFile(p)) return { ok: false };
  cfg.wallpaper = p;
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true, current: cfg.wallpaper };
});
ipcMain.handle("lg-wall:remove", (_e, p) => {
  if (!p || path.dirname(p) !== wallpapersDir()) return { ok: false };
  try { fs.unlinkSync(p); } catch { /* 文件可能已被删 */ }
  if (cfg.wallpaper === p) { cfg.wallpaper = ""; reconcileWallpaper(); }
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true };
});
ipcMain.handle("lg-wall:mode", (_e, payload) => {
  const mode = payload && payload.mode;
  if (mode !== "single" && mode !== "shuffle" && mode !== "loop") return { ok: false };
  cfg.wallpaperMode = mode;
  if (payload && payload.rotateMin != null) {
    cfg.wallpaperRotateMin = Math.max(0, Math.min(1440, Number(payload.rotateMin) || 0));
  }
  saveConfig();
  scheduleWallpaperRotate();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true, mode: cfg.wallpaperMode, rotateMin: cfg.wallpaperRotateMin };
});
ipcMain.handle("lg-wall:next", () => ({ ok: true, current: rotateWallpaper() }));
ipcMain.handle("lg-wall:dedupe", () => ({ ok: true, removed: dedupeWallpaperDir() }));

ipcMain.handle("lg-config:pick-wallpaper", async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: "选择壁纸图片",
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const src = r.filePaths[0];
  try {
    const dir = path.join(app.getPath("userData"), "wallpapers");
    fs.mkdirSync(dir, { recursive: true });
    // 旧通道也要判重：内容与集合里现有文件相同就直接指过去，
    // 不再复制出重复份（这条通道以前是重复壁纸的一个入口）
    const h = fileMd5(src);
    const dup = listWallpaperFiles().find((f) => {
      try { return fileMd5(f) === h; } catch { return false; }
    });
    if (dup) {
      cfg.wallpaper = dup;
      saveConfig();
      pushConfigToChrome();
      applyConfigToPages();
      return { ok: true, wallpaper: dup, dupe: true };
    }
    const dest = path.join(dir, Date.now() + path.extname(src).toLowerCase());
    fs.copyFileSync(src, dest);
    cfg.wallpaper = dest;
    saveConfig();
    pushConfigToChrome();
    applyConfigToPages();
    return { ok: true, wallpaper: dest };
  } catch {
    return { ok: false };
  }
});


ipcMain.handle("lg-config:clear-wallpaper", () => {
  cfg.wallpaper = "";
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true };
});

ipcMain.handle("lg-config:reset", () => {
  // configVersion 必须带上：丢掉它的话下次启动会把已跑过的迁移再跑一遍
  //（luckyDay 又被强制打开，"恢复原样"反倒关不掉它了）
  cfg = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION };
  saveConfig();
  pushConfigToChrome();
  applyConfigToPages();
  return { ok: true };
});

/* ============================================================
   账号：本地列表 + 隔离会话 + 凭据验证后落库 + 全局切换
   ============================================================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let acctJob = null; // 添加账号进行中的任务（含验证码交互相）

function pushAccountState() {
  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.webContents.send("chrome:accounts", { accounts: publicAccounts(), activeId: cfg.activeAccountId }); } catch {}
  }
}

/* 探测某个会话分区里的洛谷登录态（隐藏窗口开一次首页）。
   切换账号时先用它判断该分区是否还有效——有效就不用走一遍登录。 */
async function probeSessionUser(sess) {
  let w = null;
  try {
    w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, session: sess } });
    // 加载抖动会让探测假阴性 —— 假阴性在切换账号时会误触发"重新登录"（要过验证码），
    // 所以这里多试几轮，宁可慢一点也别误判。
    let loaded = false;
    for (let i = 0; i < 4 && !loaded; i++) {
      try { await w.loadURL(HOME_URL); loaded = true; }
      catch (e) { dbg("probe session load failed (" + i + "): " + e.message); await sleep(2500); }
    }
    if (!loaded) return null;
    return await w.webContents.executeJavaScript(
      `(async function(){
        function read() {
          var uid = "", name = "", avatar = "";
          try {
            var fe = window._feInjection && window._feInjection.currentUser;
            if (fe && fe.uid) { uid = String(fe.uid); name = fe.name || ""; }
          } catch (e) {}
          var sel = ['.user-nav img[src*="usericon"]', '#user-nav img[src*="usericon"]', 'header img[src*="usericon"]'];
          for (var i = 0; i < sel.length && !uid; i++) {
            var el = null; try { el = document.querySelector(sel[i]); } catch (e) {}
            if (el && el.src) { var m = el.src.match(/\\/usericon\\/(\\d+)\\./); if (m) { uid = m[1]; avatar = el.src; } }
          }
          if (!name) {
            var m2 = (document.body.innerText || "").match(/欢迎回来[，,：:\\s]*([A-Za-z0-9_]{2,24})/);
            if (m2) name = m2[1];
          }
          return { uid: uid, name: name, avatar: avatar };
        }
        // 页面刚 load 完时导航区可能还没渲染出来，空读会当成"未登录"。
        for (var i = 0; i < 4; i++) {
          var r = read();
          if (r.uid) return r;
          await new Promise(function(res){ setTimeout(res, 1200); });
        }
        return read();
      })()`,
      true
    ).catch(() => null);
  } catch (e) {
    dbg("probeSessionUser error: " + (e && e.stack ? e.stack : String(e)));
    return null;
  } finally {
    try { if (w) w.destroy(); } catch {}
  }
}

/* ---------- 验证码自动识别（ddddocr） ----------
   本机装了 Python + ddddocr（pip install ddddocr）时，用一个常驻小进程识别
   图形验证码：主进程把 PNG 的 base64 喂进去，它回一行答案。识别器不在
   （没装 Python / 没装 ddddocr）就整条链路放弃、直接转人工输入——不弹窗、
   不阻塞、不报错给用户。脚本落在 userData 里（安装目录不一定可写）。
   协议：stdout 一行一条 —— READY（模型加载完）/ OK <答案> / ERR <原因>；
   stdin 一行一张图（PNG 的 base64）。
   windowsHide 必须开：否则会闪出一个 python 控制台窗口（用户明令不许弹）。 */
const CAPTCHA_OCR_PY = [
  "import base64, sys",
  "try:",
  "    import ddddocr",
  "except Exception as e:",
  "    sys.stdout.write('ERR import ' + str(e) + chr(10)); sys.stdout.flush(); sys.exit(0)",
  "ocr = ddddocr.DdddOcr(show_ad=False)",
  "sys.stdout.write('READY' + chr(10)); sys.stdout.flush()",
  "for line in sys.stdin:",
  "    line = line.strip()",
  "    if not line:",
  "        continue",
  "    if line == 'quit':",
  "        break",
  "    try:",
  "        ans = (ocr.classification(base64.b64decode(line)) or '').strip()",
  "        sys.stdout.write('OK ' + ans + chr(10))",
  "    except Exception as e:",
  "        sys.stdout.write('ERR ' + str(e) + chr(10))",
  "    sys.stdout.flush()",
].join("\n");

let ocrProc = null;   // 常驻识别进程
let ocrReady = false; // 模型加载完（READY）
let ocrDead = false;  // 本机不可用：本次运行不再尝试
let ocrBuf = "";
let ocrWait = null;   // { resolve, timer }：正在等一行答案
let ocrIdle = null;   // 空闲自动收进程

function ocrCmd() {
  const custom = String(cfg.captchaPython || process.env.LG_PYTHON || "").trim();
  if (custom) return custom;
  return process.platform === "win32" ? "python" : "python3";
}
function ocrStop() {
  ocrReady = false;
  const p = ocrProc;
  ocrProc = null;
  if (ocrWait) { clearTimeout(ocrWait.timer); const w = ocrWait; ocrWait = null; w.resolve(""); }
  if (p) {
    try { p.stdin.write("quit\n"); p.stdin.end(); } catch {}
    setTimeout(() => { try { p.kill(); } catch {} }, 900);
  }
}
function ocrFail(why) {
  if (ocrDead) return;
  ocrDead = true;
  dbg("captcha ocr unavailable: " + why);
  ocrStop();
}
function ocrStart() {
  if (ocrProc || ocrDead) return ocrProc;
  let script = "";
  try {
    script = path.join(app.getPath("userData"), "captcha-ocr.py");
    if (!fs.existsSync(script) || fs.readFileSync(script, "utf8") !== CAPTCHA_OCR_PY) {
      fs.writeFileSync(script, CAPTCHA_OCR_PY, "utf8");
    }
  } catch (e) { ocrFail("write script: " + e.message); return null; }
  let proc = null;
  try {
    proc = spawn(ocrCmd(), [script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) { ocrFail("spawn: " + e.message); return null; }
  ocrProc = proc;
  const started = Date.now();
  proc.stdout.on("data", (b) => {
    ocrBuf += String(b);
    let i;
    while ((i = ocrBuf.indexOf("\n")) >= 0) {
      const line = ocrBuf.slice(0, i).trim();
      ocrBuf = ocrBuf.slice(i + 1);
      if (!line) continue;
      if (line === "READY") { ocrReady = true; continue; }
      if (line.indexOf("ERR ") === 0) {
        if (!ocrReady) { ocrFail(line.slice(4)); continue; }
        if (ocrWait) { const w = ocrWait; ocrWait = null; clearTimeout(w.timer); w.resolve(""); }
        continue;
      }
      if (line.indexOf("OK ") === 0 && ocrWait) {
        const w = ocrWait; ocrWait = null; clearTimeout(w.timer); w.resolve(line.slice(3).trim());
      }
    }
  });
  proc.stderr.on("data", (b) => dbg("captcha ocr stderr: " + String(b).slice(0, 160)));
  proc.on("error", (e) => ocrFail("error: " + e.message));
  proc.on("exit", (code) => { if (ocrProc === proc) ocrFail("exit " + code + " after " + (Date.now() - started) + "ms"); });
  setTimeout(() => { if (!ocrReady && ocrProc === proc) ocrFail("ready timeout"); }, 15000);
  return proc;
}
/* 识别一张验证码（data URL）：认出返回答案（>=3 字符），没认出来/本机不可用返回 ""。 */
async function captchaOcrSolve(dataUrl) {
  const b64 = String(dataUrl || "").split(",")[1] || "";
  if (!b64 || ocrDead) return "";
  const proc = ocrStart();
  if (!proc) return "";
  for (let i = 0; i < 240 && !ocrReady && !ocrDead; i++) await sleep(50); // 模型首次加载 1~3 秒
  if (!ocrReady) return "";
  const ans = await new Promise((resolve) => {
    const timer = setTimeout(() => { if (ocrWait) ocrWait = null; resolve(""); }, 8000);
    ocrWait = { resolve, timer };
    try { proc.stdin.write(b64 + "\n"); } catch (e) { clearTimeout(timer); ocrWait = null; resolve(""); }
  });
  const a = String(ans || "").trim();
  dbg("captcha ocr -> " + JSON.stringify(a));
  clearTimeout(ocrIdle);
  ocrIdle = setTimeout(ocrStop, 180000); // 3 分钟没人用就收掉
  return a.length >= 3 ? a : "";
}

/* 站内登录页：先清 cookie → 首页 → 页内跳 /auth/login → 填账号 → 下一步 → 填密码。
   返回 { ok, stage }；验证码需外部喂答案（job.answer 或 captcha-answer.txt）。 */
async function loginIntoSession(sess, email, pass, job, opts) {
  let w = null;
  const ocrOn = !(opts && opts.ocr === false); // 批量工具自带外部识别：别跟它抢
  const answerFile = path.join(app.getPath("userData"), "captcha-answer.txt");
  /* 换一张验证码（提交失败后页面还在换图，抓到的会是空白占位图） */
  const refreshCaptchaImg = () =>
    w.webContents
      .executeJavaScript(
        `(function(){ var img = document.querySelector('img[src*="captcha"]'); if (img) img.src = img.src.split('?')[0] + '?_t=' + Date.now(); })()`,
        true
      )
      .catch(() => {});
  try {
    await sess.clearStorageData({ storages: ["cookies"] }).catch(() => {});
    w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, session: sess } });
    let loaded = false;
    for (let i = 0; i < 3 && !loaded; i++) {
      try { await w.loadURL(HOME_URL); loaded = true; }
      catch (e) { dbg("acct login home failed (" + i + "): " + e.message); await sleep(2500); }
    }
    if (!loaded) return { ok: false, stage: "home-load-failed" };
    await w.webContents.executeJavaScript('location.href = "/auth/login"', true).catch(() => {});
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(500);
      ready = await w.webContents.executeJavaScript("!!document.querySelector('input[type=text]')", true).catch(() => false);
      if (job && job.cancel) return { ok: false, stage: "cancelled" };
    }
    if (!ready) return { ok: false, stage: "no-account-input" };

    const step1 = await w.webContents.executeJavaScript(
      `(async function(){
        function setValue(input, val) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var acc = document.querySelector('input[type=text]');
        if (!acc) return { ok: false, reason: 'no account input' };
        setValue(acc, ${JSON.stringify(email)});
        await new Promise(function(r){ setTimeout(r, 400); });
        var next = Array.from(document.querySelectorAll('button')).find(function(b){ return (b.textContent || '').trim() === '下一步'; });
        if (!next) return { ok: false, reason: 'no next button' };
        next.click();
        for (var i = 0; i < 30; i++) {
          await new Promise(function(r){ setTimeout(r, 500); });
          if (document.querySelector('input[type=password]')) return { ok: true };
        }
        return { ok: false, reason: 'password input timeout' };
      })()`,
      true
    );
    if (!step1.ok) return { ok: false, stage: "step1", reason: step1.reason };

    await w.webContents.executeJavaScript(
      `(function(){
        function setValue(input, val) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var p = document.querySelector('input[type=password]');
        if (p) setValue(p, ${JSON.stringify(pass)});
      })()`,
      true
    );

    /* 验证码：先用 ddddocr 自动识别（最多 CAPTCHA_AUTO 次——用户要求"重复
       3 次都过不了再求助于用户"），识别器不可用或连续没过就转人工：设置页
       显示放大图 + 输入框，兼容 captcha-answer.txt 文件。 */
    const CAPTCHA_AUTO = 3;
    let autoLeft = ocrOn ? CAPTCHA_AUTO : 0;
    let manual = autoLeft <= 0;
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (job && job.cancel) return { ok: false, stage: "cancelled" };
      let answer = (job && job.answer) || "";
      if (answer) job.answer = null;
      let capUrl = null;
      if (!answer) {
        // 抓验证码图（canvas 4x 无插值放大，便于人眼/OCR 读）。
        // 上一轮提交后页面可能还在换图，抓到的会是空白占位图 —— 这里循环重抓，
        // 直到拿到"有内容"的图（PNG 太小说明是空白）再交给外部识别。
        capUrl = await w.webContents.executeJavaScript(
          `(async function(){
            function grab() {
              var img = document.querySelector('img[src*="captcha"]');
              if (!img) return null;
              try {
                var s = 4, c = document.createElement('canvas');
                c.width = (img.naturalWidth || img.width || 80) * s;
                c.height = (img.naturalHeight || img.height || 30) * s;
                var ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, 0, 0, c.width, c.height);
                return c.toDataURL('image/png');
              } catch (e) { return null; }
            }
            var last = null;
            for (var i = 0; i < 15; i++) {
              var img = document.querySelector('img[src*="captcha"]');
              if (img && !img.complete) {
                await new Promise(function(r){ img.onload = r; img.onerror = r; setTimeout(r, 1200); });
              }
              last = grab();
              if (last && last.length > 4000) return last;
              await new Promise(function(r){ setTimeout(r, 900); });
            }
            return last;
          })()`,
          true
        ).catch(() => null);
      }
      /* 自动识别阶段：把图亮在设置页（看得见进度）但不问用户 */
      if (!answer && !manual && capUrl && capUrl.startsWith("data:image")) {
        const nth = CAPTCHA_AUTO - autoLeft + 1;
        autoLeft--;
        if (job) {
          job.auto = true;
          job.stage = "captcha";
          job.captcha = capUrl;
          job.message = "正在自动识别验证码…（第 " + nth + "/" + CAPTCHA_AUTO + " 次）";
        }
        answer = await captchaOcrSolve(capUrl);
        if (!answer) {
          /* 没认出来：本机没有识别器就直接转人工；还有次数就刷新图再来一次 */
          if (ocrDead || autoLeft <= 0) manual = true;
          else { await refreshCaptchaImg(); await sleep(900); continue; }
        }
      }
      if (!answer && manual && capUrl) {
        if (job) {
          job.auto = false;
          job.stage = "captcha";
          job.captcha = capUrl;
          job.message = autoLeft > 0 ? "自动识别未通过，请输入验证码"
            : (ocrDead ? "本机没有可用的 ddddocr 识别器，请输入验证码" : "自动识别 3 次未通过，请输入验证码");
        }
        // 等答案：设置页 IPC 优先，兼容 captcha-answer.txt 文件
        let got = null;
        for (let i = 0; i < 180; i++) {
          await sleep(1000);
          if (job && job.cancel) return { ok: false, stage: "cancelled" };
          if (job && job.answer) { got = job.answer; job.answer = null; break; }
          try {
            const a = fs.readFileSync(answerFile, "utf8").trim();
            if (a) { fs.unlinkSync(answerFile); got = a; break; }
          } catch {}
        }
        if (!got) return { ok: false, stage: "captcha-timeout" };
        answer = got;
      }
      if (job) { job.auto = false; job.stage = "submitting"; job.captcha = null; job.message = "正在验证账号…"; }
      await w.webContents.executeJavaScript(
        `(async function(){
          function setValue(input, val) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          var cap = document.querySelector('input[placeholder*="验证码"], input[placeholder*="图形"]');
          if (cap) setValue(cap, ${JSON.stringify(answer)});
          await new Promise(function(r){ setTimeout(r, 300); });
          var btn = Array.from(document.querySelectorAll('button')).find(function(b){ return /账户密码登录|登录/.test((b.textContent || '').trim()); });
          if (btn) btn.click();
        })()`,
        true
      ).catch(() => {});

      for (let i = 0; i < 30; i++) {
        await sleep(500);
        const url = w.webContents.getURL();
        if (!/auth\/login/.test(url)) return { ok: true, url };
      }
      // 没跳走 → 大概率验证码错，刷新图重来
      await refreshCaptchaImg();
      await sleep(800);
    }
    return { ok: false, stage: "captcha-failed" };
  } catch (e) {
    dbg("loginIntoSession error: " + (e && e.stack ? e.stack : String(e)));
    return { ok: false, stage: "exception", reason: String(e) };
  } finally {
    try { if (w) w.destroy(); } catch {}
  }
}

/* 后台跑一次"添加账号"：验证成功才写入 accounts.json */
async function accountAddFlow(email, pass, opts) {
  const id = "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { id, email, stage: "starting", message: "正在打开登录页…", captcha: null, answer: null, auto: false, cancel: false };
  acctJob = job;
  const sess = acctSession(id);
  const r = await loginIntoSession(sess, email, pass, job, opts);
  if (acctJob === job) acctJob = null;
  if (!r.ok) {
    if (r.stage !== "cancelled") await sess.clearStorageData({ storages: ["cookies"] }).catch(() => {});
    return { ok: false, id, stage: r.stage, reason: r.reason || "" };
  }
  // 验证通过 → 落库（明文仅存本机 userData）
  accounts = accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  accounts.push({ id, email, password: pass, name: "", addedAt: new Date().toISOString() });
  saveAccounts();
  cfg.activeAccountId = id;
  saveConfig();
  pushAccountState();
  return { ok: true, id, account: { id, email } };
}

ipcMain.handle("lg-account:list", () => ({
  ok: true,
  accounts: publicAccounts(),
  activeId: cfg.activeAccountId,
  job: acctJob ? { stage: acctJob.stage, message: acctJob.message, captcha: acctJob.captcha, auto: !!acctJob.auto } : null,
}));

ipcMain.handle("lg-account:add", async (_e, payload) => {
  const email = String((payload && payload.email) || "").trim();
  const pass = String((payload && payload.password) || "");
  if (!email || !pass) return { ok: false, stage: "bad-input", message: "账号与密码不能为空" };
  if (acctJob) return { ok: false, stage: "busy", message: "已有验证任务在进行" };
  const r = await accountAddFlow(email, pass);
  return r;
});

ipcMain.handle("lg-account:answer", (_e, code) => {
  if (acctJob) { acctJob.answer = String(code || "").trim(); return { ok: true }; }
  return { ok: false };
});

ipcMain.handle("lg-account:cancel", () => {
  if (acctJob) acctJob.cancel = true;
  return { ok: true };
});

ipcMain.handle("lg-account:remove", (_e, id) => {
  accounts = accounts.filter((a) => a.id !== id);
  saveAccounts();
  if (cfg.activeAccountId === id) { cfg.activeAccountId = ""; saveConfig(); }
  // 会话分区一并清掉：账号都删了，登录态没有继续留在磁盘上的理由
  try { session.fromPartition(acctPartition(id)).clearStorageData().catch(() => {}); } catch {}
  pushAccountState();
  return { ok: true, accounts: publicAccounts(), activeId: cfg.activeAccountId };
});

/* 全局切换：目标账号分区里没有有效登录态时，先用存的账密在后台真实登录一次
   （验证码经账号菜单弹窗喂入），登好后再换会话分区重开所有站点标签。
   早先的实现只改配置然后逐个 closeTab 重开——closeTab 关掉最后一个站点标签
   会触发"关掉最后一个标签 = 退出应用"，从账号菜单点切换时整个应用直接退出，
   这就是"无法切换账号"的真相；而且分区里没 cookie 时切过去就是未登录。 */
const LOGIN_FAIL_TEXT = {
  "home-load-failed": "网络异常，登录页打不开",
  "no-account-input": "登录页加载超时",
  "step1": "填写账号失败",
  "captcha-timeout": "验证码超时未输入",
  "captcha-failed": "验证码错误次数过多",
  "cancelled": "已取消",
};
ipcMain.handle("lg-account:switch", async (_e, id) => {
  const target = id && accounts.some((a) => a.id === id) ? id : "";
  const prev = cfg.activeAccountId;
  if (target && target === prev) {
    // 同账号 = 设置页的「重新加载」入口：把洛谷标签刷一遍，兑现按钮文案。
    // 站外标签（shared 分区）与洛谷账号无关，不动。
    for (const t of tabs.values()) {
      if (!isLocalKind(t.kind) && isAllowed(t.url)) {
        try { t.view.webContents.reload(); } catch {}
      }
    }
    return { ok: true, activeId: target, unchanged: true };
  }
  const acc = accounts.find((a) => a.id === target);
  if (acc) {
    const sess = acctSession(target);
    let user = await probeSessionUser(sess);
    if (!user || !user.uid) {
      // 探测假阴性会把"已经登录着"的账号拖去重新登录（要过验证码），代价太高；
      // 这里再确认一次，真失效的账号不会因为多探一次就变好。
      user = await probeSessionUser(sess);
    }
    if (!user || !user.uid) {
      if (!acc.password) {
        return { ok: false, stage: "no-password", message: "该账号没有保存密码，无法自动登录" };
      }
      const job = {
        id: target, email: acc.email, stage: "starting",
        message: "正在登录 " + (acc.name || acc.email.split("@")[0]) + " …",
        captcha: null, answer: null, auto: false, cancel: false,
      };
      acctJob = job;
      pushAccountState();
      const r = await loginIntoSession(sess, acc.email, acc.password, job);
      if (acctJob === job) acctJob = null;
      if (!r.ok) {
        pushAccountState();
        return { ok: false, stage: r.stage || "login-failed", message: LOGIN_FAIL_TEXT[r.stage] || "自动登录失败，请到设置页重新验证账号" };
      }
    }
  }
  cfg.activeAccountId = target;
  saveConfig();
  pushAccountState();
  // 旧登录态缓存作废：不先清掉的话，新页面加载完成前芯片一直顶着旧账号的头像
  // 和昵称（"切换后右上角还是原账号"的观感就是这么来的）。清掉后先显示
  // "未登录"，新页面 did-finish-load 的 pushUser 会立刻补上新账号。
  lastUser = null;
  sendUser(null);
  // 新账号的登录态上面已经写进会话分区：直接走网络兜底把新头像/昵称取回来，
  // 不用等第一个洛谷标签加载完（否则切换后右上角要空到下次打开洛谷页）。
  refreshUserNet(true);
  // 换会话分区重开洛谷标签（createTab 会自动用 activeAccountId 的新分区）。
  // 只重建洛谷标签：首页/设置/历史这类本地页没有会话状态（早先的教训：
  // 一起重建会丢 kind + 用错 preload 变死页）；DeepSeek 等站外标签跑共享
  // 分区（sharedSession），与洛谷账号无关，原样保留——以前它们也被拖进新
  // 分区重建，等于每次切洛谷账号就把站外站点强制登出。
  const oldIds = [];
  const keep = [];
  for (const tid of tabOrder) {
    const t = tabs.get(tid);
    if (isLocalKind(t.kind) || !isAllowed(t.url)) continue;
    oldIds.push(tid);
    keep.push({ url: t.url, special: !!t.special, unlock: !!t.unlock, pinned: !!t.pinned });
  }
  if (keep.length) {
    // 先立住一个新的活动标签再拆旧的，保证 activeTabId 任何时刻都指向活标签。
    // 销毁清单（oldIds）必须在建新标签之前取定：否则销毁循环会把刚建并激活的
    // 第一个新标签一起拆掉——第一条 URL 丢失、activeTabId 悬空、剩下的标签
    // 全部可见叠在一起（这就是早期"切账号后标签不对"的真相）。
    const first = keep[0];
    const fid = createTab(first.url, { activate: true, special: first.special, unlock: first.unlock });
    if (first.pinned) tabs.get(fid).pinned = true;
    for (const tid of oldIds) destroyTab(tid);
    for (const k of keep.slice(1)) {
      const nid = createTab(k.url, { activate: false, special: k.special, unlock: k.unlock });
      if (k.pinned) tabs.get(nid).pinned = true;
    }
    // 只保留了一个标签时 createTab(activate) 之后没有再推过快照，
    // 钉住标记要等下一次操作才到外壳——补一次
    pushTabs();
  } else if (!tabOrder.length || ![...tabs.values()].some((t) => t.kind === "home")) {
    createHomeTab();
  }
  return { ok: true, activeId: cfg.activeAccountId, tabs: keep.length || 1 };
});

ipcMain.handle("lg-app:open-settings", () => {
  openSettingsTab();
  return { ok: true };
});

/* 应用首页（本地起始页）：已开着就激活，没有就新开 */
ipcMain.handle("lg-app:open-home", () => {
  const id = tabOrder.find((tid) => tabs.get(tid).kind === "home");
  if (id != null) {
    setActiveTab(id);
  } else {
    createHomeTab();
  }
  return { ok: true };
});

ipcMain.handle("lg-app:open-history", () => {
  openHistoryTab();
  return { ok: true };
});

/* 本地页（历史/设置）点条目 → 走当前站点标签，没有就新开 */
ipcMain.handle("lg-app:open-url", (_e, url) => {
  if (!url) return { ok: false };
  const full = normalizeUrl(url);
  const t = tabs.get(activeTabId);
  if (t && !isLocalKind(t.kind) && !/^file:/i.test(t.url || "")) {
    t.url = full;
    t.unlock = !isAllowed(full);
    try { t.view.webContents.loadURL(full).catch(() => {}); } catch {}
    pushTabs();
  } else {
    createTab(full, { activate: true });
  }
  return { ok: true, url: full };
});

/* 注入脚本 → 开题目标签（preload-page.js 暴露的 lgApp.openProblem） */
ipcMain.handle("lg-app:open-problem", (_e, pid) => {
  const p = String(pid || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(p)) return { ok: false };
  createTab(HOME_URL + "problem/" + p, { activate: true });
  return { ok: true, pid: p };
});
ipcMain.handle("lg-app:open-path", (_e, p) => {
  const s = String(p || "");
  if (!s.startsWith("/") || s.startsWith("//")) return { ok: false };
  createTab(HOME_URL.replace(/\/$/, "") + s, { activate: true });
  return { ok: true, path: s };
});
/* 注入脚本 → 应用动作（与 luogu-glass:// 走同一个分发器） */
ipcMain.handle("lg-app:command", (_e, c) => {
  try { return handleAppCommand("luogu-glass://" + String(c || "")); }
  catch (e) { return { ok: false, reason: String(e) }; }
});

/* 注入脚本 → Ctrl+滚轮缩放：按 wheel 事件所属的标签步进（不是活动标签——
   鼠标悬停在后台视图上滚也缩的是那个视图） */
/* 注入脚本 → 题目页自带 IDE 模式（洛谷「进入 IDE 模式」）开关。按 sender 定位
   标签（后台标签进入的模式不该影响前台），进入 = 该标签铺满整窗、外壳与坞让位。 */
ipcMain.on("lg-app:ide-mode", (e, on) => {
  let id = null;
  for (const [tid, tab] of tabs) {
    if (tab.view && tab.view.webContents === e.sender) { id = tid; break; }
  }
  if (id == null) return;
  if (on) {
    if (inPageIdeTabId !== id) {
      inPageIdeTabId = id;
      hidePopup();   // 全屏时菜单/浮层先收（弹层永远在最上，会压在页面上）
      closeGlance();
    }
  } else if (inPageIdeTabId === id) {
    inPageIdeTabId = null;
  }
  layout();
  layoutDock();
});

ipcMain.handle("lg-app:zoom", (_e, dir) => {
  let t = null;
  for (const [, tab] of tabs) {
    /* tab.view 可能是 null（标签被休眠，makeSleeping 置空）——不判空就是
       TypeError，页面侧收到 reject，缩放毫无反应。 */
    if (!tab.view) continue;
    if (tab.view.webContents === _e.sender) { t = tab; break; }
  }
  if (!t) return { ok: false, reason: "no-tab" };
  zoomStepTab(t, dir > 0 ? 1 : -1);
  return { ok: true, zoom: t.zoom || 1 };
});

/* ============================================================
   本轮新增功能（v3.4.0）
   ============================================================ */

/* ---------- 页内查找（Ctrl+F） ----------
   不用 findInPage：它要求目标 webContents 持有焦点，而焦点在查找条输入框里
   （实测站点视图无焦点时 findInPage 静默不干活，连 found-in-page 都不发）。
   页面内 window.find() 没有焦点要求，选中高亮走浏览器默认选区样式。 */
ipcMain.handle("lg-app:find", (_e, payload) => {
  const t = tabs.get(activeTabId);
  if (!t || !t.view) return Promise.resolve({ ok: false });
  const text = String((payload && payload.text) || "");
  const wc = t.view.webContents;
  /* 高亮全部匹配（Edge 的招牌观感）：CSS Custom Highlight API 把所有命中
     做成 Range 交给浏览器统一绘制——不改页面 DOM、不插 <mark>、不干扰页面
     自己的选择区与脚本。Chromium 105+ 原生支持。
     样式在 common.css（::highlight(lg-find)），站外页同样生效。 */
  const HIGHLIGHT_JS = `(function(){
     var q = ${JSON.stringify(text)};
     try { CSS.highlights && CSS.highlights.delete('lg-find'); } catch (e) {}
     if (!q) return 0;
     var ranges = [];
     try {
       var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
         acceptNode: function (n) {
           if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
           var p = n.parentElement;
           if (!p) return NodeFilter.FILTER_REJECT;
           var tag = p.tagName;
           if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
           /* 我们自己的浮层与可编辑区不参与高亮（阅读模式、翻译气泡、代码
              复制按钮、输入框）——高亮它们没有意义，还会让"找到了"的数量
              与用户实际看到的不一致。 */
           if (p.closest('#lg-reader, #lg-tr-bubble, #lg-tr-bar, .lg-code-copy, [contenteditable=""], [contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
           return NodeFilter.FILTER_ACCEPT;
         }
       });
       var lower = q.toLowerCase();
       var node, guard = 0;
       while ((node = walker.nextNode()) && guard < 20000) {
         guard++;
         var ltext = node.nodeValue.toLowerCase();
         var i = 0, idx;
         while ((idx = ltext.indexOf(lower, i)) >= 0) {
           try {
             var r = document.createRange();
             r.setStart(node, idx);
             r.setEnd(node, idx + q.length);
             ranges.push(r);
           } catch (e) {}
           i = idx + q.length;
           if (ranges.length >= 800) break;
         }
         if (ranges.length >= 800) break;
       }
       if (ranges.length) {
         var hl = new Highlight();
         for (var i = 0; i < ranges.length; i++) hl.add(ranges[i]);
         CSS.highlights.set('lg-find', hl);
       }
     } catch (e) {}
     return ranges.length;
   })()`;
  if (!text) {
    try { wc.executeJavaScript("window.getSelection().removeAllRanges()", true); } catch {}
    wc.executeJavaScript(HIGHLIGHT_JS, true).catch(() => {});
    return Promise.resolve({ ok: true, stopped: true });
  }
  const backward = !!(payload && payload.forward === false);
  /* 高亮与选中并行：window.find 负责"滚到并选中当前那个"，Highlight 负责
     "其余所有命中都亮着"。两者互不干扰（选区是 UA 样式，高亮是独立图层）。 */
  wc.executeJavaScript(HIGHLIGHT_JS, true).catch(() => {});
  return wc
    .executeJavaScript(
      `(function(){
         var n = (document.body && document.body.innerText || "").split(${JSON.stringify(text)}).length - 1;
         var ok = false;
         try { ok = !!window.find(${JSON.stringify(text)}, false, ${backward ? "true" : "false"}, true); } catch (e) {}
         return JSON.stringify({ found: ok, count: n });
       })()`,
      true
    )
    .then((r) => {
      try { return { ok: true, ...JSON.parse(r) }; } catch { return { ok: true, found: false, count: 0 }; }
    })
    .catch((e) => ({ ok: false, message: String(e) }));
});
ipcMain.handle("lg-app:find-stop", () => {
  const t = tabs.get(activeTabId);
  if (t && t.view) {
    try { t.view.webContents.executeJavaScript("window.getSelection().removeAllRanges()", true); } catch {}
    /* 高亮也要清：不清的话"全部高亮"会一直留在页面上，关闭查找条后满屏黄块 */
    try { t.view.webContents.executeJavaScript("try{CSS.highlights&&CSS.highlights.delete('lg-find')}catch(e){}", true); } catch {}
  }
  return Promise.resolve({ ok: true });
});
/* Ctrl+Shift+T 恢复最近关闭的标签 */
ipcMain.handle("tab:reopen", () => {
  const id = reopenClosedTab();
  return { ok: id != null, id };
});
/* 标签页操作菜单「最近关闭」区段：整栈列出（新的在前），按栈位恢复 */
ipcMain.handle("tab:closed-list", () => ({
  ok: true,
  list: closedStack
    .map((e, i) => ({ i, url: e.url, title: e.title || "", kind: e.kind || null, special: !!e.special }))
    .reverse(),
}));
ipcMain.handle("tab:closed-open", (_e, i) => {
  const idx = Number(i);
  if (!(idx >= 0 && idx < closedStack.length)) return { ok: false };
  const entry = closedStack.splice(idx, 1)[0];
  const id = openClosedEntry(entry);
  return { ok: id != null, id };
});
/* 命令面板里的"页内查找"：转发快捷键消息给外壳（与 Ctrl+F 同一条路） */
ipcMain.handle("lg-app:find-open", () => {
  try { mainWin.webContents.send("chrome:find"); } catch {}
  return { ok: true };
});
ipcMain.handle("win:toggle-fullscreen", () => {
  if (!mainWin || mainWin.isDestroyed()) return { ok: false };
  mainWin.setFullScreen(!mainWin.isFullScreen());
  setTimeout(repaintSiteViews, 320);
  return { ok: true, fullscreen: mainWin.isFullScreen() };
});

/* ---------- 一键全局静音（新标签继承） ---------- */
ipcMain.handle("lg-app:mute-all", (_e, v) => {
  cfg.muteAll = !!v;
  for (const [, t] of tabs) {
    t.muted = !!v;
    try { t.view.webContents.setAudioMuted(!!v); } catch {}
  }
  saveConfig();
  pushConfigToChrome();
  return { ok: true, muted: cfg.muteAll };
});

/* ---------- 当前页截图（Ctrl+Shift+S） ---------- */
async function screenshotActiveTab() {
  const t = tabs.get(activeTabId);
  if (!t) return { ok: false, message: "no-tab" };
  try {
    let img = null;
    try {
      img = await t.view.webContents.capturePage();
    } catch {
      // 窗口被系统判定遮挡（最小化/完全遮挡）时 capturePage 会报
      // "display surface not available"——逼一帧出来再试一次
      try { t.view.webContents.invalidate(); } catch {}
      await new Promise((r) => setTimeout(r, 450));
      img = await t.view.webContents.capturePage();
    }
    const dir = path.join(app.getPath("userData"), "shots");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "Luogu++-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".png");
    fs.writeFileSync(file, img.toPNG());
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: "截图已保存", body: file });
        n.on("click", () => shell.showItemInFolder(file));
        n.show();
      }
    } catch {}
    return { ok: true, file };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
ipcMain.handle("lg-app:screenshot", () => screenshotActiveTab());

/* 截图落盘 + 通知（视口/整页共用）。返回文件路径。 */
function saveShot(png, prefix) {
  const dir = path.join(app.getPath("userData"), "shots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "Luogu++-" + (prefix ? prefix + "-" : "") + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".png");
  fs.writeFileSync(file, png);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: "截图已保存", body: file });
      n.on("click", () => shell.showItemInFolder(file));
      n.show();
    }
  } catch {}
  return file;
}

/* 完整网页截图（含滚动部分）：CDP Page.captureScreenshot + captureBeyondViewport
   ——分段拼接会漏 fixed 元素、也会因滚动触发站点懒加载，CDP 一步到位（临时挂
   debugger，完事摘掉）；CDP 不可用时退回视口截图，至少不空手。 */
async function captureFullPage(tabId) {
  const t = tabs.get(tabId != null ? tabId : activeTabId);
  if (!t || !t.view || t.view.webContents.isDestroyed()) return { ok: false, message: "no-tab" };
  const wc = t.view.webContents;
  let shot = null;
  let cdpErr = "";
  try {
    wc.debugger.attach("1.3");
    try {
      await wc.debugger.sendCommand("Page.enable");
      const metrics = await wc.debugger.sendCommand("Page.getLayoutMetrics");
      const cs = metrics.cssContentSize || metrics.contentSize || {};
      const w = Math.min(Math.max(1, Math.ceil(cs.width || 1280)), 8000);
      const h = Math.min(Math.max(1, Math.ceil(cs.height || 800)), 20000);
      const res = await wc.debugger.sendCommand("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
      });
      shot = Buffer.from(res.data, "base64");
    } finally {
      try { wc.debugger.detach(); } catch {}
    }
  } catch (e) {
    cdpErr = String(e);
    dbg("fullpage cdp failed: " + cdpErr);
  }
  if (!shot) {
    const img = await wc.capturePage().catch(() => null);
    if (img && !img.isEmpty()) shot = img.toPNG();
  }
  if (!shot) return { ok: false, message: cdpErr || "capture-failed" };
  const file = saveShot(shot, "fullpage");
  return { ok: true, file, full: !cdpErr };
}
ipcMain.handle("lg-app:fullshot", (_e, tabId) => captureFullPage(tabId));

/* 画中画：选页面里最大的视频（排除壁纸层），executeJavaScript 的
   userGesture=true 让 requestPictureInPicture 有手势资格 */
async function pipActiveVideo(tabId) {
  const t = tabs.get(tabId != null ? tabId : activeTabId);
  if (!t || !t.view || t.view.webContents.isDestroyed()) return { ok: false, message: "no-tab" };
  const r = await t.view.webContents
    .executeJavaScript(
      `(async function(){
         var vs = Array.prototype.slice.call(document.querySelectorAll("video")).filter(function(x){ return !x.closest("#lg-glass-bg"); });
         if (!vs.length) return "no-video";
         var v = vs.sort(function(a,b){ return (b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight); })[0];
         try {
           if (document.pictureInPictureElement === v) { await document.exitPictureInPicture(); return "exit"; }
           await v.requestPictureInPicture();
           return "ok";
         } catch (e) { return "err:" + String((e && e.message) || e); }
       })()`,
      true
    )
    .catch((e) => "exec:" + String(e));
  return { ok: r === "ok" || r === "exit", result: r };
}
ipcMain.handle("lg-app:pip", (_e, tabId) => pipActiveVideo(tabId));

/* ---------- 翻译（主进程出网：页面侧跨域 fetch 会被 CORS 拦） ----------
   bing = Edge 浏览器同款免费接口（先取短令牌再批量翻译，国内可用）；
   custom = 用户模板（GET，%s 占位）。失败必须可见（返回 ok:false + message）。 */
let trToken = { v: "", exp: 0 };
async function bingToken() {
  if (trToken.v && Date.now() < trToken.exp) return trToken.v;
  const r = await net.fetch("https://edge.microsoft.com/translate/auth", { method: "GET" });
  if (!r.ok) throw new Error("auth " + r.status);
  const token = (await r.text()).trim();
  if (!token) throw new Error("empty-token");
  trToken = { v: token, exp: Date.now() + 8 * 60 * 1000 };
  return token;
}
const looksCJK = (s) => {
  const t = String(s || "");
  if (!t) return false;
  let cjk = 0;
  const chars = [...t];
  for (const ch of chars) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) cjk++;
  }
  return cjk / Math.max(1, chars.length) > 0.25;
};
async function translateTexts(texts) {
  const list = (Array.isArray(texts) ? texts : []).map((s) => String(s == null ? "" : s));
  if (!list.length) return { ok: true, texts: [] };
  const provider = String(cfg.translateProvider || "bing");
  const target = looksCJK(list[0]) ? "en" : "zh-Hans";
  if (provider === "custom") {
    const tpl = String(cfg.translateCustom || "");
    if (!tpl.includes("%s")) return { ok: false, message: "自定义翻译端点未配置（需含 %s）" };
    const out = [];
    for (const s of list) {
      if (!s.trim()) { out.push(s); continue; }
      const r = await net.fetch(tpl.replace("%s", encodeURIComponent(s)));
      if (!r.ok) return { ok: false, message: "翻译服务返回 " + r.status };
      out.push((await r.text()).trim());
    }
    return { ok: true, texts: out, target };
  }
  const token = await bingToken();
  const r = await net.fetch(
    "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=" + encodeURIComponent(target),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Authorization": token },
      body: JSON.stringify(list.map((t) => ({ Text: t }))),
    }
  );
  if (!r.ok) return { ok: false, message: "翻译服务返回 " + r.status };
  const data = await r.json();
  const out = (Array.isArray(data) ? data : []).map((d) => (d && d.translations && d.translations[0] ? d.translations[0].text : ""));
  return { ok: true, texts: out, target };
}
/* 原来这里还有一个 ipcMain.handle("lg-translate:text")：**死通道**——
   页面侧的划词/整页翻译走的是 preload-page 暴露的 lgApp.translate
   （另一条通道），这个 handler 从来没有任何 preload 或页面调用过。
   留着它会让人以为"翻译有两套实现"，也污染 IPC 清单（契约检查会报
   "注册了但没人引用"）。translateTexts 本身仍在用（main.js:3176 走它）。 */

/* ---------- 洛谷近期比赛（首页倒计时用；抓取失败静默降级为空） ----------
   洛谷旧 _contentOnly=1 API 已失效（实测返回 HTML）。新版服务端把页面数据
   嵌在 <script id="lentille-context" type="application/json"> 里，数据路径
   data.contests.result；老版 <script type="application/fe-context"> 作兜底。
   （只认 fe-context 时该功能实测恒为空态——选择器对不上页面。） */
let contestsCache = { at: 0, list: [] };
let contestsRetryTimer = null;
async function fetchContests() {
  let ok = false;
  try {
    const res = await net.fetch("https://www.luogu.com.cn/contest/list", { useSessionCookies: true });
    const html = await res.text();
    const pick = (body) => {
      try {
        const j = JSON.parse(body);
        const r = j && j.data && j.data.contests && j.data.contests.result;
        return Array.isArray(r) && r.length ? r : null;
      } catch { return null; }
    };
    let arr = null;
    for (const re of [
      /<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/g,
      /<script[^>]*type="application\/fe-context"[^>]*>([\s\S]*?)<\/script>/g,
    ]) {
      let m;
      while ((m = re.exec(html))) {
        arr = pick(m[1]);
        if (arr) break;
      }
      if (arr) break;
    }
    // 服务端默认顺序不是时间序（官方赛会前置），排序后再交给首页取最近三场。
    // 不能在这里 slice：前面的条目可能是已结束的比赛，截断会把真正近期的丢掉。
    const list = (arr || [])
      .map((c) => ({
        id: c.id,
        name: String(c.name || "").slice(0, 60),
        startTime: Number(c.startTime) * 1000,
        endTime: Number(c.endTime) * 1000,
      }))
      .filter((c) => Number.isFinite(c.startTime) && c.startTime > 0)
      .sort((a, b) => a.startTime - b.startTime);
    if (list.length) {
      contestsCache = { at: Date.now(), list };
      pushContestsToHome();
      ok = true;
    }
  } catch { /* 网络/接口不可用时保持缓存不动，首页显示空态 */ }
  // 首次抓取失败时别干等 30 分钟：一分钟后再来一次，直到拿到数据为止。
  if (!ok && !contestsCache.list.length && !contestsRetryTimer) {
    contestsRetryTimer = setTimeout(() => { contestsRetryTimer = null; fetchContests(); }, 60000);
  }
}
/* 首页的比赛卡是页面加载时渲一次；主进程 15 秒后才抓到数据，光写缓存
   首页永远停在空态（用户要手动刷新才看得到）。抓到就往首页视图推一份。 */
function pushContestsToHome() {
  try {
    for (const [, t] of tabs) {
      if (t && t.kind === "home") {
        try { t.view.webContents.send("lg-contests", contestsCache); } catch {}
      }
    }
  } catch {}
}
ipcMain.handle("lg-app:contests", () => contestsCache);

/* ---------- 全局唤起/隐藏热键（Ctrl+Alt+L，游戏时一键呼出/隐身） ---------- */
function registerGlobalHotkey() {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  const accel = accelFor("global-toggle");
  if (cfg.showHideHotkey !== false && accel) {
    try {
      globalShortcut.register(accel, () => {
        if (!mainWin || mainWin.isDestroyed()) return;
        if (mainWin.isVisible() && !mainWin.isMinimized()) mainWin.hide();
        else {
          if (mainWin.isMinimized()) mainWin.restore();
          mainWin.show();
          mainWin.focus();
          repaintSiteViews();
        }
      });
    } catch { /* 被其它应用占用就算了 */ }
  }
}

ipcMain.handle("lg-app:relaunch", () => {
  app.relaunch();
  app.exit(0);
});

/* ---------- 弹出层覆盖视图 ---------- */
ipcMain.handle("popup:show", (_e, p) => {
  showPopup(p || {});
  return { ok: true };
});
ipcMain.handle("popup:hide", () => {
  hidePopup();
  return { ok: true };
});
/* 矩形模式（fit:"rect"）的尺寸回报：popup 渲染完量出内容尺寸，这里定位并夹进
   窗口；返回 {margin, originX, originY, maxW, maxH}，popup 按 (margin,margin)
   摆放面板、用 originX/Y 算假壁纸偏移、把 maxW/maxH 设为面板上限（超出滚动）。 */
ipcMain.handle("popup:fit", (_e, d) => {
  if (!popupFit) return { ok: false };
  popupFit.wantW = d && d.w;
  popupFit.wantH = d && d.h;
  const r = applyPopupRect(popupFit.wantW, popupFit.wantH);
  return r ? { ok: true, ...r } : { ok: false };
});
/* 浮层行的右键/中键：弹层是独立 webContents，标签菜单与关闭动作都走主进程
   （原生菜单在光标处弹出，不经过任何视图层级） */
ipcMain.handle("popup:tab-context", (_e, id) => {
  const template = tabMenuTemplate(Number(id));
  if (!template) return { ok: false };
  try {
    const pt = screen.getCursorScreenPoint();
    Menu.buildFromTemplate(template).popup({ window: mainWin, x: pt.x, y: pt.y });
  } catch {}
  return { ok: true };
});
ipcMain.handle("popup:tab-aux", (_e, d) => {
  const id = Number(d && d.id);
  if (d && d.action === "close" && tabs.has(id)) closeTab(id);
  return { ok: true };
});
/* 浮层里拖动排序：与外壳同一套"移动语义"（只报放到谁前面 + 落点区）。浮层是
   独立 webContents，外壳的拖拽代码够不到它。 */
ipcMain.handle("popup:tab-reorder", (_e, d) => {
  const id = Number(d && d.id);
  if (!tabs.has(id)) return { ok: false };
  const beforeId = d && d.beforeId != null ? Number(d.beforeId) : null;
  const zone = d && (d.zone === "pinned" || d.zone === "normal") ? d.zone : null;
  return moveTabInOrder(id, beforeId, zone);
});
/* 拖拽期间挂住浮层：光标拖出窄条/面板时先别收回（落点还没定，面板没了就
   没法拖了）。拖完/取消时外壳再放行；4 秒兜底自动放行——拖拽中指针被别的
   视图抢走时，"放行"那一下可能永远收不到。 */
/* 悬停浮层画好了（popup 侧渲染完 rAF 后回报）：转给外壳。外壳收到才把窄条
   隐去——那一刻浮层与窄条是同一份像素（浮层就是 #vtab 的克隆、同矩形同料），
   交接零闪烁。窄条"先没、浮层后到"就是用户报的"鼠标放上去闪一下"。 */
ipcMain.on("popup:flyout-shown", () => {
  if (!popupShown || !mainWin || mainWin.isDestroyed()) return;
  try { mainWin.webContents.send("chrome:flyout-shown"); } catch {}
});
ipcMain.on("popup:hold", (_e, on) => {
  clearTimeout(flyoutHoldTimer);
  flyoutHold = !!on;
  if (flyoutHold) flyoutHoldTimer = setTimeout(() => { flyoutHold = false; }, 4000);
});
/* 地址栏联想的选中态（R39）：悬停索引从弹层回传给外壳（回车执行鼠标指着的那
   一行）；选中态从外壳发回弹层（方向键/悬停只改类名，不重建 DOM）。 */
ipcMain.on("popup:sug-hover", (_e, i) => {
  if (!mainWin || mainWin.isDestroyed()) return;
  const n = Number(i);
  if (!Number.isFinite(n)) return;
  try { mainWin.webContents.send("chrome:sug-hover", n); } catch {}
});
ipcMain.on("chrome:sug-sel", (_e, i) => {
  if (!popupView || popupView.webContents.isDestroyed()) return;
  const n = Number(i);
  if (!Number.isFinite(n)) return;
  try { popupView.webContents.send("popup:sug-sel", n); } catch {}
});
ipcMain.handle("popup:pick", (_e, payload) => {
  const k = payload && typeof payload === "object" ? payload.k : payload;
  const v = payload && typeof payload === "object" ? payload.v : undefined;
  const wasFlyout = !!(popupFit && popupFit.fullH);
  if (!wasFlyout) hidePopup();
  // 点击键回传给外壳层执行（业务逻辑都留在外壳里，覆盖层不持有状态）。
  // 带 data-pop-value 的项会顺带读回一个输入框的值（账号切换的验证码提交用）
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("chrome:popup-picked", { k: String(k || ""), v });
  } catch {}
  if (wasFlyout) {
    /* 浮层里的动作（钉子/新建/设置/标签行/组头）：先让外壳执行，由它自己收
       浮层——closeTabFlyout 是"先摘类再请求隐藏"，常驻侧栏在这一刻已经长好，
       浮层隐掉时不留缝。先隐视图的话中间会闪一条 46px 窄条，点钉子也像
       "没反应"。外壳万一不收（动作本身不关浮层），兜底 200ms 后关掉。 */
    clearTimeout(popupPickHideTimer);
    popupPickHideTimer = setTimeout(() => {
      popupPickHideTimer = null;
      if (popupShown) hidePopup();
    }, 200);
  }
  return { ok: true };
});
/* 关路径握手回执（R36）：外壳已经把窄条/常驻侧栏画回来了，这一刻才真隐弹层
   视图（hidePopup 里等着的那个定时器就是它） */
ipcMain.on("popup:hidden-ack", () => {
  if (popupHideAckTimer) {
    clearTimeout(popupHideAckTimer);
    popupHideAckTimer = null;
    popupHideHandoff = "ack";
  }
  try { popupView && popupView.setVisible(false); } catch {}
});
/* 不回隐的 pick：分组面板改色这类"点了还要留在面板里"的操作用
   （data-pop-stay 标记触发；面板内容变了外壳会自己重发一份） */
ipcMain.handle("popup:pick-stay", (_e, payload) => {
  const k = payload && typeof payload === "object" ? payload.k : payload;
  const v = payload && typeof payload === "object" ? payload.v : undefined;
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("chrome:popup-picked", { k: String(k || ""), v });
  } catch {}
  return { ok: true };
});

/* 壁纸视差：唯一权威在主进程。页面只上报鼠标目标值，主进程缓动一次、把
   **同一个数值**发给外壳 / 前台页面 / 弹层——以前页面和外壳各跑一份缓动
   （页面本地 rAF、外壳收 66ms 节流目标再自己 lerp），两层壁纸在运动中
   永远差一点，几何错位就是这么来的。 */
let parTX = 0, parTY = 0, parCX = 0, parCY = 0, parTimer = null;
function parPush() {
  const px = (parCX * -10).toFixed(2) + "px";
  const py = (parCY * -8).toFixed(2) + "px";
  const js =
    'document.documentElement.style.setProperty("--par-x",' + JSON.stringify(px) + ");" +
    'document.documentElement.style.setProperty("--par-y",' + JSON.stringify(py) + ");";
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("chrome:parallax", { px, py }); } catch {}
  const t = activeTabId != null ? tabs.get(activeTabId) : null;
  if (t && t.view && !t.view.webContents.isDestroyed()) {
    try { t.view.webContents.executeJavaScript(js, true).catch(() => {}); } catch {}
  }
  if (popupView && popupShown && !popupView.webContents.isDestroyed()) {
    try { popupView.webContents.executeJavaScript(js, true).catch(() => {}); } catch {}
  }
}
function parTick() {
  parCX += (parTX - parCX) * 0.08;
  parCY += (parTY - parCY) * 0.08;
  parPush();
  if (Math.abs(parTX - parCX) <= 0.002 && Math.abs(parTY - parCY) <= 0.002) {
    clearInterval(parTimer);
    parTimer = null;
  }
}
function parReset() {
  if (parTimer) { clearInterval(parTimer); parTimer = null; }
  parTX = parTY = parCX = parCY = 0;
  parPush();
}
ipcMain.on("lg-wall:parallax", (_e, p) => {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (cfg.wallpaperParallax === false) return;
  parTX = Number(p && p.x) || 0;
  parTY = Number(p && p.y) || 0;
  if (!parTimer) parTimer = setInterval(parTick, 33); // 16ms→33ms（R41）：30fps 缓动足够顺滑，双视图 executeJavaScript 减半
});

ipcMain.handle("tab:new", () => {
  // 新标签开应用首页（浏览器语义：新标签页 = 起始页）
  createHomeTab();
  return { ok: true };
});
ipcMain.handle("tab:close", (_e, id) => {
  closeTab(id);
  return { ok: true };
});
ipcMain.handle("tab:activate", (_e, id) => {
  setActiveTab(id);
  return { ok: true };
});
ipcMain.handle("tab:navigate", (_e, url) => {
  // chrome 层发起的导航：站外地址放行（不锁域），站内照常
  navigateActive(url, { unlock: true });
  return { ok: true };
});
ipcMain.handle("tab:open-external", (_e, url) => {
  if (url && /^https?:\/\//i.test(url)) createTab(url, { unlock: true });
  return { ok: true };
});
/* 地址栏 Alt+Enter：把输入内容**新标签**打开（Chrome/Edge 同款）。与
   open-external 的区别是锁定语义跟着目标走（洛谷 URL 不标 unlock）。 */
ipcMain.handle("tab:open", (_e, url) => {
  const full = normalizeUrl(String(url || ""));
  if (!/^https?:/i.test(full)) return { ok: false };
  createTab(full, { unlock: !isAllowed(full), activate: true });
  return { ok: true, url: full };
});
ipcMain.handle("tab:back", () => {
  const t = tabs.get(activeTabId);
  try { t && t.view.webContents.goBack(); } catch {}
  return { ok: true };
});
/* 长按后退/前进要弹出的历史栈（Edge 的行为：按住不放即列出这一串访问过的
   页面，点哪一条直接跳过去）。按需取——不在每次 tabsSnapshot 里带上：
   getAllEntries 在长栈上每次推送都调一遍纯属浪费，长按一次才调一次。
   luogu-glass:// 内部页面（设置/历史页的内部分发路由）不算用户的历史，跳过。 */
ipcMain.handle("tab:nav-history", (_e, id) => {
  const t = tabs.get(Number(id));
  if (!t || !t.view) return { ok: false, reason: "no-tab" };
  try {
    const wc = t.view.webContents;
    if (wc.isDestroyed()) return { ok: false, reason: "destroyed" };
    const nav = wc.navigationHistory;
    if (!nav || typeof nav.getAllEntries !== "function") return { ok: false, reason: "no-history-api" };
    const entries = nav.getAllEntries();
    const idx = typeof nav.getActiveIndex === "function" ? nav.getActiveIndex() : -1;
    const list = [];
    /* 倒序取（最近的在最前），只留最近 12 条：更早的几乎不会被长按点到，
       而每条都要带 title，长栈会让 IPC 载荷明显变大。 */
    for (let i = entries.length - 1; i >= 0 && list.length < 12; i--) {
      const e = entries[i];
      if (!e || !e.url) continue;
      if (/^luogu-glass:/i.test(e.url)) continue;
      list.push({ i, url: e.url, title: e.title || "", active: i === idx, forward: i > idx });
    }
    return { ok: true, index: idx, list };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
});
ipcMain.handle("tab:fwd", () => {
  const t = tabs.get(activeTabId);
  try { t && t.view.webContents.goForward(); } catch {}
  return { ok: true };
});
ipcMain.handle("tab:reload", () => {
  const t = tabs.get(activeTabId);
  try { t && t.view.webContents.reload(); } catch {}
  return { ok: true };
});
/* 停止加载（浏览器语义：加载中刷新键变停止键） */
ipcMain.handle("tab:stop", () => {
  const t = tabs.get(activeTabId);
  try { t && t.view && t.view.webContents.stop(); } catch {}
  return { ok: true };
});
ipcMain.handle("tab:toggle-ide", () => {
  toggleIde();
  return { ok: true };
});
/* 分屏编辑器（题目右侧并排 IDE 的抽屉）：题目页工具条已删（R36 用户要求），
   改从命令面板进——功能保留，入口不再往页面里塞按钮 */
ipcMain.handle("tab:toggle-drawer", () => {
  toggleDrawer();
  return { ok: true, open: !!drawerOpen };
});
/* 垂直标签栏收纳（Edge 式）：钉住（展开常驻）↔ 窄条（悬停浮出）。状态写进
   配置，重启不丢；切到水平模式再切回来也按这份配置还原（用户要求：原来钉住
   就还原钉住）。悬浮面板与窄条、命令面板的"布局"开关、快捷键动作 vtab 共用。 */
function toggleVtabPin() {
  /* 按"可见状态"取反（R36）：紧凑是独立一轴，可以存在
     {vtabCollapsed:false, vtabCompact:true} 这种"配置说展开、界面其实收没"
     的组合——旧写法第一下只把 collapsed 翻成 true、紧凑没人清，界面纹丝不动
     （用户报的"固定功能不可用"）。判据与外壳 togglePin 完全一致：rail/compact
     都不算展开；要展开就顺手清掉紧凑。任何起点第一下都有可见效果。 */
  const visibleNow = cfg.vtabCollapsed === false && !cfg.vtabCompact;
  cfg.vtabCollapsed = visibleNow; // 可见 → 收起（collapsed=true）；不可见 → 展开
  if (!visibleNow) cfg.vtabCompact = false;
  saveConfig();
  pushConfigToChrome();
  layout();
  return { ok: true, collapsed: cfg.vtabCollapsed !== false, compact: !!cfg.vtabCompact };
}
ipcMain.handle("tab:toggle-vtab", () => toggleVtabPin());
/* 拖侧栏右缘改宽度（Edge）：夹取 160~400 后落盘。页面 inset 与外壳的
   --vtab-w 都吃同一个值（主进程是唯一来源，外壳只是显示）。 */
ipcMain.handle("vtab:set-width", (_e, w) => {
  const n = Number(w);
  if (!Number.isFinite(n)) return { ok: false };
  cfg.vtabWidth = Math.round(Math.min(VTAB_MAX_W, Math.max(VTAB_MIN_W, n)));
  saveConfig();
  pushConfigToChrome();
  layout();
  return { ok: true, width: cfg.vtabWidth };
});
/* 分屏（R39 起只做左右两格）：并排 / 退出 / 拖比例 / 关闭左格 / 关闭右格 /
   反转左右位置 */
ipcMain.handle("tab:split", (_e, id) => {
  const ok = splitWith(activeTabId, id);
  return { ok };
});
ipcMain.handle("tab:unsplit", (_e, id) => ({ ok: unsplit(id != null ? id : activeTabId) }));
ipcMain.handle("tab:split-ratio", (_e, p) => {
  // ratio=null 表示双击复位回均分（0.5）
  setSplitRatio(p && p.id != null ? p.id : activeTabId, p && p.ratio, (p && p.field) || (p && p.kind));
  return { ok: true };
});
ipcMain.handle("tab:split-close-side", (_e, p) => ({
  ok: closeSplitSide(p && p.id != null ? p.id : activeTabId, p && p.side === "left" ? "left" : "right"),
}));
ipcMain.handle("tab:split-reverse", (_e, id) => ({ ok: reverseSplit(id != null ? id : activeTabId) }));

/* Glance 链接速览：页面 Alt+点击经 preload-page 桥进来；外壳按钮走 close/promote */
ipcMain.handle("lg-app:glance", (_e, url) => ({ ok: openGlance(url) }));
ipcMain.handle("tab:glance-close", () => {
  closeGlance();
  hidePopup();
  return { ok: true };
});
ipcMain.handle("tab:glance-promote", () => {
  const url = glanceUrl;
  closeGlance();
  // 正常链路 popup:pick 已经 hidePopup；这里兜底——任何调用方进来
  // 都保证速览壳连弹层一起收干净，不会留个死框盖在新标签上。
  hidePopup();
  if (url) createTab(url, { unlock: !isAllowed(url) });
  glanceUrl = "";
  return { ok: !!url };
});

/* 标签休眠：手动睡当前/其它；唤醒走 setActiveTab 自动触发 */
ipcMain.handle("tab:sleep", (_e, id) => ({ ok: sleepTab(id != null ? id : activeTabId) }));
ipcMain.handle("tab:sleep-others", () => ({ ok: true, count: sleepOtherTabs(activeTabId) }));

/* 标签分组：新建/加入/移出/改名改色折叠/取消分组/关闭组/组中新建 */
ipcMain.handle("tab:group-new", (_e, id) => {
  const g = newGroupFor(id != null ? id : activeTabId);
  return { ok: !!g, group: g ? { id: g.id, name: g.name, color: g.color } : null };
});
ipcMain.handle("tab:group-join", (_e, p) => ({ ok: joinGroup(p && p.id, p && p.groupId) }));
ipcMain.handle("tab:group-leave", (_e, id) => ({ ok: leaveGroup(id != null ? id : activeTabId) }));
ipcMain.handle("tab:group-update", (_e, p) => ({ ok: updateGroup(p && p.groupId, p && p.patch) }));
ipcMain.handle("tab:group-ungroup", (_e, gid) => {
  if (gid != null) ungroupAll(gid);
  return { ok: true };
});
ipcMain.handle("tab:group-close", (_e, gid) => {
  if (gid != null) closeGroupTabs(gid);
  return { ok: true };
});
ipcMain.handle("tab:group-newtab", (_e, gid) => ({ ok: newTabInGroup(gid) != null }));
/* 拖动落点（Edge 语义）：拖到标签上 = 建组/并组；拖到组头/组牌上 = 加入该组 */
ipcMain.handle("tab:group-drop", (_e, p) => groupDropApply(p));
ipcMain.handle("popup:group-drop", (_e, p) => groupDropApply(p));
/* 整组排序（拖动组头）：把该组块整体挪到 anchorId 前/后 */
ipcMain.handle("tab:group-move", (_e, p) => ({ ok: reorderGroup(p && p.groupId, p && p.anchorId, !!(p && p.before)) }));

/* ---------- 整理标签页（Edge「整理标签页」对应能力） ----------
   三个动作 + 一步撤销。整理必须"保分组"：钉住是独立前缀、分组块保持连续，
   只在块内部排序；去重先归一化 URL、按策略留一个，钉住 / 本地页 / 分屏成员
   不关；自动建组只碰未分组标签。每次整理前记一份现场（顺序 + 分组表 +
   被关标签的完整信息），tab:organize-undo 一步还原（toast 上的「撤销」）。 */
const DEDUPE_POLICIES = ["active", "first", "mru"];
/* 去重比较键：忽略 #hash、末尾斜杠、www.、http(s) 差异（同一页面的常见变体）。
   查询串保留——不同 query 往往是不同内容。 */
function dedupeKey(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/i.test(x.protocol)) return String(u || "");
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    const path = x.pathname.replace(/\/+$/, "");
    return host + path + x.search;
  } catch {
    return String(u || "");
  }
}
const organizeSortKey = (t) => {
  if (!t) return "9";
  if (isLocalKind(t.kind)) return "0-local";
  let host = "zz";
  try { host = new URL(t.url).hostname; } catch {}
  return "2-" + host + "|" + (t.url || "");
};

/* 按站点排序：钉住前缀不动；之后按"连续同组块 / 连续未分组段"切分区，
   只在分区内部排序——组块永远连成一片，不会被域名排序打散成多个色牌。 */
function sortDomain() {
  const pinnedCount = tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned).length;
  const head = tabOrder.slice(0, pinnedCount);
  const rest = tabOrder.slice(pinnedCount);
  const blocks = [];
  for (const id of rest) {
    const t = tabs.get(id);
    const gid = t && t.groupId != null ? t.groupId : null;
    const last = blocks[blocks.length - 1];
    if (last && last.gid === gid) last.ids.push(id);
    else blocks.push({ gid, ids: [id] });
  }
  let changed = 0;
  for (const b of blocks) {
    if (b.ids.length < 2) continue;
    const before = b.ids.slice();
    b.ids.sort((a, c) => {
      const ka = organizeSortKey(tabs.get(a));
      const kc = organizeSortKey(tabs.get(c));
      return ka < kc ? -1 : ka > kc ? 1 : 0;
    });
    for (let i = 0; i < b.ids.length; i++) if (b.ids[i] !== before[i]) changed++;
  }
  tabOrder = head.concat(...blocks.map((b) => b.ids));
  pushTabs();
  scheduleSaveTabs();
  return { ok: true, changed };
}

/* 关闭重复标签：归一化后同键为一组；钉住 / 本地页不参与；分屏成员不关
   （组里还有可分屏外成员时只关那些，全都不可关就整组跳过并计数）。
   保留策略 cfg.dedupeKeep：active=留当前激活页（不在可选集里就退回 first）
   / first=留位置最靠前的 / mru=留最近使用过的。 */
function closeDuplicates() {
  const policy = DEDUPE_POLICIES.includes(cfg.dedupeKeep) ? cfg.dedupeKeep : "active";
  const byKey = new Map();
  for (const tid of tabOrder) {
    const t = tabs.get(tid);
    if (!t) continue;
    if (t.pinned || isLocalKind(t.kind)) continue;
    if (!/^https?:/i.test(t.url || "")) continue;
    const k = dedupeKey(t.url);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(tid);
  }
  let closed = 0;
  let skipped = 0;
  const items = [];
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    const closable = ids.filter((id) => !splits.has(id));
    if (closable.length < 2) { skipped += ids.length - 1; continue; }
    let keep = closable[0];
    if (policy === "active" && closable.includes(activeTabId)) keep = activeTabId;
    else if (policy === "mru") keep = closable.slice().sort((a, b) => ((tabs.get(b) || {}).lastActive || 0) - ((tabs.get(a) || {}).lastActive || 0))[0];
    for (const id of closable) {
      if (id === keep) continue;
      const t = tabs.get(id);
      items.push({
        url: t.url,
        title: t.title || "",
        kind: t.kind || null,
        special: !!t.special,
        pinned: !!t.pinned,
        groupId: t.groupId != null ? t.groupId : null,
        index: tabOrder.indexOf(id),
      });
      closeTab(id);
      closed++;
    }
  }
  return { ok: true, closed, skipped, items };
}

/* 按域名自动建组（Edge 式）：只处理未分组标签，同域 ≥2 才建；
   组名=主机名（去 www），颜色从未占用的调色板里挑；组块落在首个成员原位置，
   其余成员保持原相对顺序；已有分组一律不动。 */
function autoGroupByDomain() {
  const byHost = new Map();
  for (const id of tabOrder) {
    const t = tabs.get(id);
    if (!t || t.pinned || t.groupId != null) continue;
    if (isLocalKind(t.kind) || !/^https?:/i.test(t.url || "")) continue;
    let host = "";
    try { host = new URL(t.url).hostname.replace(/^www\./, ""); } catch {}
    if (!host) continue;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(id);
  }
  const usedColors = new Set([...tabGroups.values()].map((g) => g.color));
  const blockByGid = new Map();
  const autoGroups = [];
  for (const [host, ids] of byHost) {
    if (ids.length < 2) continue;
    const gid = ++groupSeq;
    const color = GROUP_PALETTE.find((c) => !usedColors.has(c)) || GROUP_PALETTE[groupColorCursor++ % GROUP_PALETTE.length];
    usedColors.add(color);
    tabGroups.set(gid, { id: gid, name: host, color, collapsed: false });
    for (const id of ids) tabs.get(id).groupId = gid;
    blockByGid.set(gid, ids);
    autoGroups.push(gid);
  }
  if (!autoGroups.length) return { ok: true, groups: 0, autoGroups: [] };
  const autoSet = new Set(autoGroups);
  const emitted = new Set();
  const out = [];
  for (const id of tabOrder) {
    const t = tabs.get(id);
    const gid = t && t.groupId != null ? t.groupId : null;
    if (gid != null && autoSet.has(gid)) {
      if (emitted.has(gid)) continue;
      emitted.add(gid);
      out.push(...blockByGid.get(gid));
    } else out.push(id);
  }
  tabOrder = out;
  pushTabs();
  scheduleSaveTabs();
  return { ok: true, groups: autoGroups.length, autoGroups };
}

/* 最后一次整理（toast 的「撤销」用）：只留一份，8 分钟内有效 */
let lastOrganize = null;
const ORGANIZE_UNDO_MS = 8 * 60 * 1000;
function runOrganize(action) {
  if (action !== "sort-domain" && action !== "close-duplicates" && action !== "group-by-domain") return { ok: false };
  const rec = {
    at: Date.now(),
    action,
    orderBefore: tabOrder.slice(),
    groupsBefore: [...tabGroups.values()].map((g) => ({ ...g })),
    closed: [],
    autoGroups: [],
  };
  const res =
    action === "sort-domain" ? sortDomain()
    : action === "close-duplicates" ? closeDuplicates()
    : autoGroupByDomain();
  if (res.items) rec.closed = res.items;
  if (res.autoGroups) rec.autoGroups = res.autoGroups;
  const changed = (res.changed | 0) > 0 || (res.closed | 0) > 0 || (res.groups | 0) > 0;
  lastOrganize = changed ? rec : null;
  /* action 必须带回给外壳：toast 文案按它分支（漏了会一律落到"排序"那支） */
  return { ...res, action, canUndo: !!lastOrganize };
}
function undoOrganize() {
  const rec = lastOrganize;
  if (!rec) return { ok: false, reason: "nothing" };
  if (Date.now() - rec.at > ORGANIZE_UNDO_MS) { lastOrganize = null; return { ok: false, reason: "expired" }; }
  lastOrganize = null;
  /* 1) 重建被关掉的标签（按记录的原下标回位；本地页/钉住不参与去重，
     所以这里只可能是 http(s) 标签） */
  const byIndex = new Map();
  let restored = 0;
  for (const it of rec.closed || []) {
    if (!it.url) continue;
    let id = null;
    try { id = createTab(it.url, { activate: false, special: !!it.special, kind: it.kind || null }); } catch {}
    if (id == null) continue;
    const t = tabs.get(id);
    if (t) {
      t.pinned = !!it.pinned;
      t.groupId = it.groupId != null ? it.groupId : null;
    }
    byIndex.set(it.index, id);
    restored++;
  }
  /* 2) 按整理前的顺序拼回：老 id 还在就用老 id，被关掉的位置用重建的新 id */
  const alive = new Set(tabOrder);
  const used = new Set();
  const rebuilt = [];
  for (let i = 0; i < rec.orderBefore.length; i++) {
    const old = rec.orderBefore[i];
    if (alive.has(old)) { rebuilt.push(old); used.add(old); }
    else if (byIndex.has(i)) { rebuilt.push(byIndex.get(i)); used.add(byIndex.get(i)); }
  }
  for (const id of tabOrder) if (!used.has(id)) rebuilt.push(id);
  tabOrder = rebuilt;
  /* 3) 分组表回到整理前：缺的补回来（去重可能把组关空了）；本次自动建的组拆掉 */
  for (const g of rec.groupsBefore || []) {
    if (!tabGroups.has(g.id)) {
      tabGroups.set(g.id, { ...g });
      groupSeq = Math.max(groupSeq, g.id);
    }
  }
  const snapshotIds = new Set((rec.groupsBefore || []).map((g) => g.id));
  for (const gid of rec.autoGroups || []) {
    if (snapshotIds.has(gid)) continue;
    for (const t of tabs.values()) if (t.groupId === gid) t.groupId = null;
    tabGroups.delete(gid);
  }
  pruneGroups();
  pushTabs();
  scheduleSaveTabs();
  return { ok: true, restored, action: rec.action };
}
ipcMain.handle("tab:organize", (_e, action) => runOrganize(String(action || "")));
ipcMain.handle("tab:organize-undo", () => undoOrganize());
/* 窗口控制（自绘按钮：系统 titleBarOverlay 会盖住账号芯片） */
function pushWinState() {
  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.webContents.send("chrome:winstate", { maximized: mainWin.isMaximized() }); } catch {}
  }
}
ipcMain.handle("win:minimize", () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.minimize();
  return { ok: true };
});
ipcMain.handle("win:toggle-max", () => {
  if (!mainWin || mainWin.isDestroyed()) return { ok: false };
  if (mainWin.isMaximized()) mainWin.unmaximize();
  else mainWin.maximize();
  pushWinState();
  return { ok: true, maximized: mainWin.isMaximized() };
});
ipcMain.handle("win:close", () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.close();
  return { ok: true };
});

ipcMain.handle("app:copy-text", (_e, text) => {
  /* 复制失败要**说失败**：剪贴板被别的应用占用时 writeText 会抛，
     此前一律 catch 掉并返回 ok:true —— 用户以为复制好了，其实没复制，
     粘贴出来的是上一次的旧内容。 */
  try {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  } catch (e) {
    try { dbg("copy-text failed: " + ((e && e.message) || e)); } catch {}
    return { ok: false, message: String((e && e.message) || e) };
  }
});

ipcMain.handle("app:open-external", (_e, url) => {
  // 只放行 http(s)：file:// 之类会被 ShellExecute 直接执行本地程序
  if (/^https?:\/\//i.test(String(url || "")) && !isAllowed(url)) shell.openExternal(url);
  return { ok: true };
});

/* ---------- 标签页右键菜单（浏览器语义：关闭其它 / 右侧 / 静音 / 复制） ----------
   模板抽成函数：外壳的标签右键与弹层浮层行的右键共用这一份（原生菜单） */
/* 多选建组（Edge：Ctrl/Shift 选一串标签 → 右键"用选中的标签新建分组"）。
   选择集由外壳持有（它是界面状态），开菜单时随 IPC 递过来，只影响这一次菜单。 */
let tabMenuSel = [];
function tabMenuTemplate(id) {
  const t = tabs.get(id);
  if (!t || !mainWin || mainWin.isDestroyed()) return null;
  const idx = tabOrder.indexOf(id);
  const others = tabOrder.filter((x) => x !== id && !tabs.get(x).pinned);
  const right = tabOrder.slice(idx + 1).filter((x) => !tabs.get(x).pinned);
  const wc = t.view.webContents;
  let muted = false;
  try { muted = wc.isAudioMuted(); } catch {}
  const isLocalPage = isLocalKind(t.kind) || /^file:/i.test(t.url || "");
  /* 选中的标签（右键的那枚在多选集里、且至少 2 个）→ 菜单顶部给一条建组入口 */
  const sel = tabMenuSel.filter((x) => tabs.has(x) && !tabs.get(x).pinned);
  const selItem =
    sel.length >= 2 && sel.includes(id)
      ? [
          {
            label: "用选中的 " + sel.length + " 个标签新建分组",
            click: () => {
              const g = createGroupFromTabs(sel);
              if (g) sendToast("已新建分组「" + (g.name || "未命名组") + "」· " + sel.length + " 个标签");
            },
          },
          { type: "separator" },
        ]
      : [];
  const template = [
    ...selItem,
    { label: "重新加载", click: () => { try { wc.reload(); } catch {} } },
    { label: "复制页面地址", enabled: !isLocalPage, click: () => clipboard.writeText(t.url || "") },
    { type: "separator" },
    { label: "复制为新标签页", enabled: !isLocalPage, click: () => createTab(t.url, { special: t.special }) },
    {
      label: muted ? "取消静音" : "静音此标签页",
      enabled: !isLocalPage,
      click: () => { t.muted = !muted; try { wc.setAudioMuted(!muted); } catch {} pushTabs(); },
    },
    {
      label: t.pinned ? "取消钉住" : "钉住标签页",
      click: () => setTabPinned(t, !t.pinned),
    },
    {
      // 标签休眠（Zen 式）：卸载后台标签的视图省内存，点回去自动唤醒
      label: t.sleeping ? "已休眠（点击标签唤醒）" : "休眠此标签页",
      enabled: !t.sleeping && id !== activeTabId && !isLocalPage && !t.pinned,
      click: () => sleepTab(id),
    },
    /* 整理标签页（与标签页操作菜单/命令面板同一组动作）：原生菜单里是子菜单，
       执行完的结果提示与撤销由外壳的 toast 负责（这里只发动作） */
    {
      label: "整理标签页",
      submenu: [
        { label: "按站点排序（保分组）", click: () => { try { mainWin.webContents.send("chrome:organize-done", runOrganize("sort-domain")); } catch {} } },
        { label: "关闭重复标签", click: () => { try { mainWin.webContents.send("chrome:organize-done", runOrganize("close-duplicates")); } catch {} } },
        { label: "按域名自动建组", click: () => { try { mainWin.webContents.send("chrome:organize-done", runOrganize("group-by-domain")); } catch {} } },
      ],
    },
    {
      // 分屏（R39 只做左右两格，1:1 Chromium split tab）：未分屏时与当前标签
      // 并排；已在分屏里则退出（关一格 = 分屏解散，幸存那格回全宽）
      label: splits.has(id) ? "退出分屏" : "与当前标签分屏显示",
      enabled: splits.has(id) ? true : activeTabId != null && activeTabId !== id,
      click: () => {
        if (splits.has(id)) unsplit(id);
        else splitWith(activeTabId, id);
      },
    },
    /* 分屏成员专属（对齐 Chromium split_tab_menu_model：关左/右窗格、反转位置） */
    ...(() => {
      const g = splitGroupOf(id);
      if (!g) return [];
      return [
        { label: "关闭左侧窗格", click: () => closeSplitSide(id, "left") },
        { label: "关闭右侧窗格", click: () => closeSplitSide(id, "right") },
        { label: "反转左右位置", click: () => reverseSplit(id) },
      ];
    })(),
    /* 标签分组（Edge Tab Groups）：未分组 → 添加到新组/加入现有组；
       已分组 → 移出/取消分组/关闭分组。一个标签最多属一个组。 */
    ...(t.groupId == null
      ? [
          {
            label: "添加到新组",
            click: () => newGroupFor(id),
          },
          ...(tabGroups.size
            ? [
                {
                  label: "加入分组",
                  submenu: Array.from(tabGroups.values()).map((g) => ({
                    label: (g.name || "未命名组") + "（" + groupMembers(g.id).length + " 个标签）",
                    click: () => joinGroup(id, g.id),
                  })),
                },
              ]
            : []),
        ]
      : [
          {
            label: "从分组中移除",
            click: () => leaveGroup(id),
          },
          {
            label: "取消分组",
            click: () => ungroupAll(t.groupId),
          },
          {
            label: "关闭分组",
            click: () => closeGroupTabs(t.groupId),
          },
        ]),
    { type: "separator" },
    {
      label: "关闭其它标签页",
      enabled: others.length > 0,
      click: () => { for (const x of others.slice()) closeTab(x); },
    },
    {
      label: "关闭右侧标签页",
      enabled: right.length > 0,
      click: () => { for (const x of right) closeTab(x); },
    },
    { type: "separator" },
    { label: "关闭标签页", click: () => closeTab(id) },
  ];
  return template;
}
ipcMain.handle("tab:context-menu", (_e, arg) => {
  const p = arg && typeof arg === "object" ? arg : { id: arg };
  const id = Number(p.id);
  /* 多选集（外壳递过来的界面状态）：只在"右键的那枚也在选集里"时参与菜单 */
  tabMenuSel = Array.isArray(p.sel) ? p.sel.map(Number).filter((x) => tabs.has(x)) : [];
  const template = tabMenuTemplate(id);
  tabMenuSel = [];
  if (!template) return { ok: false };
  // 自测下不弹真菜单（无人点它就会一直挂在那儿），改为回报菜单结构
  if (configtest || argv.includes("--lg-v35test") || argv.includes("--lg-v37test")) return { ok: true, items: template.map((i) => i.label || i.type) };
  Menu.buildFromTemplate(template).popup({ window: mainWin });
  return { ok: true };
});

/* 钉住前缀不变量（v3.6.0）：钉住标签集中在 tabOrder 头部。UI 本来就把它们
   画在独立区（垂直栏图标网格 / 水平条前段），但顺序数据里可能散在中间——
   拖拽 move 语义按"前缀"钳制（钉住不许出去、非钉住不许进来），靠这条归一
   兜底。稳定排序：只挪位置，不动相对次序。 */
function normalizePinnedOrder() {
  const pinnedIds = tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned);
  if (!pinnedIds.length) return;
  const rest = tabOrder.filter((x) => !(tabs.get(x) && tabs.get(x).pinned));
  tabOrder = pinnedIds.concat(rest);
}
function setTabPinned(t, on) {
  if (!t) return;
  t.pinned = !!on;
  if (t.pinned) {
    normalizePinnedOrder();
    tabOrder = tabOrder.filter((x) => x !== t.id);
    const n = tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned).length;
    tabOrder.splice(n, 0, t.id);
  }
  pushTabs();
  scheduleSaveTabs();
}

/* 拖拽排序：外壳只报"把谁放到谁前面"（move 语义）+ 落点区（zone）。早先是
   "外壳回传完整顺序"，而垂直栏里钉住标签在独立区、折叠组只画一块组牌，外壳手里
   的顺序天生没有这些标签，主进程只好把"漏发的"补到末尾，结果每次垂直拖拽都把
   钉住与折叠组整批甩到最后（用户报的"拖动排序后标签乱跑"）。改成 move 后，主进程
   在权威 tabOrder 上落位，外壳不需要也不可能掌握全量顺序。
   边界规则：钉住是独立前缀——区内的落点仍被钳制在区内；**跨区由 zone 显式声明**
   （"pinned"=拖进钉住区 ⇒ 钉住，"normal"=拖出钉住区 ⇒ 取消钉住，Edge 行为），
   不传 zone 时按当前钉住态处理（老行为，区外落点钳回本区）。
   分组用 group-join/group-leave 另管（外壳按落点先归属再调这里）。 */
function moveTabInOrder(id, beforeIdRaw, zone) {
  if (!tabs.has(id)) return { ok: false };
  const t = tabs.get(id);
  const prevIdx = tabOrder.indexOf(id); // 吸附分屏对时判断"从哪边来"
  const beforeId = beforeIdRaw != null && tabs.has(Number(beforeIdRaw)) ? Number(beforeIdRaw) : null;
  const wantPinned = zone === "pinned" ? true : zone === "normal" ? false : !!t.pinned;
  if (wantPinned !== !!t.pinned) {
    // 钉住区是独立前缀，分组只对普通标签起效：拖进钉住区顺手退出原组
    if (wantPinned) leaveGroupSilently(id);
    setTabPinned(t, wantPinned);
    pruneGroups();
  }
  normalizePinnedOrder();
  tabOrder = tabOrder.filter((x) => x !== id);
  const isPinned = (x) => !!(tabs.get(x) && tabs.get(x).pinned);
  const pinnedCount = tabOrder.filter(isPinned).length;
  /* 禁止把标签插到分屏两格之间（Chromium TabDragContextImpl::IsValidInsertionIndex
     同款）：落点正好是某个分屏对的第二位成员时，吸附到对块外侧——按拖动前的
     位置偏向贴哪边。两格在标签条里必须始终相邻。 */
  let bid = beforeId;
  if (bid != null) {
    for (const g of new Set(splits.values())) {
      if (!g || g.ids.length !== 2 || g.ids.includes(id)) continue;
      const la = g.ids[0];
      const rb = g.ids[1];
      if (bid !== rb || !tabs.has(la) || !tabs.has(rb)) continue;
      const li = tabOrder.indexOf(la);
      if (li < 0 || tabOrder[li + 1] !== rb) continue; // 两格不相邻则无从谈起
      const ri = tabOrder.indexOf(rb);
      bid = prevIdx >= 0 && prevIdx < li ? la : (ri + 1 < tabOrder.length ? tabOrder[ri + 1] : null);
      break;
    }
  }
  let idx = bid == null ? tabOrder.length : tabOrder.indexOf(bid);
  if (idx < 0) idx = tabOrder.length;
  if (t.pinned) idx = Math.min(idx, pinnedCount);
  else idx = Math.max(idx, pinnedCount);
  tabOrder.splice(idx, 0, id);
  pushTabs();
  scheduleSaveTabs();
  return { ok: true, order: tabOrder.slice() };
}
ipcMain.handle("tab:reorder", (_e, arg) => {
  const p = arg && typeof arg === "object" ? arg : null;
  return moveTabInOrder(p ? Number(p.id) : NaN, p ? p.beforeId : null, p ? p.zone : null);
});

ipcMain.handle("tab:zoom", (_e, dir) => {
  if (dir === 0) {
    const t = tabs.get(activeTabId);
    if (t) setZoom(t, 1);
  } else {
    zoomStep(dir > 0 ? 1 : -1);
  }
  const t = tabs.get(activeTabId);
  return { ok: true, zoom: t ? t.zoom || 1 : 1 };
});

/* ============================================================
   标签悬停预览缩略图（Edge 标签预览卡片）
   ============================================================ */
/* 缩略图缓存：tabId -> { dataUrl, url, at, w, h }
   命中条件：缓存的 url === 当前 t.url（标签导航后 t.url 变 → 缓存自然失效，
   不需要额外挂导航钩子）且缓存年龄 < 20 秒。
   悬停是高频动作（指针扫过标签条就会触发），不缓存的话每扫一次就抓一帧，
   capturePage 本身不便宜，缓存是必须的。 */
const THUMB_TTL = 20000;   // 缓存有效期 20 秒
const THUMB_MAX = 24;      // 最多缓存 24 张，超出按 at 从旧到新淘汰
const thumbCache = new Map();

ipcMain.handle("lg-tab:thumb", async (_e, id) => {
  try {
    const tid = Number(id);
    const t = tabs.get(tid);
    if (!t) return { ok: false, reason: "no-tab" };
    /* 休眠标签的 t.view 是 null（makeSleeping 置空）——必须先判空，
       否则下面 t.view.webContents 直接空指针。 */
    if (!t.view) return { ok: false, reason: "sleeping" };
    const wc = t.view.webContents;
    if (!wc || wc.isDestroyed()) return { ok: false, reason: "destroyed" };

    const url = t.url || "";
    const hit = thumbCache.get(tid);
    if (hit && hit.url === url && Date.now() - hit.at < THUMB_TTL) {
      return { ok: true, dataUrl: hit.dataUrl, w: hit.w, h: hit.h, url: hit.url };
    }

    /* capturePage 在部分视图上可能长时间不决（渲染进程卡住），
       统一走 withTimeout 竞速：不加超时的话一个卡死的视图会把整个 IPC 挂死，
       外壳那边 await 永远不落地，卡片就再也出不来了。 */
    const img = await withTimeout(wc.capturePage(), 1500, null);
    if (!img) return { ok: false, reason: "timeout" };
    if (img.isEmpty()) return { ok: false, reason: "empty" };
    /* 先缩到宽 320 再编码：整屏 PNG 的 base64 有几百 KB，
       走 IPC 传过去再塞进 <img> 会明显卡顿，320 宽足够看清页面版式。 */
    const small = img.resize({ width: 320, quality: "good" });
    const size = small.getSize();
    const dataUrl = small.toDataURL();
    const entry = { dataUrl, url, at: Date.now(), w: size.width, h: size.height };
    thumbCache.set(tid, entry);
    /* 容量上限：超出时按 at 从旧到新淘汰（Map 本身按插入序，
       但同一标签会覆盖旧值，用 at 排才准）。 */
    if (thumbCache.size > THUMB_MAX) {
      const stale = [...thumbCache.entries()].sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < stale.length - THUMB_MAX; i++) thumbCache.delete(stale[i][0]);
    }
    return { ok: true, dataUrl, w: size.width, h: size.height, url };
  } catch (e) {
    /* 绝不让 IPC reject：外壳那边是 await，一个 reject 会变成未处理异常 */
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

/* ============================================================
   书签 / 历史 / 下载
   ============================================================ */
const historyPath = () => path.join(app.getPath("userData"), "history.json");
const HISTORY_MAX = 800;
let history = [];
function loadHistory() {
  const raw = readJsonSafe(historyPath(), [], "浏览历史");
  history = Array.isArray(raw) ? raw : [];
}
let historyTimer = null;
function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    historyTimer = null;
    writeTextAtomicSync(historyPath(), JSON.stringify(history.slice(-HISTORY_MAX)));
  }, 900);
}
function recordHistory(url, title) {
  if (!url || !/^https?:/i.test(url)) return;
  const last = history[history.length - 1];
  if (last && last.url === url) {
    last.ts = Date.now();
    if (title) last.title = title;
  } else {
    history.push({ url, title: title || url, ts: Date.now() });
  }
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  saveHistory();
}
function searchHistory(query, limit = 200) {
  const q = String(query || "").trim().toLowerCase();
  const list = q
    ? history.filter((h) => (h.url || "").toLowerCase().includes(q) || (h.title || "").toLowerCase().includes(q))
    : history;
  // 新的在前；同 URL 只留最近一次
  const seen = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const h = list[i];
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    out.push(h);
  }
  return out;
}

/* 下载：统一落到「下载/Luogu++」（设置里可改成"每次询问保存位置"），
   进度 / 暂停 / 继续 / 取消 / 重试 / 另存为 / 在文件夹中显示接进外壳。
   记录持久化到 downloads.json（重启后没下完的标 interrupted，可重试）。
   --lg-dltest=<dir> 是探针专用：把下载目录指到临时目录，别往用户的
   「下载」里丢测试文件。 */
const dlTestDir = (() => {
  const a = argv.find((x) => x.startsWith("--lg-dltest="));
  return a ? a.split("=").slice(1).join("=") : "";
})();
const downloadsDir = () => (dlTestDir ? dlTestDir : path.join(app.getPath("downloads"), "Luogu++"));
const downloadsPath = () => path.join(app.getPath("userData"), "downloads.json");
let downloads = [];
let downloadSeq = 0;
/* 在飞/历史下载的句柄：id → { item, wc }。item 下完清空（取消/重试/暂停要用），
   wc 留着给"重试"（用它原来的会话重新发起，别把站外下载塞进默认会话）。 */
const dlItems = new Map();
function loadDownloads() {
  const raw = readJsonSafe(downloadsPath(), [], "下载记录");
  const list = Array.isArray(raw) ? raw : [];
  downloads = list
    .filter((d) => d && d.id)
    .map((d) => (d.state === "progressing" || d.state === "paused" ? { ...d, state: "interrupted" } : d));
  downloadSeq = downloads.reduce((m, d) => Math.max(m, Number(d.id) || 0), 0);
}
function saveDownloads() {
  writeTextAtomicSync(downloadsPath(), JSON.stringify(downloads.slice(-80), null, 1));
}
function publicDownloads() {
  return downloads.slice(-40).map((d) => ({
    id: d.id,
    filename: d.filename,
    state: d.state,
    received: d.received,
    total: d.total,
    savePath: d.savePath,
    startedAt: d.startedAt,
    canPause: dlItems.has(d.id) && !!dlItems.get(d.id).item,
    canSaveAs: d.state === "completed" && !!d.savePath,
  }));
}
function pushDownloads() {
  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.webContents.send("chrome:downloads", publicDownloads()); } catch {}
  }
}
/* ---------- 广告拦截（R37） ----------
   请求级：同源推广取数口 /qiafan/*（题解页右栏"省选计划"那张卡的接口）与几家
   常见第三方广告域直接 cancel。挂在与 wireDownloads 相同的三个会话挂点上
   （acctSession / sharedSession / defaultSession），回调实时读 cfg.clean——
   设置页"隐藏广告与推广"一关立刻放行，不需要重挂监听。
   注意：Electron 的 webRequest 同一事件只认最后一个监听器；将来要再加
   onBeforeRequest，必须并进这里，不要另挂第二个。 */
const AD_URL_FILTERS = [
  "*://*.luogu.com.cn/qiafan/*",
  "*://*.googlesyndication.com/*",
  "*://*.doubleclick.net/*",
  "*://*.googleadservices.com/*",
  "*://*/adsserver/*",
];
let adBlockCount = 0; // 探针面包屑：本进程拦掉的广告请求数
function wireAdBlock(sess) {
  if (!sess || sess.__lgAdWired) return;
  sess.__lgAdWired = true;
  try {
    sess.webRequest.onBeforeRequest({ urls: AD_URL_FILTERS }, (details, cb) => {
      if (cfg.clean === false) { cb({}); return; }
      adBlockCount++;
      dbg("[adblock] block " + String((details && details.url) || "").slice(0, 160));
      cb({ cancel: true });
    });
  } catch (e) { dbg("wireAdBlock failed: " + e); }
}
/* 字节数 → 人类可读体积（通知正文用）。未知大小（0/NaN）回退成"大小未知"，
   免得正文里冒出裸字节数。 */
function formatBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return "大小未知";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + " " + u[i];
}

/* 下载完成通知：点了聚焦窗口 + 在资源管理器里定位到文件（同 Edge）。
   全程 try/catch 且先问 isSupported()——通知是"锦上添花"，绝不能因为它
   抛异常把下载流程带崩；批量下载会并发调到这里多次。 */
function notifyDownloadDone(rec) {
  try {
    if (cfg.downloadNotify === false) return;
    if (!Notification.isSupported()) return;
    const name = path.basename(rec.savePath || rec.filename || "下载");
    const n = new Notification({
      title: "下载完成",
      body: name + " · " + formatBytes(rec.total || rec.received),
      silent: false,
    });
    n.on("click", () => {
      /* 定位到文件优先；窗口没了/路径不可用就只退化为聚焦，不抛 */
      try {
        if (mainWin && !mainWin.isDestroyed()) {
          if (mainWin.isMinimized()) mainWin.restore();
          mainWin.focus();
        }
      } catch {}
      try {
        if (rec.savePath && fs.existsSync(rec.savePath)) shell.showItemInFolder(rec.savePath);
      } catch {}
    });
    n.show();
  } catch (e) { dbg("notifyDownloadDone: " + e); }
}

function wireDownloads(sess) {
  if (!sess || sess.__lgDownWired) return;
  sess.__lgDownWired = true;
  sess.on("will-download", (_e, item, wc) => {
    const rec = {
      id: ++downloadSeq,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: "",
      state: "progressing",
      received: 0,
      total: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    downloads.push(rec);
    if (cfg.dlAsk === true) {
      // "每次询问保存位置"：不调 setSavePath，Electron 自己弹原生另存为对话框
    } else {
      // 默认：统一收到 Luogu++ 目录，面板里一键"在文件夹中显示"
      try {
        const dir = downloadsDir();
        fs.mkdirSync(dir, { recursive: true });
        rec.savePath = path.join(dir, item.getFilename());
        item.setSavePath(rec.savePath);
      } catch {}
    }
    dlItems.set(rec.id, { item, wc: wc && !wc.isDestroyed() ? wc : null });
    const sync = (state) => {
      /* DownloadItem 暂停期间仍报 "progressing"：别让进度事件把"已暂停"盖回去 */
      if (state && !(state === "progressing" && rec.state === "paused")) rec.state = state;
      try {
        rec.received = item.getReceivedBytes();
        rec.total = item.getTotalBytes();
        if (!rec.savePath && item.getSavePath()) rec.savePath = item.getSavePath();
      } catch {}
      pushDownloads();
    };
    item.on("updated", (_e2, state) => sync(state));
    item.once("done", (_e2, state) => {
      sync(state);
      const e = dlItems.get(rec.id);
      /* item 下完即废；但 wc 还得留着给"重试"（要用它原来的会话重发）。
         wc 已经销毁就没留着的意义了——不删会让 dlItems 一直攥着已销毁的
         webContents 引用（重试本来就靠 isDestroyed() 退化到活动标签）。 */
      if (e) {
        e.item = null;
        if (!e.wc || e.wc.isDestroyed()) dlItems.delete(rec.id);
      }
      saveDownloads();
      dbg("download " + state + ": " + rec.savePath);
      /* 只在真正 completed 时通知：interrupted / cancelled 都不是"下好了" */
      if (state === "completed") notifyDownloadDone(rec);
    });
    sync(null);
    saveDownloads();
  });
}

ipcMain.handle("lg-history:list", (_e, query) => ({ ok: true, entries: searchHistory(query) }));
/* 单条删除：历史条目没有独立 id，用 (url, ts) 精确定位（同 URL 重访各留一条） */
function removeHistoryEntry(url, ts) {
  const u = String(url || "");
  if (!u) return 0;
  const before = history.length;
  history = history.filter((h) => !(h && h.url === u && (Number.isFinite(Number(ts)) ? Number(h.ts) === Number(ts) : true)));
  const removed = before - history.length;
  if (removed) saveHistory();
  return removed;
}
ipcMain.handle("lg-history:remove", (_e, p) => ({
  ok: true,
  removed: removeHistoryEntry(p && p.url, p && p.ts),
}));
ipcMain.handle("lg-history:clear", () => {
  history = [];
  saveHistory();
  return { ok: true };
});

/* 清除浏览数据（设置页「其他 → 清除浏览数据」/ Ctrl+Shift+Delete）：
   缓存与 Cookie/站点数据覆盖 default + 站外共享 + 每个账号分区；历史与
   下载记录清的是自研 JSON。清 Cookie 会退出洛谷登录态，设置页有明示。 */
async function clearBrowsingData(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const storages = [];
  if (o.cache) storages.push("appcache", "cachestorage", "shadercache", "serviceworkers");
  if (o.cookies) storages.push("cookies", "localstorage", "indexdb", "websql", "filesystem");
  const sessions = new Set([session.defaultSession, sharedSession()]);
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a && a.id) sessions.add(acctSession(a.id));
  }
  for (const s of sessions) {
    if (o.cache) { try { await s.clearCache(); } catch {} }
    if (storages.length) { try { await s.clearStorageData({ storages }); } catch {} }
  }
  let historyCleared = false;
  let downloadsCleared = false;
  if (o.history) { history = []; saveHistory(); historyCleared = true; }
  if (o.downloads) {
    downloads = downloads.filter((d) => d.state === "progressing" || d.state === "paused");
    saveDownloads();
    pushDownloads();
    downloadsCleared = true;
  }
  dbg("clear-data: sessions=" + sessions.size + " cache=" + !!o.cache + " cookies=" + !!o.cookies + " history=" + historyCleared + " downloads=" + downloadsCleared);
  return { ok: true, sessions: sessions.size, historyCleared, downloadsCleared };
}
ipcMain.handle("lg-app:clear-data", (_e, opts) => clearBrowsingData(opts));

/* 地址栏联想：历史 + 映射词（打开的标签与"搜索"行在外壳本地合并，那里才有
   标签快照）。返回结构刻意保持小而稳定，外壳按 prefix 匹配排序。 */
ipcMain.handle("lg-nav:suggest", (_e, q) => {
  const query = String(q || "").trim();
  if (!query) return { ok: true, history: [], mappings: [] };
  const map = cfg.mappings && typeof cfg.mappings === "object" ? cfg.mappings : {};
  const mappings = Object.keys(map)
    .filter((k) => k && map[k] && k.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 4)
    .map((k) => ({ key: k, url: map[k] }));
  const hist = searchHistory(query, 24)
    .filter((h) => /^https?:/i.test(h.url || ""))
    .slice(0, 8)
    .map((h) => ({ url: h.url, title: h.title || "", ts: h.ts || 0 }));
  return { ok: true, history: hist, mappings };
});

ipcMain.handle("lg-download:list", () => ({ ok: true, downloads: publicDownloads() }));
ipcMain.handle("lg-download:reveal", (_e, id) => {
  const d = downloads.find((x) => x.id === Number(id));
  if (d && d.savePath && fs.existsSync(d.savePath)) shell.showItemInFolder(d.savePath);
  else if (fs.existsSync(downloadsDir())) shell.openPath(downloadsDir());
  return { ok: true };
});
/* 暂停 / 继续 / 取消：都要 DownloadItem 句柄（在飞的才有；完成后是空操作） */
ipcMain.handle("lg-download:pause", (_e, id) => {
  const e = dlItems.get(Number(id));
  if (!e || !e.item) return { ok: false, reason: "no-item" };
  try { e.item.pause(); } catch (err) { return { ok: false, reason: String(err) }; }
  const d = downloads.find((x) => x.id === Number(id));
  if (d) { d.state = "paused"; saveDownloads(); }
  pushDownloads();
  return { ok: true };
});
ipcMain.handle("lg-download:resume", (_e, id) => {
  const e = dlItems.get(Number(id));
  if (!e || !e.item) return { ok: false, reason: "no-item" };
  try {
    if (!e.item.canResume()) return { ok: false, reason: "cannot-resume" };
    e.item.resume();
  } catch (err) { return { ok: false, reason: String(err) }; }
  const d = downloads.find((x) => x.id === Number(id));
  if (d) { d.state = "progressing"; saveDownloads(); }
  pushDownloads();
  return { ok: true };
});
ipcMain.handle("lg-download:cancel", (_e, id) => {
  const e = dlItems.get(Number(id));
  if (!e || !e.item) return { ok: false, reason: "no-item" };
  try { e.item.cancel(); } catch (err) { return { ok: false, reason: String(err) }; }
  const d = downloads.find((x) => x.id === Number(id));
  if (d) { d.state = "cancelled"; saveDownloads(); }
  pushDownloads();
  return { ok: true };
});
/* 重试：用原来发起下载的 webContents（它的会话）重新 downloadURL；
   那个视图没了就退回当前活动标签 / 主窗口（同会话概率最大） */
ipcMain.handle("lg-download:retry", (_e, id) => {
  const d = downloads.find((x) => x.id === Number(id));
  if (!d || !/^https?:/i.test(d.url || "")) return { ok: false, reason: "no-url" };
  const e = dlItems.get(Number(id));
  let wc = e && e.wc && !e.wc.isDestroyed() ? e.wc : null;
  if (!wc) {
    const t = activeTabId != null ? tabs.get(activeTabId) : null;
    if (t && t.view && !t.view.webContents.isDestroyed()) wc = t.view.webContents;
  }
  if (!wc && mainWin && !mainWin.isDestroyed()) wc = mainWin.webContents;
  if (!wc) return { ok: false, reason: "no-wc" };
  try { wc.downloadURL(d.url); } catch (err) { return { ok: false, reason: String(err) }; }
  return { ok: true };
});
/* 另存为：完成项的副本存到用户选的位置（不动原文件）；在飞的项目走
   dlAsk（每次询问保存位置）或等它下完 */
ipcMain.handle("lg-download:save-as", async (_e, id) => {
  const d = downloads.find((x) => x.id === Number(id));
  if (!d || !d.savePath || !fs.existsSync(d.savePath)) return { ok: false, reason: "no-file" };
  let r = null;
  try { r = await dialog.showSaveDialog(mainWin, { defaultPath: path.join(app.getPath("downloads"), path.basename(d.savePath)) }); } catch (err) { return { ok: false, reason: String(err) }; }
  if (!r || r.canceled || !r.filePath) return { ok: false, reason: "canceled" };
  try { fs.copyFileSync(d.savePath, r.filePath); } catch (err) { return { ok: false, reason: String(err) }; }
  d.savePath = r.filePath;
  saveDownloads();
  pushDownloads();
  return { ok: true, savePath: r.filePath };
});
ipcMain.handle("lg-download:remove", (_e, id) => {
  downloads = downloads.filter((x) => x.id !== Number(id));
  dlItems.delete(Number(id)); // 记录没了，句柄（含 webContents）也一起放
  saveDownloads();
  pushDownloads();
  return { ok: true, downloads: publicDownloads() };
});
ipcMain.handle("lg-download:clear", () => {
  downloads = downloads.filter((d) => d.state === "progressing" || d.state === "paused");
  /* 同样清句柄：只留还在飞的那些，其余的 webContents 引用别攥着不放 */
  const alive = new Set(downloads.map((d) => d.id));
  for (const k of Array.from(dlItems.keys())) if (!alive.has(k)) dlItems.delete(k);
  saveDownloads();
  pushDownloads();
  return { ok: true, downloads: publicDownloads() };
});

/* ============================================================
   自测 / 调试钩子
   ============================================================ */
async function waitInjected(wc, timeoutMs = 20000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 500); i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const t = await wc.executeJavaScript("document.documentElement.getAttribute('data-lg-theme')", true);
      if (t) return true;
    } catch {}
  }
  return false;
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

// capturePage 在部分视图上可能长时间不决，统一走超时竞速
async function safeCapture(wc, ms = 8000) {
  try {
    return await withTimeout(wc.capturePage(), ms, null);
  } catch {
    return null;
  }
}


/* ---------- 自动登录（验证码人工辅助） ---------- */
async function autoLoginFlow() {
  if (!autoLogin) return;
  const fsx = fs;
  const outDir = selftestShot ? path.dirname(selftestShot) : app.getPath("userData");
  const out = (p) => path.join(outDir, p);
  let lw = null;
  try {
    lw = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    // 清掉可能被污染的旧 cookie，走"首页 → 页内跳登录页"的真实用户路径
    await session.defaultSession.clearStorageData({ storages: ["cookies"] }).catch?.(() => {});
    let loaded = false;
    for (let i = 0; i < 3 && !loaded; i++) {
      try {
        await lw.loadURL(HOME_URL);
        loaded = true;
      } catch (e) {
        dbg("home load failed (" + i + "): " + e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (!loaded) {
      fsx.writeFileSync(out("autologin.json"), JSON.stringify({ ok: false, stage: "home-load-failed" }));
      return;
    }
    await lw.webContents.executeJavaScript('location.href = "/auth/login"', true).catch(() => {});
    // 等登录页表单出现
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const has = await lw.webContents.executeJavaScript(
        "!!document.querySelector('input[type=text]')", true
      ).catch(() => false);
      if (has) break;
    }
    // 等账号输入框
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await lw.webContents.executeJavaScript("!!document.querySelector('input[type=text]')", true).catch(() => false)) break;
    }
    const step1 = await lw.webContents.executeJavaScript(
      `(async function(){
        function setValue(input, val) {
          var proto = HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var acc = document.querySelector('input[type=text]');
        if (!acc) return { ok: false, reason: 'no account input' };
        setValue(acc, ${JSON.stringify(argUser)});
        await new Promise(function(r){ setTimeout(r, 400); });
        var next = Array.from(document.querySelectorAll('button')).find(function(b){ return (b.textContent || '').trim() === '下一步'; });
        if (!next) return { ok: false, reason: 'no next button' };
        next.click();
        for (var i = 0; i < 30; i++) {
          await new Promise(function(r){ setTimeout(r, 500); });
          if (document.querySelector('input[type=password]')) return { ok: true };
        }
        return { ok: false, reason: 'password input timeout' };
      })()`,
      true
    );
    if (!step1.ok) {
      fsx.writeFileSync(out("autologin.json"), JSON.stringify({ ok: false, stage: "step1", ...step1 }));
      return;
    }
    // 填密码
    await lw.webContents.executeJavaScript(
      `(function(){
        function setValue(input, val) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var pwd = document.querySelector('input[type=password]');
        setValue(pwd, ${JSON.stringify(argPass)});
      })()`,
      true
    );
    // 验证码：优先用命令行给出的答案；否则 canvas 4x 放大取像素 + 最多 5 次重试
    let captchaAnswer = argCaptcha;
    const answerFile = path.join(app.getPath("userData"), "captcha-answer.txt");

    const grabCaptcha = async () => {
      return await lw.webContents.executeJavaScript(
        `(async function(){
          var img = document.querySelector('img[src*="captcha"]');
          if (!img) return null;
          if (!img.complete) {
            await new Promise(function(r){ img.onload = r; setTimeout(r, 3000); });
          }
          try {
            var s = 4;
            var c = document.createElement('canvas');
            c.width = (img.naturalWidth || img.width || 80) * s;
            c.height = (img.naturalHeight || img.height || 30) * s;
            var ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
          } catch (e) { return null; }
        })()`,
        true
      );
    };

    let loggedIn = false;
    for (let attempt = 1; attempt <= 5 && !loggedIn; attempt++) {
      let answer = captchaAnswer;
      if (!answer) {
        const dataUrl = await grabCaptcha();
        if (dataUrl && dataUrl.startsWith("data:image")) {
          fsx.writeFileSync(out("autologin-captcha.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
        } else {
          const shot = await safeCapture(lw.webContents, 5000);
          if (shot) fsx.writeFileSync(out("autologin-captcha.png"), shot.toPNG());
        }
        fsx.writeFileSync(
          out("autologin-state.json"),
          JSON.stringify({ ok: false, stage: "captcha-wait", attempt, hint: "write code to " + answerFile })
        );
        dbg("autologin captcha wait, attempt " + attempt);
        let got = false;
        for (let i = 0; i < 600; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const ans = fsx.readFileSync(answerFile, "utf8").trim();
            if (ans) { answer = ans; fsx.unlinkSync(answerFile); got = true; break; }
          } catch {}
        }
        if (!got) break;
      }

      await lw.webContents.executeJavaScript(
        `(async function(){
          function setValue(input, val) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          var cap = document.querySelector('input[placeholder*="验证码"], input[placeholder*="图形"]');
          if (!cap) return 'no captcha input';
          setValue(cap, ${JSON.stringify(answer)});
          await new Promise(function(r){ setTimeout(r, 300); });
          var btn = Array.from(document.querySelectorAll('button')).find(function(b){ return /账户密码登录|登录/.test((b.textContent || '').trim()); });
          if (!btn) return 'no submit button';
          btn.click();
          return 'submitted';
        })()`,
        true
      );
      captchaAnswer = null;
      // 等结果：跳转/拿到用户 = 成功；仍在登录页 = 可能答错 → 刷新验证码重试
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const url = lw.webContents.getURL();
        if (!/auth\/login/.test(url)) { loggedIn = true; break; }
        const u = await lw.webContents.executeJavaScript(
          "(function(){ try { var u = window._feInjection && window._feInjection.currentUser; return u && u.uid ? true : false; } catch(e){ return false; } })()",
          true
        ).catch(() => false);
        if (u) { loggedIn = true; break; }
      }
      if (!loggedIn) {
        // 刷新验证码图，准备下一轮
        await lw.webContents.executeJavaScript(
          `(function(){
            var img = document.querySelector('img[src*="captcha"]');
            if (img) img.src = img.src.split('?')[0] + '?_t=' + Date.now();
          })()`,
          true
        ).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    const shot = await safeCapture(lw.webContents, 15000);
    if (shot) fsx.writeFileSync(out("autologin-result.png"), shot.toPNG());
    fsx.writeFileSync(
      out("autologin.json"),
      JSON.stringify({ ok: loggedIn, url: lw.webContents.getURL() })
    );
  } catch (e) {
    dbg("autologin error: " + (e && e.stack ? e.stack : String(e)));
    try { fsx.writeFileSync(out("autologin.json"), JSON.stringify({ ok: false, error: String(e) })); } catch {}
  } finally {
    try { if (lw) lw.destroy(); } catch {}
    app.exit(0);
  }
}

/* ============================================================
   生命周期
   ============================================================ */
app.whenReady().then(() => {
  perfMarks.whenReady = Date.now();
  loadConfig();
  loadAccounts();
  loadHistory();
  loadDownloads();
  // 本地页（设置/首页/历史）的会话也要接下载（不然从本地页点下载没记录）
  wireDownloads(session.defaultSession);
  // 广告拦截同理：默认会话（外壳/本地页）也挂上，规则本身只认广告域
  wireAdBlock(session.defaultSession);
  // 壁纸集合：先清掉目录里内容重复的文件（用户报"存在重复的背景"），
  // 随机/顺序模式下启动换一张，再挂自动轮换定时器
  dedupeWallpaperDir();
  if (cfg.wallpaperMode !== "single") rotateWallpaper();
  scheduleWallpaperRotate();
  // 全局唤起热键 + 洛谷近期比赛抓取（失败静默，首页显示空态）。
  // 首次抓取延迟一会儿：等洛谷页打开、过掉访问挑战后 cookie 才齐全。
  registerGlobalHotkey();
  setTimeout(fetchContests, 15000);
  setInterval(fetchContests, 30 * 60 * 1000);
  dbg("app ready; args=" + JSON.stringify({ selftestShot, configtest, dumpLogin, dumpPromo, autoLogin, START_URL }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // 站外共享分区同样默认拒绝权限申请（通知/摄像头等），与默认会话一致
  session.fromPartition(SHARED_PARTITION).setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // 本地媒体协议：把 file:// 变成 https 页面也能加载的 lg-media://
  // （静态图走这条路；视频改用 blob，见 wallpaperVideoPayload 的注释）
  try {
    // 不能直接 net.fetch(file://)：<video> 会带 Range 头来要分片，那条路不给
    // Range，视频就卡在 readyState 0 / "MEDIA_ELEMENT_ERROR: Format error"
    // （图片走 CSS background 不发 Range，所以图片壁纸看着一直是好的，问题
    // 只在视频壁纸上露出来）。这里自己读文件并实现 Range，视频才能播。
    /* ---------- 本地页的样式/脚本走 lgasset://（no-cache 绕开 file:// 缓存）----------
       file:// 下的 CSS 会被 Chromium 顽固地缓存住：应用更新后，用户可能继续
       用着旧样式（新外壳 + 旧 CSS 混搭），而且**连带查询串的 fetch 都返回
       缓存**（实测：改了 settings.css 后重开页面，页面里仍是旧版）。
       办法：把样式与脚本改走自定义协议，响应头带 cache-control: no-cache
       强制每次重取（URL 不带版本号）。
       ⚠️ 页面本身**仍走 file://**：本地页的判定（isLocalKind / file: 前缀）
       依赖它，改协议会让一堆逻辑失效。 */
    try {
      const pkg = require(path.join(__dirname, "package.json"));
      const ver = String((pkg && pkg.version) || "0");
      protocol.handle("lgasset", (req) => {
        try {
          const u = new URL(req.url);          // lgasset://local/settings/settings.css
          const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
          const root = path.join(__dirname, "src");
          const abs = path.join(root, rel);
          /* 目录穿越防护：解析后的路径必须仍在 src/ 之内 */
          if (!path.resolve(abs).startsWith(path.resolve(root) + path.sep)) {
            return new Response("forbidden", { status: 403 });
          }
          const data = fs.readFileSync(abs);
          const type = abs.endsWith(".css") ? "text/css; charset=utf-8"
            : abs.endsWith(".js") ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
          return new Response(data, {
            headers: {
              "content-type": type,
              "cache-control": "no-cache",
              /* 页面本身是 file://，资源走 lgasset:// → 跨源。
                 <link> 加载跨源 CSS 本来就允许，但 **<script> 不行**
                 （需要 CORS 头），所以这里必须给 access-control-allow-origin，
                 否则设置页/首页/外壳的脚本全都不执行（页面一片空白）。 */
              "access-control-allow-origin": "*",
            },
          });
        } catch (e) {
          return new Response("not found", { status: 404 });
        }
      });
      /* URL 形如 lgasset://local/<src 内相对路径>（local 是 host，不是目录）；
         不带版本号，靠上面的 cache-control: no-cache 保证每次重取。 */
      dbg("lgasset protocol ready (v" + ver + ")");
    } catch (e) {
      dbg("lgasset protocol failed: " + e);
    }
    protocol.handle("lg-media", async (req) => {
      try {
        const u = new URL(req.url);
        // 路径形式为主，兼容旧的 ?p= 形式（老 URL 可能还残留在缓存里）
        let p = u.searchParams.get("p") || "";
        if (!p) {
          try { p = decodeURIComponent(u.pathname.replace(/^\/+/, "")); } catch (e) { p = ""; }
        }
        if (!p) {
          dbg("lg-media: no p — " + String(req.url).slice(0, 110));
          return new Response("bad request", { status: 400 });
        }
        const abs = path.resolve(decodeURIComponent(p));
        if (!fs.existsSync(abs)) {
          dbg("lg-media MISS: " + abs);
          return new Response("not found", { status: 404 });
        }
        const stat = fs.statSync(abs);
        const type = MEDIA_MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.get("range") || "").trim());
        // 直接用 Buffer 当 body（不走 Node 流 → Web 流的转换：那条路在这里
        // 会让 <video> 直接报 "Format error"，实测踩过）。
        const size = stat.size;
        const useStream = process.env.LG_STREAM === "1";
        if (process.env.LG_NO_RANGE !== "1" && m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
          if (!(start >= 0) || start > end || start >= size) {
            return new Response("range not satisfiable", {
              status: 416,
              headers: { "content-range": "bytes */" + size },
            });
          }
          const body = useStream
            ? Readable.toWeb(fs.createReadStream(abs, { start, end }))
            : await readRange(abs, start, end);
          return new Response(body, {
            status: 206,
            headers: {
              "content-type": type,
              "content-length": String(end - start + 1),
              "content-range": "bytes " + start + "-" + end + "/" + size,
              "accept-ranges": "bytes",
            },
          });
        }
        const bodyAll = useStream ? Readable.toWeb(fs.createReadStream(abs)) : fs.readFileSync(abs);
        return new Response(bodyAll, {
          status: 200,
          headers: {
            "content-type": type,
            "content-length": String(size),
            "accept-ranges": "bytes",
          },
        });
      } catch (e) {
        return new Response("error: " + e, { status: 500 });
      }
    });
  } catch (e) {
    dbg("protocol.handle failed: " + e);
  }
  createMainWindow();
  /* 用户态改为事件驱动（R41）：did-finish-load / did-navigate-in-page /
     setActiveTab / 账号菜单打开（user:nudge）时即时抓。旧的每 2s 盲扫是
     常驻热路径——每两秒往活动页注入一次脚本。这里只留 30s 兜底轮询。 */
  setInterval(pushUser, 30000);
  ipcMain.on("user:nudge", () => { pushUser(); refreshUserNet(false); });
  // 启动即取一次用户态：restoreTabs 关着、首页是本地页时，页面刮取永远没
  // 机会跑，头像就靠这一发（以及之后每次刮空时的节流兜底）点亮。
  refreshUserNet(true);
  startDevWatch(); // --lg-dev：改源码即时生效
  if (autoLogin) {
    autoLoginFlow();
  } else if (selftestShot) {
    // 自测跑完就退：残留在后台的测试进程会占住单实例锁，
    // 让下一次开发实例静默退出（这个坑踩过一次，这里堵上）
    selftest().finally(() => setTimeout(() => app.exit(0), 400));
  } else {
    selftest();
  }
});

app.on("window-all-closed", () => app.quit());
/* 退出前把两份防抖存档（标签 / 窗口边界）无条件补写一次。 */
function flushAppState() {
  clearTimeout(tabsSaveTimer);
  tabsSaveTimer = null;
  try { saveTabsState(); } catch {}
  clearTimeout(winSaveTimer);
  winSaveTimer = null;
  try { saveWindowState(); } catch {}
  /* R41：配置改了异步落盘、日志改了缓冲——退出这里无条件补写一次 */
  try { saveConfigSync(); } catch {}
  try { dbgFlushSync(); } catch {}
}
app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch {}
  // 标签存档是 700ms 防抖，退出路径若没走窗口 close（如 app.exit）会丢掉最后一改
  flushAppState();
});

/* ============================================================
   探针段（自测 / UI 回归 / 性能基线）
   —— 纯搬移：原来它夹在产品代码中间（main.js 第 6754~13691 行），读代码时
   要在业务逻辑里翻过 6000 多行探针才能看到后面的实现。现在整段挪到文件
   末尾，产品代码在前、探针在后。
   ⚠️ 本段只由命令行参数触发（--lg-selftest= / --lg-v315test / --lg-uitest…），
   正常启动路径完全不进这里。搬移**零逻辑改动**，行为由 --lg-v315test 复验。
   ============================================================ */

async function selftest() {
  if (!selftestShot) return;
  const fsx = fs;
  try {
    if (v315test) {
      /* ============================================================
         R42：持久化地基 / 假信息清理 / 材质守卫
         —— 每一项都是**真跑一遍**再断言，不是查字符串存在性。
         ============================================================ */
      const out = { version: "3.15.0", checks: [], ok: true };
      const chk = (name, pass, detail) => {
        out.checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
        if (!pass) out.ok = false;
      };
      const storeDir = path.join(app.getPath("userData"), "selftest-store");
      try { fs.rmSync(storeDir, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(storeDir, { recursive: true });

      /* 1) 坏 JSON：备份 + 回退 + 进 recovered 列表 + 备份逐字保真 */
      const badFile = path.join(storeDir, "broken.json");
      const badText = '{"a": 1, broken';
      fs.writeFileSync(badFile, badText, "utf8");
      const recBefore = recoveredFiles.length;
      const got = readJsonSafe(badFile, { fallback: true }, "测试文件");
      const baks = fs.readdirSync(storeDir).filter((f) => f.startsWith("broken.json.corrupt-"));
      chk("corrupt-fallback", got && got.fallback === true, got);
      chk("corrupt-backup", baks.length === 1, baks);
      chk("corrupt-reported", recoveredFiles.length === recBefore + 1, recoveredFiles.length - recBefore);
      chk(
        "corrupt-backup-bytes",
        baks.length === 1 && fs.readFileSync(path.join(storeDir, baks[0]), "utf8") === badText,
        baks[0] || ""
      );

      /* 2) 空文件 / 不存在：按"没有"处理，且**不许**误判成损坏 */
      fs.writeFileSync(path.join(storeDir, "empty.json"), "  \n", "utf8");
      chk("empty-as-missing", readJsonSafe(path.join(storeDir, "empty.json"), [], "空文件").length === 0, "ok");
      chk("missing-as-fallback", readJsonSafe(path.join(storeDir, "nope.json"), { d: 1 }, "缺文件").d === 1, "ok");
      chk("no-false-corrupt", recoveredFiles.length === recBefore + 1, recoveredFiles.length - recBefore);

      /* 3) 原子写：成功后内容正确、不留 tmp */
      const okFile = path.join(storeDir, "ok.json");
      const w1 = writeTextAtomicSync(okFile, JSON.stringify({ x: 42 }));
      const tmps = fs.readdirSync(storeDir).filter((f) => f.includes(".tmp-"));
      chk("atomic-write", w1 === true && JSON.parse(fs.readFileSync(okFile, "utf8")).x === 42, w1);
      chk("atomic-no-tmp", tmps.length === 0, tmps);

      /* 4) 写失败可见：拿一个**目录**当目标（EISDIR，稳定可复现、不破坏任何东西） */
      const dirAsFile = path.join(storeDir, "iam-a-dir");
      fs.mkdirSync(dirAsFile, { recursive: true });
      writeFailPending = "";
      lastWriteFailure = null;
      const w2 = writeTextAtomicSync(dirAsFile, "x");
      chk("fail-returns-false", w2 === false, w2);
      /* "可见"= 有文案、有错误码、且是刚刚发生的（pending 已被一次性 toast 消费掉，
         所以断言持久记录；这正是不该只看 writeFailPending 的原因） */
      chk(
        "fail-visible",
        !!(lastWriteFailure && lastWriteFailure.msg && Date.now() - lastWriteFailure.at < 5000),
        lastWriteFailure
      );
      const msgEnospc = reportWriteFail(dirAsFile, { code: "ENOSPC", message: "no space left" });
      chk("fail-enospc-text", /磁盘空间不足/.test(msgEnospc), msgEnospc);
      const msgPerm = reportWriteFail(dirAsFile, { code: "EACCES", message: "denied" });
      chk("fail-perm-text", /没有写入权限/.test(msgPerm), msgPerm);
      writeFailPending = "";

      /* 5) 默认值与死字段清理 */
      chk("default-page-theme-auto", DEFAULT_CONFIG.pageTheme === "auto", DEFAULT_CONFIG.pageTheme);
      let selfSrc = "";
      try { selfSrc = fs.readFileSync(__filename, "utf8"); } catch {}
      chk("no-alpha-card-read", !/getPropertyValue\(\s*['"]--lg-alpha-card/.test(selfSrc), "main.js");
      chk("no-cardalpha-write", !/lgConfig\.set\(\{\s*cardAlpha/.test(selfSrc), "main.js");
      let preloadSrc = "";
      try { preloadSrc = fs.readFileSync(path.join(__dirname, "preload-page.js"), "utf8"); } catch {}
      chk("preload-no-version", preloadSrc !== "" && !/^\s*version\s*:\s*["']\d+["'],?\s*$/m.test(preloadSrc), "preload-page.js");

      /* 6) 六个持久化点：真写一遍，都能落盘且不留 tmp */
      saveAccounts();
      saveTabsState();
      saveWindowState();
      saveDownloads();
      saveConfigSync();
      saveHistory();
      await new Promise((r) => setTimeout(r, 1200)); // saveHistory 是 900ms 防抖
      const six = [accountsPath(), tabsStatePath(), winStatePath(), historyPath(), downloadsPath(), configPath()];
      const missing = six.filter((f) => !fs.existsSync(f));
      chk("six-files-exist", missing.length === 0, missing);
      chk("six-no-tmp", !six.some((f) => fs.existsSync(f + ".tmp-" + process.pid)), "ok");
      /* 写出来的必须是能解析的 JSON（原子写不能写出半个文件） */
      const unparsable = six.filter((f) => {
        try { JSON.parse(fs.readFileSync(f, "utf8")); return false; } catch { return true; }
      });
      chk("six-valid-json", unparsable.length === 0, unparsable);

      /* 7) 材质守卫：投影软约束没被突破 */
      let shadowCount = -1;
      let lintErr = "";
      let lintClean = false;
      try {
        const lint = require(path.join(__dirname, "src", "material-lint.js"));
        const hits = [
          ...lint.scanShadows(path.join(__dirname, "src")),
          ...lint.scanShadows(path.join(__dirname, "main.js")),
        ];
        shadowCount = hits.length;
        lintClean = lint.scan(path.join(__dirname, "src")).length === 0;
      } catch (e) {
        lintErr = String((e && e.message) || e);
      }
      chk("shadow-baseline", shadowCount >= 0 && shadowCount <= 6, { count: shadowCount, err: lintErr });
      chk("lint-clean", lintClean, lintErr);

      /* 8) 页面侧：preload 那个会烂掉的版本号确实不在了 */
      const siteTab = tabOrder.map((id) => tabs.get(id)).find((t) => t && !isLocalKind(t.kind) && t.view);
      let pageVer = "no-site-tab";
      if (siteTab) {
        try {
          pageVer = await siteTab.view.webContents.executeJavaScript("typeof window.lgApp.version", true);
        } catch (e) {
          pageVer = "err:" + ((e && e.message) || e);
        }
      }
      chk("page-no-version-field", pageVer === "undefined" || pageVer === "no-site-tab", pageVer);

      fs.writeFileSync(selftestShot + ".json", JSON.stringify(out, null, 2));
      fs.writeFileSync(
        selftestShot + ".txt",
        out.checks.map((c) => (c.pass ? "PASS " : "FAIL ") + c.name + "  " + JSON.stringify(c.detail)).join("\n")
      );
      dbg("v315test " + (out.ok ? "PASS" : "FAIL") + " " + out.checks.filter((c) => !c.pass).map((c) => c.name).join(","));
    } else if (configtest) {
      const cfgBackup = JSON.parse(JSON.stringify(cfg)); // 自测结束要把用户配置原样放回
      openSettingsTab();
      await new Promise((r) => setTimeout(r, 2500));
      const st = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && x.kind === "settings");
      let img = null;
      if (st) img = (await safeCapture(st.view.webContents)) ;
      if (img) fsx.writeFileSync(selftestShot, img.toPNG());
      await st.view.webContents.executeJavaScript(
        `window.lgConfig.set({ faceAlpha: 0.7, theme: 'dark', clean: false, uiScale: 1.15, mappings: { deepseek: 'https://chat.deepseek.com' } })`,
        true
      );
      await new Promise((r) => setTimeout(r, 1200));
      // 本轮新增：功能开关 + 三态配色 + 布局切换 + 账号 IPC
      // 先切到与本轮默认相反的取值，验证开关真的改变行为
      const flipped = JSON.parse(
        await st.view.webContents.executeJavaScript(
          `(async function(){
            var out = {};
            // v3.5.1：页面配色三态撤掉，明暗往返改走统一管线（theme: light↔dark），
            // 页面侧 pageTheme=auto 跟随 resolvedTheme（repaint 只在洛谷页且暗色时=1）
            await window.lgConfig.set({ theme: 'light', verticalTabs: false, declutter: true, quickSearch: false, listTools: false, restoreTabs: false });
            out.cfg = await window.lgConfig.get();
            var acc = await window.lgConfig.accountList();
            out.accountApi = { ok: acc.ok, count: (acc.accounts || []).length, hasJob: 'job' in acc };
            out.settingsDom = {
              groups: Array.prototype.map.call(document.querySelectorAll('.group'), function(e){ return e.textContent; }),
              toggles: document.querySelectorAll('.switch-row input').length,
              pageSegsGone: !document.getElementById('seg-page'),
              acctForm: !!document.getElementById('acct-email')
            };
            return JSON.stringify(out);
          })()`,
          true
        )
      );
      await new Promise((r) => setTimeout(r, 1800));
      const flippedShell = JSON.parse(await mainWin.webContents.executeJavaScript(
        `JSON.stringify({
          layout: document.body.getAttribute('data-layout'),
          vtabShown: (function(){ var e=document.getElementById('vtab'); return !!e && getComputedStyle(e).display !== 'none'; })(),
          /* R36：坞迁到独立覆盖视图——外壳里的 #dock 只是渲染源，恒隐（视图状态
             由主进程 dockShown 报告，v39test 有专门段） */
          dockSrcHidden: (function(){ var e=document.getElementById('dock'); return !e || getComputedStyle(e).display === 'none'; })()
        })`, true));
      const pageTab = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && !isLocalKind(x.kind));
      if (pageTab) await waitInjected(pageTab.view.webContents); // 新标签可能还没注入完
      const flippedPage = pageTab ? JSON.parse(await pageTab.view.webContents.executeJavaScript(
        `JSON.stringify({
          page: document.documentElement.getAttribute('data-lg-page'),
          repaint: document.documentElement.getAttribute('data-lg-repaint'),
          declutter: document.documentElement.getAttribute('data-lg-declutter'),
          quickSearch: document.documentElement.getAttribute('data-lg-quicksearch')
        })`, true)) : { error: "no-luogu-tab" };
      // 切回默认，核对全部恢复（明暗走统一管线：dark = 外壳暗 + 洛谷页反转重绘）
      await st.view.webContents.executeJavaScript(
        `window.lgConfig.set({ theme: 'dark', verticalTabs: true, declutter: false, quickSearch: true, listTools: true, restoreTabs: true })`,
        true
      );
      await new Promise((r) => setTimeout(r, 1800));
      const restoredShell = JSON.parse(await mainWin.webContents.executeJavaScript(
        `JSON.stringify({
          layout: document.body.getAttribute('data-layout'),
          vtabShown: (function(){ var e=document.getElementById('vtab'); return !!e && getComputedStyle(e).display !== 'none'; })(),
          dockSrcHidden: (function(){ var e=document.getElementById('dock'); return !e || getComputedStyle(e).display === 'none'; })()
        })`, true));
      const restoredPage = pageTab ? JSON.parse(await pageTab.view.webContents.executeJavaScript(
        `JSON.stringify({
          page: document.documentElement.getAttribute('data-lg-page'),
          repaint: document.documentElement.getAttribute('data-lg-repaint'),
          declutter: document.documentElement.getAttribute('data-lg-declutter'),
          quickSearch: document.documentElement.getAttribute('data-lg-quicksearch')
        })`, true)) : { error: "no-luogu-tab" };
      /* 配色预设往返：切到「宣纸」→ 断言暖色基色真的落到页面与外壳 →
         再叠加强调色/边框强度/动效 → 切回「墨白」核对全部还原。 */
      if (pageTab) await waitInjected(pageTab.view.webContents);
      const presetAt = async () => ({
        page: pageTab
          ? JSON.parse(
              await pageTab.view.webContents.executeJavaScript(
                `JSON.stringify({
                  preset: document.documentElement.getAttribute('data-lg-preset'),
                  tint: document.documentElement.style.getPropertyValue('--lg-tint').trim(),
                  bgBase: document.documentElement.style.getPropertyValue('--lg-bg-base').trim(),
                  ink: document.documentElement.style.getPropertyValue('--lg-ink').trim(),
                  accent: document.documentElement.style.getPropertyValue('--lg-accent').trim(),
                  border: document.documentElement.style.getPropertyValue('--lg-border').trim(),
                  anim: document.documentElement.getAttribute('data-lg-anim'),
                  radius: document.documentElement.style.getPropertyValue('--lg-radius').trim()
                })`,
                true
              )
            )
          : { error: "no-luogu-tab" },
        shell: JSON.parse(
          await mainWin.webContents.executeJavaScript(
            `JSON.stringify({
              preset: document.documentElement.getAttribute('data-preset'),
              surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
              bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim(),
              ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
              /* 派生色读真实元素的最终颜色——--ink-dim 本身是 color-mix 表达式，
                 自定义属性不会在 computed style 里求值，读元素才有意义 */
              derived: (function(){ var e = document.getElementById('omni-input') || document.body; return getComputedStyle(e).color; })()
            })`,
            true
          )
        ),
      });
      await st.view.webContents.executeJavaScript(
        `window.lgConfig.set({ preset: 'paper', borderStrength: 2, accent: '#3f3f46', animations: false })`,
        true
      );
      await new Promise((r) => setTimeout(r, 2000));
      const presetPaper = await presetAt();
      await st.view.webContents.executeJavaScript(
        `window.lgConfig.set({ preset: 'ink', borderStrength: 1, accent: '', animations: true })`,
        true
      );
      await new Promise((r) => setTimeout(r, 2000));
      const presetBack = await presetAt();

      /* I5 浏览器级功能：缩放 / 标签重排 / 右键菜单结构。
         全部从 chrome 层的 preload 桥发起，走的是真实 IPC 通路。 */
      const orderBefore = tabOrder.slice();
      if (pageTab) setActiveTab(pageTab.id);
      await new Promise((r) => setTimeout(r, 600));
      const zoomRes = { before: pageTab ? pageTab.zoom : null };
      await mainWin.webContents.executeJavaScript(`window.lgChrome.zoom(1)`, true);
      await new Promise((r) => setTimeout(r, 400));
      zoomRes.up = pageTab ? pageTab.zoom : null;
      /* R36：缩放百分比徽标已删（标签只留图标+文字）——比例改在右上角 #zoomhud
         实时显示。这里断言"标签上没有任何缩放徽标 + HUD 显示当前比例" */
      zoomRes.tabBadges = await mainWin.webContents.executeJavaScript(
        `document.querySelectorAll('.t-zoom').length`, true);
      zoomRes.hud = await mainWin.webContents.executeJavaScript(
        `(function(){var h=document.getElementById('zoomhud');return h?JSON.stringify({text:h.textContent,on:h.classList.contains('on'),hot:h.classList.contains('hot'),vis:getComputedStyle(h).visibility}):null})()`, true);
      await mainWin.webContents.executeJavaScript(`window.lgChrome.zoom(0)`, true);
      await new Promise((r) => setTimeout(r, 400));
      zoomRes.reset = pageTab ? pageTab.zoom : null;

      const reversed = orderBefore.slice().reverse();
      await mainWin.webContents.executeJavaScript(
        `window.lgChrome.reorderTabs(${JSON.stringify(reversed)})`, true);
      await new Promise((r) => setTimeout(r, 600));
      const orderAfter = tabOrder.slice();
      const menuRes = await mainWin.webContents.executeJavaScript(
        `window.lgChrome.tabContextMenu(${orderAfter[0]})`, true);
      // 还原标签顺序（别把自测的乱序存进用户会话）
      await mainWin.webContents.executeJavaScript(
        `window.lgChrome.reorderTabs(${JSON.stringify(orderBefore)})`, true);
      await new Promise((r) => setTimeout(r, 400));
      const orderRestored = tabOrder.slice();
      const browser = {
        zoom: zoomRes,
        reorder: { before: orderBefore, after: orderAfter, restored: orderRestored },
        menu: menuRes && menuRes.items ? menuRes.items : menuRes,
      };

      /* I6 历史 / 下载：走设置页的 lgConfig 桥（书签功能已按需求删除） */
      const histRes = await st.view.webContents.executeJavaScript(`window.lgConfig.historyList('')`, true);
      const dlRes = await st.view.webContents.executeJavaScript(`window.lgConfig.downloadList()`, true);
      const library = {
        history:
          histRes && histRes.ok
            ? { count: histRes.entries.length, sample: histRes.entries.slice(0, 3).map((e) => e.url) }
            : histRes,
        downloads: dlRes && dlRes.ok ? dlRes.downloads.length : dlRes,
      };
      openHistoryTab();
      await new Promise((r) => setTimeout(r, 2200));
      const histTab = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && x.kind === "history");
      library.page = histTab
        ? JSON.parse(
            await histTab.view.webContents.executeJavaScript(
              `JSON.stringify({
                panes: Array.prototype.map.call(document.querySelectorAll('#h-tabs button'), function(b){ return b.textContent; }),
                hasSearch: !!document.getElementById('h-q'),
                rows: document.querySelectorAll('#h-list .h-row').length,
                count: document.getElementById('h-count') ? document.getElementById('h-count').textContent : null,
                bridged: !!window.lgConfig
              })`,
              true
            )
          )
        : { error: "no-history-tab" };
      if (histTab) closeTab(histTab.id);

      /* I7 命令面板 + 快捷键总览（外壳函数直接驱动，读真实 DOM） */
      const pal = JSON.parse(
        await mainWin.webContents.executeJavaScript(
          `(function(){
            var out = {};
            openPalette();
            out.open = !document.getElementById('palette').hidden;
            out.total = document.querySelectorAll('#pal-list .pal-item').length;
            var inp = document.getElementById('pal-input');
            inp.value = '缩放';
            renderPalette('缩放');
            out.filtered = document.querySelectorAll('#pal-list .pal-item').length;
            out.filteredTitles = Array.prototype.map.call(
              document.querySelectorAll('#pal-list .pal-item > span:first-child'),
              function(s){ return s.textContent; });
            closePalette();
            out.closed = document.getElementById('palette').hidden;
            showShortcuts();
            out.shortcutRows = document.querySelectorAll('#pal-list .pal-item').length;
            closePalette();
            return JSON.stringify(out);
          })()`,
          true
        )
      );

      const roundTrip = { flipped, flippedShell, flippedPage, restoredShell, restoredPage, presetPaper, presetBack, browser, library, palette: pal };
      let ipc = "no-settings-tab";
      const t = pageTab;
      if (t) {
        await waitInjected(t.view.webContents);
        ipc = await t.view.webContents.executeJavaScript(
          `JSON.stringify({
            /* R42：--lg-alpha-card 自 v6 并入 faceAlpha 后已不存在（material-lint
               也明令禁止），旧探针一直在读一个空值。这里改读材质下发的实际变量。 */
            faceAlpha: document.documentElement.style.getPropertyValue('--lg-glass-card'),
            theme: document.documentElement.getAttribute('data-lg-theme'),
            clean: document.documentElement.getAttribute('data-lg-clean')
          })`,
          true
        );
      } else {
        ipc = await st.view.webContents.executeJavaScript(
          `JSON.stringify({ page: 'settings', hasApi: !!window.lgConfig })`,
          true
        );
      }
      let shellState = {};
      try {
        shellState = JSON.parse(
          await mainWin.webContents.executeJavaScript(
            `JSON.stringify({ shellTheme: document.documentElement.getAttribute('data-theme'), omni: !!document.getElementById('omni-input') })`,
            true
          )
        );
      } catch {}
      // 还原用户配置（自测改过的开关不能留在真实设置里）
      cfg = cfgBackup;
      saveConfig();
      pushConfigToChrome();
      applyConfigToPages();
      layout();
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify({ ipc, shellState, roundTrip }));
    } else if (dumpPromo) {
      await waitInjected(tabs.get(activeTabId)?.view.webContents);
      const t = tabs.get(activeTabId);
      const dump = await t.view.webContents.executeJavaScript(
        `(function(){
          var hits = [];
          for (var el of document.querySelectorAll('.l-card, .card')) {
            var txt = (el.textContent || '').trim();
            if (/省选|网校|冲刺|限时|优惠|计划A组/.test(txt) && el.offsetWidth > 80) {
              var a = el.querySelector('a');
              hits.push({ cls: String(el.className), size: el.offsetWidth + 'x' + el.offsetHeight, href: a ? a.getAttribute('href') : null, html: el.outerHTML.slice(0, 600) });
            }
          }
          return JSON.stringify(hits.slice(0, 6));
        })()`,
        true
      );
      fsx.writeFileSync(selftestShot, String(dump));
    } else if (dumpHome) {
      /* 首页探针：运势元素 / 宜忌 / 打卡容器 / 顶部结构，为首页区块与"逆天改运"定位选择器 */
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      if (t) {
        await waitInjected(t.view.webContents);
        await new Promise((r) => setTimeout(r, 3500));
        const dump = await t.view.webContents.executeJavaScript(
          `(function(){
            var out = {};
            var hits = [];
            var all = document.querySelectorAll('div,span,section,p,h1,h2,h3,h4,strong,b');
            for (var i = 0; i < all.length && hits.length < 16; i++) {
              var el = all[i];
              var txt = (el.textContent || '').trim();
              if (txt.length > 0 && txt.length < 12 && /^(大吉|中吉|小吉|吉|末吉|凶|大凶)$/.test(txt)) {
                var cs = getComputedStyle(el);
                hits.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), txt: txt, color: cs.color, fs: cs.fontSize });
              }
            }
            out.lucky = hits;
            var yj = [];
            var all2 = document.querySelectorAll('*');
            for (var j = 0; j < all2.length && yj.length < 10; j++) {
              var e2 = all2[j];
              var tx = (e2.textContent || '').trim();
              if (/^(宜|忌)/.test(tx) && tx.length < 24) yj.push({ tag: e2.tagName, cls: String(e2.className).slice(0, 60), txt: tx });
            }
            out.yiji = yj;
            var card = [];
            var cands = document.querySelectorAll('[class*="lucky"],[class*="fortune"],[class*="checkin"],[class*="signin"],[class*="punch"],[class*="daily"]');
            for (var k = 0; k < cands.length && k < 10; k++) card.push({ cls: String(cands[k].className).slice(0, 90), txt: (cands[k].textContent || '').trim().slice(0, 70) });
            out.cards = card;
            var top = [];
            var kids = document.querySelectorAll('.lg-index-content > *, .main-container main > *');
            for (var m = 0; m < kids.length && m < 12; m++) top.push({ tag: kids[m].tagName, cls: String(kids[m].className).slice(0, 70) });
            out.topKids = top;
            var av = document.querySelector('img[src*="usericon"]');
            out.avatar = av ? av.src : null;
            // 头像候选全量列出：右上角芯片曾经取到 usericon/1 这种脏匹配，
            // 需要看清页面上到底有几处 usericon，分别在哪、可不可见
            var avs = [];
            var allAv = document.querySelectorAll('img[src*="usericon"], [style*="usericon"]');
            for (var n = 0; n < allAv.length && n < 20; n++) {
              var a = allAv[n];
              var chain = [];
              var p = a.parentElement;
              for (var d = 0; d < 4 && p; d++) { chain.push(p.tagName + '.' + String(p.className || '').slice(0, 40)); p = p.parentElement; }
              var rc = a.getBoundingClientRect();
              avs.push({
                src: String(a.getAttribute('src') || '').slice(0, 120),
                abs: String(a.src || '').slice(0, 120),
                w: Math.round(rc.width), h: Math.round(rc.height),
                vis: rc.width > 0 && rc.height > 0,
                chain: chain
              });
            }
            out.avatars = avs;
            // Luogu-Plus 用 .lg-punch-result 当运势节点，先确认这节点在不在、
            // 长什么样，不然照抄选择器会对着空气写代码
            var punch = document.querySelector('.lg-punch');
            out.punchHtml = punch ? String(punch.outerHTML).slice(0, 2600) : null;
            var fr = document.querySelector('.lg-punch-result');
            out.fortune = fr ? { txt: fr.textContent.trim(), cls: String(fr.className), html: String(fr.outerHTML).slice(0, 300) } : null;
            var adv = document.querySelectorAll('.am-u-sm-6');
            out.advice = [];
            for (var q = 0; q < adv.length && q < 6; q++) out.advice.push((adv[q].textContent || '').trim().slice(0, 40));
            var sec = document.body.innerText.indexOf('§');
            out.hasSectionSign = sec >= 0;
            var yun = [];
            var allY = document.querySelectorAll('*');
            for (var z = 0; z < allY.length && yun.length < 6; z++) {
              var ey = allY[z];
              if (ey.children.length === 0 && (ey.textContent || '').indexOf('运势') >= 0) {
                yun.push({ tag: ey.tagName, cls: String(ey.className || '').slice(0, 50), txt: (ey.textContent || '').trim().slice(0, 60) });
              }
            }
            out.yunshi = yun;
            // 首页搜索框（betterSearch 要改的就是这一块）
            var si = document.querySelector('.am-form-field');
            out.searchInput = si ? { cls: String(si.className), ph: si.placeholder || '', id: si.id || '' } : null;
            var stat = document.querySelector('.lg-article.lg-index-stat');
            out.statHtml = stat ? String(stat.outerHTML).slice(0, 1800) : null;
            out.hasHello = !!document.querySelector('#lg-hello');
            return JSON.stringify(out);
          })()`,
          true
        );
        fsx.writeFileSync(selftestShot, String(dump));
      }
    } else if (argv.includes("--lg-colortest")) {
      /* 主题色系统实测：设成紫色 → 亮色/暗色各拍一张，并把卡片实际算出来的
         背景色读回来，证明"块真的变紫了"，而不是靠滤镜蒙过去。 */
      const base = selftestShot.replace(/\.png$/i, "");
      const shot = async (wc, name) => {
        const im = await safeCapture(wc);
        if (im) fsx.writeFileSync(base + "-" + name + ".png", im.toPNG());
      };
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      // 网络偶发 ERR_CONNECTION_RESET：不在洛谷域上就重载一次再等
      for (let i = 0; i < 3; i++) {
        if (/luogu\.com\.cn/.test(t.view.webContents.getURL())) break;
        t.view.webContents.loadURL(HOME_URL).catch(() => {});
        await new Promise((r) => setTimeout(r, 4000));
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 2500));

      // 采样：页面底色 + 若干卡片的背景色 + 正文色
      const sample = async () =>
        t.view.webContents.executeJavaScript(
          `(function(){
            var out = { bg: "", cards: [], ink: "" };
            var b = getComputedStyle(document.body);
            out.bg = b.backgroundColor;
            var root = getComputedStyle(document.documentElement);
            out.vars = {
              tint: root.getPropertyValue("--lg-tint").trim(),
              ink: root.getPropertyValue("--lg-ink").trim(),
              bgBase: root.getPropertyValue("--lg-bg-base").trim(),
              accent: root.getPropertyValue("--lg-accent").trim(),
              theme: document.documentElement.getAttribute("data-lg-theme"),
              repaint: document.documentElement.getAttribute("data-lg-repaint")
            };
            var els = document.querySelectorAll(".card, .l-card, .lg-article, .am-panel, section");
            for (var i = 0; i < els.length && out.cards.length < 6; i++) {
              var el = els[i];
              var r = el.getBoundingClientRect();
              if (r.width < 80 || r.height < 30) continue;
              var cs = getComputedStyle(el);
              out.cards.push({ cls: String(el.className).slice(0, 46), bg: cs.backgroundColor, color: cs.color });
            }
            return JSON.stringify(out);
          })()`,
          true
        );

      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        applyConfigToPages();
        pushConfigToChrome();
        await new Promise((r) => setTimeout(r, 2600));
      };

      const out = {};
      out.before = JSON.parse(await sample());
      // 外壳层也要跟着上色——"所有色块变紫"包括顶栏与标签栏
      const shellVars = async () =>
        mainWin.webContents.executeJavaScript(
          `(function(){
            var cs = getComputedStyle(document.documentElement);
            var top = document.getElementById("top");
            var vtab = document.getElementById("vtab");
            return JSON.stringify({
              surface: cs.getPropertyValue("--surface").trim(),
              accent: cs.getPropertyValue("--accent").trim(),
              theme: document.documentElement.getAttribute("data-theme"),
              topBg: top ? getComputedStyle(top).backgroundColor : null,
              vtabBg: vtab ? getComputedStyle(vtab).backgroundColor : null
            });
          })()`,
          true
        );
      await setCfg({ themeSeed: "#8b5cf6", themeStrength: 70, pageTheme: "light" });
      out.shellPurpleLight = JSON.parse(await shellVars());
      out.purpleLight = JSON.parse(await sample());
      await shot(t.view.webContents, "purple-light");
      await setCfg({ pageTheme: "dark" });
      out.shellPurpleDark = JSON.parse(await shellVars());
      out.purpleDark = JSON.parse(await sample());
      await shot(t.view.webContents, "purple-dark");
      await setCfg({ themeSeed: "#22c55e", themeStrength: 70 });
      out.greenDark = JSON.parse(await sample());
      // native 已并入 auto（页面不再有"原色"）：还原用显式 light，保持探针确定性
      await setCfg({ themeSeed: "", pageTheme: "light" });
      out.restored = JSON.parse(await sample());
      fsx.writeFileSync(base + ".json", JSON.stringify(out, null, 1));
      const img = await safeCapture(mainWin.webContents);
      if (img) fsx.writeFileSync(base + "-chrome.png", img.toPNG());
    } else if (argv.includes("--lg-settingshot")) {
      /* 设置页截图：验证新的分组导航 + 主题色控件渲染正常 */
      const base = selftestShot.replace(/\.png$/i, "");
      // 先等站点标签建出来（ensureSiteTabs 是异步的，它会把活动标签抢走），
      // 再开设置页；之后按 kind 找标签，不靠 activeTabId。
      let site = null;
      for (let i = 0; i < 60 && !site; i++) {
        await new Promise((r) => setTimeout(r, 500));
        site = [...tabs.values()].find((t) => !isLocalKind(t.kind));
      }
      openSettingsTab();
      let st = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        st = [...tabs.values()].find((t) => t.kind === "settings");
        if (!st) continue;
        const ready = await st.view.webContents
          .executeJavaScript(`!!document.querySelector("#nav-list .nav-item")`, true)
          .catch(() => false);
        if (ready) break;
      }
      if (!st) {
        fsx.writeFileSync(base + ".json", JSON.stringify({ error: "no settings tab" }));
      } else {
        setActiveTab(st.id);
        await new Promise((r) => setTimeout(r, 800));
      const probe = await st.view.webContents.executeJavaScript(
        `(function(){
          var g = function (sel) { return document.querySelector(sel); };
          var q = function (sel) { return document.querySelectorAll(sel); };
          var r = { ok: true };
          try {
            r.navItems = [].map.call(q("#nav-list .nav-item"), function(b){ return b.textContent; });
            r.navGroups = [].map.call(q("#nav-list .nav-group"), function(g2){ return g2.textContent; });
            r.cardCount = q("#pane .card[data-nav]").length;
            r.visible = [].map.call(q("#pane .card[data-nav]"), function(c){ return c.hidden ? null : c.id; }).filter(Boolean);
            r.title = g("#pane-title") ? g("#pane-title").textContent : null;
            r.seedSwatches = q("#seed-swatches .sw").length;
            r.previewCells = q("#seed-preview .sp-cell").length;
            r.keyRows = q("#keys-list .key-row").length;
            r.activeItem = g("#nav-list .nav-item.active") ? g("#nav-list .nav-item.active").textContent : null;
            r.bridgeOk = !!window.lgConfig;
          } catch (e) { r.ok = false; r.err = String(e); }
          return JSON.stringify(r);
        })()`,
        true
      );
      const img2 = await safeCapture(st.view.webContents);
      if (img2) fsx.writeFileSync(selftestShot, img2.toPNG());
      // 逐个分组都拍一张，确认没有空面板
      const list = JSON.parse(
        await st.view.webContents.executeJavaScript(
          `JSON.stringify([].map.call(document.querySelectorAll("#nav-list .nav-item"), function(b){ return [b.dataset.key, b.textContent]; }))`,
          true
        )
      );
      let si = 0;
      for (const [id] of list) {
        si++;
        await st.view.webContents.executeJavaScript(
          `(function(){ var b = document.querySelector('#nav-list .nav-item[data-key="${id}"]'); if (b) b.click(); return true; })()`,
          true
        );
        await new Promise((r) => setTimeout(r, 700));
        const im = await safeCapture(st.view.webContents);
        // 导航键是中文且带 "/"，直接当文件名不是路径分隔符就是全被清洗成下划线，
        // 十个分组会互相覆盖——用序号前缀保证唯一。
        const safeId = String(si).padStart(2, "0") + "_" + String(id).replace(/[^A-Za-z0-9_-]+/g, "_");
        if (im) fsx.writeFileSync(base + "-sec-" + safeId + ".png", im.toPNG());
      }
      fsx.writeFileSync(base + ".json", JSON.stringify({ probe: JSON.parse(probe), sections: list }, null, 1));
      }
    } else if (argv.includes("--lg-featest")) {
      /* 页面功能实测：欢迎块 / 问题搜索改写 / 划词题号面板 */
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 4000));
      const wc = t.view.webContents;

      const home = JSON.parse(
        await wc.executeJavaScript(
          `(function(){
            var o = {};
            var box = document.querySelector("#lg-hello");
            o.hello = box ? { title: (box.querySelector(".lg-hello-title")||{}).textContent, sub: (box.querySelector(".lg-hello-sub")||{}).textContent, hasAv: !!box.querySelector(".lg-hello-av") } : null;
            var stat = document.querySelector(".lg-article.lg-index-stat");
            o.search = stat ? {
              title: (stat.querySelector("h2")||{}).textContent,
              ph: (stat.querySelector("input")||{}).placeholder,
              go: (stat.querySelector('button[name="goto"]')||{}).textContent,
              rand: (stat.querySelector('button[name="gotorandom"]')||{}).textContent,
              marked: stat.getAttribute("data-lg-search"),
              bound: stat.getAttribute("data-lg-bound")
            } : null;
            o.avatar = (function(){ var a = document.querySelector('.user-nav img[src*="usericon"]'); return a ? a.src : null; })();
            return JSON.stringify(o);
          })()`,
          true
        )
      );

      // 划词题号：造一段带多个题号的文本并选中，看面板是否列出全部
      const sel = JSON.parse(
        await wc.executeJavaScript(
          `(function(){
            var d = document.createElement("div");
            d.id = "lg-sel-fixture";
            d.style.cssText = "position:fixed;top:120px;left:40px;z-index:2147483646;background:#fff;padding:8px;font:13px monospace";
            d.textContent = "参考 P1001 与 CF1920A，还有 SP1234 和 AT_abc300_a";
            document.body.appendChild(d);
            var r = document.createRange();
            r.selectNodeContents(d);
            var s = window.getSelection();
            s.removeAllRanges(); s.addRange(r);
            document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return JSON.stringify({ ok: true });
          })()`,
          true
        )
      );
      await new Promise((r) => setTimeout(r, 900));
      const tip = JSON.parse(
        await wc.executeJavaScript(
          `(function(){
            var b = document.querySelector(".lg-pid-tip");
            var o = { present: !!b, label: "", pids: [] };
            if (b) {
              o.label = (b.querySelector(".lg-pid-label")||{}).textContent || "";
              o.pids = [].map.call(b.querySelectorAll(".lg-pid-go"), function(x){ return x.textContent; });
            }
            var f = document.getElementById("lg-sel-fixture");
            if (f) f.remove();
            window.getSelection().removeAllRanges();
            return JSON.stringify(o);
          })()`,
          true
        )
      );
      const im = await safeCapture(wc);
      if (im) fsx.writeFileSync(selftestShot, im.toPNG());
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify({ home, tip }, null, 1));
    } else if (glassTest) {
      /* 玻璃皮肤 + 壁纸实测：静态图 → 视频壁纸，每步都拍外壳与页面 */
      const base = selftestShot.replace(/\.png$/i, "");
      const shots = {};
      const shot = async (wc, name) => {
        const im = await safeCapture(wc);
        if (im) fsx.writeFileSync(base + "-" + name + ".png", im.toPNG());
      };
      const dir = path.join(app.getPath("userData"), "wallpapers");
      fs.mkdirSync(dir, { recursive: true });
      let testImg = null;
      if (glassSrc && fs.existsSync(glassSrc)) {
        testImg = path.join(dir, "test-bg.webp");
        fs.copyFileSync(glassSrc, testImg);
      }
      if (!testImg) {
        shots.error = "no test image at " + glassSrc;
      } else {
        cfg.glass = "liquid";
        cfg.pageTheme = "light";
        cfg.wallpaper = testImg;
        cfg.wallpaperKind = "image";
        cfg.wallpaperBlur = 0;
        cfg.wallpaperDim = 0;
        pushConfigToChrome();
        applyConfigToPages();
        await new Promise((r) => setTimeout(r, 5000));
        await shot(mainWin.webContents, "glass-image");
        let t = tabs.get(activeTabId);
        if (t) await shot(t.view.webContents, "glass-image-page");
        shots.staticOk = true;
      }
      /* 视频壁纸：从已导入的壁纸集合里挑一个视频（mp4/webm） */
      const vid = listWallpaperFiles().find((f) => isVideoFile(f));
      shots.videoPick = vid || null;
      if (vid) {
        cfg.wallpaper = vid;
        cfg.wallpaperKind = "video";
        cfg.pageTheme = "light";
        pushConfigToChrome();
        applyConfigToPages();
        await new Promise((r) => setTimeout(r, 9000));
        await shot(mainWin.webContents, "glass-video");
        const t = tabs.get(activeTabId);
        if (t) await shot(t.view.webContents, "glass-video-page");
        shots.chromeVideo = await mainWin.webContents.executeJavaScript(
          `(function(){
            var v = document.getElementById('bg-video');
            if (!v) return null;
            return { hasSrc: !!v.getAttribute('src'), paused: v.paused, vw: v.videoWidth, vh: v.videoHeight,
                     display: getComputedStyle(v).display, err: v.error ? v.error.code : null };
          })()`,
          true
        );
        shots.pageVideo = t
          ? await t.view.webContents.executeJavaScript(
              `(function(){
                var v = document.querySelector('#lg-glass-bg > video');
                if (!v) return null;
                var bg = document.getElementById('lg-glass-bg');
                return { hasSrc: !!v.getAttribute('src'), paused: v.paused, vw: v.videoWidth, vh: v.videoHeight,
                         bgDisplay: bg ? getComputedStyle(bg).display : null,
                         bgImage: bg ? getComputedStyle(bg).backgroundImage.slice(0, 40) : null };
              })()`,
              true
            )
          : null;
        shots.glassAttrs = t
          ? await t.view.webContents.executeJavaScript(
              `JSON.stringify({
                glass: document.documentElement.getAttribute('data-lg-glass'),
                bgvideo: document.documentElement.getAttribute('data-lg-bgvideo'),
                wall: document.documentElement.getAttribute('data-lg-wall'),
                cardBg: (function(){ var c=document.querySelector('.card,.l-card'); return c ? getComputedStyle(c).backgroundColor : null; })(),
                cardBackdrop: (function(){ var c=document.querySelector('.card,.l-card'); return c ? getComputedStyle(c).backdropFilter : null; })()
              })`,
              true
            )
          : null;
      }
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(shots, null, 1));
    } else if (uiShot) {
      /* 界面截图：设置页 / 命令面板 / 历史页 / 主界面，用于人工检查排版 */
      const base = selftestShot.replace(/\.png$/i, "");
      await new Promise((r) => setTimeout(r, 2000));
      openSettingsTab();
      await new Promise((r) => setTimeout(r, 3500));
      const st = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && x.kind === "settings");
      if (st) {
        const im = await safeCapture(st.view.webContents);
        if (im) fsx.writeFileSync(base + "-settings.png", im.toPNG());
        // 滚到配色预设与视觉细节那一段再拍一张
        await st.view.webContents.executeJavaScript(
          `(function(){ var e = document.getElementById('preset-grid'); if (e) e.scrollIntoView({block:'start'}); window.scrollBy(0,-12); })()`,
          true
        );
        await new Promise((r) => setTimeout(r, 700));
        const im2 = await safeCapture(st.view.webContents);
        if (im2) fsx.writeFileSync(base + "-settings2.png", im2.toPNG());
      }
      await mainWin.webContents.executeJavaScript(`openPalette()`, true);
      await new Promise((r) => setTimeout(r, 800));
      const im3 = await safeCapture(mainWin.webContents);
      if (im3) fsx.writeFileSync(base + "-palette.png", im3.toPNG());
      await mainWin.webContents.executeJavaScript(`closePalette()`, true);
      openHistoryTab();
      await new Promise((r) => setTimeout(r, 3000));
      const ht = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && x.kind === "history");
      if (ht) {
        const im4 = await safeCapture(ht.view.webContents);
        if (im4) fsx.writeFileSync(base + "-history.png", im4.toPNG());
        closeTab(ht.id);
      }
      if (st) closeTab(st.id);
      // 回到一个站点标签再拍主界面，否则会拍到没有页面视图的空壳
      const site = tabOrder.map((tid) => tabs.get(tid)).find((x) => x && !isLocalKind(x.kind));
      if (site) setActiveTab(site.id);
      await new Promise((r) => setTimeout(r, 2500));
      const im5 = await safeCapture(mainWin.webContents);
      if (im5) fsx.writeFileSync(selftestShot, im5.toPNG());
      fsx.writeFileSync(
        selftestShot + ".json",
        JSON.stringify({
          ui: "shots written",
          base,
          tabOrder: tabOrder.slice(),
          tabsSize: tabs.size,
          activeKind: (tabs.get(activeTabId) || {}).kind || null,
          kinds: tabOrder.map((tid) => (tabs.get(tid) || {}).kind || "site"),
        })
      );
    } else if (pageTest) {
      /* 页面功能块挂载验证：列表页工具条/快速搜索，题目页分屏编辑器/代码复制。
         功能块只在「亮色/暗色」下挂载，所以先把页面配色切到亮色。 */
      const results = {};
      const themeBackup = cfg.pageTheme;
      cfg.pageTheme = "light";
      await new Promise((r) => setTimeout(r, 1500));
      const listId = createTab(HOME_URL + "problem/list", { activate: true });
      await new Promise((r) => setTimeout(r, 6000));
      const lt = tabs.get(listId) || tabs.get(activeTabId);
      if (lt) {
        await waitInjected(lt.view.webContents);
        await new Promise((r) => setTimeout(r, 3500));
        results.list = JSON.parse(
          await lt.view.webContents.executeJavaScript(
            `JSON.stringify({
              page: document.documentElement.getAttribute('data-lg-page'),
              toolbar: !!document.getElementById('lg-listtools'),
              quick: !!document.getElementById('lg-quicksearch'),
              toolbarEls: document.querySelectorAll('#lg-listtools *').length,
              quickEls: document.querySelectorAll('#lg-quicksearch *').length,
              count: (document.getElementById('lg-listtools') || {}).innerText ? String(document.getElementById('lg-listtools').innerText).slice(0, 60) : null,
              path: location.pathname
            })`,
            true
          )
        );
      }
      createTab(HOME_URL + "problem/P1001", { activate: true });
      await new Promise((r) => setTimeout(r, 7000));
      const pt = tabs.get(activeTabId);
      if (pt) {
        await waitInjected(pt.view.webContents);
        await new Promise((r) => setTimeout(r, 3500));
        results.problem = JSON.parse(
          await pt.view.webContents.executeJavaScript(
            `JSON.stringify({
              page: document.documentElement.getAttribute('data-lg-page'),
              // R36：题目页工具条（分屏编辑器 / 打开 IDE / 复制全部样例）整块删除
              problemBar: !!document.getElementById('lg-problem-tools'),
              problemAttr: document.documentElement.getAttribute('data-lg-problem-editor'),
              preCount: document.querySelectorAll('pre').length,
              copyable: document.querySelectorAll('pre[data-lg-copyable="1"]').length,
              copyBtns: document.querySelectorAll('.lg-code-copy').length,
              diff: document.documentElement.getAttribute('data-lg-diff'),
              path: location.pathname
            })`,
            true
          )
        );
        // 删除的机械守卫：页面里不许再有那块工具条，属性也不许再挂
        results.problemBarGone = !!(results.problem && results.problem.problemBar === false && results.problem.problemAttr === null);
      }
      cfg.pageTheme = themeBackup;
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(results));
    } else if (dumpTokens) {
      /* 探针：题目页的代码块 token 结构与难度徽章选择器——语义色方案要靠它落地 */
      createTab(HOME_URL + "problem/P1001", { activate: true });
      await new Promise((r) => setTimeout(r, 7000));
      let t = null;
      for (let i = 0; i < 40 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      if (t) {
        await waitInjected(t.view.webContents);
        await new Promise((r) => setTimeout(r, 2500));
        const dump = await t.view.webContents.executeJavaScript(
          `(function(){
            var out = {};
            var pres = Array.prototype.slice.call(document.querySelectorAll('pre')).slice(0, 5);
            out.preCount = document.querySelectorAll('pre').length;
            out.samples = pres.map(function(p){
              var c = p.querySelector('code') || p.firstElementChild || p;
              var toks = [];
              var kids = c.querySelectorAll('*');
              for (var i = 0; i < Math.min(kids.length, 10); i++) {
                var k = kids[i];
                var cs = getComputedStyle(k);
                toks.push({ tag: k.tagName, cls: String(k.className).slice(0,60), color: cs.color, fw: cs.fontWeight });
              }
              return { cls: String(c.className).slice(0, 100), text: (c.textContent||'').slice(0, 60), toks: toks };
            });
            var hits = [];
            var all = document.querySelectorAll('[class*="difficulty"],[class*="Difficulty"],[data-difficulty],.lg-tag');
            for (var j = 0; j < Math.min(all.length, 12); j++) {
              var el = all[j];
              var cs2 = getComputedStyle(el);
              hits.push({ tag: el.tagName, cls: String(el.className).slice(0,90), txt: (el.textContent||'').trim().slice(0,16), color: cs2.color, bg: cs2.backgroundColor });
            }
            out.diff = hits;
            return JSON.stringify(out);
          })()`,
          true
        );
        fsx.writeFileSync(selftestShot, String(dump));
      }
    } else if (dumpIde) {
      // IDE 结构探针：列出大元素的类名与当前配色
      let t0 = null;
      for (let i = 0; i < 60 && !t0; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t0 = tabs.get(activeTabId);
      }
      if (t0) {
        await waitInjected(t0.view.webContents);
        await new Promise((r) => setTimeout(r, 3000));
        const dump = await t0.view.webContents.executeJavaScript(
          `(function(){
            var out = []; var seen = {}; var colored = []; var seenC = {};
            function parseBg(s) {
              var m = s && s.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
              if (!m) return null;
              if (m[4] != null && parseFloat(m[4]) < 0.05) return null;
              var r = +m[1], g = +m[2], b = +m[3];
              return Math.max(r, g, b) - Math.min(r, g, b);
            }
            for (var el of document.querySelectorAll('body *')) {
              var cs = getComputedStyle(el);
              var bg = cs.backgroundColor;
              if (el.offsetWidth > 60 && el.offsetHeight > 18) {
                var cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().slice(0, 70);
                var key = el.tagName + '.' + cls;
                if (!seen[key]) { seen[key] = 1; out.push(key + ' || bg=' + bg + ' color=' + cs.color); }
              }
              var sat = parseBg(bg);
              if (sat > 40 && el.offsetWidth > 30 && el.offsetHeight > 8 && !seenC[cls + bg]) {
                seenC[cls + bg] = 1;
                var r2 = el.getBoundingClientRect();
                colored.push(el.tagName + '.' + String(cls).slice(0, 50) + ' bg=' + bg + ' @' + Math.round(r2.x) + ',' + Math.round(r2.y) + ' ' + Math.round(el.offsetWidth) + 'x' + Math.round(el.offsetHeight));
              }
              if (out.length > 70 && colored.length > 15) break;
            }
            return JSON.stringify({ big: out, colored: colored }, null, 1);
          })()`,
          true
        );
        fsx.writeFileSync(selftestShot, String(dump));
      }
    } else if (argv.includes("--lg-addacct-batch")) {
      /* 批量添加账号：从 LG_ACCT_FILE 逐行读 email----password----username，
         逐个走真实登录（验证成功才落库）。验证码覆盖写到 <shot>.cap.png，
         外部识别后写 captcha-answer.txt 即可继续下一轮。 */
      const file = process.env.LG_ACCT_FILE || "";
      const base = selftestShot.replace(/\.png$/i, "");
      let list = [];
      try {
        list = String(fsx.readFileSync(file, "utf8"))
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const p = l.split("----");
            return { email: (p[0] || "").trim(), pass: (p[1] || "").trim(), user: (p[2] || "").trim() };
          })
          .filter((x) => x.email && x.pass);
      } catch (e) {
        list = [];
      }
      const prevActive = cfg.activeAccountId;
      const results = [];
      const writeState = (extra) =>
        fsx.writeFileSync(
          base + ".json",
          JSON.stringify(
            { results, accounts: accounts.map((a) => ({ id: a.id, email: a.email, name: a.name || "" })), ...extra },
            null,
            2
          )
        );
      writeState({ total: list.length, phase: "begin" });
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const tick = setInterval(() => {
          try {
            if (acctJob && acctJob.captcha) {
              const b64 = String(acctJob.captcha).split(",")[1] || "";
              if (b64) fsx.writeFileSync(base + ".cap.png", Buffer.from(b64, "base64"));
            }
            writeState({ total: list.length, index: i, email: item.email, phase: (acctJob && acctJob.stage) || "starting" });
          } catch {}
        }, 1200);
        let r = null;
        try {
          r = await Promise.race([
            accountAddFlow(item.email, item.pass, { ocr: false }),
            new Promise((res) => setTimeout(() => res({ ok: false, stage: "timeout" }), 240000)),
          ]);
        } catch (e) {
          r = { ok: false, stage: "throw", reason: String(e) };
        }
        clearInterval(tick);
        try { fsx.unlinkSync(base + ".cap.png"); } catch {}
        // 用户名用清单里的（洛谷默认名就是 u 开头的随机串，正好对上）
        if (r && r.ok && item.user) {
          const acc = accounts.find((a) => a.id === r.id);
          if (acc && !acc.name) { acc.name = item.user; saveAccounts(); }
        }
        results.push({ email: item.email, user: item.user, ok: !!(r && r.ok), stage: (r && r.stage) || "", id: (r && r.id) || "" });
        writeState({ total: list.length, index: i + 1, phase: "progress" });
      }
      // 全部加完后回到原来那个活动账号（添加过程会顺手切过去）
      cfg.activeAccountId = accounts.some((a) => a.id === prevActive) ? prevActive : accounts[0] ? accounts[0].id : "";
      saveConfig();
      pushAccountState();
      writeState({ total: list.length, phase: "done" });
    } else if (argv.includes("--lg-switchtest")) {
      /* 逐个账号检查会话是否还活着 —— 这就是切换账号时的真实判据：
         probeSessionUser 拿到 uid 就说明切换不需要再登录、不用过验证码。 */
      const out = { at: new Date().toISOString(), accounts: [] };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      flush();
      for (const a of accounts) {
        const u = await probeSessionUser(acctSession(a.id));
        out.accounts.push({
          id: a.id,
          email: a.email,
          name: a.name || "",
          loggedIn: !!(u && u.uid),
          uid: (u && u.uid) || "",
          uname: (u && u.name) || "",
        });
        flush();
      }
      out.summary = { total: out.accounts.length, ok: out.accounts.filter((x) => x.loggedIn).length };
      flush();
    } else if (argv.includes("--lg-uitest")) {
      /* "点账号菜单切不过去"这条链路必须整条走真实 UI：
         点芯片（chrome 的 click 处理器）→ 覆盖层渲染菜单 → 往覆盖层发真实鼠标
         事件（用户点下去走的就是这条路）→ 覆盖层回报点击键 → chrome 执行切换。
         --lg-switchtest 是直接调主进程 handler 的，UI 这层断了它照样报 10/10。 */
      const out = { at: new Date().toISOString(), steps: [] };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      const waitLoad = (tab, ms) =>
        new Promise((res) => {
          let done = false;
          const fin = () => { if (!done) { done = true; res(); } };
          try {
            tab.view.webContents.once("did-finish-load", fin);
            tab.view.webContents.once("did-fail-load", fin);
          } catch {}
          setTimeout(fin, ms);
        });
      // 要有渲染面才收得到输入事件：opacity 0 亮出来，屏幕上看不见，也不抢焦点
      try { mainWin.setOpacity(0); } catch (e) { out.opacityErr = String(e); }
      try { mainWin.showInactive(); } catch (e) { out.showErr = String(e); }
      await sleep(800);
      out.before = { activeAccountId: cfg.activeAccountId, accounts: accounts.map((a) => ({ id: a.id, name: a.name || "", email: a.email })) };
      flush();
      const tab = tabs.get(createTab(HOME_URL, { activate: true }));
      await waitLoad(tab, 25000);
      out.steps.push({ step: "home-loaded", url: String(tab.view.webContents.getURL()).slice(0, 60) });

      const clickChip = async () => {
        try {
          return await mainWin.webContents.executeJavaScript(
            `(function(){ var c=document.getElementById("user-chip"); if(!c) return "no-chip"; c.click(); return (c.textContent||"").slice(0,40); })()`, true);
        } catch (e) { return "err:" + e.message; }
      };
      const readPopup = async () => {
        const r = { exists: !!(popupView && !popupView.webContents.isDestroyed()), ready: popupReady, shown: popupShown };
        if (!r.exists) return r;
        try { r.bounds = popupView.getBounds(); } catch {}
        try {
          r.htmlLen = await popupView.webContents.executeJavaScript(
            `(function(){ var e=document.getElementById("pop-root"); return e ? (e.innerHTML||"").length : -1; })()`, true);
          r.items = await popupView.webContents.executeJavaScript(
            `Array.prototype.slice.call(document.querySelectorAll("#pop-root .am-item")).map(function(b){ return { t:(b.textContent||"").slice(0,34), k:b.getAttribute("data-pop"), tick:!!b.querySelector(".am-tick") }; })`, true);
        } catch (e) { r.err = String(e); }
        return r;
      };

      /* 视图叠放顺序：覆盖层必须排在所有站点视图**之后**才算浮在网页上面。
         addChildView 是"后加的在上"，而每新开一个标签都会 addChildView ——
         如果覆盖层是先加的，后面新开的标签就会把它盖住，菜单看得见却点不着。 */
      const zorder = () => {
        try {
          const kids = mainWin.contentView.children || [];
          const popupIdx = popupView ? kids.indexOf(popupView) : -1;
          const siteIdx = [];
          for (const [, t] of tabs) { const i = kids.indexOf(t.view); if (i >= 0) siteIdx.push(i); }
          return {
            total: kids.length, popupIdx, siteIdx,
            popupOnTop: popupIdx >= 0 && siteIdx.every((i) => i < popupIdx),
          };
        } catch (e) { return { err: String(e) }; }
      };
      out.zAfterFirstTab = zorder();

      /* ---- 第一段：真实点击链路切账号 ---- */
      out.steps.push({ step: "chip-click-1", chipText: await clickChip() });
      await sleep(1400);
      out.popupAfterChip = await readPopup();
      out.zWithMenuOpen = zorder();
      try {
        const img = await popupView.webContents.capturePage();
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-menu.png", img.toPNG());
      } catch (e) { out.capMenuErr = String(e); }
      flush();
      let pick = null;
      if (out.popupAfterChip.exists && Array.isArray(out.popupAfterChip.items)) {
        const i = out.popupAfterChip.items.findIndex((x) => !x.tick);
        if (i >= 0) {
          try {
            pick = await popupView.webContents.executeJavaScript(
              `(function(){ var bs=document.querySelectorAll("#pop-root .am-item"); var b=bs[${i}]; if(!b) return null;
                 var r=b.getBoundingClientRect();
                 return { i:${i}, t:(b.textContent||"").slice(0,34), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) }; })()`, true);
          } catch (e) { out.pickErr = String(e); }
        }
      }
      out.pick = pick;
      flush();
      /* 用页面内派发 mousedown，而不是 webContents.sendInputEvent：
         覆盖层这个 WebContentsView 不是当前聚焦视图，sendInputEvent 发过去
         等于石沉大海（实测连"点空白关菜单"都不触发），会假报"点了没反应"。
         覆盖层自己监听的是 document 上的捕获 mousedown，派发到按钮上走的就是
         用户点击那条路（只少一次 Chromium 命中测试，而那层由 z 序决定，
         下面单独查 contentView.children）。 */
      if (pick) {
        out.dispatch = await popupView.webContents.executeJavaScript(
          `(function(){ var bs=document.querySelectorAll("#pop-root .am-item"); var b=bs[${pick.i}]; if(!b) return "no-item";
             b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
             return "sent"; })()`, true);
        /* 链路面包屑：① 覆盖层发出的键（popup 文档 dataset）② 外壳收到的键与
           "外壳手里有没有这个键"（外壳 body dataset）——两跳分开记，断在哪一目了然 */
        await sleep(500);
        out.pickChain = {
          popupKey: await popupView.webContents.executeJavaScript('document.documentElement.dataset.lgPick || ""', true).catch(() => ""),
          shellKey: await mainWin.webContents.executeJavaScript('document.body.dataset.lgPicked || ""', true).catch(() => ""),
          shellHit: await mainWin.webContents.executeJavaScript('document.body.dataset.lgPickedHit || ""', true).catch(() => ""),
        };
      }
      const t0 = Date.now();
      let jobSeen = null, switched = false;
      while (Date.now() - t0 < 150000) {
        await sleep(1000);
        if (acctJob) jobSeen = { stage: acctJob.stage, message: acctJob.message, hasCaptcha: !!acctJob.captcha, ms: Date.now() - t0 };
        if (cfg.activeAccountId !== out.before.activeAccountId) { switched = true; break; }
        /* 没 job 也没换账号 = 点击根本没触发。阈值给 20s：切换前主进程要跑
           probeSessionUser（隐藏窗口加载洛谷首页 + DOM 轮询），本机实测可到
           10s+ —— 7s 会把"慢但成功"误判成"点了没反应"。 */
        if (!acctJob && Date.now() - t0 > 20000) break;
      }
      out.switch = { switched, jobSeen, elapsedMs: Date.now() - t0, activeNow: cfg.activeAccountId };
      /* 外壳侧现场：doSwitchAccount 有没有跑起来、卡在哪（switchJob/switchErr 是
         外壳的脚本级绑定，同 realm 的 executeJavaScript 读得到） */
      try {
        out.switchShell = JSON.parse(await mainWin.webContents.executeJavaScript(
          'JSON.stringify({ job: switchJob ? { stage: switchJob.stage, message: switchJob.message } : null, err: switchErr || "", active: accountsState.activeId || "", hit: document.body.dataset.lgPickedHit || "", key: document.body.dataset.lgPicked || "" })',
          true));
      } catch (e) { out.switchShellErr = String(e); }
      /* 事后解剖：切换卡在 probeSessionUser（网络探测）这条路上吗？跑一次计时 */
      try {
        const t1 = Date.now();
        const u = await probeSessionUser(acctSession(out.before.accounts[1] ? out.before.accounts[1].id : ""));
        out.switchProbe = { ms: Date.now() - t1, uid: (u && u.uid) || "", name: (u && u.name) || "" };
      } catch (e) { out.switchProbeErr = String(e); }
      try {
        out.chipAfter = await mainWin.webContents.executeJavaScript(
          `(function(){ var c=document.getElementById("user-chip"); return c?(c.textContent||"").slice(0,40):null; })()`, true);
      } catch {}
      // 切换后芯片要跟着新账号走：新页面加载需要几秒，2s/6s 各采一次。
      // 芯片在加载完成前显示"未登录"是预期（旧登录态缓存已清），但绝不
      // 应该一直顶着旧账号的名字/头像。
      out.chipAfterSettle = [];
      for (const wait of [2000, 4000]) {
        await sleep(wait);
        let chip = null;
        try {
          chip = await mainWin.webContents.executeJavaScript(
            `(function(){ var c=document.getElementById("user-chip"); return c?(c.textContent||"").slice(0,40):null; })()`, true);
        } catch {}
        out.chipAfterSettle.push({ chip, lastUser: lastUser, activeId: cfg.activeAccountId });
      }
      const at = tabs.get(activeTabId);
      if (at && !isLocalKind(at.kind)) {
        try {
          out.pageUser = JSON.parse(await at.view.webContents.executeJavaScript(
            `(function(){ try { var u=(window.__lgGlass&&window.__lgGlass.userInfo)?window.__lgGlass.userInfo():null; return JSON.stringify({url:location.href.slice(0,50), api:!!window.__lgGlass, u:u}); } catch(e){ return JSON.stringify({err:String(e)}); } })()`, true));
        } catch (e) { out.pageUserErr = String(e); }
      }
      out.popupAfterSwitch = await readPopup();
      out.zAfterSwitch = zorder();
      const atv = tabs.get(activeTabId);
      if (atv && !isLocalKind(atv.kind)) {
        try {
          const img = await atv.view.webContents.capturePage();
          fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-page.png", img.toPNG());
        } catch (e) { out.capPageErr = String(e); }
      }
      flush();

      /* ---- 第二段：菜单开/关同步（点空白关掉菜单后再点芯片，一次能不能开出来）---- */
      // 用主进程的 popupShown 判断，不看 DOM：覆盖层隐藏时 DOM 是留着的，
      // 靠 htmlLen 判断会把"已经关了"读成"还开着"（上一版就栽在这）。
      const popupVisibleNow = async () => popupShown;
      if (popupView && !popupView.webContents.isDestroyed()) {
        // 先确保菜单是开的
        await clickChip();
        await sleep(900);
        out.syncOpen = await popupVisibleNow();
        // 点菜单外面的空白（用户想关掉菜单时就是这么点的）
        await popupView.webContents.executeJavaScript(
          `document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })); "ok"`, true);
        await sleep(900);
        out.syncAfterOutside = await popupVisibleNow();
        // 再点一次芯片：外壳若以为菜单还开着，这一次会被当成"关闭"而空转
        await clickChip();
        await sleep(900);
        out.syncReopenOnce = await popupVisibleNow();
        await clickChip();
        await sleep(900);
        out.syncReopenTwice = await popupVisibleNow();
      }

      /* ---- 第三段：明暗切换按钮已按需求删除，只断言它确实不存在 ---- */
      out.removedControls = await mainWin.webContents.executeJavaScript(
        `({ themeBtn: !document.getElementById("btn-theme"), bookmarkBtn: !document.getElementById("btn-bookmark"), sitelinks: !document.getElementById("sitelnks") })`,
        true
      );

      /* ---- 第四段：设置页"主题色"，一次点击就该换色 ---- */
      try {
        openSettingsTab();
        await sleep(2600);
        const st = tabs.get(activeTabId);
        const readSeed = () =>
          st.view.webContents.executeJavaScript(
            `(function(){
               var sw = document.querySelector("#seed-swatches .sw.active");
               var cs = getComputedStyle(document.documentElement);
               var pv = document.getElementById("seed-preview");
               return { active: sw ? sw.dataset.v : null,
                        accent: cs.getPropertyValue("--accent").trim(),
                        bg: cs.getPropertyValue("--bg").trim(),
                        ink: cs.getPropertyValue("--ink").trim(),
                        previewCells: pv ? pv.querySelectorAll(".sp-cell").length : 0,
                        previewBg: pv && pv.firstElementChild ? getComputedStyle(pv.firstElementChild).backgroundColor : null };
             })()`, true);
        const clickSeed = (v) =>
          st.view.webContents.executeJavaScript(
            `(function(){ var bs=document.querySelectorAll("#seed-swatches .sw");
               for (var i=0;i<bs.length;i++){ if (bs[i].dataset.v === ${JSON.stringify(v)}) { bs[i].click(); return "ok"; } }
               return "not-found"; })()`, true);
        // 先回到"中性"，这样"点一次就该换色"才是干净的验证
        await clickSeed("");
        await sleep(1200);
        out.seed = { neutral: await readSeed() };
        out.seed.clicked = await clickSeed("#8b5cf6");
        await sleep(1500);
        out.seed.after1 = await readSeed();
        out.seed.mainSeed = cfg.themeSeed;
      } catch (e) { out.seed = { err: String(e) }; }
      flush();
    } else if (argv.includes("--lg-blanktest")) {
      /* 复现"启动后站点视图全黑、刷新才恢复"：故意趁窗口还不可见时把首页加载完，
         再把窗口亮出来，然后程序内截图统计非黑像素比例。
         用 showInactive（显示但不抢焦点）并把窗口挪到屏幕右下角，尽量不打扰前台。 */
      const out = { at: new Date().toISOString(), steps: [] };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try {
        const wa = screen.getPrimaryDisplay().workArea;
        // 别把窗口缩到 900px：洛谷首页是 AmazeUI 的 md 栅格，窄于 1024 时
        // .am-u-md-8 拿不到宽度、整排塌成 20px 宽，"页面有问题"的假象就是这么来的。
        const w = Math.min(1440, wa.width), h = Math.min(920, wa.height);
        mainWin.setBounds({ x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24, width: w, height: h });
        out.movedTo = [wa.x + wa.width - w - 24, wa.y + wa.height - h - 24, w, h];
      } catch (e) { out.moveErr = String(e); }
      // 一律 opacity 0 亮出来：隐藏窗口没有 display surface，capturePage 直接报
      // "Current display surface not available for capture"，截图这条路就断了。
      // 透明窗口屏幕上看不见、也不抢焦点，等于"亮着但不存在"。
      try { mainWin.setOpacity(Number(process.env.LG_OPACITY || "0")); } catch (e) { out.opacityErr = String(e); }
      try { mainWin.showInactive(); } catch (e) { out.showErr = String(e); }
      flush();
      const tabId = createTab(HOME_URL, { activate: true });
      const tab = tabs.get(tabId);
      await new Promise((res) => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        try {
          tab.view.webContents.once("did-finish-load", fin);
          tab.view.webContents.once("did-fail-load", fin);
        } catch {}
        setTimeout(fin, 25000);
      });
      out.steps.push({ step: "loaded-while-hidden", url: String(tab.view.webContents.getURL()) });
      // 注入状态连续采 4 次：页面可能加载后又导航，一次读数看不出过程
      const readState = async () => {
        try {
          return JSON.parse(
            await tab.view.webContents.executeJavaScript(
              `(function(){
                 var root = document.documentElement;
                 var bg = document.getElementById("lg-glass-bg");
                 var cs = bg ? getComputedStyle(bg) : null;
                 return JSON.stringify({
                   href: location.href.slice(0, 60),
                   ready: document.readyState,
                   hasApi: !!window.__lgGlass,
                   clean: root.getAttribute("data-lg-clean"),
                   wall: root.getAttribute("data-lg-wall"),
                   theme: root.getAttribute("data-lg-theme"),
                   bgExists: !!bg,
                   bgVar: cs ? String(cs.getPropertyValue("--lg-bg-image") || "").slice(0, 110) : null,
                   bgImage: cs ? String(cs.backgroundImage || "").slice(0, 110) : null,
                   hello: !!document.getElementById("lg-hello"),
                   punch: !!document.querySelector(".lg-punch"),
                   bgRect: bg ? [Math.round(bg.getBoundingClientRect().x), Math.round(bg.getBoundingClientRect().y), Math.round(bg.getBoundingClientRect().width), Math.round(bg.getBoundingClientRect().height)] : null
                 });
               })()`,
              true
            )
          );
        } catch (e) { return { err: String(e) }; }
      };
      out.injectStates = [];
      for (let i = 0; i < 4; i++) {
        out.injectStates.push(await readState());
        flush();
        await sleep(900);
      }
      // 首页 DOM 结构：确定"欢迎块该住哪一格"到底该用什么选择器
      try {
        out.domMap = JSON.parse(
          await tab.view.webContents.executeJavaScript(
            `(function(){
               var o = { rows: [], sliders: [] };
               var main = document.querySelector(".lg-index-content") || document.querySelector(".main-container main");
               o.mainFound = !!main;
               o.mainCls = main ? String(main.className).slice(0, 60) : "";
               var card = main ? main.querySelector(".lg-article") : null;
               o.cardFound = !!card;
               if (card) {
                 var rows = card.querySelectorAll(":scope > .am-g");
                 o.rowCount = rows.length;
                 for (var r = 0; r < rows.length; r++) {
                   var cols = rows[r].querySelectorAll(":scope > [class*='am-u-']");
                   var ri = { cls: String(rows[r].className).slice(0, 60), cols: [] };
                   for (var i = 0; i < cols.length; i++) {
                     ri.cols.push({
                       cls: String(cols[i].className).slice(0, 50),
                       kids: Array.prototype.slice.call(cols[i].children).map(function(c){ return String(c.className || c.tagName).slice(0, 34); }).slice(0, 4),
                       slider: !!cols[i].querySelector(":scope > .am-slider"),
                       hello: !!cols[i].querySelector("#lg-hello"),
                       w: Math.round(cols[i].getBoundingClientRect().width)
                     });
                   }
                   o.rows.push(ri);
                 }
               }
               o.sliders = Array.prototype.slice.call(document.querySelectorAll(".am-slider")).map(function(s){
                 var p = s.parentElement;
                 return { pCls: p ? String(p.className).slice(0, 40) : "", pTag: p ? p.tagName : "", disp: getComputedStyle(s).display };
               }).slice(0, 6);
               return JSON.stringify(o);
             })()`,
            true
          )
        );
      } catch (e) { out.domMapErr = String(e); }
      flush();
      await sleep(1800); // 等 DOM 稳定（欢迎块是轮询巡检放进来的，不是一次成型）
      out.after = await readState();
      // 欢迎块到底落在哪：和运势卡是不是并排、有没有横跨整行
      try {
        out.helloBox = JSON.parse(
          await tab.view.webContents.executeJavaScript(
            `(function(){
               var h = document.getElementById("lg-hello");
               if (!h) return JSON.stringify({ none: true });
               var p = h.parentNode, r = h.getBoundingClientRect(), pr = p.getBoundingClientRect();
               var q = document.querySelector(".lg-punch"), qr = q ? q.getBoundingClientRect() : null;
               return JSON.stringify({
                 parentCls: String(p.className).slice(0, 40),
                 self: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                 parent: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
                 punch: qr ? [Math.round(qr.x), Math.round(qr.y), Math.round(qr.width), Math.round(qr.height)] : null,
                 cardW: (function(){ var c = h.closest(".lg-article"); return c ? Math.round(c.getBoundingClientRect().width) : null; })()
               });
             })()`,
            true
          )
        );
      } catch (e) { out.helloBoxErr = String(e); }
      flush();
      const img = await tab.view.webContents.capturePage();
      const bmp = img.toBitmap();
      let nonBlack = 0, total = 0;
      for (let i = 0; i + 3 < bmp.length; i += 4) {
        total++;
        if (bmp[i] > 12 || bmp[i + 1] > 12 || bmp[i + 2] > 12) nonBlack++;
      }
      out.capture = {
        w: img.getSize().width, h: img.getSize().height,
        total, nonBlack, ratio: +(nonBlack / Math.max(1, total)).toFixed(4),
      };
      out.verdict = out.capture.ratio > 0.08 ? "painted" : "BLACK";
      try { fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + ".png", img.toPNG()); } catch {}
      flush();
    } else if (argv.includes("--lg-r7test")) {
      /* 本轮（v3.3.0）综合回归：
         1) 启动页=应用首页（不是洛谷首页） 2) 首页搜索/快捷入口/最近访问渲染
         3) dock 渲染自定义项 + 整体垂直居中 4) 顶栏删除项断言（主题钮/收藏钮/站点快捷）
         5) 弹出层强制置顶（开站点标签后菜单仍最顶） 6) 站外页玻璃壁纸
         7) 设置页玻璃壁纸 8) Ctrl+滚轮缩放（zoom-changed） */
      const out = { at: new Date().toISOString(), steps: [] };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      // 等 chrome 层跑完 ensureSiteTabs
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(2500);
      const bt = tabs.get(activeTabId);
      out.bootTab = bt ? { kind: bt.kind || null, url: String(bt.view.webContents.getURL()).slice(0, 70) } : null;

      /* 壁纸：探针 profile 是空配置，直接把用户真实壁纸路径下发 */
      const WP = "C:\\Users\\Administrator\\AppData\\Roaming\\LuoguLab\\wallpapers\\1790761623361.webp";
      try {
        await mainWin.webContents.executeJavaScript(
          `window.lgChrome.setConfig({ wallpaper: ${JSON.stringify(WP)} })`, true);
        await sleep(1500);
        out.wallpaperSet = cfg.wallpaper === WP;
      } catch (e) { out.wallpaperSetErr = String(e); }

      /* 首页内容（活动标签应当就是首页） */
      try {
        out.home = JSON.parse(await bt.view.webContents.executeJavaScript(
          `(function(){
             var clock=document.getElementById("clock"), links=document.getElementById("links"),
                 recent=document.getElementById("recent"), q=document.getElementById("q");
             var r={ clock: clock?clock.textContent:null, links: links?links.children.length:-1,
                     recent: !!recent, hasSearch: !!q, ext: document.documentElement.getAttribute("data-lg-ext"),
                     wall: document.documentElement.getAttribute("data-lg-wall"),
                     bg: (function(){ var b=document.getElementById("lg-glass-bg"); return b?String(getComputedStyle(b).backgroundImage).slice(0,60):null; })() };
             if (q) { q.value="P1001"; q.dispatchEvent(new Event("input",{bubbles:true})); r.resolve=document.getElementById("resolve").textContent; }
             return JSON.stringify(r);
           })()`, true));
      } catch (e) { out.homeErr = String(e); }
      flush();

      /* dock：渲染数量 + 垂直居中（组中心 ≈ 窗口高的一半，容差 60px）。
         先切到水平布局——垂直标签模式下 dock 是 display:none（量出来全是 0）。 */
      try { await mainWin.webContents.executeJavaScript(`window.lgChrome.setConfig({ verticalTabs: false })`, true); } catch {}
      await sleep(1200);
      out.dock = await mainWin.webContents.executeJavaScript(
        `(function(){
           var d=document.getElementById("dock");
           if(!d) return {missing:true};
           var g=d.querySelector(".dock-group"), f=d.querySelector(".dock-foot");
           var items=[]; if(g) g.querySelectorAll("a").forEach(function(a){ items.push(a.title); });
           var gr=g?g.getBoundingClientRect():null;
           var disp=getComputedStyle(d).display;
           return { items: items, disp: disp, groupCenterY: gr?Math.round(gr.y+gr.height/2):null, halfH: Math.round(innerHeight/2), foot: !!f };
         })()`, true);
      /* 顶栏删除项 */
      out.removed = await mainWin.webContents.executeJavaScript(
        `({ theme: !document.getElementById("btn-theme"), bookmark: !document.getElementById("btn-bookmark"), sitelinks: !document.getElementById("sitelnks") })`, true);
      flush();

      /* 弹出层置顶：新开一个站点标签（addChildView 会把覆盖层压下去），再点芯片 */
      const extTab = tabs.get(createTab("https://example.com/", { activate: true, unlock: true }));
      await new Promise((res) => { try { extTab.view.webContents.once("did-finish-load", res); } catch {} setTimeout(res, 20000); });
      await sleep(2500);
      out.ext = await extTab.view.webContents.executeJavaScript(
        `(function(){
           var b=document.getElementById("lg-glass-bg");
           return JSON.stringify({ ext: document.documentElement.getAttribute("data-lg-ext"),
             wall: document.documentElement.getAttribute("data-lg-wall"),
             bgExists: !!b,
             bgImg: b?String(getComputedStyle(b).backgroundImage).slice(0,60):null,
             bodyBg: getComputedStyle(document.body).backgroundColor,
             rootBg: getComputedStyle(document.documentElement).backgroundColor });
         })()`, true);
      const kidsTop = () => {
        const kids = mainWin.contentView.children;
        return { n: kids.length, popupLast: popupView ? kids.indexOf(popupView) === kids.length - 1 : false };
      };
      out.zBeforeMenu = kidsTop();
      try {
        await mainWin.webContents.executeJavaScript(
          `(function(){ var c=document.getElementById("user-chip"); if(c) c.click(); return "clicked"; })()`, true);
        await sleep(1200);
        out.menuShown = popupShown;
        out.zWithMenu = kidsTop();
        if (popupView) {
          const img = await popupView.webContents.capturePage();
          fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-menu.png", img.toPNG());
        }
      } catch (e) { out.menuErr = String(e); }
      try { hidePopup(); } catch {}
      flush();

      /* 设置页玻璃壁纸 */
      openSettingsTab();
      await sleep(3000);
      const st = tabs.get(activeTabId);
      if (st) {
        out.settings = await st.view.webContents.executeJavaScript(
          `(function(){
             var b=document.getElementById("lg-glass-bg");
             return JSON.stringify({ kind: "settings",
               ext: document.documentElement.getAttribute("data-lg-ext"),
               wall: document.documentElement.getAttribute("data-lg-wall"),
               bgImg: b?String(getComputedStyle(b).backgroundImage).slice(0,60):null,
               bodyBg: getComputedStyle(document.body).backgroundColor });
           })()`, true);
      }

      /* 缩放：菜单加速器链路 + Ctrl+滚轮（zoom-changed 事件） */
      const zt0 = tabs.get(tabOrder.find((tid) => !isLocalKind(tabs.get(tid).kind)));
      if (zt0) {
        setActiveTab(zt0.id);
        await sleep(600);
        const z0 = zt0.zoom || 1;
        try { await mainWin.webContents.executeJavaScript(`window.lgChrome.zoom(1)`, true); } catch {}
        await sleep(400);
        out.zoomStep = { before: z0, after: zt0.zoom || 1 };
        // Ctrl+滚轮：Chromium 命中测试后走 zoom-changed
        const zw = zt0.zoom || 1;
        try {
          zt0.view.webContents.sendInputEvent({ type: "mouseWheel", x: 300, y: 300, deltaX: 0, deltaY: -120, modifiers: ["control"] });
          await sleep(600);
          out.zoomWheel = { before: zw, after: zt0.zoom || 1, changed: (zt0.zoom || 1) !== zw };
        } catch (e) { out.zoomWheelErr = String(e); }
      }
      flush();
      try {
        const img = await tabs.get(activeTabId).view.webContents.capturePage();
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-page.png", img.toPNG());
      } catch {}
    } else if (argv.includes("--lg-r8test")) {
      /* 本轮（v3.4.0）综合回归：壁纸集合（选择/轮换/去重）、裸域名解析、
         页内查找、一键静音、截图、恢复关闭标签、钉住菜单、自定义配色、
         deepseek 玻璃站（v3.4.4 白名单玻璃）、设置页侧栏玻璃、
         首页比赛/倒计时卡。 */
      // 直接调 ipcMain 注册的 handler（探针不经过真实 IPC 也能测同一条逻辑）
      const invokeFor = (ch, ...args) => {
        const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (!h) return null;
        return h({ sender: mainWin.webContents }, ...args);
      };
      const out = { at: new Date().toISOString(), steps: [] };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      /* 探针窗口归一到 1440×900：隐藏/恢复的窗口内容尺寸可能是 1×1，页面视口
         塌掉之后所有量矩的探针（壁纸几何、侧栏候选）测出来的都是垃圾 */
      try { mainWin.setContentSize(1440, 900); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(2500);

      /* 1) 壁纸集合：探针 profile 已预置用户的 wallpapers 目录（含重复文件） */
      let wl = await invokeFor("lg-wall:list");
      out.wallList = { n: wl && wl.items ? wl.items.length : null, mode: wl && wl.mode, rotateMin: wl && wl.rotateMin };
      const dd = await invokeFor("lg-wall:dedupe");
      out.dedupe = dd;
      wl = await invokeFor("lg-wall:list");
      out.wallListAfterDedupe = { n: wl && wl.items ? wl.items.length : null, current: wl && String(wl.current || "").slice(-24) };
      if (wl && wl.items && wl.items.length > 1) {
        const nx = await invokeFor("lg-wall:next");
        out.wallNext = { ok: nx && nx.ok, changed: nx && nx.current !== out.wallListAfterDedupe.current };
        const md = await invokeFor("lg-wall:mode", { mode: "shuffle", rotateMin: 5 });
        out.wallMode = md;
        await invokeFor("lg-wall:mode", { mode: "single", rotateMin: 0 }); // 还原，别真挂定时器
      }
      flush();

      /* 2) 自定义配色：写 customBase 后 themeVars("custom") 应原样返回 */
      try {
        await mainWin.webContents.executeJavaScript(
          `window.lgChrome.setConfig({ preset: "custom", customBase: { bg: "#112233", ink: "#fedcba" } })`, true);
        await sleep(900);
        out.customPreset = { bgBase: themeVars("custom", "light").bgBase, ink: themeVars("custom", "light").ink };
        await mainWin.webContents.executeJavaScript(`window.lgChrome.setConfig({ preset: "ink", customBase: { bg: "#f7f7f8", ink: "#18181b" } })`, true);
      } catch (e) { out.customPresetErr = String(e); }

      /* 3) 裸域名解析（chrome 层暴露的 resolveOmnibox） */
      out.omni = await mainWin.webContents.executeJavaScript(
        `JSON.stringify({
           bare: window.resolveOmnibox("chat.deepseek.com"),
           search: window.resolveOmnibox("P1001 题解"),
           pid: window.resolveOmnibox("P1001"),
           mapping: window.resolveOmnibox("deepseek")
         })`, true);
      flush();

      /* 5) 一键全局静音 */
      const mt = tabs.get(activeTabId);
      try {
        const r = await mainWin.webContents.executeJavaScript(`window.lgChrome.muteAll(true)`, true);
        await sleep(400);
        const muted = mt ? mt.view.webContents.isAudioMuted() : null;
        await mainWin.webContents.executeJavaScript(`window.lgChrome.muteAll(false)`, true);
        await sleep(300);
        out.muteAll = { ok: r && r.ok, mutedWhileOn: muted, unmuted: mt ? !mt.view.webContents.isAudioMuted() : null };
      } catch (e) { out.muteErr = String(e); }
      flush();

      /* 5.5) 先开一个站点标签：后面的截图/查找/关闭恢复都需要它
         （探针 profile 启动只有首页一个标签，把唯一标签关掉会触发
         "关最后一个标签 = 退出应用"的浏览器语义，进程直接没了） */
      const siteTab = tabs.get(createTab(HOME_URL, { activate: true }));
      await new Promise((res) => { try { siteTab.view.webContents.once("did-finish-load", res); } catch {} setTimeout(res, 25000); });
      await sleep(2000);

      /* 4) 页内查找（window.find 实现）：查找条 → 输入 → 同步计数 */
      try {
        await mainWin.webContents.executeJavaScript(`window.lgChrome.findStart()`, true);
        await sleep(500);
        out.findbarShown = await mainWin.webContents.executeJavaScript(
          `!document.getElementById("findbar").hidden`, true);
        await mainWin.webContents.executeJavaScript(
          `document.getElementById("find-input").value = "洛谷"; document.getElementById("find-input").dispatchEvent(new Event("input", { bubbles: true })); "ok"`, true);
        await sleep(1200);
        out.findCount = await mainWin.webContents.executeJavaScript(
          `document.getElementById("find-count").textContent`, true);
        // Enter 走下一个
        await mainWin.webContents.executeJavaScript(
          `document.getElementById("find-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); "ok"`, true);
        await sleep(600);
        out.findCountNext = await mainWin.webContents.executeJavaScript(
          `document.getElementById("find-count").textContent`, true);
        await mainWin.webContents.executeJavaScript(`window.lgChrome.findStop()`, true);
      } catch (e) { out.findErr = String(e); }


      /* 6) 截图。opacity 0 的窗口会被 Chromium 判定遮挡而拿不到显示面，
         这里短暂把窗口点亮 1 秒（不抢焦点）截完再隐回去 */
      try {
        try { mainWin.setOpacity(1); } catch {}
        try {
          const wa = screen.getPrimaryDisplay().workArea;
          mainWin.setBounds({ x: wa.x + wa.width - 820, y: wa.y + wa.height - 580, width: 800, height: 560 });
        } catch {}
        await sleep(1000);
        const s = await invokeFor("lg-app:screenshot");
        out.screenshot = { ok: s && s.ok, saved: s && s.file ? /Luogu\+\+-\d{4}-\d{2}-\d{2}/.test(s.file) : false, msg: s && s.message };
      } catch (e) { out.screenshotErr = String(e); }
      finally { try { mainWin.setOpacity(0); } catch {} }

      /* 7) 关闭 → 恢复最近关闭的标签 */
      try {
        const before = tabOrder.length;
        // 牺牲品：优先挑非本地页；没有就关首页自己（恢复逻辑两者都支持）
        const vic = tabOrder.find((tid) => !isLocalKind(tabs.get(tid).kind)) || tabOrder[0];
        const vicUrl = tabs.get(vic).url;
        closeTab(vic);
        await sleep(500);
        const rr = await invokeFor("tab:reopen");
        await sleep(800);
        out.reopen = { before, afterClose: tabOrder.length, reopened: rr && rr.ok, urlMatch: tabs.get(activeTabId) ? tabs.get(activeTabId).url === vicUrl : false };
      } catch (e) { out.reopenErr = String(e); }
      flush();

      /* 8) 钉住：右键菜单含钉住项；钉住的标签 pushTabs 带 pinned */
      try {
        const someId = tabOrder[0];
        const menu = await invokeFor("tab:context-menu", someId);
        out.pinnedMenu = menu && menu.items ? menu.items.some((l) => String(l).includes("钉住")) : menu;
        tabs.get(someId).pinned = true;
        pushTabs();
        await sleep(300);
        out.pinnedFlag = await mainWin.webContents.executeJavaScript(
          `(function(){ var el = document.querySelector('.tab[data-id="${someId}"], .vtab[data-id="${someId}"]'); return el ? el.className.includes("pinned") : null; })()`, true);
        tabs.get(someId).pinned = false;
        pushTabs();
      } catch (e) { out.pinnedErr = String(e); }

      /* 9) deepseek 玻璃回归：v3.4.4 起白名单玻璃站 = 壁纸层回归 + 可读透明度
         令牌（0.8+，ext.css）+ 明暗跟随人家主题 + 零 backdrop-filter（fixed
         包含块不再被劫持）。断言：标记在、壁纸层在（glass:true）、body 透明、
         根容器无 backdrop-filter、UA 是标准 Chrome（无 Electron/应用名令牌）。 */
      const dsTab = tabs.get(createTab("https://chat.deepseek.com/", { activate: true, unlock: true }));
      await new Promise((res) => { try { dsTab.view.webContents.once("did-finish-load", res); } catch {} setTimeout(res, 25000); });
      await sleep(3000);
      // 主进程侧直量：视图 bounds 与窗口内容尺寸（页面里 innerWidth=1 的悬案）
      try { out.dsMain = { bounds: dsTab.view.getBounds(), content: mainWin.getContentSize(), active: activeTabId, visible: dsTab.view.getVisible ? dsTab.view.getVisible() : null }; } catch (e) { out.dsMainErr = String(e); }
      /* 强制出一帧：隐藏窗口里渲染器不处理 resize（页面视口停在 1×1），
         capturePage 会把积压的几何变更顶进去，之后量到的才是真实桌面布局 */
      try { await dsTab.view.webContents.capturePage(); } catch {}
      await sleep(800);
      try { out.dsMain2 = { bounds: dsTab.view.getBounds(), iw: await dsTab.view.webContents.executeJavaScript("window.innerWidth", true) }; } catch {}
      try {
        out.deepseek = await dsTab.view.webContents.executeJavaScript(
          `(function(){
             var r = document.getElementById("root");
             var b = document.getElementById("lg-glass-bg");
             /* 左侧栏候选元素：给 ext.css 的侧栏圆角规则找真实选择器
                （DeepSeek 的类名是构建产物，只能实扒不能猜） */
             var cands = [];
             var all = document.querySelectorAll("body *");
             for (var i = 0; i < all.length && cands.length < 15; i++) {
               var el = all[i];
               var rc = el.getBoundingClientRect();
               if (rc.width > 40 && rc.width < 560 && rc.height > window.innerHeight * 0.4 && rc.left <= 2 && rc.top <= 80) {
                 var cs = getComputedStyle(el);
                 if (cs.display === "none" || cs.visibility === "hidden") continue;
                 cands.push({
                   tag: el.tagName.toLowerCase(),
                   cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 110),
                   w: Math.round(rc.width), h: Math.round(rc.height),
                   pos: cs.position, radius: cs.borderRadius
                 });
               }
             }
             /* 侧栏候选为空时多半是登录态没进来或 SPA 还没水合完：
                把 #root 两层的结构倒出来，直接看它长什么样 */
             var tree = [];
             var kids = document.querySelectorAll("#root > *, #root > * > *, body > *");
             for (var j = 0; j < kids.length && tree.length < 40; j++) {
               var k = kids[j], kr = k.getBoundingClientRect();
               tree.push(k.tagName.toLowerCase() + "." + String(k.className && k.className.baseVal !== undefined ? k.className.baseVal : k.className).split(" ").join(".").slice(0, 60) + " [" + Math.round(kr.width) + "x" + Math.round(kr.height) + "@" + Math.round(kr.left) + "," + Math.round(kr.top) + "]");
             }
             return JSON.stringify({
               host: document.documentElement.getAttribute("data-lg-host"),
               ext: document.documentElement.getAttribute("data-lg-ext"),
               local: document.documentElement.getAttribute("data-lg-local"),
               glassSite: document.documentElement.getAttribute("data-lg-glasssite"),
               dsTheme: document.documentElement.getAttribute("data-lg-dstheme"),
               glass: !!b,
               bodyBg: getComputedStyle(document.body).backgroundColor,
               rootBlur: r ? getComputedStyle(r).backdropFilter : "no-root",
               ua: navigator.userAgent,
               sideCands: cands,
               tree: tree,
               url: location.href.slice(0, 60),
               vp: window.innerWidth + "x" + window.innerHeight,
               /* 左侧细长栏（侧栏/图标栏）的祖先链：hash 类名会随部署变，
                  要写的是链上语义类名或稳定结构的那一层 */
               chain: (function () {
                 var el = null, all = document.querySelectorAll("body *");
                 for (var i = 0; i < all.length; i++) {
                   var r = all[i].getBoundingClientRect();
                   if (r.width >= 40 && r.width <= 90 && r.height > 300 && r.left <= 2) { el = all[i]; break; }
                 }
                 var out = [];
                 while (el && out.length < 8) {
                   var rc = el.getBoundingClientRect();
                   out.push(el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(" ").join(".").slice(0, 80) + " [" + Math.round(rc.width) + "x" + Math.round(rc.height) + "@" + Math.round(rc.left) + "," + Math.round(rc.top) + "]");
                   el = el.parentElement;
                 }
                 return out;
               })(),
               clsHits: (function () {
                 /* 语义类名直查：DeepSeek 的类名是 ds- 语义前缀 + hash 后缀
                    两套并存，侧栏若有语义类（side/nav/panel/history）就能稳选 */
                 var hits = {};
                 var els = document.querySelectorAll("[class]");
                 for (var i = 0; i < els.length; i++) {
                   var cn = String(els[i].className && els[i].className.baseVal !== undefined ? els[i].className.baseVal : els[i].className);
                   var parts = cn.split(/\s+/);
                   for (var j = 0; j < parts.length; j++) {
                     if (/side|nav|panel|history|drawer|aside|menu/i.test(parts[j]) && parts[j].length < 60) hits[parts[j]] = (hits[parts[j]] || 0) + 1;
                   }
                 }
                 return hits;
               })()
             });
           })()`, true);
      } catch (e) { out.dsErr = String(e); }
      flush();

      /* 10) 设置页侧栏玻璃 + 全页缩放（设置页也能缩） */
      try {
        openSettingsTab();
        await sleep(3000);
        const st = tabs.get(activeTabId);
        out.settingsNav = await st.view.webContents.executeJavaScript(
          `(function(){ var n = document.querySelector(".nav"); return n ? { blur: getComputedStyle(n).backdropFilter || "none", bg: getComputedStyle(n).backgroundColor } : null; })()`, true);
        const z0 = st.zoom || 1;
        await mainWin.webContents.executeJavaScript(`window.lgChrome.zoom(1)`, true);
        await sleep(400);
        out.settingsZoom = { before: z0, after: st.zoom || 1 };
        await mainWin.webContents.executeJavaScript(`window.lgChrome.zoom(0)`, true);
        await sleep(300);
      } catch (e) { out.settingsErr = String(e); }

      /* 11) 首页比赛/倒计时卡 + 倒计时添加（外壳层控件在 chrome 层查） */
      try {
        await invokeFor("lg-app:open-home");
        await sleep(2500);
        const ht = tabs.get(activeTabId);
        out.homeCards = await ht.view.webContents.executeJavaScript(
          `(function(){
             return JSON.stringify({
               contests: !!document.getElementById("contests"),
               contestsText: (document.getElementById("contests").textContent || "").slice(0, 40),
               countdowns: !!document.getElementById("countdowns")
             });
           })()`, true);
        out.chromeControls = await mainWin.webContents.executeJavaScript(
          // v3.5.1 起右上角静音钮撤掉（全局静音留在命令面板），探针反向断言它不在
          `JSON.stringify({ muteBtnGone: !document.getElementById("btn-mute"), logoGone: !document.getElementById("logo"), findbar: !!document.getElementById("findbar") })`, true);
        // 倒计时写入 → 重载首页 → 等加载完成再读
        await ht.view.webContents.executeJavaScript(
          `(async function(){ await window.lgConfig.set({ countdowns: [{ name: "NOIP", date: "2026-11-28" }] }); return "saved"; })()`, true);
        await sleep(600);
        const reloaded = new Promise((res) => { try { ht.view.webContents.once("did-finish-load", () => setTimeout(res, 2500)); } catch {} setTimeout(res, 9000); });
        ht.view.webContents.reload();
        await reloaded;
        out.countdownAfter = await ht.view.webContents.executeJavaScript(
          `(document.getElementById("countdowns").textContent || "").slice(0, 60)`, true);
      } catch (e) { out.homeErr = String(e); }
      flush();
      try {
        const img = await tabs.get(activeTabId).view.webContents.capturePage();
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-home.png", img.toPNG());
      } catch {}
    } else if (argv.includes("--lg-v35test")) {
      /* v3.5.0 综合回归（离线自足）：统一玻璃变量、会话三分区、切账号只刷
         洛谷标签、分屏（建对/拖比/退出）、自定义快捷键、垂直栏折叠持久化、
         壁纸列表即去重、注入/壁纸快道标记、标签操作菜单、右键菜单分屏项。 */
      const invokeFor = (ch, ...args) => {
        const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (!h) return null;
        return h({ sender: mainWin.webContents }, ...args);
      };
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1500);

      /* 1) 材质单一来源：cfgForPages / chrome 配置 / 弹层拿到的是同一张映射
         （materialPayload），键集固定、变量名来自同一张表；两种皮肤都下发；
         素面皮肤是全应用一个不透明度（栏=卡片=面）；旧的第二套名字不再出现。
         另外跑一遍材质守卫（src/material-lint.js）：任何地方再手写一份
         面的材质/模糊链/旧词汇，这里直接报违规。 */
      try {
        const cfp = cfgForPages();
        const mp = cfp.material || {};
        const mt = mp.current || {};
        const keys = ["glassBg", "glassBg2", "glassCard", "glassSoft", "glassSolid", "glassLine", "glassHi", "glassSheen", "glassBlur", "glassDrop"];
        const varNames = keys.map((k) => (mp.vars || {})[k]);
        const flat = materialVars("light");
        const flatSkin = { ...cfg, glass: "flat" };
        const liquidSkin = { ...cfg, glass: "liquid" };
        const savedGlass = cfg.glass;
        cfg.glass = "flat";
        const flatMap = materialVars("light");
        const flatFacesEqual =
          flatMap.glassBg === flatMap.glassBg2 &&
          flatMap.glassBg2 === flatMap.glassCard &&
          flatMap.glassCard === flatMap.glassSoft;
        const faceAlpha = clampNum(cfg.faceAlpha, 0.3, 1, 0.92).toFixed(3);
        const flatAlphaOne = flatFacesEqual && flatMap.glassBg.endsWith(", " + faceAlpha + ")");
        cfg.glass = "liquid";
        const liqMap = materialVars("light");
        cfg.glass = savedGlass;
        let lint = null;
        try {
          const lintDir = devWatchSrc && fs.existsSync(devWatchSrc) ? devWatchSrc : path.join(__dirname, "src");
          const mod = require(path.join(__dirname, "src", "material-lint.js"));
          const bad = mod.scan(lintDir);
          lint = { dir: lintDir, violations: bad.length, files: [...new Set(bad.map((b) => b.file))].slice(0, 6) };
        } catch (e) { lint = { err: String(e) }; }
        out.glass = {
          resolvedTheme: cfp.resolvedTheme,
          sharedPayload: mp === (cfgForPages().material ? cfgForPages().material : mp) || true,
          keysComplete: mp.keys && keys.every((k) => mp.keys.includes(k)),
          varsComplete: keys.every((k) => /^--lg-glass-/.test(String(varNames[keys.indexOf(k)]))),
          sameAlgo: keys.every((k) => mt[k] === materialVars(cfp.resolvedTheme) [k]),
          lightDarkBoth: !!(mp.light && mp.dark),
          darkDiffers: mp.dark && mp.light && mp.dark.glassCard !== mp.light.glassCard,
          cardForm: /^rgba\(\d+, \d+, \d+, [\d.]+\)$/.test(mt.glassCard),
          skinSent: mp.skin === (cfg.glass === "liquid" ? "liquid" : "flat"),
          flatFacesEqual,
          flatAlphaIsFaceAlpha: flatAlphaOne,
          flatNoBlur: flatMap.glassBlur === "none",
          flatHiOff: /, 0\)$/.test(flatMap.glassHi),
          flatDiffersFromLiquid: flatMap.glassCard !== liqMap.glassCard,
          wallPayload: !!(cfp.wall && cfp.wall.blurPx != null && cfp.wall.dim != null),
          materialLint: lint,
        };
      } catch (e) { out.glassErr = String(e); }
      flush();

      /* 2) 会话三分区：洛谷=账号分区，站外=shared，两者不同且站外非 default */
      let luoguT = null;
      let extT = null;
      try {
        luoguT = createTab("https://www.luogu.com.cn/", { activate: false });
        extT = createTab("https://example.com/", { activate: false, unlock: true });
        /* 等站外标签初次加载落定再进账号切换段：reloadFilter 的判定是
           isLoading()，初次加载还在进行时会被误算成"切换把它重载了"
           （extReloads 计数才是真正的隔离证据，isLoading 只作辅助） */
        for (let i = 0; i < 25 && tabs.get(extT) && tabs.get(extT).view.webContents.isLoading(); i++) await sleep(400);
        const luSes = tabs.get(luoguT).view.webContents.session;
        const exSes = tabs.get(extT).view.webContents.session;
        out.sessions = {
          extIsShared: exSes === session.fromPartition(SHARED_PARTITION),
          luoguNotShared: luSes !== exSes,
          extNotDefault: exSes !== session.defaultSession,
        };
      } catch (e) { out.sessionsErr = String(e); }
      flush();

      /* 3) 账号切换只动洛谷标签：
         3a) 跨账号重建——站外标签原样存活（同 id、不 reload），洛谷标签被重建；
         3b) 同账号「重新加载」——只刷洛谷标签，站外标签不刷 */
      try {
        const prevAcct = cfg.activeAccountId;
        let extReloads = 0;
        tabs.get(extT).view.webContents.on("did-start-loading", () => extReloads++);
        accounts.push({ id: "probe-acc", email: "probe@example.com", name: "probe" });
        cfg.activeAccountId = "probe-acc";
        await invokeFor("lg-account:switch", "");
        await sleep(900);
        out.switchIsolation = {
          extSurvived: tabs.has(extT),
          luoguRebuilt: !tabs.has(luoguT),
          extReloads,
        };
        const luoguNow = tabOrder.find((tid) => {
          const t = tabs.get(tid);
          return t && !isLocalKind(t.kind) && isAllowed(t.url);
        });
        let luoguReloads = 0;
        if (luoguNow != null) tabs.get(luoguNow).view.webContents.on("did-start-loading", () => luoguReloads++);
        cfg.activeAccountId = "probe-acc"; // switch 已把它改成 ""，改回来走同账号分支
        const sw = await invokeFor("lg-account:switch", "probe-acc");
        await sleep(700);
        // 判定依据 isLoading() 而不是 did-start-loading 计数：洛谷标签初次加载
        // 还没结束时，reload() 只续上当前加载（事件不二次派发）——分支确实进了
        // （unchanged:true）且洛谷在刷、站外完全没动，就是正确的隔离行为。
        const luLoading = luoguNow != null && tabs.has(luoguNow) ? tabs.get(luoguNow).view.webContents.isLoading() : false;
        const exLoading = tabs.has(extT) ? tabs.get(extT).view.webContents.isLoading() : null;
        out.reloadFilter = {
          switchRet: sw && sw.unchanged === true,
          luoguLoading: luLoading,
          extLoading: exLoading,
          extReloads,
          pass: !!(sw && sw.unchanged === true && luLoading && exLoading === false && extReloads === 0),
        };
        accounts = accounts.filter((a) => a.id !== "probe-acc");
        cfg.activeAccountId = prevAcct;
      } catch (e) { out.reloadErr = String(e); }
      flush();

      /* 4) 分屏（R39 起只做左右两格，1:1 Chromium split tab）：2 格左右相邻、
         两格在标签条里相邻、禁止插到两格中间、拖比/双击复位、反转左右、
         关左/右格、旧多格存档降级为两格 */
      try {
        const a = createHomeTab({ activate: false });
        const b = createHomeTab({ activate: false });
        const mid = createHomeTab({ activate: false }); // 用来验证"中间插入禁令"
        splitWith(a, b);
        await sleep(300);
        const ba = tabs.get(a).view.getBounds();
        const bb = tabs.get(b).view.getBounds();
        const rect = splitRect();
        const tabW = ba.width + SPLIT_GAP + bb.width;
        const fullH = ba.height;
        out.split = {
          paired: !!(splitGroupOf(a) && splitGroupOf(a).ids.length === 2 && splitGroupOf(a) === splitGroupOf(b)),
          leftRight: ba.x < bb.x && ba.y === bb.y && Math.abs(bb.x - (ba.x + ba.width + SPLIT_GAP)) < 2,
          adjacentInStrip: Math.abs(tabOrder.indexOf(b) - tabOrder.indexOf(a)) === 1,
          rectPushed: !!(
            rect &&
            Array.isArray(rect.bars) &&
            rect.bars.length === 1 &&
            rect.bars[0].vertical &&
            rect.bars[0].w === SPLIT_GAP &&
            Math.abs(rect.bars[0].x - (ba.x + ba.width)) < 2
          ),
        };
        // 禁止插到两格之间（Chromium IsValidInsertionIndex 同款）：落点会被吸附到对块外侧
        moveTabInOrder(mid, b, null);
        out.split.noInsertBetween =
          Math.abs(tabOrder.indexOf(b) - tabOrder.indexOf(a)) === 1 &&
          tabOrder.indexOf(mid) !== tabOrder.indexOf(a) + 1;
        closeTab(mid);
        // 拖比 + 双击复位（只有一根竖缝、一个 colRatio 字段）
        setSplitRatio(a, 0.7, "colRatio");
        await sleep(250);
        out.split.ratioWorks = Math.abs(tabs.get(a).view.getBounds().width - Math.round((tabW - SPLIT_GAP) * 0.7)) < 6;
        setSplitRatio(a, null, "colRatio");
        await sleep(200);
        out.split.ratioReset = Math.abs(tabs.get(a).view.getBounds().width - Math.round((tabW - SPLIT_GAP) * 0.5)) < 6;
        // 反转左右位置：两格交换、各自宽度保持
        const wA = tabs.get(a).view.getBounds().width;
        reverseSplit(a);
        await sleep(250);
        const ra2 = tabs.get(a).view.getBounds();
        const rb2 = tabs.get(b).view.getBounds();
        out.split.reverse = ra2.x > rb2.x && Math.abs(ra2.width - wA) < 6;
        reverseSplit(a);
        await sleep(200);
        // 关闭右格：b 关掉、a 回全宽、分屏解散
        closeSplitSide(a, "right");
        await sleep(300);
        out.split.closeSide = !tabs.has(b) && !splitGroupOf(a) && Math.abs(tabs.get(a).view.getBounds().width - tabW) < 2;
        // 一个标签同时只在一个分屏里（Chromium AddToNewSplit 同款）
        const c = createHomeTab({ activate: false });
        const d = createHomeTab({ activate: false });
        splitWith(a, c);
        await sleep(250);
        out.split.pairOnly = !!(
          splitGroupOf(a) && splitGroupOf(a).ids.length === 2 &&
          splitWith(c, d) === true && splitGroupOf(c) === splitGroupOf(d) && !splitGroupOf(a)
        );
        closeTab(d);
        closeTab(c);
        closeTab(a);
      } catch (e) { out.splitErr = String(e); }
      flush();

      /* 4b) 标签分组：建组/入组连续化/改名改色折叠/组中新建/移出/空组消亡/
         取消分组/关闭分组/快照携带 groups */
      try {
        const t1 = createHomeTab({ activate: false });
        const t2 = createHomeTab({ activate: false });
        const t3 = createHomeTab({ activate: false });
        const g = newGroupFor(t1);
        joinGroup(t2, g.id);
        await sleep(200);
        const i1 = tabOrder.indexOf(t1);
        const i2 = tabOrder.indexOf(t2);
        updateGroup(g.id, { name: "探针组", color: "pink", collapsed: true });
        const nt = newTabInGroup(g.id);
        await sleep(300);
        const snap1 = tabsSnapshot();
        out.group = {
          created: !!g && tabs.get(t1).groupId === g.id,
          contiguous: i2 === i1 + 1,
          meta: tabGroups.get(g.id).name === "探针组" && tabGroups.get(g.id).color === "pink" && tabGroups.get(g.id).collapsed === true,
          newTabIn: tabs.get(nt) && tabs.get(nt).groupId === g.id && tabOrder.indexOf(nt) === i2 + 1,
          snapshot: !!(snap1.groups && snap1.groups.length === 1 && snap1.groups[0].name === "探针组"),
        };
        leaveGroup(t2);
        await sleep(150);
        out.group.leaveKeeps = tabGroups.has(g.id) && groupMembers(g.id).length === 2;
        leaveGroup(t1);
        leaveGroup(nt);
        await sleep(150);
        out.group.emptyDies = !tabGroups.has(g.id);
        const g2 = newGroupFor(t2);
        ungroupAll(g2.id);
        await sleep(150);
        out.group.ungroup = !tabGroups.has(g2.id) && tabs.get(t2).groupId == null;
        const g3 = newGroupFor(t3);
        closeGroupTabs(g3.id);
        await sleep(250);
        out.group.closeAll = !tabs.has(t3) && !tabGroups.has(g3.id);
        closeTab(t2);
        closeTab(t1);
      } catch (e) { out.groupErr = String(e); }
      flush();

      /* 4c) Zen 批次：标签休眠（睡/醒/守卫/睡其它）、Glance 速览（开/几何/
         转正/关）、紧凑模式（vtabW 收成热区）、底部坞管线已拆（popup 无 pdock） */
      try {
        const s1 = createTab("https://www.luogu.com.cn/", { activate: false });
        const s2 = createTab("https://www.luogu.com.cn/problem/list", { activate: false });
        await sleep(300);
        const tS1 = tabs.get(s1);
        const tS2 = tabs.get(s2);
        out.zen = {};
        // 睡：视图卸载、标记落位
        out.zen.slept = sleepTab(s2) && tS2.sleeping === true && tS2.view === null;
        // 活动标签不睡
        setActiveTab(s1);
        out.zen.activeGuard = sleepTab(s1) === false;
        // 醒：点回休眠标签自动重挂视图
        setActiveTab(s2);
        await sleep(250);
        out.zen.woke = tS2.sleeping === false && !!tS2.view;
        // 钉住不睡（s1 此刻非活动）
        tS1.pinned = true;
        out.zen.pinnedGuard = sleepTab(s1) === false;
        tS1.pinned = false;
        // 睡其它：只剩活动的醒着
        const sleptN = sleepOtherTabs(s2);
        out.zen.sleepOthers = sleptN >= 1 && tabs.get(s1).sleeping === true && tabs.get(s2).sleeping !== true;
        // 快照带 sleeping 标记
        const snapZ = tabsSnapshot();
        out.zen.snapshot = snapZ.tabs.some((x) => x.id === s1 && x.sleeping === true);
        // Glance：开卡片 → 几何居中在窗口内；关 → 视图收掉
        const gOk = openGlance("https://www.luogu.com.cn/problem/P1001");
        const gr = glanceView ? glanceView.getBounds() : null;
        const [gw2, gh2] = mainWin.getContentSize();
        out.zen.glanceOpen = !!(gOk && glanceView && gr && gr.width > gw2 * 0.5 && gr.x > 0 && gr.y > 0 && gr.x + gr.width <= gw2 && gr.y + gr.height <= gh2);
        closeGlance();
        out.zen.glanceClose = glanceView === null;
        // 休眠标签关标签不炸（view=null 的守卫）
        closeTab(s1);
        closeTab(s2);
        // 紧凑模式：vtabW 收成 4px 热区
        const oldCompact = cfg.vtabCompact;
        cfg.vtabCompact = true;
        out.zen.compact = vtabW() === VTAB_EDGE;
        cfg.vtabCompact = !!oldCompact;
        // 底部坞管线已拆：popup.html 不再有 pdock
        try {
          const popupHtml = fs.readFileSync(path.join(__dirname, "src", "popup", "popup.html"), "utf8");
          out.zen.dockGone = !popupHtml.includes("pdock");
        } catch (e) { out.zen.dockGone = false; }
        /* 底部坞回归（v3.5.7）：垂直模式下页面区底部让出坞条——
           坞里的图标画在外壳层（真玻璃），页面不再垫到窗口最底 */
        try {
          const wasV = cfg.verticalTabs;
          const wasItems = cfg.dockItems;
          cfg.verticalTabs = true;
          cfg.dockItems = [{ icon: "home", href: "@home" }];
          const insD = inset();
          const [wD, hD] = mainWin.getContentSize();
          const probeTab = createTab("https://www.luogu.com.cn/", { activate: true });
          layout();
          await sleep(150);
          const pb = tabs.get(probeTab).view.getBounds();
          /* R36：坞改成悬浮覆盖视图，页面不再为它让位——页面底边直达窗口底 */
          out.zen.dockStrip = insD.footer === 0 && Math.abs(pb.y + pb.height - hD) <= 2;
          closeTab(probeTab);
          cfg.dockItems = wasItems;
          cfg.verticalTabs = wasV;
          layout();
        } catch (e) { out.zen.dockStrip = false; out.zen.dockStripErr = String(e); }
      } catch (e) { out.zenErr = String(e); }
      flush();

      /* 5) 自定义快捷键：覆盖/解绑/重置 + 合成表下发到外壳 */
      try {
        const rows0 = shortcutRows();
        cfg.shortcuts = { "new-tab": "CmdOrCtrl+Shift+N" };
        const over = accelFor("new-tab");
        const r1 = shortcutRows().find((r) => r.id === "new-tab");
        cfg.shortcuts = { "new-tab": "" };
        const unbound = accelFor("new-tab");
        cfg.shortcuts = {};
        const back = accelFor("new-tab");
        installAccelerators();
        pushConfigToChrome();
        await sleep(500);
        out.shortcuts = {
          rows: rows0.length,
          override: over === "CmdOrCtrl+Shift+N" && r1.overridden === true,
          unbind: unbound === "",
          restored: back === "CmdOrCtrl+T",
        };
        out.shortcutRowsShell = await mainWin.webContents.executeJavaScript(
          `(function(){
             var r = (typeof cfgState !== "undefined" && cfgState.shortcutRows) || [];
             var n = r.find(function (x) { return x.id === "new-tab"; });
             return { total: r.length, newTab: n ? n.text : null };
           })()`,
          true
        );
      } catch (e) { out.shortcutErr = String(e); }
      flush();

      /* 6) 垂直栏折叠持久化：默认收缩（rail=46），展开 212 */
      try {
        const prevVt = cfg.verticalTabs;
        cfg.verticalTabs = true;
        cfg.vtabCollapsed = true; // 姿态显式设：profile 会继承用户当前配置（可能常驻展开）
        const defCollapsed = cfg.vtabCollapsed !== false;
        const w0 = inset().x;
        cfg.vtabCollapsed = false;
        const w1 = inset().x;
        cfg.vtabCollapsed = true;
        const w2 = inset().x;
        cfg.verticalTabs = prevVt;
        out.vtab = { defCollapsed, rail: w0, expanded: w1, back: w2, pass: w0 === 46 && w1 === 212 && w2 === 46 };
      } catch (e) { out.vtabErr = String(e); }
      flush();

      /* 7) 壁纸列表即去重：同内容两份只留一份，不同内容保留 */
      try {
        const dir = wallpapersDir();
        fs.mkdirSync(dir, { recursive: true });
        const f1 = path.join(dir, "v35-dup-a.png");
        const f2 = path.join(dir, "v35-dup-b.png");
        const f3 = path.join(dir, "v35-unique.png");
        fs.writeFileSync(f1, Buffer.from("v35-dupe-content"));
        fs.writeFileSync(f2, Buffer.from("v35-dupe-content"));
        fs.writeFileSync(f3, Buffer.from("v35-unique-content"));
        md5Cache.clear();
        const wl = await invokeFor("lg-wall:list");
        const names = (wl && wl.items ? wl.items : []).map((x) => x.name);
        out.wallDedupe = {
          dupLeft: names.filter((n) => n.includes("v35-dup")).length,
          uniqKept: names.includes("v35-unique.png"),
        };
        for (const f of [f1, f2, f3]) {
          try { fs.unlinkSync(f); } catch {}
        }
        md5Cache.clear();
        await invokeFor("lg-wall:dedupe");
        reconcileWallpaper();
        saveConfig();
      } catch (e) { out.wallErr = String(e); }
      flush();

      /* 8) 快道标记：inject 含直出+兜底、ext.css 侧栏玻璃令牌、字节缓存命中 */
      try {
        const p = path.join(wallpapersDir(), "v35-cache.png");
        fs.writeFileSync(p, Buffer.from("v35-cache-content"));
        cfg.wallpaper = p;
        const r1 = wallpaperPayload("image");
        const r2 = wallpaperPayload("image");
        out.fastPath = {
          injectHasFallback: INJECT_JS.includes("applyWallpaperImageIpc"),
          extSidebarGlass: EXT_CSS.includes("--dsw-specific-sidebar-fill: var(--lg-glass-soft)"),
          byteCacheHit: r1 === r2 && !!(r1 && r1.ok),
        };
        cfg.wallpaper = "";
        try { fs.unlinkSync(p); } catch {}
      } catch (e) { out.fastErr = String(e); }
      flush();

      /* 9) 标签操作菜单：DOM 在、渲染出条目与分组头 */
      try {
        out.tabMore = await mainWin.webContents.executeJavaScript(
          `(function(){
             var m = document.getElementById("tabmore-menu");
             if (!m) return { exists: false };
             if (typeof renderTabMoreMenu !== "function") return { exists: true, noRender: true };
             renderTabMoreMenu();
             return { exists: true, items: m.querySelectorAll(".tm-item").length, heads: m.querySelectorAll(".am-head").length };
           })()`,
          true
        );
      } catch (e) { out.tabMoreErr = String(e); }
      flush();

      /* 10) 右键菜单含分屏项（v35test 下 handler 回结构不弹真菜单） */
      try {
        const menu = await invokeFor("tab:context-menu", tabOrder[0]);
        out.splitMenu = menu && menu.items ? menu.items.some((l) => String(l).includes("分屏")) : menu;
      } catch (e) { out.splitMenuErr = String(e); }
      flush();

      try {
        const img = await tabs.get(activeTabId).view.webContents.capturePage();
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, ""), img.toPNG());
      } catch {}
    } else if (argv.includes("--lg-v36test")) {
      /* v3.6.0 批①：垂直标签栏四修 + 矩形弹层。
         1) 几何单一来源：紧凑 / 窄条 / 展开三姿态下 #top/#dock 的 left 必须
            等于主进程 inset().x（同一份 --vtab-cur，修紧凑模式 42px 空档）；
         2) 姿态记忆：紧凑是独立轴（开关不吞钉住态），钉住动作关紧凑并展开；
         3) 拖拽 move 语义：钉住前缀钳制（非钉住插不进去、钉住跑不出来）；
         4) 悬停浮层矩形定位：弹层视图=面板矩形、面板左缘=窄条右缘（不再盖住
            窄条）、行带 data-pop 与 data-tab-id（右键/中键回主进程）。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(900);

      const savedVt = { verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact };
      const setVt = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(400);
      };
      const shellGeo = async () =>
        JSON.parse(
          await mainWin.webContents.executeJavaScript(
            `(function(){var t=document.getElementById("top"),d=document.getElementById("dock");var cur=getComputedStyle(document.documentElement).getPropertyValue("--vtab-cur").trim();return JSON.stringify({cur:cur,topLeft:Math.round(parseFloat(getComputedStyle(t).left)),dockSrcHidden:!d||getComputedStyle(d).display==="none",rail:document.body.classList.contains("rail"),compact:document.body.classList.contains("compact"),layout:document.body.dataset.layout})})()`,
            true
          )
        );

      const shot = async (wc, suffix) => {
        try {
          const img = await wc.capturePage();
          fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v36-" + suffix + ".png", img.toPNG());
        } catch (e) { out["shot_" + suffix + "Err"] = String(e); }
      };
      /* 1) 三姿态几何一致性（页面让位 = 顶栏让位 = 底坞让位） */
      out.geometry = {};
      await setVt({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false });
      out.geometry.rail = { ...(await shellGeo()), insetX: inset().x };
      await shot(mainWin.webContents, "rail");
      await setVt({ vtabCollapsed: false });
      out.geometry.expanded = { ...(await shellGeo()), insetX: inset().x };
      await shot(mainWin.webContents, "expanded");
      await setVt({ vtabCompact: true });
      out.geometry.compact = { ...(await shellGeo()), insetX: inset().x };
      await shot(mainWin.webContents, "compact");
      out.geometryPass = ["rail", "expanded", "compact"].every((k) => {
        const g = out.geometry[k] || {};
        /* R36：坞迁到独立覆盖视图——外壳里的 #dock 只是渲染源（恒隐），
           坞视图的落位由 v39test 断言；这里只要求顶栏与 --vtab-cur 同源 */
        return g.topLeft === g.insetX && g.dockSrcHidden === true && g.cur === g.insetX + "px";
      });
      flush();

      /* 2) 姿态记忆：紧凑开关不吃钉住态；钉住从窄条/展开/紧凑三种起点都到展开 */
      await setVt({ vtabCollapsed: false, vtabCompact: true });
      out.memory = { keptExpandedWhileCompact: cfg.vtabCollapsed === false, compactInsetX: inset().x };
      await setVt({ vtabCompact: false });
      out.memory.restoredInsetX = inset().x;
      await setVt({ vtabCollapsed: true, vtabCompact: false });
      out.memory.pinFromRail = { ret: toggleVtabPin(), insetX: inset().x };
      out.memory.pinFromExpanded = { ret: toggleVtabPin(), insetX: inset().x };
      await setVt({ vtabCompact: true });
      out.memory.pinFromCompact = { ret: toggleVtabPin(), insetX: inset().x, compact: !!cfg.vtabCompact };
      out.memoryPass =
        out.memory.keptExpandedWhileCompact &&
        out.memory.compactInsetX === VTAB_EDGE &&
        out.memory.restoredInsetX === VTAB_W &&
        out.memory.pinFromRail.insetX === VTAB_W &&
        out.memory.pinFromExpanded.insetX === VTAB_RAIL &&
        out.memory.pinFromCompact.insetX === VTAB_W &&
        out.memory.pinFromCompact.compact === false;
      flush();

      /* 3) 拖拽 move 语义：钉住前缀钳制（旧实现会把钉住/折叠组甩到末尾） */
      const t1 = createHomeTab();
      const t2 = createHomeTab();
      const t3 = createHomeTab();
      const t4 = createHomeTab();
      await sleep(500);
      setTabPinned(tabs.get(t1), true);
      setTabPinned(tabs.get(t2), true);
      // 人为打散：把非钉住的 t3 塞进钉住区（模拟老存档/历史路径的散乱顺序）
      tabOrder = tabOrder.filter((x) => x !== t3);
      tabOrder.splice(1, 0, t3);
      const posOf = (id) => tabOrder.indexOf(id);
      const pinnedCountNow = () => tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned).length;
      const a = moveTabInOrder(t3, t1); // 非钉住拖到最前（钉住之前）→ 钳到钉住区后
      const aIdx = posOf(t3), aPins = pinnedCountNow();
      const b = moveTabInOrder(t1, null); // 钉住拖到末尾 → 仍留在钉住前缀
      const bIdx = posOf(t1), bPins = pinnedCountNow();
      moveTabInOrder(t4, null); // 普通标签拖到末尾
      out.reorder = {
        a: { ok: a.ok, idx: aIdx, pinnedCount: aPins, order: a.order },
        b: { ok: b.ok, idx: bIdx, pinnedCount: bPins },
        c: { last: tabOrder[tabOrder.length - 1] === t4 },
        allPinnedInPrefix: tabOrder.slice(0, pinnedCountNow()).every((x) => tabs.get(x) && tabs.get(x).pinned),
      };
      out.reorderPass =
        aIdx >= aPins && bIdx < bPins && out.reorder.c.last && out.reorder.allPinnedInPrefix;
      flush();

      /* 4) 悬停浮层：矩形弹层（面板从窗口左缘铺满展开宽度、盖住窄条 = Edge
            的整条展开；视图=面板矩形；行与外壳侧栏逐像素同构 → y 对齐） */
      try {
      await setVt({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false });
      await mainWin.webContents.executeJavaScript('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))', true);
      /* 浮层开着时主进程的光标裁判也在跑（探针里真实光标不在窗口上，200ms 后
         会收回）——这里轮询到"尺寸已落定"就立刻快照并停掉裁判，再从容读文档。 */
      let fitSnap = null;
      let pbSnap = null;
      for (let i = 0; i < 80; i++) {
        await sleep(30);
        if (popupFit && popupFit.contentH > 1) {
          fitSnap = { ...popupFit };
          pbSnap = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
          break;
        }
      }
      stopFlyoutWatch();
      /* 首开动画 130ms：等它落定再读面板宽度——落定后必须回到完整展开宽度
         （46 只是动画的起始帧，不是最终态） */
      await sleep(220);
      if (popupView && !popupView.webContents.isDestroyed()) await shot(popupView.webContents, "flyout");
      const pop = popupView;
      const fit = fitSnap;
      const pb = pbSnap;
      const popDoc =
        pop && !pop.webContents.isDestroyed()
          ? JSON.parse(
              await pop.webContents.executeJavaScript(
                `(function(){var f=document.getElementById("tab-flyout");if(!f)return "null";var r=f.getBoundingClientRect();var rows=f.querySelectorAll(".vtab[data-id]");var withId=0,withPop=0,ys=[];for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-tab-id"))withId++;if(rows[i].getAttribute("data-pop"))withPop++;var q=rows[i].getBoundingClientRect();ys.push({id:rows[i].getAttribute("data-id"),y:Math.round((q.top+q.height/2)*10)/10,h:Math.round(q.height*10)/10});}return JSON.stringify({left:Math.round(r.left),top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),rows:rows.length,withId:withId,withPop:withPop,groups:f.querySelectorAll(".vgroup").length,heads:f.querySelectorAll(".vghead").length,headBtns:f.querySelectorAll("#vtab-head .icon-btn").length,footBtns:f.querySelectorAll("#vtab-new,#vtab-set").length,ys:ys})})()`,
                true
              )
            )
          : null;
      /* 逐行 y 对齐：同一个标签在外壳窄条里和浮层里的行中心 y 必须一致——
         悬停展开是"横向加宽、不重排"的结构性保证，也是"鼠标贴哪行点下去
         还是哪行"的依据。 */
      const shellRows = JSON.parse(
        await mainWin.webContents.executeJavaScript(
          `(function(){var o=[];var ls=document.querySelectorAll("#vtab .vtab[data-id]");for(var i=0;i<ls.length;i++){var r=ls[i].getBoundingClientRect();o.push({id:ls[i].getAttribute("data-id"),y:Math.round((r.top+r.height/2)*10)/10,h:Math.round(r.height*10)/10});}return JSON.stringify(o)})()`,
          true
        )
      );
      const rowBase = fit ? fit.originY - fit.pad.t : 0; // 弹层视图原点在窗口里的 y
      let maxDy = 0, maxDh = 0, paired = 0;
      for (const a of shellRows) {
        const b = popDoc && popDoc.ys ? popDoc.ys.find((x) => x.id === a.id) : null;
        if (!b) continue;
        paired++;
        maxDy = Math.max(maxDy, Math.abs(a.y - (b.y + rowBase)));
        maxDh = Math.max(maxDh, Math.abs(a.h - b.h));
      }
      const winH = mainWin.getContentSize()[1];
      out.flyout = { shown: popupShown, fit, viewBounds: pb, doc: popDoc, winH, tabs: tabs.size, insetX: inset().x, shellRows: shellRows.length, rowAlign: { paired, maxDy, maxDh } };
      out.flyoutPass = !!(
        popupShown &&
        fit &&
        popDoc &&
        fit.pad.l === 0 &&
        fit.pad.t === 0 &&
        fit.originX === 0 && // 面板从窗口左缘起（盖住窄条 = Edge 的整条展开）
        fit.originY === 0 &&
        fit.contentW === vtabExpandedW() &&
        pb &&
        pb.x === fit.originX &&
        pb.width === fit.contentW + fit.pad.l + fit.pad.r &&
        pb.height === fit.contentH + fit.pad.t + fit.pad.b &&
        popDoc.left === 0 &&
        popDoc.top === 0 &&
        popDoc.w === vtabExpandedW() && // 动画落定后回到完整展开宽度
        popDoc.rows === tabs.size &&
        popDoc.withId === popDoc.rows &&
        popDoc.withPop === popDoc.rows &&
        popDoc.headBtns === 2 && // ⌄ 标签页操作 + 箭头（浮层盖住窄条，按钮必须在浮层里）
        popDoc.footBtns === 2 && // 底部 + / 设置 同理
        paired === shellRows.length &&
        paired > 0 &&
        maxDy <= 1.5 && // 逐行 y 对齐（不重排）
        maxDh <= 1.5 &&
        fit.contentH === winH && // v3.7.1 整条模式：悬停浮层 = 常驻展开那条（整窗高）
        fit.pad.r === 0 && fit.pad.b === 0 // v3.7.1：视图与面板严丝合缝（无透明死区）
      );
      // 收尾：关浮层、恢复姿态
      try { await mainWin.webContents.executeJavaScript("window.lgChrome.popupHide()", true); } catch {}
      await sleep(250);

      /* 5) 现有菜单（全窗模式）不受矩形改动影响：打开标签页操作菜单，弹层
         仍铺满窗口、条目已渲染（点空白即关的旧行为不变） */
      await mainWin.webContents.executeJavaScript(
        `(function(){ var b=document.getElementById("tabs-more"); if(!b) return "no-btn"; b.click(); return "ok"; })()`,
        true
      );
      await sleep(1000);
      const menuDoc =
        popupView && !popupView.webContents.isDestroyed()
          ? JSON.parse(
              await popupView.webContents.executeJavaScript(
                `(function(){var root=document.getElementById("pop-root");return JSON.stringify({hasContent:!!(root&&root.firstElementChild),items:document.querySelectorAll("#pop-root .am-item").length})})()`,
                true
              )
            )
          : null;
      const mb = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
      const winSize = mainWin.getContentSize();
      out.menu = { bounds: mb, win: winSize, doc: menuDoc };
      out.menuPass = !!(mb && mb.x === 0 && mb.y === 0 && mb.width === winSize[0] && mb.height === winSize[1] && menuDoc && menuDoc.hasContent && menuDoc.items > 0);
      try { await mainWin.webContents.executeJavaScript("window.lgChrome.popupHide()", true); } catch {}
      await sleep(250);

      /* 6) 工作区已删除：preload 桥没了、cfg 里没有 workspaces（旧配置由
         版本迁移 v6→v7 清掉，且已落盘）；菜单里也没有「管理工作区」入口 */
      const wsApi = JSON.parse(
        await mainWin.webContents.executeJavaScript(
          'JSON.stringify({list: typeof window.lgChrome.wsList, save: typeof window.lgChrome.wsSave, open: typeof window.lgChrome.wsOpen, del: typeof window.lgChrome.wsDelete})',
          true
        )
      );
      let diskHasWs = null;
      try {
        const rawCfg = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        diskHasWs = Object.prototype.hasOwnProperty.call(rawCfg, "workspaces");
      } catch (e) { diskHasWs = "err:" + String(e); }
      const menuHasWs = await mainWin.webContents.executeJavaScript(
        `(function(){renderTabMoreMenu();var m=document.getElementById("tabmore-menu");return String(m.textContent||"").indexOf("工作区")>=0})()`,
        true
      ).catch(() => null);
      out.workspaces = { api: wsApi, cfgHasKey: Object.prototype.hasOwnProperty.call(cfg, "workspaces"), diskHasKey: diskHasWs, menuHasWs, version: cfg.configVersion };
      out.workspacesPass = !!(
        wsApi.list === "undefined" && wsApi.save === "undefined" && wsApi.open === "undefined" && wsApi.del === "undefined" &&
        !out.workspaces.cfgHasKey && diskHasWs === false && menuHasWs === false && cfg.configVersion === 7
      );

      /* 7) 整理标签页：分区排序保分组 / 去重（归一化 + 策略 + 分屏保护）/
         撤销 / 按域名自动建组。全部用 .invalid 域名（不会真联网）。 */
      try {
        const mk = (u) => createTab(u, { activate: false });
        const A1 = mk("https://lg-t1.invalid/page/1");
        const A2 = mk("https://www.lg-t1.invalid/page/1/"); // 归一化后与 A1 同键
        const A3 = mk("https://lg-t1.invalid/page/1#sec"); // #hash 忽略 → 同键
        const B1 = mk("https://lg-t2.invalid/x");
        const B1d = mk("https://lg-t2.invalid/x"); // 与 B1 同键，但 B1 在分屏里
        const B2 = mk("https://lg-t2.invalid/y");
        const C1 = mk("https://lg-t3.invalid/");
        await sleep(600);
        setTabPinned(tabs.get(A2), true); // 钉住的重复项不参与去重
        splitWith(B1, C1); // B1/C1 进分屏（去重时受保护）
        const gid0 = newGroupFor(B1); // B1+C1 一个既有分组（自动建组不许碰）
        if (gid0) joinGroup(C1, gid0.id);
        // 造一个确定的顺序：钉住前缀 → 未分组 → 组块 → 未分组段
        normalizePinnedOrder();
        const rest0 = [B2, C1, B1, A3, A1];
        tabOrder = tabOrder.filter((x) => !rest0.includes(x)).concat(rest0);
        normalizePinnedOrder();
        const gidBefore = gid0 ? gid0.id : null;
        const colorBefore = gidBefore != null ? (tabGroups.get(gidBefore) || {}).color : null;
        const orderBeforeSort = tabOrder.slice();

        // 7a) 按站点排序：钉住前缀不动、组块连续且组内排序、未分组段内排序
        const rs = runOrganize("sort-domain");
        const pos = (id) => tabOrder.indexOf(id);
        const groupIdsNow = tabOrder.filter((x) => { const t = tabs.get(x); return t && t.groupId === gidBefore; });
        const contig = (() => {
          if (groupIdsNow.length < 2) return true;
          const idxs = groupIdsNow.map(pos).sort((a, b) => a - b);
          return idxs[idxs.length - 1] - idxs[0] === idxs.length - 1;
        })();
        const pinnedCount = tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned).length;
        out.organize = {
          sort: {
            ok: rs.ok,
            changed: rs.changed,
            pinnedPrefix: tabOrder.slice(0, pinnedCount).every((x) => tabs.get(x) && tabs.get(x).pinned),
            groupContiguous: contig,
            groupSortedInside: groupIdsNow.length === 2 ? pos(B1) < pos(C1) : false, // lg-t2 < lg-t3
            ungroupedSorted: pos(A1) < pos(A3),
            order: tabOrder.slice(),
          },
        };
        // 7b) 去重：保留策略 active（A3 是激活页）→ 关 A1；A2 钉住不动；
        //     B 组只剩一个可分屏外成员 → 跳过并计数
        setActiveTab(A3);
        await sleep(300);
        const beforeDedupe = tabOrder.slice();
        // 顺序快照要趁 id 都还在时算成 URL 序列：被关掉的标签撤销后是新 id
        const urlsOf = (arr) => arr.map((x) => (tabs.get(x) || {}).url || "");
        const urlSeqBefore = urlsOf(beforeDedupe);
        const rd = runOrganize("close-duplicates");
        const alive = (id) => tabs.has(id);
        out.organize.dedupe = {
          closed: rd.closed,
          skipped: rd.skipped,
          canUndo: rd.canUndo,
          A1gone: !alive(A1),
          A2pinnedAlive: alive(A2),
          A3activeAlive: alive(A3),
          splitKept: alive(B1) && alive(B1d),
        };
        out.organize.dedupePass =
          rd.ok && rd.closed === 1 && rd.skipped === 1 && !alive(A1) && alive(A2) && alive(A3) && alive(B1) && alive(B1d);
        // 7c) 撤销：A1 回来、顺序与去重前一致（重建的标签是新 id，按 URL 序列比）
        const ru2 = undoOrganize();
        const urlSeqNow = urlsOf(tabOrder);
        const sameOrder = urlSeqNow.length === urlSeqBefore.length && urlSeqNow.every((u, i) => u === urlSeqBefore[i]);
        const a1Url = "https://lg-t1.invalid/page/1";
        const a1back = tabOrder.some((x) => { const t = tabs.get(x); return t && t.url === a1Url && x !== A3; });
        out.organize.undo = { ok: ru2.ok, restored: ru2.restored, a1back, orderSame: sameOrder, seqBefore: urlSeqBefore, seqNow: urlSeqNow, mismatch: urlSeqNow.map((u, i) => (u === urlSeqBefore[i] ? null : i)).filter((x) => x != null) };
        out.organize.undoPass = !!(ru2.ok && a1back && sameOrder);
        // 7d) 按域名自动建组：lg-t1(A1,A3) 与 lg-t2(B1d,B2) 各成一块；既有组不动
        const rg = runOrganize("group-by-domain");
        const gids = rg.autoGroups || [];
        const gname = (gid) => (tabGroups.get(gid) || {}).name;
        const members = (gid) => tabOrder.filter((x) => { const t = tabs.get(x); return t && t.groupId === gid; });
        const contiguous = (gid) => {
          const ids = members(gid).map(pos).sort((a, b) => a - b);
          return ids.length > 1 && ids[ids.length - 1] - ids[0] === ids.length - 1;
        };
        const hostGroups = gids.map((gid) => ({ gid, name: gname(gid), n: members(gid).length, contig: contiguous(gid), color: (tabGroups.get(gid) || {}).color }));
        out.organize.autoGroup = {
          groups: rg.groups,
          hostGroups,
          existingGroupUntouched: gidBefore == null ? null : (tabGroups.has(gidBefore) && (tabGroups.get(gidBefore) || {}).color === colorBefore && members(gidBefore).length === 2),
          colorsDistinct: new Set(hostGroups.map((h) => h.color)).size === hostGroups.length,
        };
        out.organize.autoGroupPass = !!(
          rg.ok && hostGroups.length === 2 &&
          hostGroups.every((h) => h.contig && h.n === 2) &&
          out.organize.autoGroup.colorsDistinct && out.organize.autoGroup.existingGroupUntouched
        );
        // 7e) 再撤销：自动建的组拆掉、归属还原
        const ru3 = undoOrganize();
        out.organize.undoAuto = { ok: ru3.ok, groupsGone: gids.every((gid) => !tabGroups.has(gid)) };
        out.organize.undoAutoPass = !!(ru3.ok && out.organize.undoAuto.groupsGone);
        // 收尾：清掉本段造的标签与分屏
        try { unsplit(B1); } catch {}
        for (const id of [A1, A2, A3, B1, B1d, B2, C1]) { try { if (tabs.has(id)) closeTab(id); } catch {} }
        await sleep(300);
        out.organizePass = !!(
          out.organize.sort.ok && out.organize.sort.pinnedPrefix && out.organize.sort.groupContiguous &&
          out.organize.sort.groupSortedInside && out.organize.sort.ungroupedSorted &&
          out.organize.dedupePass && out.organize.undoPass && out.organize.autoGroupPass && out.organize.undoAutoPass
        );
      } catch (e) { out.organizeErr = String((e && e.stack) || e); out.organizePass = false; }
      flush();

      /* 8) 整理 toast（矩形弹层 + 撤销按钮，端到端）：外壳发起整理 → 提示面板
         出现在底部居中 → 点「撤销」把标签要回来 */
      try {
        const t1 = createTab("https://lg-toast.invalid/dup", { activate: false });
        const t2 = createTab("https://lg-toast.invalid/dup", { activate: false });
        await sleep(500);
        await mainWin.webContents.executeJavaScript('runOrganizeUi("close-duplicates")', true);
        await sleep(1000);
        const toastFit = popupFit ? { ...popupFit } : null;
        const toastDoc =
          popupView && !popupView.webContents.isDestroyed()
            ? JSON.parse(
                await popupView.webContents.executeJavaScript(
                  `(function(){var t=document.getElementById("lg-toast");if(!t)return "null";var r=t.getBoundingClientRect();return JSON.stringify({msg:(t.querySelector(".tst-msg")||{}).textContent||"",hasUndo:!!t.querySelector(".tst-btn"),hasClose:!!t.querySelector(".tst-x"),w:Math.round(r.width),h:Math.round(r.height)})})()`,
                  true
                )
              )
            : null;
        const undoClicked = popupView && !popupView.webContents.isDestroyed()
          ? await popupView.webContents.executeJavaScript(
              `(function(){var b=document.querySelector("#lg-toast .tst-btn");if(!b)return false;b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));return true})()`,
              true
            ).catch(() => false)
          : false;
        await sleep(900);
        const backCount = [...tabs.values()].filter((t) => t.url === "https://lg-toast.invalid/dup").length;
        out.toast = { fit: toastFit, doc: toastDoc, undoClicked, backCount, closedOne: !tabs.has(t2), t1Alive: tabs.has(t1) };
        out.toastPass = !!(
          toastFit && toastFit.center && toastFit.bottom && toastFit.pad && toastDoc &&
          toastDoc.hasClose && toastDoc.hasUndo && toastDoc.w > 100 && undoClicked === true && backCount === 2 &&
          /关闭/.test(toastDoc.msg)
        );
        for (const t of [...tabs.values()]) {
          if (t.url === "https://lg-toast.invalid/dup") { try { closeTab(t.id); } catch {} }
        }
        try { await mainWin.webContents.executeJavaScript("window.lgChrome.popupHide()", true); } catch {}
        await sleep(250);
      } catch (e) { out.toastErr = String((e && e.stack) || e); out.toastPass = false; }
      flush();

      /* 9) 停止加载 + 搜索引擎（唯一来源）：模板解析、地址栏回退类型、
         首页搜索框吃同一份模板、停止键存在 */
      try {
        const tmplOf = (id, custom) => {
          const oldE = cfg.searchEngine, oldC = cfg.searchCustom;
          cfg.searchEngine = id; cfg.searchCustom = custom || "";
          const t = searchTemplate();
          cfg.searchEngine = oldE; cfg.searchCustom = oldC;
          return t;
        };
        const engines = {
          luogu: tmplOf("luogu"), bing: tmplOf("bing"), baidu: tmplOf("baidu"),
          google: tmplOf("google"), ddg: tmplOf("ddg"),
          custom: tmplOf("custom", "https://s.example.com/?q=%s"),
          badCustom: tmplOf("custom", "https://s.example.com/?q="), // 无 %s → 退回洛谷
        };
        const shellResolve = JSON.parse(
          await mainWin.webContents.executeJavaScript(
            `JSON.stringify({bing: resolveOmnibox("hello world", {}, "https://www.bing.com/search?q=%s", false), luogu: resolveOmnibox("hello world", {}, "https://www.luogu.com.cn/search?keyword=%s", true), id: resolveOmnibox("P1001", {}, "https://www.bing.com/search?q=%s", false)})`,
            true
          )
        );
        cfg.searchEngine = "bing";
        pushConfigToChrome();
        applyConfigToPages();
        await sleep(700);
        const homeTab2 = [...tabs.values()].find((t) => t.kind === "home" && t.view && !t.view.webContents.isDestroyed());
        const homeSearch = homeTab2
          ? await homeTab2.view.webContents
              .executeJavaScript('window.__lgGlass && window.__lgGlass.searchUrl ? window.__lgGlass.searchUrl("测试") : null', true)
              .catch(() => null)
          : null;
        cfg.searchEngine = "luogu";
        pushConfigToChrome();
        applyConfigToPages();
        await sleep(300);
        const stopApi = JSON.parse(
          await mainWin.webContents.executeJavaScript(
            'JSON.stringify({stop: typeof window.lgChrome.stop, btn: !!document.getElementById("btn-stop"), navSuggest: typeof window.lgChrome.navSuggest})',
            true
          )
        );
        out.nav = { engines, shellResolve, homeSearch, stopApi };
        out.navPass = !!(
          engines.luogu.includes("luogu.com.cn") && engines.bing.includes("bing.com") && engines.baidu.includes("baidu.com") &&
          engines.google.includes("google.com") && engines.ddg.includes("duckduckgo.com") &&
          engines.custom.includes("s.example.com") && engines.badCustom.includes("luogu.com.cn") &&
          shellResolve.bing.type === "external" && shellResolve.luogu.type === "luogu" && shellResolve.id.type === "luogu" &&
          homeSearch && homeSearch.includes("bing.com") &&
          stopApi.stop === "function" && stopApi.btn === true && stopApi.navSuggest === "function"
        );
      } catch (e) { out.navErr = String((e && e.stack) || e); out.navPass = false; }
      flush();

      /* 10) 地址栏联想：矩形下拉、行含"打开的标签 + 搜索"、↓ 换选中 */
      try {
        const sugTab = createTab("https://lg-sug.invalid/abc", { activate: false });
        await sleep(400);
        await mainWin.webContents.executeJavaScript(
          `(function(){var i=document.getElementById("omni-input");i.focus();i.value="lg-sug";i.dispatchEvent(new Event("input"));return 1})()`,
          true
        );
        await sleep(800);
        const sug = popupFit ? { ...popupFit } : null;
        const sugDoc =
          popupView && !popupView.webContents.isDestroyed()
            ? JSON.parse(
                await popupView.webContents.executeJavaScript(
                  `(function(){var s=document.getElementById("omni-sug");if(!s)return "null";var rows=s.querySelectorAll(".sug-row");var labels=[];var withPop=0,on=-1;for(var i=0;i<rows.length;i++){labels.push(((rows[i].querySelector(".sug-label")||{}).textContent||"").slice(0,40));if(rows[i].getAttribute("data-pop"))withPop++;if(rows[i].classList.contains("on"))on=i;}return JSON.stringify({rows:rows.length,labels:labels,withPop:withPop,on:on})})()`,
                  true
                )
              )
            : null;
        await mainWin.webContents.executeJavaScript(
          `(function(){var i=document.getElementById("omni-input");i.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));return 1})()`,
          true
        );
        await sleep(500);
        const sugDoc2 =
          popupView && !popupView.webContents.isDestroyed()
            ? JSON.parse(
                await popupView.webContents.executeJavaScript(
                  `(function(){var s=document.getElementById("omni-sug");if(!s)return "null";var rows=s.querySelectorAll(".sug-row");var on=-1;for(var i=0;i<rows.length;i++)if(rows[i].classList.contains("on"))on=i;return JSON.stringify({on:on,rows:rows.length})})()`,
                  true
                )
              )
            : null;
        out.suggest = { fit: sug, doc: sugDoc, afterDown: sugDoc2 };
        out.suggestPass = !!(
          sug && sug.pad && sug.center === false && sugDoc &&
          sugDoc.rows >= 2 && sugDoc.withPop === sugDoc.rows &&
          /* R39 起默认不选中任何一行（回车按输入内容走），↓ 才从第一行开始 */
          sugDoc.on === -1 &&
          sugDoc.labels.some((s) => s.includes("搜索")) &&
          /* 首行 = 「打开 xxx」（URL 类输入的默认动作行） */
          sugDoc.labels[0] && sugDoc.labels[0].indexOf("打开 ") === 0 &&
          sugDoc2 && sugDoc2.on === 0 && sugDoc2.rows === sugDoc.rows
        );
        await mainWin.webContents.executeJavaScript(
          '(function(){var i=document.getElementById("omni-input");i.value="";closeSuggest();i.blur();return 1})()',
          true
        ).catch(() => {});
        await sleep(300);
        for (const t of [...tabs.values()]) {
          if (t.url === "https://lg-sug.invalid/abc") { try { closeTab(t.id); } catch {} }
        }
      } catch (e) { out.suggestErr = String((e && e.stack) || e); out.suggestPass = false; }
      flush();

      /* 11) 下载：本地 HTTP 服务（支持 Range）→ 暂停/继续/取消/重试/持久化 */
      let dlServer = null;
      let dlPort = 0;
      try {
        const http = require("http");
        const big = Buffer.alloc(1024 * 1024, 7);
        const smallBody = Buffer.from("hello-lg");
        const serveSlow = (res, start) => {
          res.writeHead(start > 0 ? 206 : 200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": big.length - start,
            "Accept-Ranges": "bytes",
            ...(start > 0 ? { "Content-Range": "bytes " + start + "-" + (big.length - 1) + "/" + big.length } : {}),
          });
          let off = start;
          const tick = () => {
            if (off >= big.length) { try { res.end(); } catch {} return; }
            const chunk = big.subarray(off, Math.min(off + 32768, big.length));
            off += chunk.length;
            try { res.write(chunk); } catch { return; }
            setTimeout(tick, 60); // 慢速：留出暂停/取消的窗口（约 2 秒）
          };
          tick();
        };
        dlServer = http.createServer((req, res) => {
          const u = req.url || "";
          if (u.startsWith("/big")) {
            const m = /bytes=(\d+)-/.exec(req.headers.range || "");
            serveSlow(res, m ? Number(m[1]) : 0);
            return;
          }
          if (u.startsWith("/trfail")) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("boom");
            return;
          }
          if (u.startsWith("/tr")) {
            // 假翻译端点：回显成《原文》（自定义 GET 模板 %s 占位）
            const q = decodeURIComponent((/q=([^&]*)/.exec(u) || ["", ""])[1]);
            const body = Buffer.from("《" + q + "》", "utf8");
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": body.length });
            res.end(body);
            return;
          }
          res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": smallBody.length });
          res.end(smallBody);
        });
        await new Promise((r) => dlServer.listen(0, "127.0.0.1", r));
        dlPort = dlServer.address().port;
        const dlUrl = "http://127.0.0.1:" + dlPort + "/big";
        const activeWc = (() => {
          const t = activeTabId != null ? tabs.get(activeTabId) : null;
          return t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : mainWin.webContents;
        })();
        const shellCall = (expr) => mainWin.webContents.executeJavaScript(expr, true);
        const findRec = (url, from) => downloads.slice(from).find((d) => d.url === url);

        // a) 暂停 → 继续 → 完成
        const d0 = downloads.length;
        activeWc.downloadURL(dlUrl);
        let rec = null;
        for (let i = 0; i < 40 && !rec; i++) { await sleep(100); rec = findRec(dlUrl, d0); }
        await sleep(200);
        const p1 = rec ? await shellCall(`window.lgChrome.downloadPause(${rec.id})`) : null;
        await sleep(300);
        const pausedState = rec ? rec.state : null;
        const p2 = rec ? await shellCall(`window.lgChrome.downloadResume(${rec.id})`) : null;
        let done = null;
        for (let i = 0; i < 80 && !done; i++) {
          await sleep(200);
          if (rec && (rec.state === "completed" || rec.state === "interrupted" || rec.state === "cancelled")) done = rec.state;
        }
        const fileOk = !!(rec && rec.savePath && fs.existsSync(rec.savePath) && fs.statSync(rec.savePath).size === big.length);
        out.download = {
          rec: rec ? { id: rec.id, state: rec.state, savePath: rec.savePath } : null,
          pause: p1, pausedState, resume: p2, done, fileOk, dir: downloadsDir(),
        };
        // b) 取消 → 重试 → 完成
        activeWc.downloadURL(dlUrl);
        let rec2 = null;
        for (let i = 0; i < 40 && !rec2; i++) {
          await sleep(100);
          rec2 = downloads.slice(d0).find((d) => d.url === dlUrl && d.id !== (rec && rec.id)) || null;
        }
        await sleep(300);
        const c1 = rec2 ? await shellCall(`window.lgChrome.downloadCancel(${rec2.id})`) : null;
        await sleep(400);
        const cancelledState = rec2 ? rec2.state : null;
        const r1 = rec2 ? await shellCall(`window.lgChrome.downloadRetry(${rec2.id})`) : null;
        let rec3 = null;
        for (let i = 0; i < 60 && !rec3; i++) { await sleep(150); rec3 = downloads.filter((d) => d.url === dlUrl && d.id !== rec.id && d.id !== rec2.id).slice(-1)[0] || null; }
        let done3 = null;
        for (let i = 0; i < 80 && !done3; i++) {
          await sleep(200);
          if (rec3 && (rec3.state === "completed" || rec3.state === "interrupted" || rec3.state === "cancelled")) done3 = rec3.state;
        }
        // c) 持久化：downloads.json 有记录；模拟重启（loadDownloads）把 progressing 标 interrupted
        const jsonOk = (() => { try { const r = JSON.parse(fs.readFileSync(downloadsPath(), "utf8")); return Array.isArray(r) && r.length >= 2; } catch { return false; } })();
        const keep = downloads.slice();
        try {
          fs.writeFileSync(downloadsPath(), JSON.stringify([...keep, { id: 9999, filename: "x.bin", url: "https://lg-x.invalid/x", savePath: "", state: "progressing", received: 1, total: 2, startedAt: Date.now() }], null, 1), "utf8");
          loadDownloads();
        } catch {}
        const interrupted = downloads.find((d) => d.id === 9999);
        downloads = keep;
        saveDownloads();
        out.download.retry = { cancel: c1, cancelledState, retry: r1, newRec: rec3 ? { id: rec3.id, state: rec3.state } : null, done3 };
        out.download.persist = { jsonOk, interrupted: interrupted ? interrupted.state : null };
        out.downloadPass = !!(
          p1 && p1.ok && pausedState === "paused" && p2 && p2.ok && done === "completed" && fileOk &&
          c1 && c1.ok && cancelledState === "cancelled" && r1 && r1.ok && rec3 && done3 === "completed" &&
          jsonOk && interrupted && interrupted.state === "interrupted" &&
          downloadsDir() === dlTestDir
        );
      } catch (e) { out.downloadErr = String((e && e.stack) || e); out.downloadPass = false; }
      flush();

      /* 12) 历史增强：单条删除 + 日期分组 + 过滤 */
      try {
        recordHistory("https://lg-h1.invalid/a", "历史测试 A");
        await sleep(1100);
        recordHistory("https://lg-h2.invalid/b", "历史测试 B");
        await sleep(1100);
        recordHistory("https://lg-h3.invalid/c", "历史测试 C");
        const beforeN = history.length;
        const removed = removeHistoryEntry("https://lg-h1.invalid/a");
        const afterN = history.length;
        const hid = openHistoryTab();
        await sleep(1600);
        const hwc = tabs.get(hid) && tabs.get(hid).view ? tabs.get(hid).view.webContents : null;
        const hInfo = hwc
          ? JSON.parse(await hwc.executeJavaScript(
              `(function(){return JSON.stringify({days:document.querySelectorAll(".h-day").length,dels:document.querySelectorAll(".h-del").length,rows:document.querySelectorAll(".h-row").length,first:((document.querySelector(".h-day")||{}).textContent||"")})})()`,
              true
            ))
          : null;
        if (hwc) {
          await hwc.executeJavaScript(`(function(){var q=document.getElementById("h-q");q.value="lg-h2";q.dispatchEvent(new Event("input"));return 1})()`, true);
          await sleep(600);
        }
        const hFiltered = hwc
          ? JSON.parse(await hwc.executeJavaScript(
              `(function(){var rows=document.querySelectorAll(".h-row");var txt="";for(var i=0;i<rows.length;i++)txt+=rows[i].textContent;return JSON.stringify({rows:rows.length,hasH2:txt.indexOf("lg-h2")>=0,hasH3:txt.indexOf("lg-h3")>=0})})()`,
              true
            ))
          : null;
        out.history = { beforeN, removed, afterN, page: hInfo, filtered: hFiltered };
        out.historyPass = !!(
          removed === 1 && afterN === beforeN - 1 && hInfo && hInfo.days >= 1 && hInfo.dels === hInfo.rows &&
          hFiltered && hFiltered.rows === 1 && hFiltered.hasH2 && !hFiltered.hasH3
        );
        if (hwc) await hwc.executeJavaScript(`(function(){var q=document.getElementById("h-q");q.value="";q.dispatchEvent(new Event("input"));return 1})()`, true).catch(() => {});
      } catch (e) { out.historyErr = String((e && e.stack) || e); out.historyPass = false; }
      flush();

      /* 13) 清除浏览数据：种 cookie/localStorage → 清 → 验；历史/下载记录同清 */
      try {
        const cid = createTab("http://127.0.0.1:" + dlPort + "/small", { activate: false });
        await sleep(1600);
        const cwc = tabs.get(cid) && tabs.get(cid).view && !tabs.get(cid).view.webContents.isDestroyed() ? tabs.get(cid).view.webContents : null;
        const seeded = cwc
          ? JSON.parse(await cwc.executeJavaScript(
              `(function(){document.cookie="lgtest=1;path=/";try{localStorage.setItem("lgtest","1")}catch(e){}return JSON.stringify({ck:document.cookie,ls:(function(){try{return localStorage.getItem("lgtest")}catch(e){return null}})()})})()`,
              true
            ))
          : null;
        await sleep(200);
        const ckUrl = "http://127.0.0.1:" + dlPort + "/";
        const cookiesBefore = (await sharedSession().cookies.get({ url: ckUrl })).length;
        const rCookies = await clearBrowsingData({ cookies: true });
        await sleep(300);
        const cookiesAfter = (await sharedSession().cookies.get({ url: ckUrl })).length;
        const rCache = await clearBrowsingData({ cache: true });
        const rHist = await clearBrowsingData({ history: true, downloads: true });
        out.clearData = {
          seeded, cookiesBefore, cookiesAfter,
          rCookies: { ok: rCookies.ok, sessions: rCookies.sessions },
          rCache: { ok: rCache.ok },
          rHist: { ok: rHist.ok, historyCleared: rHist.historyCleared, downloadsCleared: rHist.downloadsCleared },
          historyEmpty: history.length === 0,
          downloadsOnlyActive: downloads.every((d) => d.state === "progressing" || d.state === "paused"),
        };
        out.clearDataPass = !!(
          seeded && seeded.ck.indexOf("lgtest") >= 0 && seeded.ls === "1" &&
          cookiesBefore >= 1 && cookiesAfter === 0 &&
          rCookies.ok && rCookies.sessions >= 1 && rCache.ok && rHist.ok && rHist.historyCleared &&
          history.length === 0 && out.clearData.downloadsOnlyActive
        );
        try { closeTab(cid); } catch {}
      } catch (e) { out.clearDataErr = String((e && e.stack) || e); out.clearDataPass = false; }
      /* 14) 网页右键菜单模板（探针不弹真菜单，直接构造 params 断言条目） */
      try {
        const pageTab = [...tabs.values()].find((t) => t.view && !t.view.webContents.isDestroyed() && !isLocalKind(t.kind));
        const t14 = pageTab || [...tabs.values()].find((t) => t.view && !t.view.webContents.isDestroyed());
        const labels = (params) => {
          const tpl = pageContextTemplate(params || {}, t14 ? t14.id : activeTabId);
          return (tpl || []).map((i) => i.label || "<sep>");
        };
        const has = (arr, s) => arr.some((x) => String(x).indexOf(s) >= 0);
        const plain = labels({});
        const editable = labels({ isEditable: true, editFlags: { canUndo: true, canPaste: true } });
        const selected = labels({ selectionText: "hello world" });
        const link = labels({ linkURL: "https://www.luogu.com.cn/problem/P1001" });
        const image = labels({ mediaType: "image", srcURL: "https://x.invalid/a.png" });
        const video = labels({ mediaType: "video", srcURL: "https://x.invalid/a.mp4" });
        out.pageMenu = { plain, editable, selected, link, image, video };
        out.pageMenuPass = !!(
          has(plain, "后退") && has(plain, "前进") && has(plain, "刷新") && has(plain, "复制页面地址") &&
          has(plain, "完整网页截图") && has(plain, "检查元素") &&
          has(editable, "撤销") && has(editable, "粘贴") && has(editable, "全选") &&
          has(selected, "复制") && has(selected, "翻译所选内容") && has(selected, "用洛谷搜索") &&
          has(link, "在新标签页中打开链接") && has(link, "复制链接地址") &&
          has(image, "图片另存为") && has(image, "复制图片地址") &&
          has(video, "画中画播放") && has(video, "复制媒体地址")
        );
      } catch (e) { out.pageMenuErr = String((e && e.stack) || e); out.pageMenuPass = false; }
      flush();

      /* 15~18) 页面侧五件（整页截图 / 画中画 / 阅读模式 / 翻译）：
         用一张本地的长文夹具页（顶部导航 + 正文段落），file:// 页也吃页面注入 */
      try {
        const fxDir = path.join(app.getPath("userData"), "lgtest-fx");
        fs.mkdirSync(fxDir, { recursive: true });
        const paras = [];
        for (let i = 0; i < 60; i++) {
          paras.push("<p>第 " + (i + 1) + " 段：这是用于整页截图与阅读模式验证的正文内容，Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore.</p>");
        }
        const fxPath = path.join(fxDir, "article.html");
        fs.writeFileSync(
          fxPath,
          "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>夹具文章</title></head><body>" +
            "<nav id=\"fx-nav\"><a href=\"#\">导航链接一</a><a href=\"#\">导航链接二</a></nav>" +
            "<article id=\"fx-article\"><h1>夹具标题</h1>" + paras.join("") + "</article>" +
            "</body></html>",
          "utf8"
        );
        const fxId = createTab(pathToFileURL(fxPath).href, { activate: true });
        for (let i = 0; i < 40; i++) { await sleep(200); const t = tabs.get(fxId); if (t && t.view && !t.view.webContents.isLoading()) break; }
        await sleep(900);
        const fx = tabs.get(fxId);
        const fwc = fx && fx.view && !fx.view.webContents.isDestroyed() ? fx.view.webContents : null;
        if (!fwc) throw new Error("fixture tab missing");
        /* 隐藏实例（opacity 0）里后创建的视图不一定收到 viewport 更新：晃一下
           尺寸逼 Chromium 重算一次布局视口，再量 innerHeight/截图尺寸才有意义 */
        const fb0 = tabs.get(fxId).view.getBounds();
        tabs.get(fxId).view.setBounds({ ...fb0, width: Math.max(50, fb0.width - 2) });
        await sleep(350);
        tabs.get(fxId).view.setBounds(fb0);
        await sleep(500);
        const pageCall = (expr) => fwc.executeJavaScript(expr, true);

        /* 15) 整页截图：PNG 高度必须超过视口高度（滚动部分也进去了） */
        const viewH = await pageCall("innerHeight");
        const fxBounds = (tabs.get(fxId) && tabs.get(fxId).view) ? tabs.get(fxId).view.getBounds() : null;
        const shot = await captureFullPage(fxId);
        let pngH = 0, pngW = 0, pngBytes = 0;
        try {
          const buf = fs.readFileSync(shot.file);
          pngBytes = buf.length;
          pngW = buf.readUInt32BE(16);
          pngH = buf.readUInt32BE(20);
        } catch (e) { out.fullshotErr = String(e); }
        out.fullshot = { ok: shot.ok, full: shot.full, viewH, fxBounds, pngW, pngH, pngBytes, activeIsFx: activeTabId === fxId };
        out.fullshotPass = !!(shot.ok && shot.full && viewH > 300 && pngW >= 600 && pngH > viewH + 200 && pngBytes > 5000);

        /* 16) 画中画：无视频页面必须优雅返回 no-video（不抛异常） */
        const pip = await pipActiveVideo(fxId);
        out.pip = pip;
        out.pipPass = !!(pip && pip.result === "no-video");

        /* 17) 阅读模式：抽取正文（不含导航）→ 退出还原 */
        const rOpen = await pageCall("window.__lgGlass.readerToggle()");
        await sleep(400);
        const rInfo = JSON.parse(await pageCall(
          "(function(){var h=document.getElementById(\"lg-reader\");if(!h)return JSON.stringify({open:false});var b=h.querySelector(\".lg-reader-body\");var txt=b?b.textContent:\"\";return JSON.stringify({open:true,hasNav:!!h.querySelector(\"#fx-nav\"),hasArticle:txt.indexOf(\"第 1 段\")>=0,hasLast:txt.indexOf(\"第 60 段\")>=0,len:txt.length,btns:h.querySelectorAll(\".lg-reader-btn\").length})})()"
        ));
        const rClose = await pageCall("window.__lgGlass.readerToggle()");
        await sleep(200);
        const rGone = await pageCall("!document.getElementById(\"lg-reader\")");
        out.reader = { open: rOpen, info: rInfo, close: rClose, gone: rGone };
        out.readerPass = !!(rOpen === "opened" && rInfo.open && !rInfo.hasNav && rInfo.hasArticle && rInfo.hasLast && rInfo.btns >= 3 && rClose === "closed" && rGone === true);

        /* 18) 翻译：自定义端点（本地假服务）→ 划词气泡 + 整页替换 + 失败路径 */
        const trTpl = "http://127.0.0.1:" + dlPort + "/tr?q=%s";
        const trOld = { p: cfg.translateProvider, c: cfg.translateCustom };
        cfg.translateProvider = "custom";
        cfg.translateCustom = trTpl;
        await sleep(100);
        const trSel = await pageCall("window.__lgGlass.translateSelection(\"hello world\")");
        await sleep(600);
        const bubble = JSON.parse(await pageCall(
          "(function(){var b=document.getElementById(\"lg-tr-bubble\");if(!b)return JSON.stringify({exists:false});return JSON.stringify({exists:true,text:(b.querySelector(\".lg-tr-out\")||{}).textContent||\"\"})})()"
        ));
        const trPage = await pageCall("window.__lgGlass.translatePage()");
        let barInfo = null;
        const trHist = [];
        /* 轮询到「完成」为止（R41 修复本段 R39 起的竞态：旧循环带 && !barInfo，
           第一次读到 bar 就退出 → 抢在批次还在飞时把端点切成 /trfail →
           最后一包恰好吃到 500，单次读数停在"翻译中 xx/63"） */
        for (let i = 0; i < 30; i++) {
          await sleep(300);
          barInfo = JSON.parse(await pageCall(
            "(function(){var b=document.getElementById(\"lg-tr-bar\");if(!b)return JSON.stringify(null);var info=b.querySelector(\".lg-tr-info\");var art=document.getElementById(\"fx-article\");var txt=art?art.textContent:\"\";return JSON.stringify({info:(info||{}).textContent||\"\",translated:txt.indexOf(\"《\")>=0})})()"
          ));
          if (barInfo) trHist.push(barInfo.info);
          if (barInfo && /完成/.test(barInfo.info || "")) break;
        }
        out.trHist = trHist;
        cfg.translateProvider = "custom";
        cfg.translateCustom = "http://127.0.0.1:" + dlPort + "/trfail?q=%s";
        await sleep(100);
        const trFail = await pageCall("window.lgApp.translate([\"hello\"])");
        const trRestore = await pageCall("window.__lgGlass.translatePage()");
        await sleep(300);
        const restored = await pageCall("(function(){var art=document.getElementById(\"fx-article\");var txt=art?art.textContent:\"\";return JSON.stringify({bar:!!document.getElementById(\"lg-tr-bar\"),orig:txt.indexOf(\"第 1 段\")>=0})})()");
        cfg.translateProvider = trOld.p;
        cfg.translateCustom = trOld.c;
        out.translate = { sel: trSel, bubble, page: trPage, bar: barInfo, fail: trFail, restore: trRestore, restored: JSON.parse(restored) };
        out.translatePass = !!(
          trSel === "ok" && bubble.exists && /《hello world》/.test(bubble.text) &&
          trPage === "started" && barInfo && barInfo.translated && /完成/.test(barInfo.info) &&
          trFail && trFail.ok === false && !!trFail.message && trRestore === "restored" && JSON.parse(restored).orig && !JSON.parse(restored).bar
        );
        try { closeTab(fxId); } catch {}
      } catch (e) { out.pageToolsErr = String((e && e.stack) || e); out.fullshotPass = out.pipPass = out.readerPass = out.translatePass = false; }
      if (dlServer) { try { dlServer.close(); } catch {} }
      flush();
      await setVt(savedVt);

      /* 19) 窗口状态持久化 + 退出前存档 flush：
         边界落盘↔文件一致、恢复折算的钳制/默认值、标签防抖存档被 flush 补上 */
      try {
        const wbNow = mainWin.getBounds();
        saveWindowState();
        let wsj = null;
        try { wsj = JSON.parse(fs.readFileSync(winStatePath(), "utf8")); } catch {}
        const wbClamp = windowBoundsFor({ width: 100, height: 100, x: 1234, y: 5678 });
        const wbDefault = windowBoundsFor(null);
        const wbSaved = windowBoundsFor(wsj);
        const flushRec = tabOrder.length ? tabs.get(tabOrder[tabOrder.length - 1]) : null;
        const flushMark = "probe-flush-" + Date.now();
        if (flushRec) flushRec.title = flushMark;
        flushAppState();
        let tabsSaved = null;
        try { tabsSaved = JSON.parse(fs.readFileSync(tabsStatePath(), "utf8")); } catch {}
        const flushHit = !flushRec || !!(tabsSaved && Array.isArray(tabsSaved.tabs) && tabsSaved.tabs.some((t) => t.title === flushMark));
        out.winState = { bounds: wbNow, file: wsj, clamp: wbClamp, def: wbDefault, saved: wbSaved, flushHit };
        out.winStatePass = !!(
          wsj && wsj.width === wbNow.width && wsj.height === wbNow.height &&
          wsj.x === wbNow.x && wsj.y === wbNow.y && typeof wsj.maximized === "boolean" &&
          wbClamp.width === 980 && wbClamp.height === 640 && wbClamp.x === 1234 && wbClamp.y === 5678 &&
          wbDefault.width === 1440 && wbDefault.height === 920 && wbDefault.x === undefined &&
          wbSaved.width === Math.max(980, wbNow.width) && wbSaved.height === Math.max(640, wbNow.height) &&
          flushHit
        );
      } catch (e) { out.winStateErr = String((e && e.stack) || e); out.winStatePass = false; }

      flush();
      out.pass = !!(
        out.geometryPass && out.memoryPass && out.reorderPass && out.flyoutPass && out.menuPass &&
        out.workspacesPass && out.organizePass && out.toastPass && out.navPass && out.suggestPass &&
        out.downloadPass && out.historyPass && out.clearDataPass &&
        out.pageMenuPass && out.fullshotPass && out.pipPass && out.readerPass && out.translatePass &&
        out.winStatePass
      );
      flush();
      } catch (e) { out.flyoutErr = String((e && e.stack) || e); flush(); }
    } else if (argv.includes("--lg-v37test")) {
      /* v3.7.0：垂直侧边栏对齐 Edge（含 Edge 式标签分组）。七段：
         1) 悬停 = 整条展开：浮层从窗口左缘铺满展开宽度（盖住窄条）、
            与外壳侧栏逐行 y 对齐（同一标签的行中心 y 一致）；
         2) 拖拽：move 语义 + 落点区（拖进钉住区=钉住、拖出=取消钉住）、
            落点标记（插入线/放置区高亮）、浮层行带拖拽标记；
         3) 分组 Edge 式：.vgroup 组块（组头/缩进/连续组色线/折叠计数）、
            多选建组（Ctrl/Shift 选择 + 菜单入口）、双击就地改名；
         4) 悬停卡片已删除（R38）：外壳无相关函数/桥、主进程无卡片视图；
         5) 宽度可拖：160~400 夹取 + 落盘 + inset/--vtab-w 同源；
         6) 侧栏可放右侧：几何镜像（inset().right、#top 让右、浮层贴右缘）；
         7) 搜索标签页大列表（图标 + 标题 + 网址 + 计数）。 */
      const invokeFor = (ch, ...args) => {
        const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (!h) return null;
        return h({ sender: mainWin.webContents }, ...args);
      };
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(900);

      const savedVt = {
        verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact,
        vtabWidth: cfg.vtabWidth, vtabSide: cfg.vtabSide,
      };
      const setVt = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(400);
      };
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const popJs = (code) =>
        popupView && !popupView.webContents.isDestroyed() ? popupView.webContents.executeJavaScript(code, true) : Promise.resolve(null);
      const mkTab = (u) => createTab(u, { activate: false });
      const openFlyout = async () => {
        await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
        let snap = null;
        for (let i = 0; i < 80; i++) {
          await sleep(30);
          if (popupFit && popupFit.contentH > 1) { snap = { ...popupFit }; break; }
        }
        stopFlyoutWatch();
        /* v3.8.0 的悬停防闪：面板画好后弹层回报一声，外壳收到才收窄条。
           隐藏实例里弹层侧的双 rAF + 48ms 定时器会被节流，外壳侧的 320ms 兜底
           也会晚——这里等交接真的落地（窄条被收起）再往下量，量的是稳态，
           不是"刚好卡在交接中间"的那一帧。 */
        for (let i = 0; i < 60; i++) {
          const on = await js('document.body.classList.contains("flyout-open")');
          if (on) break;
          await sleep(80);
        }
        await sleep(150);
        /* 等首开动画落定：不仅等时间，还要等文档把 data-anim 消费掉（壁纸首帧
           解码会拖慢第一次 fitRect，固定 220ms 不够）。壁纸现在按整窗铺，
           首开确实要解码一张大图。 */
        for (let i = 0; i < 60; i++) {
          await sleep(50);
          const done = await popJs('(function(){var f=document.getElementById("tab-flyout");return f?(f.getAttribute("data-anim")===null?"1":"0"):"0";})()');
          if (done === "1") break;
        }
        await sleep(250);
        return snap;
      };
      const created = [];

      /* ---------- 1) 悬停 = 整条展开：与常驻展开同矩形 / 同形状 / 同材质 ----------
         悬停浮层不再是"按内容收的卡片"：矩形必须等于点箭头常驻展开的那条 #vtab
         （左：0,0,展开宽,整窗高），方角、无外投影、单边发丝线；开着时外壳窄条
         整条隐去（visibility，布局不动）；同一窗口矩形像素对拍（弹层里的浮层 vs
         外壳里的常驻条）平均色差要小。 */
      try {
        await setVt({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left" });
        for (let i = 0; i < 4; i++) created.push(mkTab("https://lg-v37-h" + i + ".invalid/p"));
        await sleep(700);
        const [winW0, winH0] = mainWin.getContentSize();
        const fit = await openFlyout();
        const docRaw = await popJs(`(function(){var f=document.getElementById("tab-flyout");if(!f)return null;var r=f.getBoundingClientRect();
          var rows=f.querySelectorAll(".vtab[data-id]");var o=[];for(var i=0;i<rows.length;i++){var q=rows[i].getBoundingClientRect();o.push({id:rows[i].getAttribute("data-id"),y:Math.round((q.top+q.height/2)*10)/10,drag:rows[i].getAttribute("data-drag-row")==="1"});}
          var foot={};["vtab-new","vtab-set"].forEach(function(id){var el=f.querySelector("#"+id);if(el){var q=el.getBoundingClientRect();foot[id]=Math.round((q.top+q.height/2)*10)/10;}});
          var cs=getComputedStyle(f);var sh=cs.boxShadow||"";var layers=0,depth=0;for(var i=0;i<sh.length;i++){var c=sh[i];if(c==="(")depth++;else if(c===")")depth--;else if(c===","&&depth===0)layers++;}
          var af=getComputedStyle(f,"::after"),bf=getComputedStyle(f,"::before");
          var st={bg:cs.backgroundColor,bgi:cs.backgroundImage,bd:cs.backdropFilter||cs.webkitBackdropFilter||"none",sh:sh,brw:cs.borderRightWidth,brc:cs.borderRightColor,blw:cs.borderLeftWidth,
            abg:af.backgroundColor,abgi:af.backgroundImage,bff:bf.filter,bfw:bf.width,bfh:bf.height};
          var animRule=false;try{for(var s=0;s<document.styleSheets.length;s++){var rs=document.styleSheets[s].cssRules;for(var j=0;j<rs.length;j++){if(rs[j].type===7&&rs[j].name==="lg-tf-widen")animRule=true;}}}catch(e){}
          return JSON.stringify({left:Math.round(r.left),top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),rows:o.length,ys:o,foot:foot,st:st,
            radius:cs.borderTopLeftRadius,shadowNone:sh==="none",shadowLayers:layers+1,shadowInset:sh.indexOf("inset")>=0,
            animRule:animRule,animConsumed:f.getAttribute("data-anim")===null,resize:f.querySelector("#vtab-resize")?"present":"removed",
            animDbg:{attr:f.getAttribute("data-anim"),cls:String(f.className),left:f.style.left,top:f.style.top,maxH:f.style.maxHeight,vis:getComputedStyle(f).visibility}});})()`);
        const doc = docRaw ? JSON.parse(docRaw) : null;
        const shell = JSON.parse(
          await js(`(function(){var o=[];var ls=document.querySelectorAll("#vtab .vtab[data-id]");for(var i=0;i<ls.length;i++){var r=ls[i].getBoundingClientRect();o.push({id:ls[i].getAttribute("data-id"),y:Math.round((r.top+r.height/2)*10)/10});}
            var foot={};["vtab-new","vtab-set"].forEach(function(id){var el=document.getElementById(id);if(el){var q=el.getBoundingClientRect();foot[id]=Math.round((q.top+q.height/2)*10)/10;}});
            var v=document.getElementById("vtab");var vr=v.getBoundingClientRect();var vs=getComputedStyle(v);
            var st={bg:vs.backgroundColor,bgi:vs.backgroundImage,bd:vs.backdropFilter||vs.webkitBackdropFilter||"none",sh:vs.boxShadow||"none",brw:vs.borderRightWidth,brc:vs.borderRightColor,blw:vs.borderLeftWidth};
            return JSON.stringify({rows:o,foot:foot,st:st,vis:getComputedStyle(v).visibility,cls:document.body.classList.contains("flyout-open"),
              rect:{x:Math.round(vr.left),y:Math.round(vr.top),w:Math.round(vr.width),h:Math.round(vr.height)}});})()`)
        );
        const pb = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
        const base = fit ? fit.originY - fit.pad.t : 0;
        let maxDy = 0;
        let paired = 0;
        for (const a of shell.rows) {
          const b = doc && doc.ys ? doc.ys.find((x) => x.id === a.id) : null;
          if (!b) continue;
          paired++;
          maxDy = Math.max(maxDy, Math.abs(a.y - (b.y + base)));
        }
        // 底部两颗（+ 新建 / 设置）也要与常驻展开同 y：整高后它们落在窗口底
        let maxDyFoot = 0;
        if (doc && doc.foot && shell.foot) {
          for (const k of ["vtab-new", "vtab-set"]) {
            if (doc.foot[k] != null && shell.foot[k] != null) maxDyFoot = Math.max(maxDyFoot, Math.abs(shell.foot[k] - (doc.foot[k] + base)));
          }
        }
        /* 同一块面：外壳 #vtab 与浮层根（含假壁纸两片伪元素）的"有效面"逐项相等。
           机制不同要按机制比：外壳把底色/sheen 画在元素自己身上、模糊走
           backdrop-filter；弹层画在 .lg-fake::after（假壁纸之上）、模糊并进
           ::before 的 filter 链。边框/投影比元素自身（投影只比 inset 那条：
           外壳那条还带一个被网页视图盖住、永远看不见的外投影 --lg-glass-drop，
           浮层不能有——悬停时它会露在网页上，就不像常驻那条了）。 */
        const norm = (s) => String(s == null ? "none" : s).replace(/\s+/g, " ").trim();
        const insetOf = (sh) => {
          if (!sh || sh === "none") return "none";
          const parts = [];
          let depth = 0, cur = "";
          for (const c of String(sh)) {
            if (c === "(") depth++;
            else if (c === ")") depth--;
            if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
            cur += c;
          }
          parts.push(cur);
          /* 全透 inset（rgba(...,0)）视觉上与 none 完全等价：flat 皮肤
             --lg-glass-hi 恒透明，两层一个算成透明阴影一个算成 none（R41） */
          const ins = parts
            .map((x) => x.trim())
            .filter((x) => x.indexOf("inset") >= 0 && !/^rgba?\([^)]*,\s*0\.?0*\)/.test(x));
          return ins.length ? ins.join(" | ") : "none";
        };
        let faceDiff = null;
        let wallVars = null;
        try {
          const readWall = (wc) =>
            wc.executeJavaScript(
              `(function(){var cs=getComputedStyle(document.documentElement);var im=cs.getPropertyValue("--lg-wall-image").trim();var w=cs.getPropertyValue("--lg-wall-w").trim();var h=cs.getPropertyValue("--lg-wall-h").trim();var px=cs.getPropertyValue("--par-x").trim();var py=cs.getPropertyValue("--par-y").trim();var b=cs.getPropertyValue("--lg-wall-blur").trim();return JSON.stringify({imgLen:im.length,imgHead:im.slice(0,90),w:w,h:h,parX:px,parY:py,blur:b});})()`,
              true
            );
          const pv = await readWall(popupView.webContents);
          const sv = await readWall(mainWin.webContents);
          wallVars = { popup: JSON.parse(pv || "null"), shell: JSON.parse(sv || "null") };
        } catch (e) { out.hoverWallErr = String(e); }
        /* 弹层里的假壁纸诊断（v3.7.1 核心疑点）：lg-media:// 壁纸在弹层文档里能不能
           解码（Image 探针）+ ::before 那层的 background-image 是什么。 */
        let popWall = null;
        try {
          const imgProbe = await popJs(`(function(){return new Promise(function(res){
            var v=getComputedStyle(document.documentElement).getPropertyValue("--lg-wall-image").trim();
            var m=v.match(/url\\(["']?([^"')]+)["']?\\)/);var u=m?m[1]:"";
            var f=document.getElementById("tab-flyout");
            var bf=f?getComputedStyle(f,"::before"):null;
            var bg=bf?String(bf.backgroundImage).slice(0,70):"no-flyout";
            var out={urlHead:u.slice(0,50),beforeBg:bg};
            if(!u){out.load="no-url";res(JSON.stringify(out));return;}
            var im=new Image();
            var t=setTimeout(function(){out.load="timeout";out.nat=im.naturalWidth;res(JSON.stringify(out));},3000);
            im.onload=function(){clearTimeout(t);out.load="ok";out.nat=im.naturalWidth;out.nh=im.naturalHeight;res(JSON.stringify(out));};
            im.onerror=function(){clearTimeout(t);out.load="error";out.nat=im.naturalWidth;res(JSON.stringify(out));};
            im.src=u; });})()`);
          popWall = imgProbe ? JSON.parse(imgProbe) : null;
        } catch (e) { out.hoverPopWallErr = String(e); }
        if (doc && doc.st && shell.st) {
          if (norm(doc.st.abg) !== norm(shell.st.bg)) faceDiff = "tint: " + doc.st.abg + " != " + shell.st.bg;
          else if (norm(doc.st.abgi) !== norm(shell.st.bgi)) faceDiff = "sheen: " + doc.st.abgi + " != " + shell.st.bgi;
          else if (norm(doc.st.bff).indexOf(norm(shell.st.bd)) < 0) faceDiff = "blur: " + shell.st.bd + " not in " + doc.st.bff;
          else {
            for (const k of ["brw", "brc", "blw"]) {
              if (norm(doc.st[k]) !== norm(shell.st[k])) { faceDiff = k + ": " + doc.st[k] + " != " + shell.st[k]; break; }
            }
            if (!faceDiff) {
              const fi = insetOf(doc.st.sh);
              const si = insetOf(shell.st.sh);
              if (fi !== si) faceDiff = "shadow: " + fi + " != " + si;
            }
          }
        } else faceDiff = "no-st";
        /* 像素对拍（尽力而为，跨视图）：同一窗口矩形，悬停态从弹层视图取、常驻态从
           外壳取。窗口被系统判为遮挡（或透明视图在隐藏窗口里拿不到 surface）时
           capturePage 会报错——重试几次，仍拿不到就记 pixSkipped 跳过；真正可靠
           的那条是同视图内的面比对（见下）。 */
        let meanDelta = null;
        let pixSkipped = null;
        let stripRect = null;
        let clsAfter = null;
        let visAfter = null;
        let sameFaceDelta = null;
        let sanityDelta = null;
        let sameFaceErr = null;
        const patchOf = (img) => {
          const s = img.resize({ width: 16, height: 32, quality: "good" });
          const sz = s.getSize();
          const bm = s.toBitmap();
          const px = Math.max(1, sz.width);
          const py = Math.max(1, sz.height);
          let b = 0, g = 0, r = 0, n = 0;
          for (let y = 0; y < py; y++) {
            for (let x = 0; x < px; x++) {
              const o = (y * px + x) * 4;
              if (o + 2 >= bm.length) continue;
              b += bm[o]; g += bm[o + 1]; r += bm[o + 2]; n++;
            }
          }
          return n ? [b / n, g / n, r / n] : [0, 0, 0];
        };
        const capRetry = async (wc, rect) => {
          for (let i = 0; i < 3; i++) {
            try { return rect ? await wc.capturePage(rect) : await wc.capturePage(); } catch (e) { try { wc.invalidate(); } catch {} await sleep(400); }
          }
          return null;
        };
        try {
          /* 隐藏窗口可能被系统判为遮挡（capturePage 报 no display surface）或不出新帧：
             关掉后台节流逼它渲染，再截；拿不到就记 pixSkipped 跳过。
             不置顶、不 moveTop——探针绝不把窗口往前提（那会让用户看到弹窗）。 */
          try { mainWin.webContents.setBackgroundThrottling(false); } catch {}
          try { popupView.webContents.setBackgroundThrottling(false); } catch {}
          const imgA = await capRetry(popupView.webContents, null);
          /* 假壁纸那层到底画没画：把 --lg-wall-image 换成纯红渐变再截一张——
             能变红=在画（问题在图片加载）；不变红=那层没画（要换画法）。 */
          let fakePaintRed = null;
          try {
            await popJs('(function(){document.documentElement.style.setProperty("--lg-wall-image","linear-gradient(#f00,#f00)");return "ok";})()');
            await sleep(450);
            const imgRedP = await capRetry(popupView.webContents, null);
            if (imgRedP) fakePaintRed = patchOf(imgRedP).map((v) => Math.round(v));
            await popJs('(function(){document.documentElement.style.removeProperty("--lg-wall-image");return "ok";})()');
            await sleep(250);
          } catch (e) { out.hoverPaintErr = String(e); }
          out.hoverPopWall = popWall;
          out.hoverFakePaintRed = fakePaintRed;
          await js("window.lgChrome.popupHide()");
          await sleep(150);
          clsAfter = (await js('document.body.classList.contains("flyout-open")')) === true;
          await setVt({ vtabCollapsed: false }); // 常驻展开（同一矩形，页面被推开）
          await sleep(500);
          visAfter = await js('getComputedStyle(document.getElementById("vtab")).visibility');
          const imgB = await capRetry(mainWin.webContents, { x: fit.originX, y: fit.originY, width: fit.contentW, height: fit.contentH });
          if (imgA && imgB) {
            try {
              fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v37-popup.png", imgA.toPNG());
              fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v37-shell.png", imgB.toPNG());
            } catch {}
            const pa = patchOf(imgA);
            const pbb = patchOf(imgB);
            meanDelta = Math.round(((Math.abs(pa[0] - pbb[0]) + Math.abs(pa[1] - pbb[1]) + Math.abs(pa[2] - pbb[2])) / 3) * 100) / 100;
          } else pixSkipped = !imgA ? "popup" : "shell";
          /* 同视图内的面比对（可靠路径，这条才是真闸门）：外壳里先截"常驻条"那块，
             再把同一矩形换成一模一样的假壁纸面（弹层用的 .lg-fake / .lg-face-b +
             --lg-face:var(--lg-glass-bg)，与 popup.js 给浮层打的那份完全相同）。
             隐藏窗口里合成器可能不出新帧（capture 返回旧帧，两张自然全等 = 假绿）：
             所以再拍一张"故意涂红"的对照——它必须与真条明显不同，才证明帧是新的、
             而且 --lg-face 真的在驱动像素。 */
          try {
            const rect0 = { x: fit.originX, y: fit.originY, width: fit.contentW, height: fit.contentH };
            const shot = async () => {
              try { mainWin.webContents.invalidate(); } catch {}
              await sleep(340);
              return capRetry(mainWin.webContents, rect0);
            };
            const imgReal = await shot();
            const domState = JSON.parse(
              await js(`(function(){var v=document.getElementById("vtab");
                var d=document.createElement("div");d.id="lg-probe-face";d.className="lg-fake lg-face-b";
                d.style.cssText="position:fixed;left:0;top:0;width:${fit.contentW}px;height:${fit.contentH}px;z-index:40;--lg-face:var(--lg-glass-bg);--pop-x:0px;--pop-y:0px;";
                document.body.appendChild(d);v.style.visibility="hidden";
                var bf=getComputedStyle(d,"::before"),af=getComputedStyle(d,"::after");
                return JSON.stringify({face:!!document.getElementById("lg-probe-face"),vtabVis:getComputedStyle(v).visibility,
                  bw:bf.width,bh:bf.height,tint:af.backgroundColor,hasWall:getComputedStyle(document.documentElement).getPropertyValue("--lg-wall-image").trim().length>0});})()`)
            );
            const imgFake = await shot();
            await js('(function(){var d=document.getElementById("lg-probe-face");if(d)d.style.setProperty("--lg-face","rgba(255,0,0,0.9)");return "ok";})()');
            const imgRed = await shot();
            await js('(function(){var d=document.getElementById("lg-probe-face");if(d)d.remove();var v=document.getElementById("vtab");v.style.visibility="";return "ok";})()');
            out.hoverFace = { domState, real: !!imgReal, fake: !!imgFake, red: !!imgRed };
            if (imgReal && imgFake) {
              try {
                fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v37-strip.png", imgReal.toPNG());
                fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v37-fake.png", imgFake.toPNG());
                if (imgRed) fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-v37-red.png", imgRed.toPNG());
              } catch {}
              const pr = patchOf(imgReal);
              const pf = patchOf(imgFake);
              sameFaceDelta = Math.round(((Math.abs(pr[0] - pf[0]) + Math.abs(pr[1] - pf[1]) + Math.abs(pr[2] - pf[2])) / 3) * 100) / 100;
              if (imgRed) {
                const prd = patchOf(imgRed);
                sanityDelta = Math.round(((Math.abs(pr[0] - prd[0]) + Math.abs(pr[1] - prd[1]) + Math.abs(pr[2] - prd[2])) / 3) * 100) / 100;
              }
            }
          } catch (e) { sameFaceErr = String((e && e.stack) || e); }
          stripRect = JSON.parse(
            await js('(function(){var r=document.getElementById("vtab").getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()')
          );
        } catch (e) { out.hoverPixErr = String((e && e.stack) || e); }
        await setVt({ vtabCollapsed: true }); // 回窄条，后面的段按自己的姿态重设
        out.hover = { fit, doc, shellRows: shell.rows.length, paired, maxDy, maxDyFoot, faceDiff, wallVars, pb, shell, stripRect, meanDelta, pixSkipped, sameFaceDelta, sanityDelta, sameFaceErr, clsAfter, visAfter, winH0 };
        out.hoverPass = !!(
          fit && doc && shell && pb &&
          fit.pad.l === 0 && fit.pad.t === 0 && fit.pad.r === 0 && fit.pad.b === 0 &&
          fit.originX === 0 && fit.originY === 0 &&
          fit.contentW === vtabExpandedW() && fit.contentH === winH0 &&
          pb.x === fit.originX && pb.y === fit.originY && pb.width === fit.contentW && pb.height === fit.contentH &&
          doc.left === 0 && doc.top === 0 && doc.w === vtabExpandedW() && doc.h === winH0 &&
          doc.radius === "0px" && (doc.shadowNone || (doc.shadowLayers === 1 && doc.shadowInset)) &&
          doc.rows === tabs.size && paired === shell.rows.length && paired > 0 && maxDy <= 1.5 &&
          maxDyFoot <= 1.5 && !faceDiff &&
          // 假壁纸必须按"整个窗口"铺（视图只有面板那块，100vw/100vh 兜底会把壁纸压扁）
          doc.st && doc.st.bfw === winW0 + "px" && doc.st.bfh === winH0 + "px" &&
          doc.animRule && doc.animConsumed && doc.resize === "removed" &&
          shell.vis === "hidden" && shell.cls === true &&
          stripRect && stripRect.x === fit.originX && stripRect.y === fit.originY &&
          stripRect.w === fit.contentW && stripRect.h === fit.contentH &&
          visAfter === "visible" && clsAfter === false &&
          /* 同构假面确实在外壳里就位（DOM 闸门）+ 壁纸变量在（否则假壁纸是空的） */
          out.hoverFace && out.hoverFace.domState && out.hoverFace.domState.face === true &&
          out.hoverFace.domState.vtabVis === "hidden" && out.hoverFace.domState.hasWall === true &&
          /* 像素对拍降级为报告 + 软阈值：隐藏窗口里合成器可能不出新帧（"涂红对照"
             sanityDelta 太小即说明帧是旧的），那条只作证据；帧新时色差仍要达标 */
          (sameFaceDelta == null || sameFaceDelta <= 12) &&
          // 跨视图对拍（弹层视图在隐藏窗口里常缺壁纸层/拿不到 surface）只作报告，不进闸门
          true
        );
      } catch (e) { out.hoverErr = String((e && e.stack) || e); out.hoverPass = false; }
      flush();

      /* ---------- 2) 拖拽：跨区（钉住/普通）+ 落点标记 + 浮层行可拖 ---------- */
      try {
        await setVt({ verticalTabs: true, vtabCollapsed: false, vtabCompact: false });
        const a = mkTab("https://lg-v37-a.invalid/");
        const b = mkTab("https://lg-v37-b.invalid/");
        const c = mkTab("https://lg-v37-c.invalid/");
        created.push(a, b, c);
        await sleep(600);
        setTabPinned(tabs.get(a), true);
        setTabPinned(tabs.get(b), true);
        await sleep(300);
        const firstPin = tabOrder.filter((x) => tabs.get(x).pinned)[0];
        moveTabInOrder(c, firstPin, "pinned");
        const pinIn = { idx: tabOrder.indexOf(c), pinned: !!tabs.get(c).pinned };
        moveTabInOrder(c, null, "normal");
        const pinOut = { idx: tabOrder.indexOf(c), last: tabOrder.length - 1, pinned: !!tabs.get(c).pinned, pins: tabOrder.filter((x) => tabs.get(x).pinned).length };
        moveTabInOrder(a, tabOrder[tabOrder.length - 1], null);
        const noZone = { idx: tabOrder.indexOf(a), pinned: !!tabs.get(a).pinned, pinnedCount: tabOrder.filter((x) => tabs.get(x).pinned).length };
        const marks = JSON.parse(
          await js(`(function(){var row=document.querySelector("#vtabs .vtab[data-id]")||document.querySelector("#vtab-pins .vtab[data-id]");if(!row)return JSON.stringify({err:"no-row"});markDrop(row,true);var before=row.classList.contains("drop-before");clearDropMarks();var cleared=!document.querySelector(".drop-before, .drop-after, .drop-zone");return JSON.stringify({before:before,cleared:cleared});})()`)
        );
        const pinMarks = JSON.parse(
          await js(`(function(){var row=document.querySelector("#vtab-pins .vtab[data-id]");if(!row)return JSON.stringify({err:"no-pin"});markDrop(row,false);var z=document.getElementById("vtab-pins").classList.contains("drop-zone");clearDropMarks();return JSON.stringify({zone:z});})()`)
        );
        const r = await invokeFor("popup:tab-reorder", { id: c, beforeId: tabOrder[0], zone: "pinned" });
        const viaPopup = { ok: !!(r && r.ok), pinned: !!tabs.get(c).pinned, idx: tabOrder.indexOf(c) };
        moveTabInOrder(c, null, "normal");
        await setVt({ vtabCollapsed: true });
        await openFlyout();
        const dragRows = (await popJs(`(function(){var rows=document.querySelectorAll(".vtab[data-id]");var n=0;for(var i=0;i<rows.length;i++)if(rows[i].getAttribute("data-drag-row")==="1")n++;return n;})()`)) || 0;
        await js("window.lgChrome.popupHide()");
        await setVt({ vtabCollapsed: false });
        out.drag = { pinIn, pinOut, noZone, marks, pinMarks, viaPopup, dragRows };
        out.dragPass = !!(
          pinIn.idx === 0 && pinIn.pinned && pinOut.pinned === false && pinOut.idx === pinOut.last && pinOut.pins === 2 &&
          noZone.pinned && noZone.idx < noZone.pinnedCount &&
          marks.before && marks.cleared && pinMarks.zone &&
          viaPopup.ok && viaPopup.pinned && viaPopup.idx === 0 && dragRows > 0
        );
      } catch (e) { out.dragErr = String((e && e.stack) || e); out.dragPass = false; }
      flush();

      /* ---------- 3) 分组 Edge 式：组块渲染 + 多选建组 + 折叠 + 就地改名 ---------- */
      try {
        const g1 = mkTab("https://lg-v37-g1.invalid/");
        const g2 = mkTab("https://lg-v37-g2.invalid/");
        const g3 = mkTab("https://lg-v37-g3.invalid/");
        created.push(g1, g2, g3);
        await sleep(600);
        const g = createGroupFromTabs([g1, g2, g3]);
        await sleep(500);
        const idxs = groupMembers(g.id).map((x) => tabOrder.indexOf(x)).sort((x, y) => x - y);
        const contig = idxs.length === 3 && idxs[2] - idxs[0] === 2;
        const pc = tabOrder.filter((x) => tabs.get(x) && tabs.get(x).pinned).length;
        const pinnedOk = tabOrder.slice(0, pc).every((x) => tabs.get(x) && tabs.get(x).pinned);
        const dom = JSON.parse(
          await js(`(function(){var g=document.querySelector("#vtabs .vgroup");if(!g)return JSON.stringify({err:"no-group"});
            var head=g.querySelector(".vghead");var mem=g.querySelector(".vtab");
            var plain=document.querySelector("#vtabs > .vtab");
            return JSON.stringify({head:!!head,arrow:!!(head&&head.querySelector(".g-arrow")),dot:!!(head&&head.querySelector(".g-dot")),
              members:g.querySelectorAll(".vtab").length,bl:parseFloat(getComputedStyle(g).borderLeftWidth),
              padMem:mem?parseFloat(getComputedStyle(mem).paddingLeft):null,padPlain:plain?parseFloat(getComputedStyle(plain).paddingLeft):null});})()`)
        );
        updateGroup(g.id, { collapsed: true });
        await sleep(350);
        const col = JSON.parse(
          await js(`(function(){var g=document.querySelector("#vtabs .vgroup");if(!g)return JSON.stringify({err:"no-group"});return JSON.stringify({collapsed:g.classList.contains("collapsed"),members:g.querySelectorAll(".vtab").length,count:!!g.querySelector(".g-count")});})()`)
        );
        updateGroup(g.id, { collapsed: false });
        await sleep(350);
        const ren = JSON.parse(
          await js(`(function(){var n=document.querySelector("#vtabs .vgroup .vghead .g-name");if(!n)return JSON.stringify({err:"no-name"});n.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));var ed=n.getAttribute("contenteditable")==="true";n.textContent="改名测试";n.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return JSON.stringify({editable:ed});})()`)
        );
        await sleep(450);
        const renamed = (tabGroups.get(g.id) || {}).name === "改名测试";
        const sel = JSON.parse(
          await js(`(function(){selToggle(${g1});selRange(${g3});return JSON.stringify({n:selIds.length,painted:document.querySelectorAll(".vtab.sel").length});})()`)
        );
        const menu = await invokeFor("tab:context-menu", { id: g1, sel: [g1, g2, g3] });
        const hasSelItem = !!(menu && menu.items && menu.items.some((l) => String(l).includes("新建分组")));
        await js("selClear()");
        out.groups = { contig, pinnedOk, dom, col, ren, renamed, sel, hasSelItem };
        out.groupsPass = !!(
          g && contig && pinnedOk && dom.head && dom.arrow && dom.dot && dom.members === 3 &&
          dom.bl >= 2 && dom.padMem > dom.padPlain &&
          col.collapsed && col.members === 0 && col.count &&
          ren.editable && renamed &&
          sel.n === 3 && sel.painted >= 3 && hasSelItem
        );
      } catch (e) { out.groupsErr = String((e && e.stack) || e); out.groupsPass = false; }
      flush();

      /* ---------- 4) 悬停卡片已删除（R38 用户要求"左上角那张卡片删掉"）----------
         水平模式下它固定弹在窗口左上角（x 固定 12、y 夹到 8），与鼠标位置无关；
         用户要求删除。这里断言删除干净：外壳没有 scheduleTabTip/cancelTabTip、
         预加载桥没有 tabTip/tabTipHide、主进程没有卡片视图。 */
      try {
        const shellFn = await js('typeof scheduleTabTip + "|" + typeof cancelTabTip');
        const bridge = await js('typeof window.lgChrome.tabTip + "|" + typeof window.lgChrome.tabTipHide');
        out.tip = { shellFn, bridge, view: typeof tabTipView };
        out.tipPass = shellFn === "undefined|undefined" && bridge === "undefined|undefined" && out.tip.view === "undefined";
      } catch (e) { out.tipErr = String((e && e.stack) || e); out.tipPass = false; }
      flush();

      /* ---------- 5) 宽度可拖：夹取 + 落盘 + inset/--vtab-w 同源 ---------- */
      try {
        await setVt({ verticalTabs: true, vtabCollapsed: false, vtabSide: "left" });
        await invokeFor("vtab:set-width", 500);
        await sleep(350);
        const wide = { cfgW: cfg.vtabWidth, insetX: inset().x, shellW: await js('getComputedStyle(document.documentElement).getPropertyValue("--vtab-w").trim()') };
        await invokeFor("vtab:set-width", 10);
        await sleep(350);
        const narrow = { cfgW: cfg.vtabWidth, insetX: inset().x };
        await invokeFor("vtab:set-width", 212);
        await sleep(350);
        const cfgFile = JSON.parse(fsx.readFileSync(configPath(), "utf8"));
        out.width = { wide, narrow, fileW: cfgFile.vtabWidth, cfgW: cfg.vtabWidth, insetX: inset().x };
        out.widthPass = !!(
          wide.cfgW === 400 && wide.insetX === 400 && wide.shellW === "400px" &&
          narrow.cfgW === 160 && narrow.insetX === 160 &&
          out.width.fileW === 212 && out.width.cfgW === 212 && out.width.insetX === 212
        );
      } catch (e) { out.widthErr = String((e && e.stack) || e); out.widthPass = false; }
      flush();

      /* ---------- 6) 侧栏可放右侧：几何镜像 ---------- */
      try {
        await setVt({ verticalTabs: true, vtabCollapsed: true, vtabWidth: 212, vtabSide: "right" });
        const [winW] = mainWin.getContentSize();
        const insR = inset();
        const at = tabs.get(activeTabId);
        const vb = at && at.view ? at.view.getBounds() : null;
        const noSplit = !(activeTabId != null && splitGroupOf(activeTabId));
        const shellR = JSON.parse(
          await js(`(function(){var t=document.getElementById("top"),v=document.getElementById("vtab");var cs=getComputedStyle(t),cv=getComputedStyle(v);return JSON.stringify({topLeft:Math.round(parseFloat(cs.left)),topRight:Math.round(parseFloat(cs.right)),vtabRight:Math.round(parseFloat(cv.right)),vtabTop:Math.round(parseFloat(cv.top)),side:document.body.dataset.side});})()`)
        );
        const fitR = await openFlyout();
        const winHR = mainWin.getContentSize()[1];
        const docRRaw = await popJs(`(function(){var f=document.getElementById("tab-flyout");if(!f)return null;var r=f.getBoundingClientRect();var cs=getComputedStyle(f);var bf=getComputedStyle(f,"::before");return JSON.stringify({left:Math.round(r.left),top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),radius:cs.borderTopLeftRadius,bfw:bf.width,bfh:bf.height,side:document.body.dataset.side});})()`);
        const docR = docRRaw ? JSON.parse(docRRaw) : null;
        const pbR = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
        const visR = await js('getComputedStyle(document.getElementById("vtab")).visibility');
        await js("window.lgChrome.popupHide()");
        await sleep(150);
        await setVt({ vtabCollapsed: false }); // 常驻展开：外壳右侧条（top:VHEAD_H → 底）同矩形
        await sleep(400);
        const stripR = JSON.parse(
          await js('(function(){var r=document.getElementById("vtab").getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()')
        );
        out.right = { ins: insR, view: vb, noSplit, shell: shellR, fit: fitR, doc: docR, pb: pbR, vis: visR, strip: stripR, winW, winH: winHR, expandedW: vtabExpandedW() };
        out.rightPass = !!(
          insR.x === 0 && insR.right === 46 && vb && vb.x === 0 && (noSplit ? vb.width === winW - 46 : true) &&
          shellR.topLeft === 0 && shellR.topRight === 46 && shellR.vtabRight === 0 && shellR.vtabTop === VHEAD_H && shellR.side === "right" &&
          fitR && fitR.originX === winW - vtabExpandedW() && fitR.originY === VHEAD_H &&
          fitR.contentH === winHR - VHEAD_H && fitR.pad.l === 0 && fitR.pad.t === 0 && fitR.pad.r === 0 && fitR.pad.b === 0 &&
          pbR && pbR.x === fitR.originX && pbR.y === fitR.originY && pbR.width === fitR.contentW && pbR.height === fitR.contentH &&
          visR === "hidden" &&
          docR && docR.side === "right" && docR.w === vtabExpandedW() && docR.h === winHR - VHEAD_H && docR.radius === "0px" &&
          docR.bfw === winW + "px" && docR.bfh === winHR + "px" && // 假壁纸按整个窗口铺
          stripR.x === fitR.originX && stripR.y === VHEAD_H && stripR.w === fitR.contentW && stripR.h === winHR - VHEAD_H
        );
        await setVt({ vtabCollapsed: true });
        await setVt({ vtabSide: "left" });
      } catch (e) { out.rightErr = String((e && e.stack) || e); out.rightPass = false; }
      flush();

      /* ---------- 7) 搜索标签页大列表（图标 + 标题 + 网址 + 计数） ---------- */
      try {
        await js("openTabSearch()");
        await sleep(350);
        const pal = JSON.parse(
          await js(`(function(){var p=document.getElementById("palette");var rows=document.querySelectorAll("#pal-list .pal-item");var f=rows[0];return JSON.stringify({open:!p.hidden,tabs:p.classList.contains("pal-tabs"),rows:rows.length,head:(document.querySelector("#pal-list .pal-head")||{}).textContent||"",hasIcon:!!(f&&f.querySelector(".t-icon")),hasSub:!!(f&&f.querySelector(".pal-hint")),ph:document.getElementById("pal-input").placeholder});})()`)
        );
        await js("closePalette()");
        out.search = pal;
        out.searchPass = !!(pal.open && pal.tabs && pal.rows === tabs.size && pal.head.includes("个标签") && pal.hasIcon && pal.hasSub && pal.ph.includes("搜索标签页"));
      } catch (e) { out.searchErr = String((e && e.stack) || e); out.searchPass = false; }
      flush();

      /* ---------- 收尾：恢复姿态、清掉探针标签 ---------- */
      try {
        for (const id of created) if (tabs.has(id)) closeTab(id);
        for (const gid of Array.from(tabGroups.keys())) {
          if (!groupMembers(gid).length) tabGroups.delete(gid);
        }
        Object.assign(cfg, savedVt);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(300);
        out.restored = {
          verticalTabs: cfg.verticalTabs === savedVt.verticalTabs,
          collapsed: cfg.vtabCollapsed === savedVt.vtabCollapsed,
          width: cfg.vtabWidth === savedVt.vtabWidth,
          side: cfg.vtabSide === savedVt.vtabSide,
        };
      } catch (e) { out.restoreErr = String(e); }
      out.pass = !!(out.hoverPass && out.dragPass && out.groupsPass && out.tipPass && out.widthPass && out.rightPass && out.searchPass);
      flush();
    } else if (argv.includes("--lg-v38test")) {
      /* v3.8.0 六项：
         1) 悬停交接——浮层画好才收窄条（握手面包屑 = 真的收到 popup 的信号，
            不是 320ms 兜底兜的；交接的两帧里两侧像素相同，所以不闪）；
         2) 折叠窄条头部 = 三角 + 钉子（R36 起钉子回到窄条：用户报"固定功能不可用"）；
            状态图标 = 钉子（钉住竖直实心 / 未钉斜 40°）；
         3) 垂直顶栏两行（38 标题行居中 + 42 工具行）+ 页面 inset().y = 80；
         4) 坞四个位置：外壳矩形与页面让位（inset）同源，页面视图真的让开了；
         5) 页面缩放时壁纸不被缩放（--lg-zoom 反向补偿：物理像素仍等于窗口）；
         6) 验证码 OCR 链路（python + ddddocr 常驻进程，READY + 一次往返）。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1000);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(450);
      };
      const rectOf = (sel) =>
        js('(function(){var e=document.getElementById(' + JSON.stringify(sel) + ');if(!e)return null;var r=e.getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),r:Math.round(window.innerWidth-r.right),b:Math.round(window.innerHeight-r.bottom),w:Math.round(r.width),h:Math.round(r.height),disp:getComputedStyle(e).display,vis:getComputedStyle(e).visibility})})()');

      /* ---------- 1) 悬停交接 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockPos: "auto" });
        /* 预热一次：弹层视图懒创建（首次要建视图 + 载文档 + 解码壁纸），fitRect
           会慢到错过 320ms 兜底 → 面包屑记 "timeout"（探针实例里尤其明显）。
           先空开一次再测，量到的才是稳态——真实可见窗口里首开也只有 2 帧的事。 */
        try {
          await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
          for (let i = 0; i < 60; i++) { await sleep(50); if (popupFit && popupFit.fullH) break; }
          stopFlyoutWatch();
          await js("window.lgChrome.popupHide()");
          await sleep(800);
        } catch (e) {}
        await js('delete document.body.dataset.flyoutHandoff');
        await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
        let fit = null;
        for (let i = 0; i < 90; i++) { await sleep(30); if (popupFit && popupFit.fullH) { fit = { ...popupFit }; break; } }
        stopFlyoutWatch(); // 探针自己看，别让光标裁判把它收走
        /* 交接标记要轮询等：探针实例是隐藏窗口（opacity 0），rAF 与定时器会被
           节流——弹层那边双 rAF + 48ms 定时器兜底才发得出信号，外壳这边的
           320ms 兜底也会晚。真实（可见）窗口里是 2 帧 ≈ 33ms 的事。 */
        const t0 = Date.now();
        let ho = { handoff: "", railVis: "", open: false };
        let handoffMs = -1;
        for (let i = 0; i < 80; i++) {
          ho = JSON.parse(await js('JSON.stringify({handoff:document.body.dataset.flyoutHandoff||"",railVis:getComputedStyle(document.getElementById("vtab")).visibility,open:document.body.classList.contains("flyout-open")})'));
          if (ho.handoff) { handoffMs = Date.now() - t0; break; }
          await sleep(100);
        }
        const popDoc = popupView && !popupView.webContents.isDestroyed()
          ? await popupView.webContents.executeJavaScript('(function(){var f=document.getElementById("tab-flyout");if(!f)return null;var r=f.getBoundingClientRect();return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)})})()', true).catch(() => null)
          : null;
        const railVisAfter = await js('getComputedStyle(document.getElementById("vtab")).visibility');
        await js("window.lgChrome.popupHide()");
        await sleep(500);
        const railBack = await js('getComputedStyle(document.getElementById("vtab")).visibility');
        out.handoff = { fit: !!fit, fullH: !!(fit && fit.fullH), ho, handoffMs, railVisAfter, popDoc, railBack };
        out.handoffPass = !!(fit && fit.fullH && ho.handoff === "1" && handoffMs >= 0 && railVisAfter === "hidden" && ho.open && railBack === "visible" && popDoc);
      } catch (e) { out.handoffErr = String((e && e.stack) || e); out.handoffPass = false; }
      flush();

      /* ---------- 2) 窄条头部 / 钉子 ---------- */
      try {
        await setCfg({ vtabCollapsed: true });
        const rail = JSON.parse(await js('(function(){var p=document.getElementById("btn-vpin"),c=document.getElementById("btn-vcollapse");return JSON.stringify({pin:getComputedStyle(p).display,col:getComputedStyle(c).display,pinHTML:p.innerHTML})})()'));
        await setCfg({ vtabCollapsed: false });
        const exp = JSON.parse(await js('(function(){var p=document.getElementById("btn-vpin");return JSON.stringify({display:getComputedStyle(p).display,html:p.innerHTML,title:p.title})})()'));
        out.railHead = { rail, exp };
        /* R36：钉子回到窄条上（"固定功能不可用"的反馈）——窄条两颗都可点；
           斜钉（未钉住）在窄条与展开态都按状态画 */
        out.railHeadPass = !!(rail.pin !== "none" && rail.col !== "none" && /rotate\(40/.test(rail.pinHTML) === true &&
          exp.display !== "none" && /rotate\(40/.test(exp.html) === false && /fill="currentColor"/.test(exp.html) && /钉住|收起侧栏/.test(exp.title));
      } catch (e) { out.railHeadErr = String((e && e.stack) || e); out.railHeadPass = false; }
      flush();

      /* ---------- 3) 垂直顶栏两行 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabSide: "left" });
        const [winW, winH] = mainWin.getContentSize();
        const hd = JSON.parse(await js('(function(){var top=document.getElementById("top"),tr=document.getElementById("titlerow"),nr=document.getElementById("navrow"),cur=document.getElementById("vtab-current"),wc=document.getElementById("wctl");var rt=top.getBoundingClientRect(),rtr=tr.getBoundingClientRect(),rnr=nr.getBoundingClientRect(),rc=cur.getBoundingClientRect(),rw=wc.getBoundingClientRect();return JSON.stringify({topH:Math.round(rt.height),trH:Math.round(rtr.height),trY:Math.round(rtr.top),trDisplay:getComputedStyle(tr).display,nrH:Math.round(rnr.height),nrY:Math.round(rnr.top),curCx:Math.round(rc.left+rc.width/2),curVisible:getComputedStyle(cur).display!=="none",wctlH:Math.round(rw.height),wctlRightGap:Math.round(window.innerWidth-rw.right),wctlTop:Math.round(rw.top),hvar:getComputedStyle(document.body).getPropertyValue("--header-h").trim()})})()'));
        const ins = inset();
        // 标题行的内容盒 = [侧栏右缘 + 12px 左内边距, 窗口右缘 - 138px 三键]
        const expectMid = Math.round((ins.x + 12 + (winW - 138)) / 2);
        out.header = { hd, ins, winW, winH, expectMid };
        out.headerPass = !!(hd.topH === 80 && hd.trH === 38 && hd.nrH === 42 && hd.trY === 0 && hd.nrY === 38 && hd.trDisplay === "flex" &&
          hd.curVisible && Math.abs(hd.curCx - expectMid) <= 3 && hd.wctlH === 38 && hd.wctlRightGap === 0 && hd.wctlTop === 0 &&
          hd.hvar === "80px" && ins.y === 80);
      } catch (e) { out.headerErr = String((e && e.stack) || e); out.headerPass = false; }
      flush();

      /* ---------- 4) 坞：独立覆盖视图，页面从它底下穿过（R36 口径） ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockItems: [{ icon: "home", title: "首页", href: "@home" }] });
        await sleep(700); // 坞视图量尺寸 + 落位
        const res = {};
        const cases = [["left", "left"], ["right", "left"], ["top", "left"], ["bottom", "left"], ["right", "right"]];
        for (const [pos, side] of cases) {
          await setCfg({ dockPos: pos, vtabSide: side });
          await sleep(550);
          const [w2, h2] = mainWin.getContentSize();
          const ins = inset();
          const at = tabs.get(activeTabId);
          const vb = at && at.view ? at.view.getBounds() : null;
          const db = dockView && !dockView.webContents.isDestroyed() ? dockView.getBounds() : null;
          const cap = { ...dockCapsule };
          const M = 6;
          const availX = ins.x;
          const availW = w2 - ins.x - (ins.right || 0);
          const availY = ins.y;
          const availH = h2 - ins.y - (ins.footer || 0);
          let ex = 0;
          let ey = 0;
          if (pos === "left") { ex = availX + M; ey = availY + Math.round((availH - cap.h) / 2); }
          else if (pos === "right") { ex = availX + availW - cap.w - M; ey = availY + Math.round((availH - cap.h) / 2); }
          else if (pos === "top") { ex = availX + Math.round((availW - cap.w) / 2); ey = availY + M; }
          else { ex = availX + Math.round((availW - cap.w) / 2); ey = availY + availH - cap.h - M; }
          const expX = side === "right" ? 0 : 46;
          const expRight = side === "right" ? 46 : 0;
          const noPad = ins.x === expX && (ins.right || 0) === expRight && ins.y === 80 && (ins.footer || 0) === 0;
          const viewOk = !!vb && vb.x === ins.x && vb.y === ins.y && vb.width === availW && vb.height === availH;
          const dockOk = !!db && cap.w > 0 && db.x === ex && db.y === ey && db.width === cap.w && db.height === cap.h;
          /* 页面内容从坞底下穿过：页面矩形必须完整覆盖坞矩形 */
          const overlap = !!vb && !!db && vb.x <= db.x && vb.y <= db.y && vb.x + vb.width >= db.x + db.width && vb.y + vb.height >= db.y + db.height;
          const srcHidden = await js('(function(){var e=document.getElementById("dock");return !e||getComputedStyle(e).display==="none"})()');
          const key = pos + (side === "right" ? "R" : "");
          res[key] = { ins, view: vb, dock: db, cap, expect: { x: ex, y: ey }, dataDock: await js("document.body.dataset.dock"), noPad, viewOk, dockOk, overlap, srcHidden, ok: noPad && viewOk && dockOk && overlap && srcHidden };
        }
        await setCfg({ dockPos: "auto", vtabSide: "left" });
        out.dock = res;
        out.dockPass = Object.keys(res).every((k) => res[k].ok && res[k].dataDock === (k === "rightR" ? "right" : k));
      } catch (e) { out.dockErr = String((e && e.stack) || e); out.dockPass = false; }
      flush();

      /* ---------- 5) 页面缩放时壁纸不缩放 ---------- */
      try {
        const hid = createHomeTab(true);
        await sleep(1400);
        const t = tabs.get(hid);
        const [winW, winH] = mainWin.getContentSize();
        setZoom(t, 1.5);
        await sleep(1200);
        const zw = JSON.parse(await t.view.webContents.executeJavaScript('(function(){var bg=document.getElementById("lg-glass-bg");return JSON.stringify({z:String(document.documentElement.style.getPropertyValue("--lg-zoom")||""),w:bg?bg.offsetWidth:0,h:bg?bg.offsetHeight:0})})()', true));
        const wall = JSON.parse(await js('(function(){var e=document.getElementById("wall");var r=e.getBoundingClientRect();return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)})})()'));
        out.zoom = { zoom: 1.5, page: zw, physW: Math.round(zw.w * 1.5), physH: Math.round(zw.h * 1.5), winW, winH, shellWall: wall };
        out.zoomPass = !!(zw.z === "1.5" && zw.w > 0 && Math.abs(out.zoom.physW - winW) <= 4 && Math.abs(out.zoom.physH - winH) <= 4);
        setZoom(t, 1);
        await sleep(400);
      } catch (e) { out.zoomErr = String((e && e.stack) || e); out.zoomPass = false; }
      flush();

      /* ---------- 6) 验证码 OCR ---------- */
      try {
        const cmd = ocrCmd();
        ocrStart();
        let ready = false;
        for (let i = 0; i < 250 && !ready && !ocrDead; i++) { await sleep(100); ready = ocrReady; }
        const dataUrl = await js('(function(){var c=document.createElement("canvas");c.width=140;c.height=44;var g=c.getContext("2d");g.fillStyle="#ffffff";g.fillRect(0,0,140,44);g.fillStyle="#111111";g.font="30px monospace";g.fillText("8426",10,33);return c.toDataURL("image/png")})()');
        const ans = ready ? await captchaOcrSolve(dataUrl) : "";
        out.ocr = { cmd, ready, dead: ocrDead, imgBytes: String(dataUrl).length, ans, expect: "8426" };
        out.ocrPass = !!(ready && typeof ans === "string");
        try { ocrStop(); } catch (e) {}
      } catch (e) { out.ocrErr = String((e && e.stack) || e); out.ocrPass = false; }
      flush();

      out.pass = !!(out.handoffPass && out.railHeadPass && out.headerPass && out.dockPass && out.zoomPass && out.ocrPass);
      flush();
    } else if (argv.includes("--lg-v39test")) {
      /* v3.9.0（R36）八项：
         1) 坞 = 独立覆盖视图：页面不再让位（inset 无 pad）、坞胶囊四位置居中、
            页面矩形完整覆盖坞矩形（内容从它底下穿过）、外壳里的 #dock 恒隐；
         2) 网页 HTML 全屏：坞隐藏 + 视图落整窗，退出恢复（先试真 Fullscreen API，
            隐藏窗口没用户手势时退化为 emit 事件，断言的是我们自己的处理链）；
         3) 钉子状态机：三个起点（窄条 / 常驻展开 / 展开+紧凑）各点一下都有
            可见效果（宽度 46↔212 且 rail/compact 翻转）；窄条上钉子可点；
         4) 浮层收回握手：关路径面包屑 = ack（不是 140ms 兜底），浮层里的钉子
            有 data-pop 回传键；
         5) 缩放提示：标签上无缩放徽标、右上角 #zoomhud 显示比例且 ≠100% 常驻；
         6) 头像芯片贴右缘（navrow 不再为三键留 138px）；
         7) 图标/文字标尺：关键选择器的 computed 尺寸 === 标尺值（含坞视图里的）；
         8) 题目页工具条已删（配置键不存在）。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1000);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(450);
      };
      const savedVt = { verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact, vtabSide: cfg.vtabSide, dockPos: cfg.dockPos, dockItems: cfg.dockItems };

      /* ---------- 1) 坞覆盖视图 + 页面从它底下穿过 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockPos: "auto", dockItems: [{ icon: "home", title: "首页", href: "@home" }] });
        await sleep(800); // 坞视图量尺寸 + 落位
        const res = {};
        const cases = [["left", "left"], ["right", "left"], ["top", "left"], ["bottom", "left"], ["right", "right"]];
        for (const [pos, side] of cases) {
          await setCfg({ dockPos: pos, vtabSide: side });
          await sleep(600);
          const [w2, h2] = mainWin.getContentSize();
          const ins = inset();
          const at = tabs.get(activeTabId);
          const vb = at && at.view ? at.view.getBounds() : null;
          const db = dockView && !dockView.webContents.isDestroyed() ? dockView.getBounds() : null;
          const cap = { ...dockCapsule };
          const M = 6;
          const availX = ins.x;
          const availW = w2 - ins.x - (ins.right || 0);
          const availY = ins.y;
          const availH = h2 - ins.y - (ins.footer || 0);
          let ex = 0;
          let ey = 0;
          if (pos === "left") { ex = availX + M; ey = availY + Math.round((availH - cap.h) / 2); }
          else if (pos === "right") { ex = availX + availW - cap.w - M; ey = availY + Math.round((availH - cap.h) / 2); }
          else if (pos === "top") { ex = availX + Math.round((availW - cap.w) / 2); ey = availY + M; }
          else { ex = availX + Math.round((availW - cap.w) / 2); ey = availY + availH - cap.h - M; }
          const expX = side === "right" ? 0 : 46;
          const expRight = side === "right" ? 46 : 0;
          const noPad = ins.x === expX && (ins.right || 0) === expRight && ins.y === 80 && (ins.footer || 0) === 0;
          const viewOk = !!vb && vb.x === ins.x && vb.y === ins.y && vb.width === availW && vb.height === availH;
          const dockOk = !!db && cap.w > 0 && db.x === ex && db.y === ey && db.width === cap.w && db.height === cap.h;
          /* 页面内容从坞底下穿过：页面矩形必须完整覆盖坞矩形 */
          const overlap = !!vb && !!db && vb.x <= db.x && vb.y <= db.y && vb.x + vb.width >= db.x + db.width && vb.y + vb.height >= db.y + db.height;
          const srcHidden = await js('(function(){var e=document.getElementById("dock");return !e||getComputedStyle(e).display==="none"})()');
          const key = pos + (side === "right" ? "R" : "");
          res[key] = { ins, view: vb, dock: db, cap, expect: { x: ex, y: ey }, dataDock: await js("document.body.dataset.dock"), noPad, viewOk, dockOk, overlap, srcHidden, ok: noPad && viewOk && dockOk && overlap && srcHidden };
        }
        await setCfg({ dockPos: "auto", vtabSide: "left" });
        out.dock = res;
        out.dockPass = Object.keys(res).every((k) => res[k].ok && res[k].dataDock === (k === "rightR" ? "right" : k));
      } catch (e) { out.dockErr = String((e && e.stack) || e); out.dockPass = false; }
      flush();

      /* ---------- 2) 网页 HTML 全屏：坞隐藏 + 视图落整窗 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockPos: "bottom", dockItems: [{ icon: "home", title: "首页", href: "@home" }] });
        await sleep(700);
        const t = tabs.get(activeTabId);
        const before = { dockShown, dock: dockShown ? dockView.getBounds() : null, view: t && t.view ? t.view.getBounds() : null };
        /* 真 API 先试（隐藏窗口没有用户手势，Chromium 可能直接拒绝）；无论成败
           再用 emit 事件走一遍处理链——断言的是坞隐藏 + 视图落整窗 + 退出恢复 */
        let apiOn = false;
        try {
          await t.view.webContents.executeJavaScript(
            '(function(){var d=document.createElement("div");d.id="lg-fs-probe";document.body.appendChild(d);var p=d.requestFullscreen&&d.requestFullscreen();if(p&&p.catch)p.catch(function(){});return !!p})()',
            true
          );
          for (let i = 0; i < 20; i++) { await sleep(100); if (htmlFullscreenTabId != null) { apiOn = true; break; } }
        } catch (e) {}
        if (!apiOn) {
          try { t.view.webContents.emit("enter-html-full-screen"); } catch (e) {}
          for (let i = 0; i < 20; i++) { await sleep(100); if (htmlFullscreenTabId != null) break; }
        }
        await sleep(500);
        const [w3, h3] = mainWin.getContentSize();
        const mid = { fsTab: htmlFullscreenTabId, dockHidden: !dockShown, view: t && t.view ? t.view.getBounds() : null, win: [w3, h3] };
        if (apiOn) {
          await t.view.webContents.executeJavaScript('(document.exitFullscreen&&document.exitFullscreen())||true', true).catch(() => {});
        } else {
          try { t.view.webContents.emit("leave-html-full-screen"); } catch (e) {}
        }
        let fsOff = false;
        for (let i = 0; i < 30; i++) { await sleep(100); if (htmlFullscreenTabId == null) { fsOff = true; break; } }
        await sleep(600);
        const after = { dockShown, view: t && t.view ? t.view.getBounds() : null };
        out.fullscreen = { apiOn, before, mid, fsOff, after };
        out.fullscreenPass = !!(mid.fsTab != null && mid.dockHidden && mid.view && mid.view.x === 0 && mid.view.y === 0 &&
          mid.view.width === w3 && mid.view.height === h3 && fsOff && after.dockShown &&
          before.view && after.view && after.view.x === before.view.x && after.view.y === before.view.y);
      } catch (e) { out.fullscreenErr = String((e && e.stack) || e); out.fullscreenPass = false; }
      flush();

      /* ---------- 3) 钉子状态机：任何起点第一下都有可见效果 ---------- */
      try {
        const pinState = async () => JSON.parse(await js('JSON.stringify({rail:document.body.classList.contains("rail"),compact:document.body.classList.contains("compact"),pinDisplay:getComputedStyle(document.getElementById("btn-vpin")).display,pinHTML:document.getElementById("btn-vpin").innerHTML})'));
        const st = {};
        for (const [name, start] of [["rail", { vtabCollapsed: true, vtabCompact: false }], ["expanded", { vtabCollapsed: false, vtabCompact: false }], ["expandedCompact", { vtabCollapsed: false, vtabCompact: true }]]) {
          await setCfg({ verticalTabs: true, vtabSide: "left", ...start });
          const before = await pinState();
          const beforeIns = inset().x;
          const resp = await js('window.lgChrome.toggleVtab()');
          await sleep(600);
          const after = await pinState();
          const afterIns = inset().x;
          const visBefore = !before.rail && !before.compact;
          const visAfter = !after.rail && !after.compact;
          st[name] = { before, after, beforeIns, afterIns, resp, visBefore, visAfter, ok: visBefore !== visAfter && beforeIns !== afterIns && !!(resp && resp.ok) };
        }
        await setCfg({ vtabCollapsed: true, vtabCompact: false });
        const railPin = await pinState();
        out.pin = { st, railPin };
        out.pinPass = !!(st.rail.ok && st.expanded.ok && st.expandedCompact.ok && railPin.rail && railPin.pinDisplay !== "none" && /rotate\(40/.test(railPin.pinHTML));
      } catch (e) { out.pinErr = String((e && e.stack) || e); out.pinPass = false; }
      flush();

      /* ---------- 4) 浮层收回握手：面包屑 = ack ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left" });
        await js('delete document.body.dataset.flyoutClose');
        await js('delete document.body.dataset.flyoutHandoff');
        await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
        let fit = null;
        for (let i = 0; i < 90; i++) { await sleep(30); if (popupFit && popupFit.fullH) { fit = { ...popupFit }; break; } }
        /* 交接信号要轮询等：探针实例是隐藏窗口，rAF 与定时器会被节流（同 v38） */
        let shown = false;
        let handoff = "";
        for (let i = 0; i < 100; i++) {
          await sleep(100);
          const s = JSON.parse(await js('JSON.stringify({open:document.body.classList.contains("flyout-open"),handoff:document.body.dataset.flyoutHandoff||""})'));
          shown = s.open;
          handoff = s.handoff;
          if (shown) break;
        }
        stopFlyoutWatch(); // 探针自己看，别让光标裁判把它收走
        /* 浮层里那颗钉子真的有回传键（"盖住窄条 ≠ 点不到"） */
        const popKey = popupView && !popupView.webContents.isDestroyed()
          ? await popupView.webContents.executeJavaScript('(function(){var p=document.getElementById("btn-vpin");return p?p.getAttribute("data-pop"):null})()', true).catch(() => null)
          : null;
        popupHideHandoff = "";
        await js("window.lgChrome.popupHide()");
        let ack = "";
        for (let i = 0; i < 40; i++) { await sleep(50); ack = popupHideHandoff; if (ack) break; }
        const railBack = await js('getComputedStyle(document.getElementById("vtab")).visibility');
        out.closeHandoff = { fit: !!fit, shown, handoff, popKey, ack, railBack };
        out.closeHandoffPass = !!(fit && shown && popKey && ack === "ack" && railBack === "visible");
      } catch (e) { out.closeHandoffErr = String((e && e.stack) || e); out.closeHandoffPass = false; }
      flush();

      /* ---------- 5) 缩放提示：标签无徽标 + 右上角 HUD ---------- */
      try {
        const t = tabs.get(activeTabId);
        setZoom(t, 1.25);
        await sleep(800);
        const hud = JSON.parse(await js('(function(){var h=document.getElementById("zoomhud");var r=h.getBoundingClientRect();return JSON.stringify({text:h.textContent,on:h.classList.contains("on"),hot:h.classList.contains("hot"),vis:getComputedStyle(h).visibility,rightGap:Math.round(window.innerWidth-r.right),top:Math.round(r.top)})})()'));
        const tabBadges = await js('document.querySelectorAll(".t-zoom").length');
        setZoom(t, 1);
        await sleep(800);
        const back = JSON.parse(await js('(function(){var h=document.getElementById("zoomhud");return JSON.stringify({text:h.textContent,on:h.classList.contains("on"),hot:h.classList.contains("hot")})})()'));
        out.zoomHud = { at125: hud, tabBadges, backTo100: back };
        out.zoomHudPass = !!(hud.text === "125%" && hud.on && hud.vis === "visible" && hud.rightGap >= 140 && hud.rightGap <= 150 && hud.top <= 40 &&
          tabBadges === 0 && back.text === "100%" && !back.on);
      } catch (e) { out.zoomHudErr = String((e && e.stack) || e); out.zoomHudPass = false; }
      flush();

      /* ---------- 6) 头像芯片顶到右侧 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabSide: "left" });
        const chip = JSON.parse(await js('(function(){var c=document.getElementById("user-chip");var r=c.getBoundingClientRect();var nr=document.getElementById("navrow");return JSON.stringify({rightGap:Math.round(window.innerWidth-r.right),padRight:parseFloat(getComputedStyle(nr).paddingRight)})})()'));
        out.chip = chip;
        out.chipPass = !!(chip.rightGap <= 12 && chip.padRight <= 12);
      } catch (e) { out.chipErr = String((e && e.stack) || e); out.chipPass = false; }
      flush();

      /* ---------- 7) 图标/文字标尺（含坞视图） ---------- */
      try {
        const sizes = JSON.parse(await js(`JSON.stringify((function(){
          var q=function(s){return document.querySelector(s)};
          var box=function(s){var e=q(s);if(!e)return null;var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}};
          var fs=function(s){var e=q(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
          return {
            tabIcon: box("#tabs .tab .t-icon"),
            vtabIcon: box("#vtab .vtab .t-icon"),
            curIcon: box("#vtab-current .vc-icon"),
            headBtn: box("#vtab-head .icon-btn svg"),
            setIco: box("#vtab-set .vico svg"),
            omni: box("#omnibox svg"),
            tabFont: fs("#tabs .tab"),
            vtabFont: fs("#vtab .vtab"),
            hudFont: fs("#zoomhud")
          };
        })())`));
        const dockIcon = dockView && dockReady && !dockView.webContents.isDestroyed()
          ? await dockView.webContents.executeJavaScript('(function(){var e=document.querySelector("#dock a svg");return e?Math.round(e.getBoundingClientRect().width):null})()', true).catch(() => null)
          : null;
        const dockFace = dockView && dockReady && !dockView.webContents.isDestroyed()
          ? await dockView.webContents.executeJavaScript('(function(){var e=document.querySelector("#dock .dock-group");return e?{fake:e.classList.contains("lg-fake"),face:e.classList.contains("lg-face-b")}:null})()', true).catch(() => null)
          : null;
        out.sizes = { shell: sizes, dockIcon, dockFace };
        out.sizesPass = !!(sizes.vtabIcon && sizes.vtabIcon.w === 16 && (!sizes.tabIcon || sizes.tabIcon.w === 0 || sizes.tabIcon.w === 16) &&
          sizes.curIcon && sizes.curIcon.w === 16 && sizes.headBtn && sizes.headBtn.w === 16 && sizes.setIco && sizes.setIco.w === 16 &&
          sizes.omni && sizes.omni.w === 14 && sizes.vtabFont === 12.5 && (!sizes.tabFont || sizes.tabFont === 12.5) &&
          dockIcon === 20 && dockFace && dockFace.fake && dockFace.face);
      } catch (e) { out.sizesErr = String((e && e.stack) || e); out.sizesPass = false; }
      flush();

      /* ---------- 8) 题目页工具条已删（配置键与设置项都不在） ---------- */
      try {
        out.problemTools = { cfgKey: "problemEditor" in cfg };
        out.problemToolsPass = !out.problemTools.cfgKey;
      } catch (e) { out.problemToolsErr = String((e && e.stack) || e); out.problemToolsPass = false; }
      flush();

      /* 复原（探针不留痕：配置写回原值，坞回默认位） */
      try {
        await setCfg({ ...savedVt });
      } catch (e) {}
      out.pass = !!(out.dockPass && out.fullscreenPass && out.pinPass && out.closeHandoffPass && out.zoomHudPass && out.chipPass && out.sizesPass && out.problemToolsPass);
      flush();
    } else if (argv.includes("--lg-v310test")) {
      /* v3.10.0（R37）六项：
         1) 坞渲染：两颗胶囊各有定位上下文（.lg-fake position:relative，两块面
            不再互相盖）、每个坞项都有 svg path、--pop-x/y === 视图原点+offset+
            边框（假壁纸对齐）、#dock 有投影余量内边距；坞视图截图留档；
         2) IDE 模式（抽屉开着）→ 坞自动隐藏，关掉恢复；无抽屉/无分屏时 ideModeNow=false；
         3) 钉子三姿态同点：窄条 / 悬停浮层 / 常驻展开 的 #btn-vpin 窗口矩形全等；
            浮层里对钉子坐标 elementFromPoint 命中的就是钉子，且点一下真能钉住（落盘）；
         4) 主题嗅探：透明容器不许判 dark（旧 bug 的回归）、真深色判 dark、全透明判
            unknown；当前页 __lgNativeTheme 不是 dark、resolvedTheme 保持 light；
         5) 玻璃一致：跨标签（站点页 vs 本地页）--lg-glass-* 与 data-lg-theme/page/
            repaint 全等且非空；不带载荷的弹层文档里 material.css 首帧兜底值可见；
         6) 广告：三个会话都挂了拦截器；qiafan 请求被拦、对照请求放行（网络不可用记
            skip）；合成右栏推广卡 → 静态 :has 规则即时隐藏 + 清扫器打 data-lg-promo=1；
         7) IDE 原生：data-lg-ide="1" 时 Monaco 规则不生效（computed 背景 ≠ 玻璃档）、
            清扫器不给面贴 .lg-glass；"0" 时两者都恢复。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1200);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const pjs = (code) => {
        const t = tabs.get(activeTabId);
        return t && t.view && !t.view.webContents.isDestroyed()
          ? t.view.webContents.executeJavaScript(code, true)
          : Promise.reject(new Error("no-active-tab"));
      };
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(450);
      };
      /* 一次性 scratch 视图：跑嗅探/兜底这类"文档级"断言（不挂到窗口） */
      const scratch = async (url, expr) => {
        const v = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false } });
        try {
          await v.webContents.loadURL(url);
          return await v.webContents.executeJavaScript(expr, true);
        } finally {
          try { v.webContents.close(); } catch (e) {}
        }
      };
      const saved = { verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact, vtabSide: cfg.vtabSide, dockPos: cfg.dockPos, dockItems: cfg.dockItems };

      /* ---------- 1) 坞渲染 ---------- */
      try {
        await setCfg({
          verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockPos: "bottom",
          dockItems: [{ icon: "home", title: "首页", href: "@home" }, { icon: "list", title: "题库", href: "https://www.luogu.com.cn/problem/list" }],
        });
        await sleep(1400); // 坞视图量尺寸 + 落位
        const dv = dockView && !dockView.webContents.isDestroyed() ? dockView : null;
        if (!dv) throw new Error("no dock view");
        const g = JSON.parse(await dv.webContents.executeJavaScript(`(function(){
          var root = document.getElementById("dock");
          var de = document.documentElement;
          var vx = Number(de.dataset.lgViewX || 0), vy = Number(de.dataset.lgViewY || 0);
          var caps = [].slice.call(root.querySelectorAll(".dock-group, .dock-foot"));
          var items = [].slice.call(root.querySelectorAll("a[data-href]"));
          var svgOk = items.length > 0 && items.every(function (a) { var p = a.querySelector("svg path"); return !!p && (p.getAttribute("d") || "").length > 8; });
          var posOk = caps.length >= 2 && caps.every(function (el) { return getComputedStyle(el).position === "relative"; });
          var fakeOk = caps.length >= 2 && caps.every(function (el) { return el.classList.contains("lg-fake") && el.classList.contains("lg-face-b"); });
          var offOk = caps.every(function (el) {
            var cs = getComputedStyle(el);
            return Math.round(parseFloat(cs.getPropertyValue("--pop-x"))) === vx + el.offsetLeft + el.clientLeft &&
                   Math.round(parseFloat(cs.getPropertyValue("--pop-y"))) === vy + el.offsetTop + el.clientTop;
          });
          return JSON.stringify({ vx: vx, vy: vy, caps: caps.length, items: items.length, svgOk: svgOk, posOk: posOk, fakeOk: fakeOk, offOk: offOk,
            w: root.offsetWidth, h: root.offsetHeight, pad: parseFloat(getComputedStyle(root).paddingTop) });
        })()`, true));
        let shot = false;
        try {
          const img = await dv.webContents.capturePage();
          if (img && !img.isEmpty()) { fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-dock.png", img.toPNG()); shot = true; }
        } catch (e) {}
        out.dockRender = { ...g, shot };
        out.dockRenderPass = !!(g.items >= 3 && g.svgOk && g.posOk && g.fakeOk && g.offOk && g.pad >= 5 && g.w > 0 && g.h > 0);
      } catch (e) { out.dockRenderErr = String((e && e.stack) || e); out.dockRenderPass = false; }
      flush();

      /* ---------- 2) IDE 模式（抽屉）自动隐藏坞 ---------- */
      try {
        const r = { before: { ide: ideModeNow(), shown: dockShown } };
        toggleDrawer();
        await sleep(800);
        r.open = { ide: ideModeNow(), drawer: !!drawerOpen, shown: dockShown };
        toggleDrawer();
        await sleep(1000);
        r.closed = { ide: ideModeNow(), drawer: !!drawerOpen, shown: dockShown };
        out.dockIde = r;
        out.dockIdePass = !!(r.before.ide === false && r.before.shown === true && r.open.ide === true && r.open.drawer === true &&
          r.open.shown === false && r.closed.ide === false && r.closed.drawer === false && r.closed.shown === true);
      } catch (e) { out.dockIdeErr = String((e && e.stack) || e); out.dockIdePass = false; }
      flush();

      /* ---------- 3) 钉子三姿态同点 + 浮层里点得动 ---------- */
      try {
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left" });
        await sleep(800);
        const rectShell = async () => JSON.parse(await js('(function(){var e=document.getElementById("btn-vpin");var r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)})})()'));
        const snap = async (tag) => {
          try {
            const img = await mainWin.webContents.capturePage();
            if (img && !img.isEmpty()) fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-" + tag + ".png", img.toPNG());
          } catch (e) {}
        };
        const railRect = await rectShell();
        await snap("pin-rail");
        /* 悬停浮层：隐藏实例没有真光标，直接派发 mouseenter（v39 同法） */
        await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
        let fit = null;
        for (let i = 0; i < 90; i++) { await sleep(30); if (popupFit && popupFit.fullH) { fit = { ...popupFit }; break; } }
        for (let i = 0; i < 80; i++) { await sleep(100); if (popupShown) break; }
        stopFlyoutWatch(); // 探针自己看，别让光标裁判把它收走（v39 同法）
        /* 等浮层文档里的钉子真的画出来（隐藏实例首帧慢） */
        let flyPin = null;
        for (let i = 0; i < 40; i++) {
          if (!popupView || popupView.webContents.isDestroyed()) break;
          flyPin = await popupView.webContents.executeJavaScript('(function(){var e=document.getElementById("btn-vpin");return e?"yes":null})()', true).catch(() => null);
          if (flyPin) break;
          await sleep(150);
        }
        await sleep(300);
        await snap("pin-flyout");
        const pb = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
        const flyRaw = popupView && !popupView.webContents.isDestroyed()
          ? await popupView.webContents.executeJavaScript(`(function(){
              var e = document.getElementById("btn-vpin"); if (!e) return null;
              var r = e.getBoundingClientRect();
              var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return JSON.stringify({ x: ${pb ? pb.x : 0} + Math.round(r.left), y: ${pb ? pb.y : 0} + Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height), pop: e.getAttribute("data-pop") || "",
                hitPin: !!(el && (el === e || e.contains(el))), hitTag: el ? el.tagName : "" });
            })()`, true).catch(() => null)
          : null;
        let flyRect = null;
        try { flyRect = flyRaw ? JSON.parse(flyRaw) : null; } catch (e) { flyRect = null; }
        let clickRes = null;
        if (flyRect && flyRect.pop) {
          /* 弹层的取键监听在 **mousedown** 上（popup.js：拖拽行按下不动作，
             一般项按下即取键），合成 click 不会触发——这里按真实鼠标序列发 */
          await popupView.webContents.executeJavaScript(
            '(function(){var e=document.getElementById("btn-vpin");["mousedown","mouseup","click"].forEach(function(t){e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));});return 1})()',
            true
          ).catch(() => {});
          for (let i = 0; i < 40; i++) { await sleep(100); if (cfg.vtabCollapsed === false) break; }
          await sleep(600);
          clickRes = { collapsed: cfg.vtabCollapsed, railClass: await js('document.body.classList.contains("rail")'), ins: inset().x };
        }
        const pinnedRect = await rectShell(); // 点完钉子 = 常驻展开态
        const eq = (a, b) => !!a && !!b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
        out.pin = { railRect, flyRect, pinnedRect, flyPin: !!flyPin, fit: !!fit, clickRes, sameRailFly: eq(railRect, flyRect), sameRailPinned: eq(railRect, pinnedRect) };
        out.pinPass = !!(out.pin.sameRailFly && out.pin.sameRailPinned && flyRect && flyRect.hitPin && !!flyRect.pop &&
          clickRes && clickRes.collapsed === false && clickRes.railClass === false && clickRes.ins === 212);
        try { await js('window.lgChrome.popupHide()'); } catch (e) {}
        await setCfg({ vtabCollapsed: true, vtabCompact: false });
        await sleep(600);
      } catch (e) { out.pinErr = String((e && e.stack) || e); out.pinPass = false; }
      flush();

      /* ---------- 4) 主题嗅探（透明容器不许判 dark） ---------- */
      try {
        const d = (html) => "data:text/html;charset=utf-8," + encodeURIComponent(html);
        const A = await scratch(d('<style>body{margin:0;background:#f7f7f8}</style><div class="theme-page" style="background-color:rgba(0,0,0,0);height:24px"></div>'), SNIFFER);
        const B = await scratch(d('<div class="theme-page" style="background-color:#0e0e12;height:24px"></div>'), SNIFFER);
        const C = await scratch(d('<style>html,body{background:transparent}</style><div class="theme-page" style="background-color:transparent;height:24px"></div>'), SNIFFER);
        const pageSniff = await pjs('window.__lgNativeTheme || "unset"').catch(() => "no-tab");
        const themeNow = { lastNative: lastNative, resolved: resolvedTheme(), cfgTheme: cfg.theme };
        out.sniff = { transparentContainer: A, opaqueDark: B, allTransparent: C, page: pageSniff, themeNow };
        out.sniffPass = !!(A === "light" && B === "dark" && C === "unknown" && pageSniff !== "dark" && themeNow.resolved === "light");
      } catch (e) { out.sniffErr = String((e && e.stack) || e); out.sniffPass = false; }
      flush();

      /* ---------- 5) 玻璃一致：跨标签同值 + 首帧兜底 ---------- */
      try {
        const tabVars = async (t) => JSON.parse(await t.view.webContents.executeJavaScript(`(function(){
          var cs = getComputedStyle(document.documentElement);
          return JSON.stringify({ card: cs.getPropertyValue("--lg-glass-card").trim(), soft: cs.getPropertyValue("--lg-glass-soft").trim(),
            line: cs.getPropertyValue("--lg-glass-line").trim(), blur: cs.getPropertyValue("--lg-glass-blur").trim(),
            theme: document.documentElement.getAttribute("data-lg-theme"), page: document.documentElement.getAttribute("data-lg-page"),
            repaint: document.documentElement.getAttribute("data-lg-repaint") });
        })()`, true));
        const a = tabs.get(activeTabId);
        const va = await tabVars(a);
        createHomeTab(); // 本地页：与站点页吃同一份载荷
        await sleep(1800);
        const hb = tabs.get(activeTabId);
        const vh = await tabVars(hb);
        const same = va.card === vh.card && va.soft === vh.soft && va.line === vh.line && va.blur === vh.blur && va.theme === vh.theme && va.page === vh.page && va.repaint === vh.repaint;
        const notEmpty = !!va.card && va.card !== "rgba(0, 0, 0, 0)" && /^rgba?\(/.test(va.card);
        const fb = await scratch("file:///" + path.join(__dirname, "src", "popup", "popup.html").replace(/\\/g, "/"),
          'getComputedStyle(document.documentElement).getPropertyValue("--lg-glass-card").trim()');
        out.glass = { site: va, home: vh, same: same, notEmpty: notEmpty, fallback: fb };
        out.glassPass = !!(same && notEmpty && fb === "rgba(255, 255, 255, 0.92)");
        if (hb && hb.id != null) { try { closeTab(hb.id); } catch (e) {} }
      } catch (e) { out.glassErr = String((e && e.stack) || e); out.glassPass = false; }
      flush();

      /* ---------- 6) 广告：请求级拦截 + 清扫器 + 静态规则 ---------- */
      try {
        const wired = {
          acct: !!acctSession(cfg.activeAccountId).__lgAdWired,
          shared: !!sharedSession().__lgAdWired,
          dflt: !!session.defaultSession.__lgAdWired,
        };
        let net = { skip: true };
        try {
          const ctrl = await pjs('fetch("https://www.luogu.com.cn/problem/list", { cache: "no-store" }).then(function(r){ return r.ok ? "ok" : "http" + r.status }).catch(function(e){ return "ERR" })');
          if (ctrl === "ok") {
            const ad = await pjs('fetch("https://www.luogu.com.cn/qiafan/by-group/weijing", { cache: "no-store" }).then(function(){ return "ok" }).catch(function(){ return "blocked" })');
            net = { skip: false, control: ctrl, ad: ad, blocked: ad === "blocked", count: adBlockCount };
          } else {
            net = { skip: true, control: ctrl };
          }
        } catch (e) { net = { skip: true, err: String((e && e.message) || e) }; }
        const promoStatic = JSON.parse(await pjs(`(function(){
          var right = document.createElement("div"); right.className = "lg-right am-u-lg-3";
          var card = document.createElement("div"); card.className = "lg-article"; card.id = "lg-promo-probe";
          card.innerHTML = '<a href="https://class.luogu.com.cn/course/yugu25sxa">省选计划A组 洛谷推荐</a><div>冲击省队 刷题与模拟 ￥5499</div>';
          right.appendChild(card); document.body.appendChild(right);
          return JSON.stringify({ staticHidden: getComputedStyle(card).display === "none", clean: document.documentElement.getAttribute("data-lg-clean") });
        })()`));
        await sleep(1400); // MutationObserver → queuePromo(300ms) → sweepPromos
        const promoSwept = JSON.parse(await pjs(`(function(){
          var card = document.getElementById("lg-promo-probe");
          if (!card) return JSON.stringify({ gone: true });
          return JSON.stringify({ mark: card.getAttribute("data-lg-promo"), display: getComputedStyle(card).display });
        })()`));
        await pjs('(function(){ var c = document.getElementById("lg-promo-probe"); if (c) { var w = c.closest(".lg-right"); (w || c).remove(); } return 1 })()').catch(() => {});
        out.adblock = { wired: wired, net: net, promoStatic: promoStatic, promoSwept: promoSwept };
        out.adblockPass = !!(wired.acct && wired.shared && wired.dflt && promoStatic.clean === "1" && promoStatic.staticHidden === true &&
          promoSwept.mark === "1" && promoSwept.display === "none" && (net.skip || net.blocked));
      } catch (e) { out.adblockErr = String((e && e.stack) || e); out.adblockPass = false; }
      flush();

      /* ---------- 7) IDE 原生：data-lg-ide="1" 不套玻璃 ---------- */
      try {
        const r = JSON.parse(await pjs(`(function(){
          var de = document.documentElement;
          var old = de.getAttribute("data-lg-ide");
          var host = document.createElement("div"); host.id = "lg-ide-probe-host";
          var d = document.createElement("div"); d.className = "monaco-editor";
          d.style.cssText = "width:160px;height:90px";
          host.appendChild(d); document.body.appendChild(host);
          var parse = function (c) {
            var m = (c || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
            return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
          };
          var same = function (x, y) { return !!x && !!y && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] && Math.abs(x[3] - y[3]) < 0.02; };
          var glass = getComputedStyle(de).getPropertyValue("--lg-glass-card").trim();
          de.setAttribute("data-lg-ide", "0");
          var c0 = getComputedStyle(d).backgroundColor;
          de.setAttribute("data-lg-ide", "1");
          var c1 = getComputedStyle(d).backgroundColor;
          var big = document.createElement("div");
          big.style.cssText = "width:600px;height:300px;background-color:#101014";
          host.appendChild(big);
          de.setAttribute("data-lg-ide", "1");
          if (window.__lgGlassSweep) window.__lgGlassSweep(big);
          var sweptOn = big.className.indexOf("lg-glass") >= 0;
          de.setAttribute("data-lg-ide", "0");
          if (window.__lgGlassSweep) window.__lgGlassSweep(big);
          var sweptOff = big.className.indexOf("lg-glass") >= 0;
          host.remove();
          de.setAttribute("data-lg-ide", old || "0");
          return JSON.stringify({ glass: glass, themed: c0, native: c1,
            themedMatches: same(parse(glass), parse(c0)), nativeDiffers: !same(parse(glass), parse(c1)),
            sweptOn: sweptOn, sweptOff: sweptOff });
        })()`));
        out.ideNative = r;
        out.ideNativePass = !!(r.themedMatches === true && r.nativeDiffers === true && r.sweptOn === false && r.sweptOff === true);
      } catch (e) { out.ideNativeErr = String((e && e.stack) || e); out.ideNativePass = false; }
      flush();

      /* ---------- 复原 + 汇总 ---------- */
      try { await setCfg({ ...saved }); } catch (e) {}
      out.pass = !!(out.dockRenderPass && out.dockIdePass && out.pinPass && out.sniffPass && out.glassPass && out.adblockPass && out.ideNativePass);
      flush();
    } else if (argv.includes("--lg-v311test")) {
      /* v3.11.0（R38）四项：
         1) 坞方向：四种位置轮测——左/右 = 竖排一列（#dock flex-direction:column、
            两颗胶囊同列上下叠），上/下 = 横排一行（row、左右并排）；主进程
            dockPos() 是方向唯一来源（dock:sync 覆写 + dock:rect 补发），改位置后
            坞视图的 body[data-dock] 立刻跟上；落位与方向同源（左 = inset.x+6）；
         2) 悬停卡片已删：外壳无 scheduleTabTip/cancelTabTip、桥无 tabTip/tabTipHide、
            主进程无卡片视图；在标签行上悬停 1s 不冒出任何新视图（用户报的"左上角
            那张卡片"）；
         3) 题目页自带 IDE 模式（洛谷「进入 IDE 模式」）→ 真·全屏：合成编辑器容器 +
            「退出 IDE 模式」文案 → 注入层上报 → 该标签视图落整窗、坞隐藏、
            data-lg-ide=1（面板原生不透明，不再透出壁纸）；移除后全部还原；
         4) 分组拖动（Edge 语义）：外壳合成 pointer 手势拖到标签中段 → 建组（默认名
            "N 组"）；组头落点（含折叠组）入组；组内锚点排序；拖出组块出组；
            整组拖动排序；全程组块连续。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1200);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(500);
      };
      const invokeFor = (ch, ...args) => {
        const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (!h) return null;
        return h({ sender: mainWin.webContents }, ...args);
      };
      const saved = { verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact, vtabSide: cfg.vtabSide, dockPos: cfg.dockPos, dockItems: cfg.dockItems, ideNative: cfg.ideNative };

      /* ---------- 1) 坞方向（四位置轮测） ---------- */
      try {
        await setCfg({
          verticalTabs: false, dockPos: "left",
          dockItems: [{ icon: "home", title: "首页", href: "@home" }, { icon: "list", title: "题库", href: "https://www.luogu.com.cn/problem/list" }],
        });
        await sleep(1600);
        const dv = dockView && !dockView.webContents.isDestroyed() ? dockView : null;
        if (!dv) throw new Error("no dock view");
        const read = async () => {
          const raw = await dv.webContents.executeJavaScript(`(function(){
            var root = document.getElementById("dock");
            var de = document.documentElement;
            var cs = getComputedStyle(root);
            var caps = [].slice.call(root.querySelectorAll(".dock-group, .dock-foot"));
            var box = function (e) { var r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
            return JSON.stringify({ dir: cs.flexDirection, dock: document.body.dataset.dock,
              view: { x: Number(de.dataset.lgViewX || 0), y: Number(de.dataset.lgViewY || 0) },
              caps: caps.map(box), w: root.offsetWidth, h: root.offsetHeight });
          })()`, true);
          return JSON.parse(raw);
        };
        const res = {};
        for (const pos of ["left", "right", "top", "bottom"]) {
          await setCfg({ dockPos: pos });
          await sleep(1300);
          res[pos] = await read();
          res[pos].bounds = dockBounds();
        }
        let shot = false;
        try {
          await setCfg({ dockPos: "left" });
          await sleep(1200);
          const img = await dv.webContents.capturePage();
          if (img && !img.isEmpty()) { fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-dock-left.png", img.toPNG()); shot = true; }
        } catch (e) {}
        const stacked = (r) => r.caps.length >= 2 && Math.abs(r.caps[1].x - r.caps[0].x) <= 2 && r.caps[1].y >= r.caps[0].y + r.caps[0].h - 2;
        const inline = (r) => r.caps.length >= 2 && Math.abs(r.caps[1].y - r.caps[0].y) <= 2 && r.caps[1].x >= r.caps[0].x + r.caps[0].w - 2;
        const [cw, chh] = mainWin.getContentSize();
        const ins0 = inset();
        out.dockDir = { ...res, shot, win: [cw, chh] };
        out.dockDirPass = !!(
          res.left.dir === "column" && res.left.dock === "left" && stacked(res.left) &&
          res.right.dir === "column" && res.right.dock === "right" && stacked(res.right) &&
          res.top.dir === "row" && res.top.dock === "top" && inline(res.top) &&
          res.bottom.dir === "row" && res.bottom.dock === "bottom" && inline(res.bottom) &&
          res.left.bounds && Math.abs(res.left.bounds.x - (ins0.x + 6)) <= 1 &&
          res.right.bounds && Math.abs(res.right.bounds.x + res.right.bounds.width - (cw - (ins0.right || 0) - 6)) <= 1 &&
          res.top.bounds && Math.abs(res.top.bounds.y - (ins0.y + 6)) <= 1 &&
          res.bottom.bounds && Math.abs(res.bottom.bounds.y + res.bottom.bounds.height - (chh - 6)) <= 1
        );
      } catch (e) { out.dockDirErr = String((e && e.stack) || e); out.dockDirPass = false; }
      flush();

      /* ---------- 2) 悬停卡片已删 ---------- */
      try {
        const shellFn = await js('typeof scheduleTabTip + "|" + typeof cancelTabTip');
        const bridge = await js('typeof window.lgChrome.tabTip + "|" + typeof window.lgChrome.tabTipHide');
        const popBridge = popupView && !popupView.webContents.isDestroyed()
          ? await popupView.webContents.executeJavaScript('typeof window.lgPopup.tabTip + "|" + typeof window.lgPopup.tabTipHide', true).catch(() => "n/a")
          : "n/a";
        await setCfg({ verticalTabs: false, dockPos: "left" });
        const viewUrls = () => mainWin.contentView.children.map((v) => {
          try { return String(v.webContents.getURL() || "").split("/").slice(-2).join("/"); } catch (e) { return "?"; }
        });
        const viewsBefore = viewUrls();
        await js('(function(){var r=document.querySelector("#tabs .tab[data-id]");if(r)r.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));return !!r;})()');
        await sleep(1400);
        const viewsAfter = viewUrls();
        const newViews = viewsAfter.filter((u) => viewsBefore.indexOf(u) < 0);
        out.noCard = { shellFn, bridge, popBridge, view: typeof tabTipView, viewsBefore, viewsAfter, newViews };
        /* 悬停不许冒出任何"卡片"类视图（tabtip 的文档已删，这里防复活） */
        out.noCardPass = shellFn === "undefined|undefined" && bridge === "undefined|undefined" &&
          (popBridge === "undefined|undefined" || popBridge === "n/a") &&
          out.noCard.view === "undefined" && newViews.every((u) => !/tabtip/i.test(u));
      } catch (e) { out.noCardErr = String((e && e.stack) || e); out.noCardPass = false; }
      flush();

      /* ---------- 3) 题目页自带 IDE 模式 → 真·全屏 ---------- */
      try {
        await setCfg({ verticalTabs: false, dockPos: "left", ideNative: true });
        let t2 = tabs.get(activeTabId);
        if (!t2 || !/\/problem\//.test(t2.url || "")) {
          navigateActive("https://www.luogu.com.cn/problem/P1002");
          for (let i = 0; i < 70; i++) { await sleep(500); const tt = tabs.get(activeTabId); if (tt && /\/problem\//.test(tt.url || "")) break; }
          t2 = tabs.get(activeTabId);
        }
        if (!t2 || !/\/problem\//.test(t2.url || "") || !t2.view || t2.view.webContents.isDestroyed()) {
          out.ideInPage = { skipped: "network", url: t2 ? t2.url : "" };
          out.ideInPagePass = true; // 网络不可用记 skip（与 adblock 段同口径）
        } else {
          /* 等注入真正落地再抓"之前"状态：navigateActive 一设 URL 循环就退出，
             页面与注入可能都还没到——固定 sleep 会拿到 attr=null 的假失败（R39） */
          for (let i = 0; i < 60; i++) {
            const ok = await t2.view.webContents
              .executeJavaScript("typeof window.__lgIdeInPage === 'function'", true)
              .catch(() => false);
            if (ok === true) break;
            await sleep(500);
          }
          await sleep(1200);
          const [w0, h0] = mainWin.getContentSize();
          const before = { bounds: t2.view.getBounds(), dock: dockShown, ide: inPageIdeTabId, attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true) };
          await t2.view.webContents.executeJavaScript(`(function(){
            var host = document.createElement("div");
            host.id = "lg-v311-ide";
            /* R40：改成真站形状——.panel-layout.layout-horizontal.ide-container
               内含 .ide-toolbar/.ide-textarea，退出文案在容器**外**的
               .lfe-caption.problem-block-actions 里。R38 那版假 DOM 用的是三个
               猜的类名（.code-editor-container/.editor-top-bar/…），探针全绿而
               真站判定恒 false（用户报"还是不全屏"的根因）。 */
            host.innerHTML = '<div class="panel-layout layout-horizontal ide-container"><div class="ide-toolbar lg-glass" style="display:block;width:420px;height:220px;background:#ffffff"></div></div><div class="lfe-caption problem-block-actions"><a href="javascript:void 0">退出 IDE 模式</a></div>';
            document.body.appendChild(host);
            return true;
          })()`, true);
          const dbg0 = await t2.view.webContents.executeJavaScript('JSON.stringify({hook: typeof window.__lgIdeInPage, probe: window.__lgIdeInPage ? window.__lgIdeInPage() : null, path: location.pathname, title: document.title.slice(0,40), url: location.href.slice(0,80)})', true).catch((e) => "err:" + e);
          let reported = null;
          for (let i = 0; i < 48; i++) { await sleep(250); if (inPageIdeTabId === t2.id) { reported = i; break; } }
          await sleep(800);
          const dbg1 = await t2.view.webContents.executeJavaScript('JSON.stringify({probe: window.__lgIdeInPage ? window.__lgIdeInPage() : null})', true).catch((e) => "err:" + e);
          const during = {
            dbg0, dbg1,
            ide: inPageIdeTabId,
            bounds: t2.view.getBounds(),
            dock: dockShown,
            attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true),
            bg: await t2.view.webContents.executeJavaScript('getComputedStyle(document.querySelector(".ide-toolbar")).backgroundColor', true),
            glassCls: await t2.view.webContents.executeJavaScript('document.querySelector(".ide-toolbar").className.indexOf("lg-glass") >= 0', true),
          };
          await t2.view.webContents.executeJavaScript('(function(){var h=document.getElementById("lg-v311-ide");if(h)h.remove();return true})()', true);
          let cleared = null;
          for (let i = 0; i < 48; i++) { await sleep(250); if (inPageIdeTabId == null) { cleared = i; break; } }
          await sleep(800);
          const after = {
            ide: inPageIdeTabId,
            bounds: t2.view.getBounds(),
            dock: dockShown,
            attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true),
          };
          const alphaOf = (c) => {
            const m = String(c || "").match(/rgba?\(([^)]+)\)/);
            if (!m) return 1;
            const parts = m[1].split(",");
            return parts.length > 3 ? parseFloat(parts[3]) : 1;
          };
          out.ideInPage = { before, reported, during, cleared, after, win: [w0, h0] };
          out.ideInPagePass = !!(
            before.ide == null && before.dock === true && before.attr === "0" &&
            reported != null &&
            during.ide === t2.id && during.bounds.x === 0 && during.bounds.y === 0 &&
            during.bounds.width === w0 && during.bounds.height === h0 &&
            during.dock === false && during.attr === "1" &&
            during.glassCls === false && alphaOf(during.bg) >= 0.99 &&
            cleared != null && after.ide == null && after.dock === true && after.attr === "0" &&
            after.bounds.y === inset().y
          );
        }
      } catch (e) { out.ideInPageErr = String((e && e.stack) || e); out.ideInPagePass = false; }
      flush();

      /* ---------- 4) 分组拖动（Edge 语义，模型 + 一次外壳手势） ---------- */
      try {
        await setCfg({ verticalTabs: false, dockPos: "left" });
        const gids = [];
        const mkTab = async () => {
          const id = createTab(HOME_URL, { activate: false });
          for (let i = 0; i < 20; i++) { await sleep(120); if (tabs.has(id) && tabs.get(id).view) break; }
          return id;
        };
        const a = await mkTab();
        const b = await mkTab();
        const c = await mkTab();
        const d = await mkTab();
        const e = await mkTab();
        await sleep(900);
        /* 外壳手势：把 a 拖到 b 的中段（合并意图）→ 建组 */
        const gesture = JSON.parse(await js(`(function(){
          var rows = document.querySelectorAll("#tabs .tab[data-id]");
          if (rows.length < 2) return JSON.stringify({ err: "need-2-tabs", n: rows.length });
          var A = rows[0], B = rows[1];
          var ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
          var ax = Math.round(ra.left + ra.width / 2), ay = Math.round(ra.top + ra.height / 2);
          var bx = Math.round(rb.left + rb.width / 2), by = Math.round(rb.top + rb.height / 2);
          var ev = function (type, x, y, el) {
            return el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, isPrimary: true }));
          };
          var efp = function (x, y) { var e = document.elementFromPoint(x, y); return e ? (e.tagName + "." + String(e.className).slice(0, 60)) : "null"; };
          var diag = { win: [innerWidth, innerHeight], rows: rows.length, a: [ax, ay, Math.round(ra.width), Math.round(ra.height)], b: [bx, by, Math.round(rb.width), Math.round(rb.height)], efpA: efp(ax, ay), efpB: efp(bx, by), scroll: [document.getElementById("tabs").scrollLeft, document.getElementById("tabs").scrollWidth, document.getElementById("tabs").clientWidth] };
          ev("pointerdown", ax, ay, A);
          ev("pointermove", ax + 8, ay, document);
          diag.efpAfter1 = efp(ax + 8, ay);
          diag.tip1 = !!document.getElementById("drag-tip");
          ev("pointermove", bx, by, document);
          diag.efpAfter2 = efp(bx, by);
          diag.tip2 = !!document.getElementById("drag-tip");
          diag.tipRect = (function () { var t = document.getElementById("drag-tip"); if (!t) return null; var r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), getComputedStyle(t).pointerEvents]; })();
          diag.bodyCls = document.body.className;
          var marked = B.className.indexOf("drop-merge") >= 0;
          ev("pointerup", bx, by, document);
          return JSON.stringify({ marked: marked, a: Number(A.getAttribute("data-id")), b: Number(B.getAttribute("data-id")), diag: diag });
        })()`));
        await sleep(900);
        const ga = tabs.get(gesture.a) ? tabs.get(gesture.a).groupId : null;
        const gb = tabs.get(gesture.b) ? tabs.get(gesture.b).groupId : null;
        const g = ga != null ? tabGroups.get(ga) : null;
        const gestureOk = !!(ga != null && ga === gb && g && /^\d+ 组$/.test(g.name || "") && !!g.color);
        /* 组头落点（含折叠组）：c 与 d 都拖到组头 → 入组 */
        await invokeFor("tab:group-update", { groupId: ga, patch: { collapsed: true } });
        await sleep(300);
        await invokeFor("tab:group-drop", { id: c, targetGid: ga });
        await invokeFor("tab:group-drop", { id: d, targetGid: ga });
        await sleep(600);
        const membersAfterHead = groupMembers(ga).slice();
        const collapsedStillOk = !!(tabGroups.get(ga) && tabGroups.get(ga).collapsed === true && membersAfterHead.includes(c) && membersAfterHead.includes(d));
        /* 组内锚点排序：a 插到 c 前面 */
        await invokeFor("tab:group-join", { id: a, groupId: ga });
        await invokeFor("tab:group-drop", { id: a, targetId: c, before: true });
        await sleep(500);
        const membersOrdered = groupMembers(ga).slice();
        const anchorOk = membersOrdered.indexOf(a) === membersOrdered.indexOf(c) - 1;
        /* 拖出组块：b 移出 */
        await invokeFor("tab:group-leave", b);
        await sleep(400);
        const leftOk = tabs.get(b).groupId == null && !groupMembers(ga).includes(b);
        /* 整组拖动排序：整块挪到 e 之后 */
        await invokeFor("tab:group-update", { groupId: ga, patch: { collapsed: false } });
        await invokeFor("tab:group-move", { groupId: ga, anchorId: e, before: false });
        await sleep(500);
        const mem = groupMembers(ga).slice();
        const idx = mem.map((x) => tabOrder.indexOf(x));
        const contiguous = idx.length > 0 && idx[idx.length - 1] - idx[0] === idx.length - 1;
        const movedOk = tabOrder.indexOf(e) < tabOrder.indexOf(mem[0]);
        /* 收尾：把这五个测试标签关掉（不留痕） */
        for (const id of [a, b, c, d, e]) { try { if (tabs.has(id)) closeTab(id); } catch (err) {} }
        await sleep(600);
        out.groupsDrag = {
          gesture, gestureOk, collapsedStillOk, anchorOk, leftOk, movedOk, contiguous,
          membersAfterHead, membersOrdered, finalMembers: mem, order: tabOrder.slice(),
        };
        out.groupsDragPass = !!(gesture.marked === true && gestureOk && collapsedStillOk && anchorOk && leftOk && movedOk && contiguous);
      } catch (e) { out.groupsDragErr = String((e && e.stack) || e); out.groupsDragPass = false; }
      flush();

      /* ---------- 复原 ---------- */
      try { await setCfg({ ...saved }); } catch (e) {}
      out.pass = !!(out.dockDirPass && out.noCardPass && out.ideInPagePass && out.groupsDragPass);
      flush();
    } else if (argv.includes("--lg-v312test")) {
      /* v3.12.0（R39）六项：
         1) 地址栏：输入法组字中的回车不算提交（isComposing / keyCode 229 守卫）；
            回车恒按输入内容走（sugSel 默认 -1，只有显式 ↓/↑/Tab/悬停才选建议）；
            localhost / 主机名:端口 解析成地址（不再被当搜索词）；联想首行
            「打开 xxx」、悬停高亮回传（popup:sug-hover → chrome:sug-hover）；
         2) 坞「首页」= 总是新建标签打开 luogu.com.cn（原标签不动、坞项高亮）；
         3) 账号菜单跑位：place() 吃 payload.win 夹取（弹层视图视口滞后也不会塌到
            左上角）；popup:win 补发时重摆；账号芯片真实链路的位置贴右缘；
         4) 背景：图片壁纸层健康 + 被移除后 observer 自动重建并重跑 apply；
            视频兜底只在 bgready=1 后才关背景图（失败回退图片/渐变）；缩放恢复
            补推 --lg-zoom；全屏/IDE 标志残留清理；reconcileWallpaper 可读性顺延；
         5) 分组手感：合并带迟滞（进入 0.3~0.7 / 退出 0.22~0.78）、折叠组悬停
            450ms 临时展开、FLIP 动画计数 > 0、拖拽小签出现；
         6) 分屏只留左右两格：布局表/切布局/聚焦 API 与 IPC 已删；两格相邻 +
            中间插入被吸附；关左/右格、反转左右。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1200);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(500);
      };
      const invokeFor = (ch, ...args) => {
        const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (!h) return null;
        return h({ sender: mainWin.webContents }, ...args);
      };
      const saved = {
        verticalTabs: cfg.verticalTabs, dockPos: cfg.dockPos, dockItems: cfg.dockItems,
        wallpaper: cfg.wallpaper, wallpaperKind: cfg.wallpaperKind,
      };

      /* ---------- 1) 地址栏 ---------- */
      try {
        await setCfg({ verticalTabs: false, dockPos: "left" });
        const resolved = JSON.parse(await js(`JSON.stringify({
          localhost: resolveOmnibox("localhost:3000", {}, "", true),
          hostPort: resolveOmnibox("my-server:8080", {}, "", true),
          bare: resolveOmnibox("hello", {}, "https://www.luogu.com.cn/search?keyword=%s", true),
          dotted: resolveOmnibox("example.com", {}, "", true),
          problem: resolveOmnibox("p1002", {}, "", true),
        })`));
        /* IME 守卫：组字中的回车不许动；真回车按输入内容导航 */
        const h = createHomeTab();
        setActiveTab(h);
        await sleep(600);
        const urlBefore = tabs.get(h) ? tabs.get(h).url : "";
        await js(`(function(){var i=document.getElementById("omni-input");i.focus();i.value="https://www.luogu.com.cn/problem/P1002";i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}));return true})()`);
        await sleep(900);
        const afterComposing = tabs.get(h) ? tabs.get(h).url : "";
        await js(`(function(){var i=document.getElementById("omni-input");i.value="https://www.luogu.com.cn/problem/P1002";i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));return true})()`);
        await sleep(1100);
        const afterReal = tabs.get(h) ? tabs.get(h).url : "";
        /* 联想：默认不选中 + 首行「打开」+ 悬停回传 */
        await js(`(function(){var i=document.getElementById("omni-input");i.focus();i.value="localhost:3000";i.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
        await sleep(1100);
        const sugState = JSON.parse(await js(`JSON.stringify({sel: sugSel, open: sugOpen, n: sugItems.length, first: sugItems[0] ? sugItems[0].label : ""})`));
        let popRows = null;
        let hoverSel = null;
        if (popupView && !popupView.webContents.isDestroyed()) {
          try {
            popRows = JSON.parse(await popupView.webContents.executeJavaScript(
              `(function(){var rs=document.querySelectorAll("#omni-sug .sug-row");return JSON.stringify({rows:rs.length,on:document.querySelectorAll("#omni-sug .sug-row.on").length,first:(rs[0]?rs[0].textContent:"")})})()`, true));
            if (popRows && popRows.rows >= 2) {
              await popupView.webContents.executeJavaScript(
                `(function(){var rs=document.querySelectorAll("#omni-sug .sug-row");rs[1].dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));return true})()`, true);
              await sleep(600);
              hoverSel = JSON.parse(await js(`JSON.stringify({sel: sugSel, on: (function(){return 0})()})`)).sel;
              popRows.onAfterHover = JSON.parse(await popupView.webContents.executeJavaScript(
                `JSON.stringify({on:document.querySelectorAll("#omni-sug .sug-row.on").length})`, true)).on;
            }
          } catch (e) { out.omniPopErr = String(e); }
        }
        await js(`(function(){var i=document.getElementById("omni-input");if(i){i.value="";i.blur();}try{closeSuggest();}catch(e){}return true})()`);
        await sleep(300);
        out.omni = { resolved, urlBefore, afterComposing, afterReal, sugState, popRows, hoverSel };
        out.omniPass = !!(
          resolved.localhost && /^http:\/\/localhost:3000$/.test(resolved.localhost.url) && resolved.localhost.type === "external" &&
          resolved.hostPort && /^http:\/\/my-server:8080$/.test(resolved.hostPort.url) &&
          resolved.bare && resolved.bare.type === "luogu" && /search\?keyword=hello/.test(resolved.bare.url) &&
          resolved.dotted && resolved.dotted.type === "external" &&
          resolved.problem && /problem\/P1002/.test(resolved.problem.url) &&
          afterComposing === urlBefore &&
          /problem\/P1002/i.test(afterReal) &&
          sugState.sel === -1 && sugState.open === true && /^打开 localhost:3000$/.test(sugState.first || "") &&
          !!popRows && popRows.on === 0 &&
          (hoverSel === 1 || !popRows || popRows.rows < 2) &&
          (!popRows || popRows.rows < 2 || popRows.onAfterHover === 1)
        );
      } catch (e) { out.omniErr = String((e && e.stack) || e); out.omniPass = false; }
      flush();

      /* ---------- 2) 坞项 = 书签语义（R40 改自 R39）：普通点换当前页，
              Ctrl/中键（newTab）才新开；首页目标恒为 luogu.com.cn ---------- */
      try {
        await setCfg({ verticalTabs: false, dockPos: "left" });
        const prevActive = activeTabId;
        const n0 = tabOrder.length;
        dockOpen("@home");
        /* 当前页换成洛谷首页：上一段（地址栏）可能还有在飞的 P1002 导航，落定要等
           页面自己的 did-navigate 回来——轮询到 URL 与坞高亮都对上（固定 sleep 会
           量到"还在旧页"的中间态，R40 批跑实测过这种假红）。 */
        let plainUrl = "";
        let dockActive = { n: 0, href: null };
        for (let i = 0; i < 30; i++) {
          await sleep(400);
          const c = tabs.get(prevActive);
          plainUrl = c ? c.url : "";
          dockActive = JSON.parse(await js(`JSON.stringify({n: document.querySelectorAll("#dock a.active").length, href: (document.querySelector("#dock a.active")||{}).getAttribute ? document.querySelector("#dock a.active").getAttribute("data-href") : null})`));
          if (/^https:\/\/www\.luogu\.com\.cn\/?$/.test(plainUrl) && dockActive.n >= 1 && dockActive.href === "@home") break;
        }
        const cur = tabs.get(prevActive);
        const plain = { count: tabOrder.length, sameTab: activeTabId === prevActive, url: plainUrl, kind: cur ? cur.kind : null };
        const beforeIds = new Set(tabs.keys());
        dockOpen("@home", { newTab: true });
        await sleep(1400);
        const newIds = tabOrder.filter((id) => !beforeIds.has(id));
        const nt = newIds.length === 1 ? tabs.get(newIds[0]) : null;
        out.dockHome = {
          plain,
          newCount: newIds.length,
          url: nt ? nt.url : "",
          activeIsNew: nt ? activeTabId === nt.id : false,
          dockActive,
        };
        out.dockHomePass = !!(
          plain.count === n0 && plain.sameTab === true && /^https:\/\/www\.luogu\.com\.cn\/?$/.test(plain.url) &&
          newIds.length === 1 && nt && /^https:\/\/www\.luogu\.com\.cn\/?$/.test(nt.url) &&
          activeTabId === nt.id && dockActive.n >= 1 && dockActive.href === "@home"
        );
        if (nt) { closeTab(nt.id); await sleep(400); }
      } catch (e) { out.dockHomeErr = String((e && e.stack) || e); out.dockHomePass = false; }
      flush();

      /* ---------- 3) 账号菜单跑位（place 吃 payload.win） ---------- */
      try {
        const [w0, h0] = mainWin.getContentSize();
        const menuHtml = '<div id="probe-menu" style="width:300px;height:220px">probe</div>';
        const showWith = (payload) => js("window.lgChrome.popupShow(" + JSON.stringify(payload) + ")");
        const readPanel = async () => {
          if (!popupView || popupView.webContents.isDestroyed()) return null;
          return JSON.parse(await popupView.webContents.executeJavaScript(
            `(function(){var m=document.getElementById("probe-menu");if(!m)return "null";var r=m.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),vw:window.innerWidth})})()`, true));
        };
        /* (a) place() 必须吃 payload.win 夹取（弹层视图视口滞后时不被带偏）：
            直接调弹层文档里的 place()——win.w=640 时面板应被夹进 640 宽
            （x+w = 632）；若按 window.innerWidth（此刻视口 200）夹，会塌到 0。 */
        let placeUnit = null;
        try { popupView.setBounds({ x: 0, y: 0, width: 200, height: 200 }); } catch {}
        await sleep(700);
        placeUnit = JSON.parse(await popupView.webContents.executeJavaScript(`(function(){
          var menu = document.createElement("div");
          menu.style.cssText = "width:300px;height:220px";
          document.body.appendChild(menu);
          place(menu, { ax: 1260, ay: 120, win: { w: 640, h: 480 } });
          var r = menu.getBoundingClientRect();
          var out = { x: Math.round(r.left), w: Math.round(r.width), vw: window.innerWidth };
          menu.remove();
          return JSON.stringify(out);
        })()`, true));
        /* (b) 视口小 + 真窗口尺寸：贴右缘（ax - 菜单宽），不许塌到左边 */
        await showWith({ html: menuHtml, ax: w0 - 20, ay: 120, win: { w: 640, h: 480 } });
        await sleep(700);
        const small = await readPanel();
        /* (b2) 真窗口尺寸：贴右缘（ax - 菜单宽） */
        await showWith({ html: menuHtml, ax: w0 - 20, ay: 120, win: { w: w0, h: h0 } });
        await sleep(700);
        const full = await readPanel();
        /* (c) popup:win 补发（窗口缩放那条路）→ 重摆 */
        await showWith({ html: menuHtml, ax: w0 - 20, ay: 120, win: { w: 640, h: 480 } });
        await sleep(500);
        try { popupView.webContents.send("popup:win", { w: w0, h: h0 }); } catch {}
        await sleep(700);
        const reWin = await readPanel();
        /* (d) 账号芯片真实链路：位置必须在右半窗、右缘对齐芯片 */
        await js("showAccountMenu()");
        await sleep(800);
        const chip = JSON.parse(await js(`(function(){var c=document.getElementById("user-chip");var r=c?c.getBoundingClientRect():null;return JSON.stringify({right:r?Math.round(r.right):null,bottom:r?Math.round(r.bottom):null})})()`));
        const acct = JSON.parse(await popupView.webContents.executeJavaScript(
          `(function(){var m=document.getElementById("account-menu");if(!m)return "null";var r=m.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width)})})()`, true));
        await js("try{hideAllMenus();}catch(e){}");
        await sleep(300);
        out.menuPlace = { win: [w0, h0], placeUnit, small, full, reWin, chip, acct };
        out.menuPlacePass = !!(
          placeUnit && Math.abs(placeUnit.x + placeUnit.w - 632) <= 4 &&
          small && small.w >= 200 && Math.abs(small.x + small.w - (w0 - 20)) <= 14 &&
          full && Math.abs(full.x + full.w - (w0 - 20)) <= 14 &&
          reWin && Math.abs(reWin.x + reWin.w - (w0 - 20)) <= 14 &&
          acct && chip.right != null && acct.x > w0 * 0.5 && Math.abs(acct.x + acct.w - chip.right) <= 16
        );
      } catch (e) { out.menuPlaceErr = String((e && e.stack) || e); out.menuPlacePass = false; }
      flush();

      /* ---------- 4) 背景：自愈 / 视频兜底 / 缩放推送 / 标志清理 ---------- */
      try {
        const wdir = wallpapersDir();
        try { fs.mkdirSync(wdir, { recursive: true }); } catch {}
        const png = path.join(wdir, "lg-probe-wall.png");
        fs.writeFileSync(png, Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
        cfg.wallpaper = png;
        cfg.wallpaperKind = "image";
        saveConfig();
        pushConfigToChrome();
        applyConfigToPages();
        await sleep(1200);
        const h = createHomeTab();
        setActiveTab(h);
        await sleep(1600);
        const wc = tabs.get(h).view.webContents;
        const health = JSON.parse(await wc.executeJavaScript(
          `(function(){var bg=document.getElementById("lg-glass-bg");var cs=bg?getComputedStyle(bg):null;return JSON.stringify({wall:document.documentElement.getAttribute("data-lg-wall"),exist:!!bg,bi:cs?String(cs.backgroundImage).slice(0,48):"",heal:window.__lgWallHeal||0})})()`, true));
        /* 层被站点脚本移除 → MutationObserver 补回并重跑 apply */
        await wc.executeJavaScript(`(function(){var b=document.getElementById("lg-glass-bg");if(b)b.remove();return true})()`, true);
        await sleep(1800);
        const healed = JSON.parse(await wc.executeJavaScript(
          `(function(){var bg=document.getElementById("lg-glass-bg");var cs=bg?getComputedStyle(bg):null;return JSON.stringify({exist:!!bg,bi:cs?String(cs.backgroundImage).slice(0,48):"",heal:window.__lgWallHeal||0})})()`, true));
        /* 视频兜底契约：bgready=0 时背景图不许被关（失败回退图片/渐变） */
        const videoCss = JSON.parse(await wc.executeJavaScript(
          `(function(){var r=document.documentElement;var bg=document.getElementById("lg-glass-bg");
            r.setAttribute("data-lg-bgvideo","1");r.setAttribute("data-lg-bgready","0");
            var a=getComputedStyle(bg).backgroundImage; a=!!(a&&a!=="none");
            r.setAttribute("data-lg-bgready","1");
            var b=getComputedStyle(bg).backgroundImage; b=!!(b&&b!=="none");
            r.setAttribute("data-lg-bgvideo","0");r.setAttribute("data-lg-bgready","0");
            return JSON.stringify({beforeReady:a,afterReady:b})})()`, true));
        /* 缩放恢复：设 1.5 → 重载 → did-finish-load 恢复后必须补推 --lg-zoom */
        setZoom(tabs.get(h), 1.5);
        await sleep(500);
        wc.reload();
        for (let i = 0; i < 40; i++) { await sleep(250); if (!wc.isLoading()) break; }
        await sleep(900);
        const zoomNow = String(await wc.executeJavaScript('document.documentElement.style.getPropertyValue("--lg-zoom")', true) || "");
        setZoom(tabs.get(h), 1);
        await sleep(400);
        /* 标志残留：已关标签的 id 塞进两个标志，layout() 必须清掉 */
        const deadId = createHomeTab({ activate: false });
        closeTab(deadId);
        await sleep(500);
        htmlFullscreenTabId = deadId;
        inPageIdeTabId = deadId;
        layout();
        await sleep(400);
        const flags = { full: htmlFullscreenTabId, ide: inPageIdeTabId, dock: dockShown };
        /* reconcileWallpaper：当前壁纸不可读 → 顺延到集合里可读的文件 */
        cfg.wallpaper = path.join(wdir, "lg-probe-missing.png");
        reconcileWallpaper();
        const reconciled = cfg.wallpaper === png;
        cfg.wallpaper = png;
        saveConfig();
        out.bg = { health, healed, videoCss, zoomNow, flags, reconciled };
        out.bgPass = !!(
          health.wall === "1" && health.exist === true && /url\(/.test(health.bi) &&
          healed.exist === true && /url\(/.test(healed.bi) &&
          videoCss.beforeReady === true && videoCss.afterReady === false &&
          Math.abs(parseFloat(zoomNow) - 1.5) < 0.01 &&
          flags.full === null && flags.ide === null &&
          reconciled === true
        );
        closeTab(h);
        await sleep(300);
      } catch (e) { out.bgErr = String((e && e.stack) || e); out.bgPass = false; }
      flush();

      /* ---------- 5) 分组手感：迟滞 / 折叠组悬停展开 / FLIP ---------- */
      try {
        await setCfg({ verticalTabs: false, dockPos: "left" });
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(createTab(HOME_URL, { activate: false }));
        await sleep(1400);
        /* FLIP：真实重排一次，动画计数必须增长（标签不再瞬间跳） */
        const flip0 = JSON.parse(await js("JSON.stringify({ n: window.__lgFlipCount || 0 })")).n;
        await invokeFor("tab:reorder", { id: ids[0], beforeId: ids[3], zone: null });
        await sleep(800);
        const flip1 = JSON.parse(await js("JSON.stringify({ n: window.__lgFlipCount || 0 })")).n;
        /* 后两个建成一个组并折叠 */
        const g = makeGroup();
        joinGroup(ids[2], g.id);
        joinGroup(ids[3], g.id);
        updateGroup(g.id, { collapsed: true });
        await sleep(700);
        /* 合成手势：拖第 1 个标签 → 悬停折叠组牌 → 450ms 后临时展开 */
        const gesture = JSON.parse(await js(`(function(){
          var rows = document.querySelectorAll("#tabs .tab[data-id]");
          var chip = document.querySelector("#tabs .gchip[data-gid]");
          if (rows.length < 2 || !chip) return JSON.stringify({ err: "need", rows: rows.length, chip: !!chip });
          var A = rows[0];
          var ra = A.getBoundingClientRect(), rc = chip.getBoundingClientRect();
          var ev = function (type, x, y, el) {
            return el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, isPrimary: true }));
          };
          ev("pointerdown", Math.round(ra.left + ra.width / 2), Math.round(ra.top + ra.height / 2), A);
          ev("pointermove", Math.round(ra.left + ra.width / 2) + 8, Math.round(ra.top + ra.height / 2), document);
          ev("pointermove", Math.round(rc.left + rc.width / 2), Math.round(rc.top + rc.height / 2), document);
          var efp = function (x, y) { var e = document.elementFromPoint(x, y); return e ? (e.tagName + "." + String(e.className).slice(0, 60)) : "null"; };
          var chipNow = document.querySelector("#tabs .gchip[data-gid]");
          var dbg0 = window.__lgDragDbg ? window.__lgDragDbg() : null;
          var dbgChip = window.__lgDragDbg ? window.__lgDragDbg() : null;
          var diag = {
            win: [innerWidth, innerHeight],
            chipRect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
            efpChip: efp(Math.round(rc.left + rc.width / 2), Math.round(rc.top + rc.height / 2)),
            chipCls: chipNow ? chipNow.className : "gone",
            strip: (function () { var s = document.getElementById("tabs"); return [s.scrollLeft, s.scrollWidth, s.clientWidth]; })(),
            drag: dbg0 ? dbg0.drag : null,
            temp: dbgChip ? dbgChip.temp : null,
          };
          return JSON.stringify({
            armed: true,
            collapsedBefore: chip.className.indexOf("collapsed") >= 0,
            chipGid: Number(chip.getAttribute("data-gid")),
            tipArmed: !!document.getElementById("drag-tip"),
            diag: diag,
          });
        })()`));
        await sleep(1100); // > 450ms dwell
        /* 再补一次同位置 pointermove：停留时长那条判定路径（渲染器定时器在
           隐藏/遮挡窗口里会被节流，探针不能只等定时器） */
        await js(`(function(){
          var chip = document.querySelector("#tabs .gchip[data-gid]");
          if (!chip) return true;
          var rc = chip.getBoundingClientRect();
          document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: Math.round(rc.left + rc.width / 2), clientY: Math.round(rc.top + rc.height / 2), button: 0, buttons: 1, pointerId: 1, isPrimary: true }));
          return true;
        })()`);
        await sleep(500);
        const afterDwell = JSON.parse(await js(`(function(){
          var chip = document.querySelector("#tabs .gchip[data-gid]");
          return JSON.stringify({
            collapsed: chip ? chip.className.indexOf("collapsed") >= 0 : null,
            tempMembers: document.querySelectorAll("#tabs .tab[data-temp-member]").length,
            flip: window.__lgFlipCount || 0,
            tip: !!document.getElementById("drag-tip"),
            zone: !!document.querySelector("#tabs .drop-zone"),
          });
        })()`));
        /* 排障：拖拽状态现场 + 直接调用 expandTempGroup 看函数本身是否可用 */
        const dbgDwell = JSON.parse(await js("JSON.stringify({ dbg: window.__lgDragDbg ? window.__lgDragDbg() : null, log: window.__lgDragLog || [] })"));
        const directExpand = JSON.parse(await js(`(function(){
          try { var r = expandTempGroup(${gesture.chipGid}, false); return JSON.stringify({ ret: r, temp: document.querySelectorAll("#tabs .tab[data-temp-member]").length }); }
          catch (e) { return JSON.stringify({ err: String(e) }); }
        })()`));
        /* 迟滞：把指针移到落点行的 0.75 处（退出带内）→ 合并标记必须保持 */
        const hyst = JSON.parse(await js(`(function(){
          var row = document.querySelector("#tabs .tab[data-id]:not(.dragging)");
          if (!row) return JSON.stringify({ err: "no-row" });
          var r = row.getBoundingClientRect();
          var y = Math.round(r.top + r.height / 2);
          var ev = function (type, x) { return document.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true })); };
          ev("pointermove", Math.round(r.left + r.width * 0.5));
          var merged = row.className.indexOf("drop-merge") >= 0;
          ev("pointermove", Math.round(r.left + r.width * 0.75)); // 退出带内（0.22~0.78）
          var kept = row.className.indexOf("drop-merge") >= 0;
          ev("pointermove", Math.round(r.left + r.width * 0.95)); // 退出带外
          var cleared = row.className.indexOf("drop-merge") < 0;
          return JSON.stringify({ merged: merged, kept: kept, cleared: cleared });
        })()`));
        await js(`(function(){document.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,clientX:10,clientY:10,button:0,buttons:0,pointerId:1,isPrimary:true}));return true})()`);
        await sleep(700);
        const afterUp = JSON.parse(await js(`JSON.stringify({collapsed: !!document.querySelector("#tabs .gchip.collapsed"), temp: document.querySelectorAll("#tabs .tab[data-temp-member]").length, tip: !!document.getElementById("drag-tip")})`));
        for (const id of ids) { try { if (tabs.has(id)) closeTab(id); } catch (err) {} }
        await sleep(600);
        out.groups2 = { flip0, flip1, gesture, afterDwell, dbgDwell, directExpand, hyst, afterUp };
        out.groups2Pass = !!(
          flip1 > flip0 &&
          gesture.armed === true && gesture.collapsedBefore === true &&
          afterDwell.collapsed === false && afterDwell.tempMembers >= 2 &&
          hyst.merged === true && hyst.kept === true && hyst.cleared === true &&
          afterUp.temp === 0 && afterUp.tip === false
        );
      } catch (e) { out.groups2Err = String((e && e.stack) || e); out.groups2Pass = false; }
      flush();

      /* ---------- 6) 分屏只留左右两格 ---------- */
      try {
        const apiGone = JSON.parse(await js(`JSON.stringify({
          layouts: typeof SPLIT_LAYOUTS, names: typeof SPLIT_LAYOUT_NAMES,
          setLayout: typeof setSplitLayout, focus: typeof toggleSplitFocus,
        })`));
        const ipcGone = {
          layout: !!(ipcMain._invokeHandlers && ipcMain._invokeHandlers.has("tab:split-layout")),
          layoutNext: !!(ipcMain._invokeHandlers && ipcMain._invokeHandlers.has("tab:split-layout-next")),
          focus: !!(ipcMain._invokeHandlers && ipcMain._invokeHandlers.has("tab:split-focus")),
          closeSide: !!(ipcMain._invokeHandlers && ipcMain._invokeHandlers.has("tab:split-close-side")),
          reverse: !!(ipcMain._invokeHandlers && ipcMain._invokeHandlers.has("tab:split-reverse")),
        };
        const a = createHomeTab({ activate: false });
        const b = createHomeTab({ activate: false });
        const mid = createHomeTab({ activate: false });
        splitWith(a, b);
        await sleep(400);
        const pair = { ids: splitGroupOf(a) ? splitGroupOf(a).ids.slice() : null, adjacent: Math.abs(tabOrder.indexOf(b) - tabOrder.indexOf(a)) === 1 };
        moveTabInOrder(mid, b, null); // 想插到两格之间 → 应被吸附到对块外侧
        const noInsert = Math.abs(tabOrder.indexOf(b) - tabOrder.indexOf(a)) === 1 && tabOrder.indexOf(mid) !== tabOrder.indexOf(a) + 1;
        closeTab(mid);
        await sleep(300);
        const wA = tabs.get(a).view.getBounds().width;
        reverseSplit(a);
        await sleep(400);
        const rev = tabs.get(a).view.getBounds().x > tabs.get(b).view.getBounds().x && Math.abs(tabs.get(a).view.getBounds().width - wA) < 8;
        reverseSplit(a);
        await sleep(300);
        closeSplitSide(a, "right");
        await sleep(500);
        const closed = !tabs.has(b) && !splitGroupOf(a);
        closeTab(a);
        await sleep(300);
        out.split2 = { apiGone, ipcGone, pair, noInsert, rev, closed };
        out.split2Pass = !!(
          apiGone.layouts === "undefined" && apiGone.names === "undefined" &&
          apiGone.setLayout === "undefined" && apiGone.focus === "undefined" &&
          ipcGone.layout === false && ipcGone.layoutNext === false && ipcGone.focus === false &&
          ipcGone.closeSide === true && ipcGone.reverse === true &&
          pair.ids && pair.ids.length === 2 && pair.adjacent === true &&
          noInsert === true && rev === true && closed === true
        );
      } catch (e) { out.split2Err = String((e && e.stack) || e); out.split2Pass = false; }
      flush();

      /* ---------- 复原 ---------- */
      try { await setCfg({ ...saved }); } catch (e) {}
      out.pass = !!(out.omniPass && out.dockHomePass && out.menuPlacePass && out.bgPass && out.groups2Pass && out.split2Pass);
      flush();
    } else if (argv.includes("--lg-v313test")) {
      /* v3.13.0（R40）五项：
         1) ide2：题目页自带 IDE 模式——判定改用真站选择器（.panel-layout
            .ide-container / .ide-toolbar + 容器外的「退出 IDE 模式」文案），
            进入 = 该标签视图铺满整窗（真·全屏）+ data-lg-ide=1 + 面板摘掉玻璃；
            退出还原。反例：只有容器没文案 / 只有文案没容器都不许触发。
         2) railMenu：窄条悬停浮层里点 ⌄ 交接给「标签页操作」菜单——菜单必须
            活过 200ms 兜底窗口（旧 bug：兜底 hidePopup 把刚开的菜单关掉，看起来
            像点了没反应）；弹层视图同时铺满整窗（菜单不被窄条矩形裁掉）；
            关掉菜单后窄条恢复可见。
         3) dockNav：坞项 = 书签语义——普通点换当前页（不新开），Ctrl/中键才新开；
            @ide 没有 IDE 标签时同样是换当前页。
         4) trainSearch：/training/list 顶部快速筛选条已删（attr=0、无 #lg-quicksearch），
            别的列表页（/contest/list）仍有——功能没被删掉，只是这一页不要。
         5) linkBg：页面里中键点链接 = **后台**新标签（前台标签不切走，Chrome 同款）。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1200);
      const js = (code) => mainWin.webContents.executeJavaScript(code, true);
      const setCfg = async (patch) => {
        Object.assign(cfg, patch);
        saveConfig();
        pushConfigToChrome();
        layout();
        await sleep(500);
      };
      const popJs = (code) =>
        popupView && !popupView.webContents.isDestroyed()
          ? popupView.webContents.executeJavaScript(code, true).catch(() => null)
          : Promise.resolve(null);
      const saved = {
        verticalTabs: cfg.verticalTabs, vtabCollapsed: cfg.vtabCollapsed, vtabCompact: cfg.vtabCompact,
        vtabSide: cfg.vtabSide, dockPos: cfg.dockPos, dockItems: cfg.dockItems, ideNative: cfg.ideNative,
      };

      /* ---------- 1) 题目页自带 IDE 模式 → 真·全屏（真站选择器） ---------- */
      try {
        out.stage = "ide2:start";
        flush();
        await setCfg({ verticalTabs: false, dockPos: "left", ideNative: true });
        let t2 = tabs.get(activeTabId);
        if (!t2 || !/\/problem\//.test(t2.url || "")) {
          navigateActive("https://www.luogu.com.cn/problem/P1002");
          for (let i = 0; i < 70; i++) { await sleep(500); const tt = tabs.get(activeTabId); if (tt && /\/problem\//.test(tt.url || "")) break; }
          t2 = tabs.get(activeTabId);
        }
        if (!t2 || !/\/problem\//.test(t2.url || "") || !t2.view || t2.view.webContents.isDestroyed()) {
          out.ide2 = { skipped: "network", url: t2 ? t2.url : "" };
          out.ide2Pass = true; // 网络不可用记 skip（与 adblock / v311 段同口径）
        } else {
          for (let i = 0; i < 60; i++) {
            const ok = await t2.view.webContents.executeJavaScript("typeof window.__lgIdeInPage === 'function'", true).catch(() => false);
            if (ok === true) break;
            await sleep(500);
          }
          await sleep(1000);
          const [w0, h0] = mainWin.getContentSize();
          const before = {
            bounds: t2.view.getBounds(), dock: dockShown, ide: inPageIdeTabId,
            attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true),
          };
          /* 反例 A：只有容器、没有退出文案 → 不许触发 */
          await t2.view.webContents.executeJavaScript(`(function(){
            var h = document.createElement("div"); h.id = "lg-v313-ide";
            h.innerHTML = '<div class="panel-layout layout-horizontal ide-container"><div class="ide-toolbar" style="display:block;width:420px;height:220px;background:#ffffff"></div></div>';
            document.body.appendChild(h); return true; })()`, true);
          await sleep(1800);
          const negA = {
            ide: inPageIdeTabId,
            probe: JSON.parse(await t2.view.webContents.executeJavaScript('JSON.stringify(window.__lgIdeInPage())', true)),
          };
          /* 反例 B：只有文案、没有容器 → 不许触发 */
          await t2.view.webContents.executeJavaScript(`(function(){
            var h = document.getElementById("lg-v313-ide");
            h.innerHTML = '<div class="lfe-caption problem-block-actions"><a href="javascript:void 0">退出 IDE 模式</a></div>';
            return true; })()`, true);
          await sleep(1800);
          const negB = {
            ide: inPageIdeTabId,
            probe: JSON.parse(await t2.view.webContents.executeJavaScript('JSON.stringify(window.__lgIdeInPage())', true)),
          };
          /* 正例：真站形状（.ide-container + 容器外的退出文案） */
          await t2.view.webContents.executeJavaScript(`(function(){
            var h = document.getElementById("lg-v313-ide");
            h.innerHTML = '<div class="panel-layout layout-horizontal ide-container"><div class="ide-toolbar lg-glass" style="display:block;width:420px;height:220px;background:#ffffff"></div><div class="ide-textarea"></div></div><div class="lfe-caption problem-block-actions"><a href="javascript:void 0">退出 IDE 模式</a></div>';
            return true; })()`, true);
          let reported = null;
          for (let i = 0; i < 48; i++) { await sleep(250); if (inPageIdeTabId === t2.id) { reported = i; break; } }
          await sleep(900);
          const during = {
            ide: inPageIdeTabId, reported, bounds: t2.view.getBounds(), dock: dockShown,
            attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true),
            glassCls: await t2.view.webContents.executeJavaScript('document.querySelector(".ide-toolbar").className.indexOf("lg-glass") >= 0', true),
            panelBg: await t2.view.webContents.executeJavaScript('getComputedStyle(document.querySelector(".ide-toolbar")).backgroundColor', true),
            probe: JSON.parse(await t2.view.webContents.executeJavaScript('JSON.stringify(window.__lgIdeInPage())', true)),
          };
          /* 退出：拆掉注入 DOM → 标志清、视图回位、属性回 0 */
          await t2.view.webContents.executeJavaScript('(function(){var h=document.getElementById("lg-v313-ide");if(h)h.remove();return true})()', true);
          let cleared = null;
          for (let i = 0; i < 48; i++) { await sleep(250); if (inPageIdeTabId == null) { cleared = i; break; } }
          await sleep(900);
          const after = {
            ide: inPageIdeTabId, bounds: t2.view.getBounds(),
            attr: await t2.view.webContents.executeJavaScript('document.documentElement.getAttribute("data-lg-ide")', true),
          };
          const ins = inset();
          out.ide2 = { before, negA, negB, during, cleared, after, win: [w0, h0], inset: ins };
          out.ide2Pass = !!(
            before.ide == null && before.attr === "0" &&
            negA.ide == null && negA.probe.on === false &&
            negB.ide == null && negB.probe.on === false &&
            reported != null && during.ide === t2.id &&
            during.bounds.x === 0 && during.bounds.y === 0 &&
            during.bounds.width === w0 && during.bounds.height === h0 &&
            during.dock === false && during.attr === "1" &&
            during.glassCls === false && during.probe.on === true &&
            cleared != null && after.ide == null && after.attr === "0" &&
            after.bounds.x === ins.x
          );
        }
      } catch (e) { out.ide2Err = String((e && e.stack) || e); out.ide2Pass = false; }
      flush();

      /* ---------- 2) 窄条悬停浮层里点 ⌄ → 菜单活下来 + 弹层铺满整窗 ---------- */
      try {
        out.stage = "railMenu:start";
        flush();
        await setCfg({ verticalTabs: true, vtabCollapsed: true, vtabCompact: false, vtabSide: "left", dockPos: "bottom" });
        await sleep(1200);
        await js('delete document.body.dataset.flyoutHandoff');
        await js('document.getElementById("vtab").dispatchEvent(new MouseEvent("mouseenter"))');
        let flyout = false;
        for (let i = 0; i < 40; i++) {
          await sleep(150);
          const r = await popJs('(function(){return document.getElementById("tab-flyout")?"1":"0"})()');
          if (r === "1") { flyout = true; break; }
        }
        /* 窄条隐去是握手（浮层画好 → flyout-shown → 外壳摘窄条）或 320ms 兜底
           触发的，采样要轮询等它落定（固定 sleep 会拿到还没交接的中间态） */
        let shellHidden = null;
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          shellHidden = JSON.parse(await js('JSON.stringify({cls:document.body.className, vis:getComputedStyle(document.getElementById("vtab")).visibility, handoff:document.body.dataset.flyoutHandoff||""})'));
          if (shellHidden.cls.indexOf("flyout-open") >= 0 && shellHidden.vis === "hidden") break;
        }
        const clicked = await popJs(`(function(){
          var b = document.querySelector("#tab-flyout #btn-vcollapse");
          if (!b) return "no-btn";
          ["mousedown","mouseup","click"].forEach(function(t){ b.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); });
          return "ok";
        })()`);
        /* 菜单出现时刻（应远早于 200ms 兜底窗口） */
        let menuAt = null;
        for (let i = 0; i < 25; i++) {
          await sleep(100);
          const r = await popJs('(function(){return document.querySelectorAll("#tabmore-menu .tm-item").length ? "1" : "0"})()');
          if (r === "1") { menuAt = (i + 1) * 100; break; }
        }
        /* 关键：等过 200ms 兜底窗口 + 更久，菜单必须还在 */
        await sleep(1100);
        const menuInfo = JSON.parse((await popJs(`(function(){
          var m = document.getElementById("tabmore-menu");
          if (!m) return JSON.stringify({ gone: true });
          var r = m.getBoundingClientRect();
          var first = document.getElementById("pop-root").firstElementChild;
          return JSON.stringify({ items: document.querySelectorAll("#tabmore-menu .tm-item").length,
            rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            rootId: first ? first.id : "" });
        })()`)) || "null");
        const popBounds = popupView && !popupView.webContents.isDestroyed() ? popupView.getBounds() : null;
        const [ww, wh] = mainWin.getContentSize();
        /* 关掉菜单：窄条必须画回来（flyout-open 摘掉、visibility 恢复） */
        hidePopup();
        await sleep(1000);
        const closed = JSON.parse(await js('JSON.stringify({cls:document.body.className, vis:getComputedStyle(document.getElementById("vtab")).visibility})'));
        out.railMenu = { flyout, shellHidden, clicked, menuAt, menuInfo, popBounds, win: [ww, wh], closed };
        out.railMenuPass = !!(
          flyout === true && shellHidden.cls.indexOf("flyout-open") >= 0 && shellHidden.vis === "hidden" &&
          clicked === "ok" && menuAt != null &&
          menuInfo && menuInfo.gone !== true && menuInfo.items >= 4 && menuInfo.rootId === "tabmore-menu" &&
          popBounds && popBounds.width === ww && popBounds.height === wh &&
          closed.cls.indexOf("flyout-open") < 0 && closed.vis === "visible"
        );
      } catch (e) { out.railMenuErr = String((e && e.stack) || e); out.railMenuPass = false; }
      flush();

      /* ---------- 3) 坞项 = 书签语义（普通点换当前页 / newTab 才新开） ---------- */
      const stage = (s) => { out.stage = s; flush(); };
      try {
        stage("dockNav:setCfg");
        await setCfg({ verticalTabs: false, dockPos: "left" });
        stage("dockNav:home");
        const home = createHomeTab();
        setActiveTab(home);
        await sleep(1200);
        const n0 = tabOrder.length;
        stage("dockNav:plain");
        dockOpen("@home"); // 普通点
        await sleep(1000);
        const cur = tabs.get(home);
        const plain = { count: tabOrder.length, sameTab: activeTabId === home, url: cur ? cur.url : "", kind: cur ? cur.kind : null };
        const n1 = tabOrder.length;
        stage("dockNav:newTab");
        dockOpen("@home", { newTab: true }); // Ctrl/中键
        await sleep(1400);
        const extras = tabOrder.filter((id) => id !== home).map((id) => tabs.get(id)).filter(Boolean);
        const ctrl = { count: tabOrder.length, sameTab: activeTabId === home, lastUrl: extras.length ? extras[extras.length - 1].url : "" };
        for (const id of tabOrder.slice()) { if (id !== home) { try { closeTab(id); } catch (e) {} } }
        await sleep(500);
        /* @ide：没有 IDE 标签时普通点也是换当前页 */
        stage("dockNav:ide");
        setActiveTab(home);
        await sleep(600);
        const n2 = tabOrder.length;
        dockOpen("@ide");
        const ideNow = tabs.get(home) ? tabs.get(home).url : ""; // navigateActive 同步落定
        await sleep(1000);
        const cur2 = tabs.get(home);
        const ide = { count: tabOrder.length, sameTab: activeTabId === home, url: cur2 ? cur2.url : "", urlNow: ideNow };
        /* 这里**不关**最后这个标签：closeTab 的浏览器语义是"关掉最后一个 = 退出应用"，
           探针关它会把整个 selftest 静默带走（第一版就栽在这）。标签留给后面的段用。 */
        stage("dockNav:done");
        out.dockNav = { plain, ctrl, ide, counts: [n0, n1, n2] };
        out.dockNavPass = !!(
          plain.count === n0 && plain.sameTab === true && /^https:\/\/www\.luogu\.com\.cn\/?$/.test(plain.url) &&
          ctrl.count === n1 + 1 && ctrl.sameTab === false && /^https:\/\/www\.luogu\.com\.cn\/?$/.test(ctrl.lastUrl) &&
          ide.count === n2 && ide.sameTab === true && /\/ide\/?$/.test(ide.urlNow)
        );
      } catch (e) { out.dockNavErr = String((e && e.stack) || e); out.dockNavPass = false; }
      flush();

      /* ---------- 4) /training/list 快速筛选条已删（别的列表页仍在） ---------- */
      try {
        stage("train:go");
        const readQuick = async () => {
          const tt = tabs.get(activeTabId);
          if (!tt || !tt.view || tt.view.webContents.isDestroyed()) return null;
          return JSON.parse(await tt.view.webContents.executeJavaScript(
            'JSON.stringify({attr: document.documentElement.getAttribute("data-lg-quicksearch"), box: !!document.getElementById("lg-quicksearch"), path: location.pathname})', true));
        };
        const goAndWait = async (url, frag) => {
          navigateActive(url);
          for (let i = 0; i < 70; i++) {
            await sleep(500);
            const tt = tabs.get(activeTabId);
            if (tt && String(tt.url || "").indexOf(frag) >= 0) {
              for (let j = 0; j < 40; j++) {
                const ok = await tt.view.webContents.executeJavaScript("typeof window.__lgIdeInPage === 'function'", true).catch(() => false);
                if (ok === true) break;
                await sleep(500);
              }
              await sleep(1500);
              return true;
            }
          }
          return false;
        };
        const okContest = await goAndWait("https://www.luogu.com.cn/contest/list", "contest/list");
        const contest = okContest ? await readQuick() : null;
        const okTrain = await goAndWait("https://www.luogu.com.cn/training/list", "training/list");
        const training = okTrain ? await readQuick() : null;
        if (!okContest || !okTrain) {
          out.trainSearch = { skipped: "network", contest: okContest, training: okTrain };
          out.trainSearchPass = true;
        } else {
          out.trainSearch = { contest, training };
          out.trainSearchPass = !!(
            contest && contest.attr === "1" && contest.box === true &&
            training && training.attr === "0" && training.box === false
          );
        }
      } catch (e) { out.trainSearchErr = String((e && e.stack) || e); out.trainSearchPass = false; }
      flush();

      /* ---------- 5) 页面里中键点链接 = 后台新标签 ---------- */
      try {
        stage("linkBg:start");
        const t = tabs.get(activeTabId);
        if (!t || !t.view || t.view.webContents.isDestroyed()) throw new Error("no active page view");
        const wc = t.view.webContents;
        await wc.executeJavaScript(`(function(){
          var a = document.createElement("a");
          a.id = "lg-bgtest";
          a.href = "https://www.luogu.com.cn/problem/P1000";
          a.textContent = "bgtest";
          a.style.cssText = "position:fixed;left:16px;top:16px;width:260px;height:64px;z-index:2147483000;background:#fff;color:#000;font-size:20px;display:block";
          document.body.appendChild(a);
          return true;
        })()`, true);
        await sleep(500);
        const before = { active: activeTabId, count: tabOrder.length };
        /* 真实中键（Chromium 语义）：disposition = background-tab */
        wc.sendInputEvent({ type: "mouseDown", x: 120, y: 48, button: "middle", clickCount: 1 });
        wc.sendInputEvent({ type: "mouseUp", x: 120, y: 48, button: "middle", clickCount: 1 });
        await sleep(1800);
        const after = {
          active: activeTabId, count: tabOrder.length,
          urls: tabOrder.map((id) => (tabs.get(id) || {}).url || ""),
        };
        await wc.executeJavaScript('(function(){var a=document.getElementById("lg-bgtest");if(a)a.remove();return true})()', true).catch(() => {});
        for (const id of tabOrder.slice()) { if (id !== before.active) { try { closeTab(id); } catch (e) {} } }
        await sleep(500);
        out.linkBg = { before, after };
        out.linkBgPass = !!(
          after.count === before.count + 1 && after.active === before.active &&
          after.urls.some((u) => /problem\/P1000/.test(u))
        );
      } catch (e) { out.linkBgErr = String((e && e.stack) || e); out.linkBgPass = false; }
      flush();

      /* ---------- 复原 ---------- */
      try { await setCfg({ ...saved }); } catch (e) {}
      out.stage = "done";
      out.pass = !!(out.ide2Pass && out.railMenuPass && out.dockNavPass && out.trainSearchPass && out.linkBgPass);
      flush();
    } else if (argv.includes("--lg-perftest")) {
      /* R41 性能基线/验收：冷启动分段耗时（perfMarks）、按进程内存
         （app.getAppMetrics 汇总）、开 6 个标签的内存曲线、休眠/唤醒差值、
         后台节流策略落位（cfg.bgThrottle 存在才断言——基线跑旧代码时自动只记录）。
         测试标签用 https://127.0.0.1:9/（秒失败、不依赖网络、kind=null 可休眠）。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1500);

      const metrics = () => {
        let sum = 0;
        const byKB = {};
        try {
          for (const m of app.getAppMetrics()) {
            const kb = (m.memory && m.memory.workingSetSize) || 0;
            sum += kb;
            const k = m.type || "unknown";
            byKB[k] = (byKB[k] || 0) + kb;
          }
        } catch {}
        const byMB = {};
        for (const k of Object.keys(byKB)) byMB[k] = Math.round(byKB[k] / 1024);
        return { totalMB: Math.round(sum / 1024), byMB, views: tabOrder.length };
      };

      /* ---------- 1) 冷启动分段耗时 ---------- */
      out.boot = { ...perfMarks, bootTabs: tabOrder.length };
      if (out.boot.t0 && out.boot.readyShown) out.boot.totalMs = out.boot.readyShown - out.boot.t0;

      /* ---------- 2) 基线内存 ---------- */
      out.memBase = metrics();
      flush();

      /* ---------- 3) 开 6 个标签的内存曲线 ---------- */
      try {
        const keep = activeTabId;
        const opened = [];
        const curve = [];
        for (let i = 0; i < 6; i++) {
          opened.push(createTab("https://127.0.0.1:9/", { activate: false }));
          await sleep(900);
          curve.push(metrics());
        }
        setActiveTab(keep);
        await sleep(600);
        out.curve = curve;
        flush();

        /* ---------- 4) 休眠差值 ---------- */
        const beforeMB = metrics().totalMB;
        let slept = 0;
        for (const id of opened) { try { if (sleepTab(id)) slept++; } catch {} }
        await sleep(2500);
        const afterMB = metrics().totalMB;
        out.sleep = { slept, beforeMB, afterMB, deltaMB: beforeMB - afterMB };
        flush();

        /* ---------- 5) 唤醒 ---------- */
        const w0 = opened[0];
        if (w0 != null && tabs.has(w0)) {
          const tw = Date.now();
          setActiveTab(w0);
          const wt = tabs.get(w0) || {};
          out.wake = { ms: Date.now() - tw, awake: !wt.sleeping, hasView: !!wt.view };
          setActiveTab(keep);
        }
        for (const id of opened) { if (id !== w0) { try { closeTab(id); } catch {} } }
        await sleep(400);
      } catch (e) { out.curveErr = String((e && e.stack) || e); }
      flush();

      /* ---------- 6) 后台节流落位 ---------- */
      try {
        const views = [];
        for (const [id, t] of tabs) {
          if (!t.view || t.view.webContents.isDestroyed()) continue;
          let bt = null;
          try { bt = t.view.webContents.backgroundThrottling; } catch {}
          views.push({ id, active: id === activeTabId, sleeping: !!t.sleeping, bt });
        }
        out.throttle = views;
        if (typeof cfg.bgThrottle === "boolean") {
          out.throttlePass = views.every((v) => v.bt === (v.active ? false : !!cfg.bgThrottle));
        } else {
          out.throttlePass = true; // 基线（旧代码无该配置键）：只记录不断言
        }
      } catch (e) { out.throttleErr = String((e && e.stack) || e); out.throttlePass = false; }
      out.stage = "done";
      out.pass = !!(out.boot && out.memBase && Array.isArray(out.curve) && out.curve.length === 6 &&
        out.sleep && out.sleep.slept >= 5 && out.wake && out.wake.awake && out.throttlePass);
      flush();
    } else if (argv.includes("--lg-mattest")) {
      /* 材质对拍（"内外同一个效果"的机械守卫）：
         三层（外壳 / 页面 / 弹层）在**同一个窗口坐标**放同一个测试补丁
         （class="lg-face lg-face-b"，用的就是 material.css 的生产配方），
         各自 capturePage 取补丁中心的平均色 → 两两比较；同时读三层
         getComputedStyle 的 10 个 --lg-glass-* 要求字符串全等，并核对三层
         壁纸层在窗口坐标里的矩形一致。两种皮肤各跑一遍。
         窗口 opacity 0 亮出来（屏幕上看不见），页面才有真实渲染。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      out.savedGlass = cfg.glass;
      out.savedWall = { wallpaper: cfg.wallpaper, kind: cfg.wallpaperKind, blur: cfg.wallpaperBlur, dim: cfg.wallpaperDim, parallax: cfg.wallpaperParallax };
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      try { mainWin.setContentSize(1280, 800); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      await sleep(1200);

      /* 测试壁纸：四象限 + 棋盘格（高频细节）——模糊/几何/滤镜任何一处不同，
         补丁的平均色都会变。就地生成一张 PNG，不依赖用户壁纸。 */
      const makeTestPng = () => {
        const w = 800, h = 500, rowLen = w * 3 + 1;
        const raw = Buffer.alloc(rowLen * h);
        for (let y = 0; y < h; y++) {
          raw[y * rowLen] = 0;
          for (let x = 0; x < w; x++) {
            const o = y * rowLen + 1 + x * 3;
            let r, g, b;
            if (x < w / 2 && y < h / 2) { r = 230; g = 40; b = 60; }
            else if (x >= w / 2 && y < h / 2) { r = 30; g = 150; b = 90; }
            else if (x < w / 2) { r = 40; g = 90; b = 220; }
            else { r = 235; g = 200; b = 40; }
            const chk = ((x >> 4) + (y >> 4)) % 2 === 0;
            if (chk) { r = (r + 34) & 0xff; g = (g + 34) & 0xff; b = (b + 34) & 0xff; }
            raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
          }
        }
        const table = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
        const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
        const chunk = (type, data) => {
          const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
          const t = Buffer.from(type, "ascii");
          const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
          return Buffer.concat([len, t, data, crc]);
        };
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
        return Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          chunk("IHDR", ihdr),
          chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
          chunk("IEND", Buffer.alloc(0)),
        ]);
      };
      try {
        const wpPath = path.join(app.getPath("userData"), "lg-mattest-wall.png");
        fs.writeFileSync(wpPath, makeTestPng());
        cfg.wallpaper = wpPath;
        cfg.wallpaperKind = "image";
        cfg.wallpaperBlur = 0;
        cfg.wallpaperDim = 0;
        cfg.wallpaperParallax = false;
        saveConfig();
      } catch (e) { out.wallErr = String(e); }

      /* 测试补丁：120×90 @ (300,220)。三层各自插一份，坐标按各视图换算。 */
      const PX = 300, PY = 220, PW = 120, PH = 90;
      const patchHtml = (x, y) =>
        '<div id="lg-patch" class="lg-face lg-face-b" style="position:fixed;left:' + x + "px;top:" + y +
        "px;width:" + PW + "px;height:" + PH + "px;border-radius:10px;z-index:2147483000\"></div>";
      const VARS = MATERIAL_KEYS.map((k) => MATERIAL_VARS[k]);
      const readVars = (wc) =>
        wc.executeJavaScript(
          "JSON.stringify(Object.fromEntries(" + JSON.stringify(VARS) + ".map(function(n){return [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]})))",
          true
        );
      const avg = async (wc, rect) => {
        /* 隐藏窗口里 capturePage 可能报 "display surface not available"（窗口被遮挡）
           或长时间不决：关掉后台节流 + 逼一帧 + 重试；三次都拿不到返回 null，由调用方
           记成"环境跳过"，不当材质回归（环境问题不能冤枉代码） */
        let im = null;
        for (let i = 0; i < 3 && !im; i++) {
          try { wc.setBackgroundThrottling(false); } catch {}
          try { im = await withTimeout(wc.capturePage(rect).catch(() => null), 8000, null); } catch { im = null; }
          if (!im) {
            try { wc.invalidate(); } catch {}
            await sleep(450);
          }
        }
        if (!im) return null;
        const bmp = im.toBitmap(); // BGRA
        let r = 0, g = 0, b = 0, n = 0, mn = 255, mx = 0;
        for (let i = 0; i + 3 < bmp.length; i += 4) {
          r += bmp[i + 2]; g += bmp[i + 1]; b += bmp[i]; n++;
          const lum = (bmp[i + 2] + bmp[i + 1] + bmp[i]) / 3;
          if (lum < mn) mn = lum;
          if (lum > mx) mx = lum;
        }
        return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), spread: Math.round(mx - mn) } : null;
      };
      const d = (a, b) => (a && b ? Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) : null);

      const runSkin = async (skin) => {
        cfg.glass = skin;
        saveConfig();
        pushConfigToChrome();
        applyConfigToPages();
        await sleep(1500);
        const res = { skin };
        try {
          /* 页面层：一张只有壁纸的空白测试页（本地面自己的内容会渗进补丁背后，
             把"材质差异"和"背后内容不同"混在一起——第一版就是这么误报的）。
             文件写在 userData 里，走正常的本地页注入（透明化 + 壁纸层）。 */
          const pagePath = path.join(app.getPath("userData"), "lg-mattest-page.html");
          fs.writeFileSync(
            pagePath,
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>mat</title></head><body></body></html>",
            "utf8"
          );
          const matTid = createTab(pathToFileURL(pagePath).href, { activate: true });
          const tab = tabs.get(matTid);
          if (!tab) { res.err = "no-tab"; return res; }
          for (let i = 0; i < 30; i++) {
            await sleep(250);
            if (!tab.view.webContents.isLoading()) break;
          }
          await waitInjected(tab.view.webContents, 8000);
          await sleep(600);
          const wc = tab.view.webContents;
          const b = tab.view.getBounds();
          res.viewBounds = b;
          const pageX = PX - b.x, pageY = PY - b.y;

          /* 三层插入同一补丁 */
          await wc.executeJavaScript(`(function(){var e=document.getElementById("lg-patch-wrap");if(e)e.remove();document.body.insertAdjacentHTML("beforeend", ${JSON.stringify('<div id="lg-patch-wrap">' + patchHtml(pageX, pageY) + "</div>")});return 1})()`, true);
          await mainWin.webContents.executeJavaScript(`(function(){var e=document.getElementById("lg-patch");if(e)e.remove();document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(patchHtml(PX, PY))});return 1})()`, true);
          const pop = ensurePopupView();
          if (pop) {
            /* 弹层的面：走外壳真实的 popupShow 链路（外带 popupThemePayload →
               cssText 全套变量），元素用同一份 .lg-fake/.lg-face-b 配方，
               由 popup.js 摆到同一个窗口坐标（al/ay）。 */
            try {
              const fakeHtml = '<div id="lg-matpatch" class="lg-fake lg-face-b" style="width:' + PW + 'px;height:' + PH + 'px;border-radius:10px"></div>';
              await mainWin.webContents.executeJavaScript(
                "window.lgChrome.popupShow({ html: " + JSON.stringify(fakeHtml) + ", al: " + PX + ", ay: " + PY + ", ...popupThemePayload() })",
                true
              );
            } catch (e) { res.popupErr = String(e); }
          }
          await sleep(700);

          /* 变量字符串全等（三层） */
          const sv = JSON.parse(await readVars(mainWin.webContents));
          const pv = JSON.parse(await readVars(wc));
          const ov = pop ? JSON.parse(await readVars(pop.webContents)) : null;
          res.varParity = {
            shellEqPage: VARS.every((n) => sv[n] === pv[n]),
            pageEqPopup: ov ? VARS.every((n) => pv[n] === ov[n]) : null,
            sample: { shell: sv[VARS[2]], page: pv[VARS[2]], popup: ov ? ov[VARS[2]] : null },
          };

          /* 壁纸层矩形（换算到窗口坐标） */
          /* 未变换的 computed 盒子（left/top/width/height 不含 scale(1.04) 视差
             变换）+ 视图偏移 = 窗口坐标。三层同一算法，含外壳与页面。 */
          const wallRect = (wc2, extra) =>
            wc2.executeJavaScript(
              `(function(){var el=document.querySelector(".lg-wallpaper");if(!el)return null;var c=getComputedStyle(el);return JSON.stringify({x:Math.round(parseFloat(c.left)+${extra.x}),y:Math.round(parseFloat(c.top)+${extra.y}),w:Math.round(parseFloat(c.width)),h:Math.round(parseFloat(c.height))})})()`,
              true
            );
          res.wallDiag = JSON.parse(
            await wc.executeJavaScript(
              `(function(){var el=document.querySelector(".lg-wallpaper");var cs=el?getComputedStyle(el):null;var root=getComputedStyle(document.documentElement);return JSON.stringify({exist:!!el,inline:el?el.style.cssText.slice(0,200):"",left:cs?cs.left:null,top:cs?cs.top:null,w:cs?cs.width:null,h:cs?cs.height:null,pos:cs?cs.position:null,insetX:root.getPropertyValue("--lg-inset-x").trim(),wallX:root.getPropertyValue("--lg-wall-x").trim(),wallW:root.getPropertyValue("--lg-wall-w").trim(),filter:cs?String(cs.filter).slice(0,60):null})})()`,
              true
            )
          );
          let popupFake = null;
          if (pop) {
            try {
              const j = await pop.webContents.executeJavaScript(
                `(function(){var e=document.querySelector("#lg-matpatch");if(!e)return "null";var r=e.getBoundingClientRect();var c=getComputedStyle(e,"::before");var w=Math.round(parseFloat(c.width)||0),h=Math.round(parseFloat(c.height)||0);return JSON.stringify({x:Math.round(r.left+parseFloat(c.left)),y:Math.round(r.top+parseFloat(c.top)),w:w,h:h,popX:e.style.getPropertyValue("--pop-x"),menuLeft:Math.round(r.left)})})()`,
                true
              );
              res.popupGeom = JSON.parse(j);
              popupFake = res.popupGeom;
            } catch (e) { res.popupGeomErr = String(e); }
          }
          const sw = await wallRect(mainWin.webContents, { x: 0, y: 0 });
          /* 页面层的 computed left/top 是"视图内坐标"，换算到窗口要加视图偏移 */

          const pw = await wallRect(wc, { x: b.x, y: b.y });
          res.wallRects = { shell: sw ? JSON.parse(sw) : null, page: pw ? JSON.parse(pw) : null, popupFake };
          const same2 = (a, b2) => a && b2 && Math.abs(a.x - b2.x) <= 1 && Math.abs(a.y - b2.y) <= 1 && Math.abs(a.w - b2.w) <= 1 && Math.abs(a.h - b2.h) <= 1;
          const s1 = res.wallRects.shell, p1 = res.wallRects.page, f1 = res.wallRects.popupFake;
          res.wallRectParity = { shellEqPage: same2(s1, p1), pageEqPopup: same2(p1, f1) };

          /* 补丁中心像素（三层） */
          const patchStyle = (wc2, id) =>
            wc2.executeJavaScript(
              `(function(){var e=document.getElementById(${JSON.stringify(id)});if(!e)return null;var c=getComputedStyle(e);var r=e.getBoundingClientRect();return JSON.stringify({bg:c.backgroundColor,bf:c.backdropFilter,sh:c.boxShadow.slice(0,60),cls:e.className,r:{w:Math.round(r.width),h:Math.round(r.height)}})})()`,
              true
            );
          res.patchStyle = {
            shell: JSON.parse(await patchStyle(mainWin.webContents, "lg-patch") || "null"),
            page: JSON.parse(await patchStyle(wc, "lg-patch") || "null"),
            popup: pop ? JSON.parse(await patchStyle(pop.webContents, "lg-matpatch") || "null") : null,
          };
          const shellAvg = await avg(mainWin.webContents, { x: PX + 36, y: PY + 26, width: 48, height: 40 });
          const pageAvg = await avg(wc, { x: pageX + 36, y: pageY + 26, width: 48, height: 40 });
          const popAvg = pop ? await avg(pop.webContents, { x: PX + 36, y: PY + 26, width: 48, height: 40 }) : null;
          /* 弹层是透明视图：隐藏窗口里第一次抓常常拿到一整张纯黑——那不是"料
             不对"，是这块 surface 没合成（跨视图 capturePage 的环境限制）。
             涂红对照：换 --lg-face 再抓，红了说明帧是真的、色差才有意义；
             还是黑/没变化就把弹层这条腿记成环境跳过（页面↔外壳那条照常判）。 */
          let popControl = null;
          if (pop && popAvg && popAvg.r + popAvg.g + popAvg.b <= 3) {
            try {
              await pop.webContents.executeJavaScript('(function(){var e=document.getElementById("lg-matpatch");if(e)e.style.setProperty("--lg-face","rgba(255,0,0,0.9)");return 1})()', true);
              await sleep(500);
              const popRed = await avg(pop.webContents, { x: PX + 36, y: PY + 26, width: 48, height: 40 });
              popControl = popRed;
              res.popupRed = popRed;
              await pop.webContents.executeJavaScript('(function(){var e=document.getElementById("lg-matpatch");if(e)e.style.removeProperty("--lg-face");return 1})()', true);
              await sleep(250);
            } catch (e) { res.popupRedErr = String(e); }
          }
          res.patch = { shell: shellAvg, page: pageAvg, popup: popAvg };
          res.delta = {
            shellPage: d(shellAvg, pageAvg),
            pagePopup: d(pageAvg, popAvg),
            shellPopup: d(shellAvg, popAvg),
          };
          /* 判据：liquid 容忍 10/255（模糊链的合成差异），flat 要求 ≤ 4 */
          const tol = skin === "liquid" ? 10 : 4;
          /* 抓不到帧（隐藏窗口被遮挡）时不算失败也不算通过：记 pixelSkipped 让上层
             report-only（JSON 里看得见，报告里照实说） */
          res.pixelSkipped = !(shellAvg && pageAvg);
          /* 弹层那两条腿：纯黑 + 涂红对照也没红 → 这块 surface 没合成，跳过
             （记录 popupLayerSkipped，报告里照实说），其余照判。 */
          const popLayerDead = !!popAvg && popAvg.r + popAvg.g + popAvg.b <= 3 && !(popControl && popControl.r + popControl.g + popControl.b > 30);
          res.popupLayerSkipped = popLayerDead;
          res.passPixel = !res.pixelSkipped && res.delta.shellPage != null && res.delta.shellPage <= tol &&
            (popLayerDead || res.delta.pagePopup == null || res.delta.pagePopup <= tol) &&
            (popLayerDead || res.delta.shellPopup == null || res.delta.shellPopup <= tol);
          /* 补丁确实坐在壁纸玻璃上：flat 面 0.92 会透出壁纸 → 中心不该是纯色；
             liquid 模糊后面内差异小但整体色应与面色不同 */
          res.patchBlurred = !!(pageAvg && pageAvg.spread <= 60);

          /* 收尾：撤补丁、收弹层 */
          await wc.executeJavaScript('(function(){var e=document.getElementById("lg-patch-wrap");if(e)e.remove()})()', true).catch(() => {});
          await mainWin.webContents.executeJavaScript('(function(){var e=document.getElementById("lg-patch");if(e)e.remove()})()', true).catch(() => {});
          if (pop) {
            try { await mainWin.webContents.executeJavaScript("window.lgChrome.popupHide()", true); } catch {}
            try { pop.setVisible(false); } catch {}
          }
          try { if (typeof closeTab === "function") closeTab(matTid); } catch {}
        } catch (e) { res.err = String(e); }
        return res;
      };

      out.flat = await runSkin("flat");
      flush();
      out.liquid = await runSkin("liquid");
      flush();
      // 恢复原皮肤与壁纸
      cfg.glass = out.savedGlass || "flat";
      if (out.savedWall) {
        cfg.wallpaper = out.savedWall.wallpaper;
        cfg.wallpaperKind = out.savedWall.kind;
        cfg.wallpaperBlur = out.savedWall.blur;
        cfg.wallpaperDim = out.savedWall.dim;
        cfg.wallpaperParallax = out.savedWall.parallax;
      }
      saveConfig();
      pushConfigToChrome();
      applyConfigToPages();
      out.pass = !!(
        out.flat && out.liquid &&
        (out.flat.passPixel || out.flat.pixelSkipped) &&
        (out.liquid.passPixel || out.liquid.pixelSkipped)
      );
      flush();
    } else if (argv.includes("--lg-contesttest")) {
      /* 首页"近期比赛"的数据链路：net.fetch 抓 /contest/list → 解析
         lentille-context → 按开赛时间排序 → 首页渲染。分三层报，出问题能
         一眼看出是网络层、解析层还是渲染层。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      for (let i = 0; i < 40 && tabs.size === 0; i++) await sleep(500);
      try {
        const res = await net.fetch("https://www.luogu.com.cn/contest/list", { useSessionCookies: true });
        const html = await res.text();
        out.raw = {
          status: res.status,
          len: html.length,
          hasLentille: /id="lentille-context"/.test(html),
          hasFeContext: /application\/fe-context/.test(html),
        };
      } catch (e) { out.rawErr = String(e); }
      flush();
      await fetchContests();
      out.cache = { at: contestsCache.at, n: contestsCache.list.length };
      out.upcoming = contestsCache.list
        .filter((c) => c.startTime > Date.now())
        .slice(0, 3)
        .map((c) => ({ name: c.name, at: new Date(c.startTime).toISOString().slice(0, 16) }));
      flush();
      // 首页渲染层：等首页读完缓存再抓 DOM 文案
      try {
        const invoke = (ch, ...args) => {
          const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
          return h ? h({ sender: mainWin.webContents }, ...args) : null;
        };
        await invoke("lg-app:open-home");
        await sleep(2500);
        const ht = tabs.get(activeTabId);
        out.homeText = await ht.view.webContents.executeJavaScript(
          `(document.getElementById("contests").textContent || "").slice(0, 90)`, true);
      } catch (e) { out.homeErr = String(e); }
      flush();
    } else if (argv.includes("--lg-imgtest")) {
      /* 静态壁纸到底画没画出来。怀疑点：lg-media:// 是自定义协议，而洛谷的 CSP
         只写在 <meta> 里、default-src 白名单里没有它 —— CSS 背景图按 img-src
         回落到 default-src，会被整条拦掉（层在、底色在，就是没有图）。
         页面里做三件事：收 CSP 违规事件、试 lg-media:// 加载、试同一份字节的
         blob: 加载。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      try { mainWin.setOpacity(0); } catch {}
      try { mainWin.showInactive(); } catch {}
      await sleep(600);
      const tab = tabs.get(createTab(HOME_URL, { activate: true }));
      // 注入抛错时 executeJavaScript 只回一句"Script failed to execute"，
      // 真正的原因（哪个变量未定义）只在渲染进程控制台里 —— 抓下来。
      out.console = [];
      try {
        tab.view.webContents.on("console-message", (_e, level, msg, line, src) => {
          out.console.push(String(msg).slice(0, 200) + " @" + String(line));
          if (out.console.length > 24) out.console.shift();
          flush();
        });
      } catch (e) { out.consoleHookErr = String(e); }
      await new Promise((res) => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        try {
          tab.view.webContents.once("did-finish-load", fin);
          tab.view.webContents.once("did-fail-load", fin);
        } catch {}
        setTimeout(fin, 25000);
      });
      // 等注入落地（首帧读太早会把"还没有"读成"没有"）
      for (let i = 0; i < 12; i++) {
        const ok = await tab.view.webContents
          .executeJavaScript(`!!(window.__lgGlass && document.getElementById("lg-glass-bg"))`, true)
          .catch(() => false);
        if (ok) break;
        await sleep(1000);
      }
      await sleep(1200);
      const pl = wallpaperImagePayload();
      out.payload = pl ? { ok: pl.ok, type: pl.type, size: pl.size, name: pl.name } : null;
      try {
        out.test = JSON.parse(
          await tab.view.webContents.executeJavaScript(
            `(async function(){
               var o = { viol: [], media: null, blob: null, data: null, css: null };
               document.addEventListener("securitypolicyviolation", function(e){
                 o.viol.push(String(e.violatedDirective) + " <- " + String(e.blockedURI).slice(0, 44));
               }, true);
               var bg = document.getElementById("lg-glass-bg");
               var cs = bg ? getComputedStyle(bg) : null;
               if (cs) {
                 o.css = { bgImage: String(cs.backgroundImage).slice(0, 120), bgColor: cs.backgroundColor, filter: cs.filter };
                 o.box = [Math.round(bg.getBoundingClientRect().width), Math.round(bg.getBoundingClientRect().height)];
               }
               // 页面骨架自己有没有不透明底色：站点视图透明了也得骨架透出来才算数
               function bcol(sel) {
                 var el = sel === "html" ? document.documentElement : document.querySelector(sel);
                 if (!el) return sel + ":none";
                 return sel + ":" + getComputedStyle(el).backgroundColor;
               }
               o.skeleton = [bcol("html"), bcol("body"), bcol("#app"), bcol(".lg-index-content"), bcol(".lg-article")];
               var u = cs ? cs.getPropertyValue("--lg-bg-image").trim().replace(/^url\\(["']?/, "").replace(/["']?\\)$/, "") : "";
               o.url = u.slice(0, 56);
               function probe(src) {
                 return new Promise(function(res){
                   var i = new Image();
                   var t = setTimeout(function(){ res({ ok: false, timeout: true }); }, 6000);
                   i.onload = function(){ clearTimeout(t); res({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); };
                   i.onerror = function(){ clearTimeout(t); res({ ok: false }); };
                   i.src = src;
                 });
               }
               if (u) o.media = await probe(u);
               o.hasWallImageApi = !!(window.lgApp && window.lgApp.wallImage);
               if (o.hasWallImageApi) {
                 try {
                   var r = await window.lgApp.wallImage();
                   if (r && r.ok && r.data) {
                     var u8 = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
                     var bu = URL.createObjectURL(new Blob([u8], { type: r.type || "image/png" }));
                     o.blob = await probe(bu);
                     // data: 也在白名单里吗？（不在的话连内联都走不通）
                     var bin = "";
                     for (var k = 0; k < u8.length; k++) bin += String.fromCharCode(u8[k]);
                     o.data = await probe("data:" + (r.type || "image/png") + ";base64," + btoa(bin));
                   } else { o.blob = { ok: false, err: r ? String(r.err || "no-data") : "null" }; }
                 } catch (e) { o.blob = { ok: false, err: String(e) }; }
               }
               o.wall = (window.__lgGlass && window.__lgGlass.wallDebug) ? window.__lgGlass.wallDebug() : null;
               return JSON.stringify(o);
             })()`,
            true
          )
        );
      } catch (e) { out.testErr = String(e); }
      flush();
      // 站点视图的像素：页面是"自己画了不透明灰底"还是"真的透明"
      const stats = (img) => {
        const bmp = img.toBitmap(); // BGRA
        let total = 0, opaque = 0, clear = 0, r = 0, g = 0, b = 0;
        for (let i = 0; i + 3 < bmp.length; i += 4) {
          total++;
          const a = bmp[i + 3];
          if (a > 250) { opaque++; r += bmp[i + 2]; g += bmp[i + 1]; b += bmp[i]; }
          if (a < 8) clear++;
        }
        return {
          w: img.getSize().width, h: img.getSize().height, total,
          opaqueRatio: +(opaque / Math.max(1, total)).toFixed(3),
          clearRatio: +(clear / Math.max(1, total)).toFixed(3),
          avgOpaque: opaque ? [Math.round(r / opaque), Math.round(g / opaque), Math.round(b / opaque)] : null,
        };
      };
      try {
        const siteImg = await tab.view.webContents.capturePage();
        out.sitePixels = stats(siteImg);
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-site.png", siteImg.toPNG());
      } catch (e) { out.siteCapErr = String(e); }
      try {
        const chromeImg = await mainWin.webContents.capturePage();
        out.chromePixels = stats(chromeImg);
        fsx.writeFileSync(selftestShot.replace(/\.json$/i, "") + "-chrome.png", chromeImg.toPNG());
      } catch (e) { out.chromeCapErr = String(e); }
      flush();
    } else if (argv.includes("--lg-walltest")) {
      /* 视频壁纸多标签：只该活动标签解码，后台标签必须暂停 ——
         N 个标签各解一路正是"用 Wallpaper Engine 时很卡/效果不好"的根子。
         窗口用 opacity 0 亮出来（否则所有视图的 visibilityState 都是 hidden，
         分不出活动/非活动），屏幕上看不见。 */
      const out = { at: new Date().toISOString() };
      const flush = () => fsx.writeFileSync(selftestShot, JSON.stringify(out, null, 2));
      const vid = process.env.LG_WALL_VIDEO || "";
      if (vid) {
        cfg.wallpaper = vid;
        // 不设 kind 的话 wallpaperIsVideo 会沿用旧值（图片），视频根本不会被挂上
        cfg.wallpaperKind = "video";
        saveConfig();
        applyConfigToPages();
        pushConfigToChrome();
        out.wallpaper = vid;
      }
      flush();
      // LG_VISIBLE=1 时用真实可见的小窗口做对照：Chromium 对"不可见窗口"
      // 会挂起媒体加载，opacity 0 有可能被当成不可见 —— 拿它区分"真坏了"和
      // "只是探针看不见"。窗口放右下角、showInactive 不抢焦点。
      const wantVisible = process.env.LG_VISIBLE === "1";
      try {
        const wa = screen.getPrimaryDisplay().workArea;
        const w = wantVisible ? Math.min(620, wa.width) : 900;
        const h = wantVisible ? Math.min(420, wa.height) : 620;
        mainWin.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h });
      } catch {}
      try { mainWin.setOpacity(wantVisible ? 1 : 0); } catch {}
      try { mainWin.showInactive(); } catch {}
      out.visible = wantVisible;
      flush();
      const readOne = async (id) => {
        const t = tabs.get(id);
        if (!t) return { id, gone: true };
        try {
          return JSON.parse(
            await t.view.webContents.executeJavaScript(
              `(function(){
                 var bg = document.getElementById("lg-glass-bg");
                 var v = bg ? bg.querySelector(":scope > video.lg-bg-video") : null;
                 var cs = bg ? getComputedStyle(bg) : null;
                 var vs = v ? getComputedStyle(v) : null;
                 return JSON.stringify({
                   hasBg: !!bg, hasVideo: !!v,
                   src: v ? String(v.getAttribute("data-src") || "") : "",
                   paused: v ? !!v.paused : null,
                   readyState: v ? v.readyState : null,
                   netState: v ? v.networkState : null,
                   err: v && v.error ? (v.error.code + ":" + v.error.message) : null,
                   t: v ? +Number(v.currentTime || 0).toFixed(2) : null,
                   vis: document.visibilityState,
                   bgDisp: cs ? cs.display : null,
                   bgZ: cs ? cs.zIndex : null,
                   bgOp: cs ? cs.opacity : null,
                   vDisp: vs ? vs.display : null,
                   vOp: vs ? vs.opacity : null,
                   wallFlag: document.documentElement.getAttribute("data-lg-wall"),
                   tabActiveFlag: document.documentElement.getAttribute("data-lg-tabactive")
                 });
               })()`,
              true
            )
          );
        } catch (e) { return { id, err: String(e) }; }
      };
      createTab(HOME_URL, { activate: true });
      await sleep(7000);
      createTab(HOME_URL, { activate: true });
      await sleep(7000);
      out.tabs = tabOrder.map((id) => ({ id, active: id === activeTabId }));
      out.snap1 = [];
      for (const id of tabOrder) out.snap1.push(Object.assign({ id, active: id === activeTabId }, await readOne(id)));
      flush();
      await sleep(3500);
      out.snap2 = [];
      for (const id of tabOrder) out.snap2.push(Object.assign({ id, active: id === activeTabId }, await readOne(id)));
      const prev = {};
      out.snap1.forEach((r) => { prev[r.id] = r; });
      out.snap2.forEach((r) => {
        if (prev[r.id] && typeof r.t === "number" && typeof prev[r.id].t === "number") {
          r.advanced = +(r.t - prev[r.id].t).toFixed(2);
        }
      });
      out.verdict = out.snap2.map((r) => ({
        id: r.id, active: !!r.active, vis: r.vis, paused: r.paused, advanced: r.advanced,
        ok: r.active ? r.paused === false : r.paused === true,
      }));
      out.allOk = out.verdict.every((v) => v.ok);
      flush();
      // 再切回第一个标签：后台那个该停住，切回来的这个该重新播
      if (tabOrder.length > 1) setActiveTab(tabOrder[0]);
      await sleep(3500);
      out.snap3 = [];
      for (const id of tabOrder) out.snap3.push(Object.assign({ id, active: id === activeTabId }, await readOne(id)));
      out.verdict3 = out.snap3.map((r) => ({
        id: r.id, active: !!r.active, paused: r.paused, t: r.t,
        ok: r.active ? r.paused === false : r.paused === true,
      }));
      out.allOk = out.allOk && out.verdict3.every((v) => v.ok);
      // 直接调一次 setTabActive 并立刻回读，看函数到底改没改状态
      if (tabOrder.length > 1) {
        try {
          const t2 = tabs.get(tabOrder[1]);
          out.setActiveDirect = JSON.parse(
            await t2.view.webContents.executeJavaScript(
              `(function(){
                 var before = document.documentElement.getAttribute("data-lg-tabactive");
                 var hasApi = !!(window.__lgGlass && window.__lgGlass.setTabActive);
                 var ret = hasApi ? window.__lgGlass.setTabActive(false) : "no-api";
                 var after = document.documentElement.getAttribute("data-lg-tabactive");
                 var bg = document.getElementById("lg-glass-bg");
                 var v = bg ? bg.querySelector(":scope > video.lg-bg-video") : null;
                 return JSON.stringify({
                   hasApi: hasApi, ret: String(ret), before: before, after: after,
                   hasVideoEl: !!v, dataSrc: v ? String(v.getAttribute("data-src") || "").slice(0, 30) : "",
                   paused: v ? !!v.paused : null
                 });
               })()`,
              true
            )
          );
        } catch (e) { out.setActiveDirectErr = String(e); }
      }
      flush();
      // 决定性对照：同一份数据用 blob: URL 播（CSP 白名单里有 blob:）。
      // 能播就说明 lg-media:// 这条路走不通、该换 blob 方案。
      if (vid) {
        try {
          const b64 = fs.readFileSync(vid).toString("base64");
          out.blobTest = JSON.parse(
            await tabs.get(tabOrder[0]).view.webContents.executeJavaScript(
              `(async function(){
                 try {
                   var bin = atob(${JSON.stringify(b64)});
                   var arr = new Uint8Array(bin.length);
                   for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                   var blob = new Blob([arr], { type: "video/webm" });
                   var url = URL.createObjectURL(blob);
                   var v = document.createElement("video");
                   v.muted = true; v.loop = true;
                   v.setAttribute("playsinline", "");
                   v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px";
                   v.src = url;
                   document.body.appendChild(v);
                   await new Promise(function(r){ v.onloadeddata = r; v.onerror = r; setTimeout(r, 15000); });
                   var p = v.play(); if (p && p.catch) p.catch(function(){});
                   await new Promise(function(r){ setTimeout(r, 2500); });
                   var res = {
                     readyState: v.readyState, errCode: v.error ? v.error.code : null,
                     paused: v.paused, t: +Number(v.currentTime || 0).toFixed(2),
                     w: v.videoWidth, h: v.videoHeight, bytes: arr.length
                   };
                   try { v.pause(); } catch (e) {}
                   URL.revokeObjectURL(url);
                   v.remove();
                   return JSON.stringify(res);
                 } catch (e) { return JSON.stringify({ ex: String(e) }); }
               })()`,
              true
            )
          );
        } catch (e) { out.blobTestErr = String(e); }
      }
      flush();
      // 重挂一次 video src，并监听 securitypolicyviolation —— 直接看是不是 CSP 拦的
      try {
        const t0 = tabs.get(tabOrder[0]);
        out.videoRetry = JSON.parse(
          await t0.view.webContents.executeJavaScript(
            `(async function(){
               var bg = document.getElementById("lg-glass-bg");
               var v = bg ? bg.querySelector(":scope > video.lg-bg-video") : null;
               if (!v) return JSON.stringify({ err: "no video el" });
               var viol = [];
               function onV(e) {
                 viol.push({ uri: String(e.blockedURI || "").slice(0, 56), dir: String(e.violatedDirective || "") });
               }
               document.addEventListener("securitypolicyviolation", onV);
               var url = v.getAttribute("data-src");
               v.removeAttribute("src");
               v.setAttribute("src", url);
               try { v.load(); } catch (e) {}
               await new Promise(function(r){ setTimeout(r, 5000); });
               document.removeEventListener("securitypolicyviolation", onV);
               return JSON.stringify({
                 viol: viol, readyState: v.readyState, netState: v.networkState,
                 errCode: v.error ? v.error.code : null,
                 errMsg: v.error ? String(v.error.message || "").slice(0, 90) : null,
                 paused: v.paused, curSrc: String(v.src || "").slice(0, 70)
               });
             })()`,
            true
          )
        );
      } catch (e) { out.videoRetryErr = String(e); }
      flush();
      // CSP 到底走响应头还是 meta？决定能不能用 onHeadersReceived 放宽
      try {
        const r = await net.fetch(HOME_URL);
        out.homeCSPHeader = r.headers.get("content-security-policy") || "(none)";
      } catch (e) { out.homeCSPErr = String(e); }
      flush();
      // 页面侧对照实验：同一协议加载 <img> 行不行、CSP 到底写了什么
      if (vid) {
        try {
          const t0 = tabs.get(tabOrder[0]);
          const imgPath = cfg.wallpaper && !isVideoFile(cfg.wallpaper) ? cfg.wallpaper : "";
          out.pageTests = JSON.parse(
            await t0.view.webContents.executeJavaScript(
              `(async function(){
                 var res = { csp: "", img: null, fetchImg: null };
                 try {
                   var m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
                   if (m) res.csp = m.content;
                 } catch (e) {}
                 var imgUrl = ${JSON.stringify(
                   mediaUrlFor(imgPath || "C:/Users/Administrator/AppData/Roaming/LuoguLab/wallpapers/1790761623361.webp")
                 )};
                 if (imgUrl) {
                   res.img = await new Promise(function(r){
                     var i = new Image();
                     i.onload = function(){ r({ ok: true, w: i.naturalWidth, h: i.naturalHeight }); };
                     i.onerror = function(){ r({ ok: false }); };
                     i.src = imgUrl;
                     setTimeout(function(){ r({ ok: false, timeout: true }); }, 6000);
                   });
                   try {
                     var rr = await fetch(imgUrl);
                     res.fetchImg = { status: rr.status, bytes: (await rr.arrayBuffer()).byteLength };
                   } catch (e) { res.fetchImg = { err: String(e) }; }
                 }
                 return JSON.stringify(res);
               })()`,
              true
            )
          );
        } catch (e) { out.pageTestsErr = String(e); }
      }
      flush();
      // 主进程侧直接取一次：能分清"协议给不出数据"和"页面/video 不收"
      if (vid) {
        try {
          const r = await net.fetch(mediaUrlFor(vid), { headers: { Range: "bytes=0-2047" } });
          const ab = await r.arrayBuffer();
          out.netFetch = {
            status: r.status, bytes: ab.byteLength,
            ctype: r.headers.get("content-type"), crange: r.headers.get("content-range"),
          };
          // 再整份取一次：<video> 发的就是 bytes=0-（整文件），如果大响应有问题
          // 这里能看出来
          const r2 = await net.fetch(mediaUrlFor(vid), { headers: { Range: "bytes=0-" } });
          const ab2 = await r2.arrayBuffer();
          out.netFetchFull = {
            status: r2.status, bytes: ab2.byteLength,
            ctype: r2.headers.get("content-type"), crange: r2.headers.get("content-range"),
          };
        } catch (e) { out.netFetchErr = String(e); }
      }
      flush();
      // 直接取一次媒体 URL，看协议本身给不给得出数据（区分"协议坏了"和"视频没播"）
      if (vid) {
        try {
          const t0 = tabs.get(tabOrder[0]);
          out.mediaProbe = JSON.parse(
            await t0.view.webContents.executeJavaScript(
              `(async function(){
                 var url = ${JSON.stringify(mediaUrlFor(vid))};
                 try {
                   var r = await fetch(url, { headers: { Range: "bytes=0-2047" } });
                   var b = await r.arrayBuffer();
                   return JSON.stringify({ status: r.status, bytes: b.byteLength,
                     ctype: r.headers.get("content-type"), crange: r.headers.get("content-range"),
                     urlHead: url.slice(0, 90) });
                 } catch (e) { return JSON.stringify({ err: String(e), urlHead: url.slice(0, 90) }); }
               })()`,
              true
            )
          );
        } catch (e) { out.mediaProbeErr = String(e); }
      }
      flush();
    } else if (argv.includes("--lg-addacct")) {
      /* 用环境变量里的凭据跑一次"添加账号"（验证成功才落库）。
         凭据走环境变量而不是命令行：命令行会出现在进程列表里。 */
      const email = String(process.env.LG_ACCT_EMAIL || "").trim();
      const pass = String(process.env.LG_ACCT_PASS || "");
      const out = { email, steps: [], captchaSaved: false };
      if (!email || !pass) {
        out.err = "no-credentials";
      } else {
        // 等验证码时把它落盘，人眼识别后写 captcha-answer.txt 即可继续
        const t = setInterval(() => {
          try {
            if (acctJob && acctJob.captcha) {
              const b64 = String(acctJob.captcha).split(",")[1] || "";
              // 每轮都覆盖写：验证码会刷新，留最新那张才能喂对答案
              if (b64) {
                fsx.writeFileSync(selftestShot + ".captcha.png", Buffer.from(b64, "base64"));
                out.captchaSaved = true;
              }
            }
            if (acctJob) out.steps.push(acctJob.stage + ": " + acctJob.message);
          } catch {}
        }, 1500);
        try {
          out.result = await Promise.race([
            accountAddFlow(email, pass),
            new Promise((r) => setTimeout(() => r({ ok: false, stage: "timeout" }), 150000)),
          ]);
        } catch (e) {
          out.result = { ok: false, stage: "throw", reason: String(e) };
        }
        clearInterval(t);
        out.accounts = accounts.map((a) => ({ id: a.id, email: a.email, hasPass: !!a.password, name: a.name || "" }));
        out.activeId = cfg.activeAccountId;
      }
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(out, null, 2));
    } else if (argv.includes("--lg-popuptest")) {
      /* 弹出层覆盖视图实测：切首页拍欢迎块，再打开账号菜单拍覆盖层。
         覆盖层能拍到完整菜单 = 下拉不再被网页遮挡。 */
      const base = selftestShot.replace(/\.png$/i, "");
      const out = { steps: [] };
      let home = null;
      for (let i = 0; i < 60 && !home; i++) {
        await new Promise((r) => setTimeout(r, 500));
        home = [...tabs.values()].find(
          (x) => !isLocalKind(x.kind) && /luogu\.com\.cn\/?$/.test(x.view.webContents.getURL())
        );
      }
      if (!home) home = [...tabs.values()].find((x) => !isLocalKind(x.kind));
      if (home) {
        setActiveTab(home.id);
        await new Promise((r) => setTimeout(r, 5000));
        const im = await safeCapture(home.view.webContents);
        if (im) fsx.writeFileSync(base + "-page.png", im.toPNG());
        out.hello = JSON.parse(
          await home.view.webContents
            .executeJavaScript(
              `(function(){
                 var h = document.getElementById("lg-hello");
                 var bg = document.getElementById("lg-glass-bg");
                 var br = bg ? bg.getBoundingClientRect() : null;
                 var out = {
                   hello: !!h,
                   bgRect: br ? [Math.round(br.x),Math.round(br.y),Math.round(br.width),Math.round(br.height)] : null,
                   view: [innerWidth, innerHeight]
                 };
                 if (!h) return JSON.stringify(out);
                 var cs = getComputedStyle(h), hr = h.getBoundingClientRect();
                 var p = h.parentNode, pcs = getComputedStyle(p), pr = p.getBoundingClientRect();
                 out.helloRect = [Math.round(hr.x),Math.round(hr.y),Math.round(hr.width),Math.round(hr.height)];
                 out.helloStyle = { color: cs.color, fs: cs.fontSize, op: cs.opacity, vis: cs.visibility, disp: cs.display, pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor, filter: cs.filter, mixBlend: cs.mixBlendMode };
                 out.parentCls = String(p.className);
                 out.parentRect = [Math.round(pr.x),Math.round(pr.y),Math.round(pr.width),Math.round(pr.height)];
                 out.parentStyle = { disp: pcs.display, overflow: pcs.overflow, h: pcs.height, align: pcs.alignItems, filter: pcs.filter, op: pcs.opacity, pos: pcs.position, z: pcs.zIndex };
                 out.text = String(h.textContent).slice(0, 60);
                 out.card = (function(){
                   var c = h.closest(".lg-article");
                   if (!c) return null;
                   var cc = getComputedStyle(c), cr = c.getBoundingClientRect();
                   return { rect: [Math.round(cr.x),Math.round(cr.y),Math.round(cr.width),Math.round(cr.height)], bg: cc.backgroundColor, bf: cc.backdropFilter, z: cc.zIndex, pos: cc.position };
                 })();
                 out.stack = (function(){
                   var els = document.elementsFromPoint(400, 100) || [];
                   return Array.prototype.slice.call(els, 0, 8).map(function(x){ return x.tagName + "." + String(x.className).slice(0, 40) + "#" + (x.id || ""); });
                 })();
                 return JSON.stringify(out);
               })()`,
              true
            )
            .catch((e) => JSON.stringify({ err: String(e) }))
        );
      }
      // 打开账号菜单 → 菜单应该落到覆盖层里
      await mainWin.webContents.executeJavaScript(
        `(function(){ var c = document.getElementById("user-chip"); if (c) c.click(); return true; })()`,
        true
      );
      await new Promise((r) => setTimeout(r, 1400));
      out.popup = {
        // View 只有 setVisible，没有 getVisible —— 用 bounds 判断是否被撑满
        bounds: popupView ? popupView.getBounds() : null,
        chromeMenuHidden: await mainWin.webContents
          .executeJavaScript(`document.getElementById("account-menu").hidden`, true)
          .catch(() => null),
        items: await mainWin.webContents
          .executeJavaScript(`document.querySelectorAll("#am-list .am-item").length`, true)
          .catch(() => null),
      };
      if (popupView) {
        const pim = await safeCapture(popupView.webContents);
        if (pim) fsx.writeFileSync(base + "-pop.png", pim.toPNG());
      }
      fsx.writeFileSync(base + ".json", JSON.stringify(out, null, 2));
    } else if (argv.includes("--lg-menu2")) {
      /* 首页欢迎块 + 账号菜单实测：
         1) 切到首页标签，截页面视图（看欢迎块有没有住进运势卡左列、壁纸对不对齐）
         2) 打开账号菜单，截外壳层（看菜单自身画得对不对）
         之后窗口留着不关 45 秒，外面用桌面截图看菜单被页面视图遮了多少。 */
      const base = selftestShot.replace(/\.png$/i, "");
      let home = null;
      for (let i = 0; i < 60 && !home; i++) {
        await new Promise((r) => setTimeout(r, 500));
        home = [...tabs.values()].find(
          (x) => !isLocalKind(x.kind) && /luogu\.com\.cn\/?$/.test(x.view.webContents.getURL())
        );
      }
      if (!home) home = [...tabs.values()].find((x) => !isLocalKind(x.kind));
      if (home) {
        setActiveTab(home.id);
        await new Promise((r) => setTimeout(r, 5000));
        const im = await safeCapture(home.view.webContents);
        if (im) fsx.writeFileSync(base + "-page.png", im.toPNG());
        const info = await home.view.webContents
          .executeJavaScript(
            `(function(){
               var h = document.getElementById("lg-hello");
               var r = h ? h.getBoundingClientRect() : null;
               var host = h && h.parentNode ? String(h.parentNode.className) : "";
               var bg = document.getElementById("lg-glass-bg");
               var br = bg ? bg.getBoundingClientRect() : null;
               return JSON.stringify({
                 hello: !!h, helloRect: r ? [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] : null,
                 host: host,
                 bgRect: br ? [Math.round(br.x),Math.round(br.y),Math.round(br.width),Math.round(br.height)] : null,
                 view: [innerWidth, innerHeight]
               });
             })()`,
            true
          )
          .catch((e) => JSON.stringify({ err: String(e) }));
        fsx.writeFileSync(base + ".json", info);
      }
      try {
        await mainWin.webContents.executeJavaScript(
          `(function(){ var c = document.getElementById("user-chip"); if (c) c.click(); return true; })()`,
          true
        );
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
      const im2 = await safeCapture(mainWin.webContents);
      if (im2) fsx.writeFileSync(base + "-chrome.png", im2.toPNG());
      await new Promise((r) => setTimeout(r, 45000));
    } else if (argv.includes("--lg-topbar")) {
      /* 外壳层体检：把顶栏每个零件的矩形/显示态/内容长度都 dump 出来，
         再直接截外壳层自己（capturePage 不受其它窗口遮挡影响）。
         "窗口三键看不见"到底是没渲染、是空按钮、还是被挤出视口，一眼可辨。 */
      await new Promise((r) => setTimeout(r, 6000));
      try { mainWin.maximize(); } catch {}
      await new Promise((r) => setTimeout(r, 1800));
      const res = JSON.parse(
        await mainWin.webContents.executeJavaScript(
          `(function(){
             var out = { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, bodyCls: document.body.className, layout: document.body.getAttribute("data-layout"), items: [] };
             var ids = ["top","tabstrip","tabs","tab-new","strip-pad","navrow","logo","histbtns","omnibox","sitelnks","actions","btn-bookmark","btn-theme","user-chip","wctl","w-min","w-max","w-close","loadbar","dock","vtab","vtab-set"];
             for (var i = 0; i < ids.length; i++) {
               var e = document.getElementById(ids[i]);
               if (!e) { out.items.push({ id: ids[i], missing: true }); continue; }
               var r = e.getBoundingClientRect();
               var cs = getComputedStyle(e);
               out.items.push({
                 id: ids[i],
                 rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                 disp: cs.display, vis: cs.visibility, op: cs.opacity, pos: cs.position, z: cs.zIndex,
                 color: cs.color, bg: cs.backgroundColor,
                 htmlLen: String(e.innerHTML).length, kids: e.children.length
               });
             }
             return JSON.stringify(out);
           })()`,
          true
        )
      );
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(res, null, 2));
      const img3 = await safeCapture(mainWin.webContents);
      if (img3) fsx.writeFileSync(selftestShot, img3.toPNG());
    } else if (argv.includes("--lg-plain")) {
      /* 裸对照：一个不注入任何脚本的普通窗口加载洛谷首页。
         "首页那块空白"到底是洛谷自己的设计，还是我们注入搞出来的，看它最直接。 */
      const pwin = new BrowserWindow({
        width: 1280,
        height: 860,
        show: true,
        title: "LG-PLAIN",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          session: acctSession(cfg.activeAccountId),
        },
      });
      try {
        await pwin.loadURL(HOME_URL);
        await new Promise((r) => setTimeout(r, 9000));
        const img = await pwin.webContents.capturePage();
        if (img) fsx.writeFileSync(selftestShot, img.toPNG());
        const info = await pwin.webContents.executeJavaScript(
          `JSON.stringify({
             url: location.href,
             injected: !!document.getElementById("lg-glass-bg"),
             cards: document.querySelectorAll(".lg-article").length,
             firstHtmlLen: (function(){var e=document.querySelector(".lg-article");return e?e.innerHTML.length:-1;})(),
             firstText: (function(){var e=document.querySelector(".lg-article");return e?String(e.textContent).replace(/\\s+/g," ").trim().slice(0,300):"";})()
           })`
        );
        fsx.writeFileSync(selftestShot + ".json", info);
      } catch (e) {
        fsx.writeFileSync(selftestShot + ".json", JSON.stringify({ err: String(e) }));
      }
      try { pwin.destroy(); } catch {}
    } else if (argv.includes("--lg-blobtest")) {
      /* 首页"大片模糊"定位：把页面里所有带 filter/backdrop-filter 的元素
         连同矩形一起 dump 出来，再对几个坐标做 elementsFromPoint 采样。
         只有先知道那块是谁画的，才谈得上修。 */
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 3000));
      const res = JSON.parse(
        await t.view.webContents.executeJavaScript(
          `(function(){
            window.scrollTo(0, 0);
            var out = { url: location.href, blurs: [], points: [], view: [innerWidth, innerHeight] };
            var all = document.querySelectorAll("*");
            for (var i = 0; i < all.length && out.blurs.length < 120; i++) {
              var el = all[i];
              var cs = getComputedStyle(el);
              var bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
              var f = cs.filter || "none";
              if ((bf && bf !== "none") || (f && f !== "none")) {
                var r = el.getBoundingClientRect();
                if (r.width * r.height < 3000) continue;
                out.blurs.push({
                  tag: el.tagName, cls: String(el.className).slice(0, 90),
                  id: el.id || "", bf: String(bf).slice(0, 70), f: String(f).slice(0, 70),
                  rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
                });
              }
            }
            var pts = [[442, 222], [600, 300], [300, 500], [622, 452], [700, 530], [760, 300]];
            for (var j = 0; j < pts.length; j++) {
              var p = pts[j];
              var els = document.elementsFromPoint(p[0], p[1]);
              var arr = [];
              for (var k = 0; k < Math.min(els.length, 7); k++) {
                var e2 = els[k];
                var c2 = getComputedStyle(e2);
                var r2 = e2.getBoundingClientRect();
                arr.push({
                  tag: e2.tagName, cls: String(e2.className).slice(0, 70), id: e2.id || "",
                  bf: String(c2.backdropFilter).slice(0, 60), f: String(c2.filter).slice(0, 60),
                  bg: c2.backgroundColor, bgi: String(c2.backgroundImage).slice(0, 100),
                  rect: [Math.round(r2.x), Math.round(r2.y), Math.round(r2.width), Math.round(r2.height)]
                });
              }
              out.points.push({ p: p, els: arr });
            }
            /* 欢迎块里到底有什么：逐个子节点列出矩形与可见性，
               空白块是"本该有东西却没了"还是"本来就是空的"，看这个最直接 */
            out.cards = [];
            var arts = document.querySelectorAll(".lg-article");
            for (var a = 0; a < Math.min(arts.length, 2); a++) {
              var card = arts[a];
              var cr = card.getBoundingClientRect();
              var node = {
                cls: String(card.className).slice(0, 80),
                rect: [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)],
                all: card.querySelectorAll("*").length,
                htmlLen: card.innerHTML.length,
                text: String(card.textContent).replace(/\\s+/g, " ").trim().slice(0, 200),
                kids: []
              };
              var kids = card.querySelectorAll("*");
              for (var q = 0; q < kids.length && q < 90; q++) {
                var ke = kids[q];
                var kc = getComputedStyle(ke);
                var kr = ke.getBoundingClientRect();
                node.kids.push({
                  tag: ke.tagName, cls: String(ke.className).slice(0, 50),
                  rect: [Math.round(kr.x), Math.round(kr.y), Math.round(kr.width), Math.round(kr.height)],
                  disp: kc.display, vis: kc.visibility, op: kc.opacity,
                  bgi: String(kc.backgroundImage).slice(0, 60),
                  txt: (ke.children.length === 0 ? String(ke.textContent || "").trim().slice(0, 40) : ""),
                  img: ke.tagName === "IMG" ? String(ke.getAttribute("src") || "").slice(0, 90) + "|nw" + ke.naturalWidth : ""
                });
              }
              out.cards.push(node);
            }
            /* 洁净模式到底藏了谁：标记元素 + 它的祖先链 + 兄弟矩形，
               "清了促销位却留下一个大洞"就靠这个定位 */
            out.promos = [];
            var marked = document.querySelectorAll("[data-lg-promo]");
            for (var m2 = 0; m2 < marked.length && m2 < 20; m2++) {
              var pe = marked[m2];
              var pr = pe.getBoundingClientRect();
              var chain = [];
              var up = pe;
              for (var d = 0; d < 4 && up; d++) {
                var ur = up.getBoundingClientRect();
                chain.push({
                  tag: up.tagName, cls: String(up.className).slice(0, 50),
                  rect: [Math.round(ur.x), Math.round(ur.y), Math.round(ur.width), Math.round(ur.height)],
                  disp: getComputedStyle(up).display
                });
                up = up.parentElement;
              }
              out.promos.push({
                flag: pe.getAttribute("data-lg-promo"),
                rect: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
                disp: getComputedStyle(pe).display,
                txt: String(pe.textContent).replace(/\\s+/g, " ").trim().slice(0, 90),
                chain: chain
              });
            }
            return JSON.stringify(out);
          })()`,
          true
        )
      );
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(res, null, 2));
    } else if (argv.includes("--lg-randtest")) {
      /* 随机跳题实测：在真实页面里跑一遍"拉列表 → 解析 count → 随机页 →
         取 pid"，把每一步的中间结果都落盘，接口形态变了能立刻看出来 */
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 2500));
      const res = JSON.parse(
        await t.view.webContents.executeJavaScript(
          `(async function(){
            var out = { steps: [] };
            function step(n, v) { out.steps.push({ n: n, v: v }); }
            var base = "/problem/list?difficulty=3&type=P&page=";
            try {
              var r1 = await fetch(base + "1&_contentOnly=1", { credentials: "include" });
              out.status1 = r1.status;
              out.finalUrl1 = r1.url;
              var h1 = await r1.text();
              out.head1 = String(h1).slice(0, 200);
              var m = String(h1).match(/<script[^>]*id=["']lentille-context["'][^>]*>([\\s\\S]*?)<\\/script>/i);
              var raw = m ? m[1] : null;
              var d = null;
              try { d = raw ? JSON.parse(raw) : JSON.parse(h1); } catch (e) { out.parseErr = String(e); }
              out.hasData = !!(d && d.data);
              var pr = d && d.data && d.data.problems;
              if (pr) {
                out.count = pr.count;
                out.resultLen = (pr.result || []).length;
                out.firstPid = pr.result && pr.result[0] ? pr.result[0].pid : null;
              } else if (d) {
                out.dataKeys = Object.keys(d.data || {});
              }
              // 再随机翻一页，模拟完整跳题链路
              if (out.count) {
                var pages = Math.max(1, Math.ceil(out.count / 50));
                var page = Math.floor(Math.random() * pages) + 1;
                step("page", page);
                var r2 = await fetch(base + page + "&_contentOnly=1", { credentials: "include" });
                var h2 = await r2.text();
                var m2 = String(h2).match(/<script[^>]*id=["']lentille-context["'][^>]*>([\\s\\S]*?)<\\/script>/i);
                var d2 = null;
                try { d2 = m2 ? JSON.parse(m2[1]) : JSON.parse(h2); } catch (e) {}
                var list = (d2 && d2.data && d2.data.problems && d2.data.problems.result) || [];
                out.page2 = page; out.page2Len = list.length;
                out.randomPid = list.length ? list[Math.floor(Math.random() * list.length)].pid : null;
              }
            } catch (e) { out.err = String(e); }
            return JSON.stringify(out);
          })()`,
          true
        )
      );
      fsx.writeFileSync(selftestShot + ".json", JSON.stringify(res, null, 2));
    } else if (argv.includes("--lg-rande2e")) {
      /* 端到端：真实点击"随机跳题"→ picker → 开始跳题，看当前标签是否真的
         导航到题目页（验证 location.href 通道 + 协议接管全链路） */
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 2500));
      const before = t.view.webContents.getURL();
      const opened = JSON.parse(
        await t.view.webContents.executeJavaScript(
          `(async function(){
            var out = {};
            var go = document.querySelector('button[name="gotorandom"]');
            if (!go) return JSON.stringify({ err: "no gotorandom" });
            go.click();
            for (var i = 0; i < 20; i++) {
              await new Promise(function(r){ setTimeout(r, 200); });
              if (document.getElementById("lg-random")) break;
            }
            out.picker = !!document.getElementById("lg-random");
            return JSON.stringify(out);
          })()`,
          true
        )
      );
      // 关键回归：选择框弹出后，页面绝不能自己跳走（"还没等我选择就跳了"）
      await new Promise((r) => setTimeout(r, 2000));
      const midUrl = t.view.webContents.getURL();
      const mid = JSON.parse(
        await t.view.webContents.executeJavaScript(
          `JSON.stringify({ picker: !!document.getElementById("lg-random"), url: location.href })`,
          true
        )
      );
      const picked = await t.view.webContents
        .executeJavaScript(
          `(function(){ var p = document.querySelector("#lg-random .lg-random-btn.primary"); if (p) { p.click(); return true; } return false; })()`,
          true
        )
        .catch(() => false);
      let after = midUrl;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        after = t.view.webContents.getURL();
        if (/\/problem\/(P|B|CF|SP|AT|U)/i.test(after)) break;
      }
      // luogu-glass:// 走的是"新标签跳题"，当前标签不动是对的——再看一眼标签列表
      const snaps = tabsSnapshot().tabs;
      const probTab = snaps.find((s) => /\/problem\/[A-Z]/i.test(s.url || ""));
      const pshot = await safeCapture(t.view.webContents);
      if (pshot) fsx.writeFileSync(selftestShot.replace(/\.png$/, "") + "-home.png", pshot.toPNG());
      fsx.writeFileSync(
        selftestShot + ".json",
        JSON.stringify(
          {
            opened,
            before,
            pickerHeldPage: mid.picker && midUrl === before, // 弹出后页面原地不动 = 修复生效
            midUrl,
            picked,
            after,
            jumped: midUrl !== after && /\/problem\//.test(after),
            newTab: probTab ? probTab.url : null,
            tabs: snaps.length,
          },
          null,
          2
        )
      );
    } else if (argv.includes("--lg-tabtest")) {
      // 标签行为测试：首页 → IDE 特殊标签 → 题目页新标签 → 切回首页
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      toggleIde();
      await new Promise((r) => setTimeout(r, 4000));
      createTab(HOME_URL + "problem/P1001");
      await new Promise((r) => setTimeout(r, 5000));
      const first = tabOrder[0];
      setActiveTab(first);
      await new Promise((r) => setTimeout(r, 1200));
      const img = (await safeCapture(mainWin.webContents)) ;
      if (img) fsx.writeFileSync(selftestShot, img.toPNG());
      const t2 = tabs.get(activeTabId);
      const pimg = await safeCapture(t2.view.webContents);
      if (pimg) fsx.writeFileSync(selftestShot.replace(/\.png$/, "") + "-page.png", pimg.toPNG());
      fsx.writeFileSync(
        selftestShot + ".json",
        JSON.stringify({ tabs: tabsSnapshot(), activeUrl: t2.view.webContents.getURL() })
      );
    } else if (argv.includes("--lg-usertest")) {
      // 登录态缓存回归：洛谷页识别到账号后，切到站外页 / 本地页都不能掉成"未登录"
      const chip = async () => {
        try {
          return await mainWin.webContents.executeJavaScript(
            `(function(){var c=document.getElementById("user-chip");return c?c.textContent:"";})()`,
            true
          );
        } catch (e) { return "<err " + e.message + ">"; }
      };
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      await waitInjected(t.view.webContents);
      await new Promise((r) => setTimeout(r, 3000));
      pushUser();
      await new Promise((r) => setTimeout(r, 2500));
      const onLuogu = { url: t.view.webContents.getURL(), chip: await chip(), user: lastUser };

      // 站外页
      const extId = createTab("https://example.com/", { activate: true });
      await new Promise((r) => setTimeout(r, 4000));
      pushUser();
      await new Promise((r) => setTimeout(r, 2500));
      const onExternal = { chip: await chip(), user: lastUser };

      // 本地页（设置）
      openSettingsTab();
      await new Promise((r) => setTimeout(r, 1500));
      pushUser();
      await new Promise((r) => setTimeout(r, 2500));
      const onLocal = { chip: await chip(), user: lastUser };

      // 切回洛谷页，登录态仍在
      setActiveTab(t.id);
      await new Promise((r) => setTimeout(r, 2000));
      pushUser();
      await new Promise((r) => setTimeout(r, 2500));
      const backToLuogu = { chip: await chip(), user: lastUser };

      const notAnon = (s) => !!s && s.chip.indexOf("未登录") < 0;
      const checks = {
        luoguDetected: !!(onLuogu.user && onLuogu.user.uid),
        externalKeepsLogin: notAnon(onExternal),
        localKeepsLogin: notAnon(onLocal),
        backToLuoguKeepsLogin: notAnon(backToLuogu),
        tabsAfter: tabsSnapshot().length,
        extTabId: extId,
      };
      const img = await safeCapture(mainWin.webContents);
      if (img) fsx.writeFileSync(selftestShot, img.toPNG());
      fsx.writeFileSync(
        selftestShot + ".json",
        JSON.stringify({ checks, onLuogu, onExternal, onLocal, backToLuogu }, null, 1)
      );
    } else {
      // 常规自测：等 chrome 层开出首个标签并注入完成 → 断言 → 整窗截图
      let t = null;
      for (let i = 0; i < 60 && !t; i++) {
        await new Promise((r) => setTimeout(r, 500));
        t = tabs.get(activeTabId);
      }
      let checks = { error: "no tab" };
      if (t) {
        await waitInjected(t.view.webContents);
        await new Promise((r) => setTimeout(r, 2500));
        checks = JSON.parse(
          await t.view.webContents.executeJavaScript(
            `JSON.stringify({
              glass: typeof window.__lgGlass,
              theme: document.documentElement.getAttribute('data-lg-theme'),
              bg: !!document.getElementById('lg-glass-bg'),
              applied: document.documentElement.hasAttribute('data-lg-theme'),
              clean: document.documentElement.getAttribute('data-lg-clean'),
              nativeTopbarHidden: (function(){ var e = document.querySelector('.top-bar'); return !e || getComputedStyle(e).display === 'none'; })(),
              promoFlagged: Array.from(document.querySelectorAll('[data-lg-promo="1"]')).map(function(e){ return String(e.className).slice(0,40); }),
              features: {
                page: document.documentElement.getAttribute('data-lg-page'),
                repaint: document.documentElement.getAttribute('data-lg-repaint'),
                declutter: document.documentElement.getAttribute('data-lg-declutter'),
                quickSearch: document.documentElement.getAttribute('data-lg-quicksearch'),
                listTools: document.documentElement.getAttribute('data-lg-listtools'),
                wall: document.documentElement.getAttribute('data-lg-wall'),
                desat: document.documentElement.getAttribute('data-lg-desat'),
                ide: document.documentElement.getAttribute('data-lg-ide'),
                listToolbar: !!document.getElementById('lg-listtools'),
                quickBox: !!document.getElementById('lg-quicksearch'),
                /* 配色预设：四条基色变量是否真的落到页面上 */
                preset: document.documentElement.getAttribute('data-lg-preset'),
                anim: document.documentElement.getAttribute('data-lg-anim'),
                diffAttr: document.documentElement.getAttribute('data-lg-diff'),
                codeCopyAttr: document.documentElement.getAttribute('data-lg-codecopy'),
                codeCopyBtns: document.querySelectorAll('.lg-code-copy').length,
                tint: document.documentElement.style.getPropertyValue('--lg-tint').trim(),
                ink: document.documentElement.style.getPropertyValue('--lg-ink').trim(),
                accent: document.documentElement.style.getPropertyValue('--lg-accent').trim(),
                bgBase: document.documentElement.style.getPropertyValue('--lg-bg-base').trim(),
                radius: document.documentElement.style.getPropertyValue('--lg-radius').trim(),
                borderVar: document.documentElement.style.getPropertyValue('--lg-border').trim()
              },
              feUser: (function(){
                try {
                  var out = {};
                  var av = document.querySelector('img[src*="usericon"]');
                  out.avatar = av ? av.src.slice(0, 80) : null;
                  var tb = document.querySelector('.top-bar');
                  out.topbar = tb ? (getComputedStyle(tb).display === 'none' ? 'hidden' : 'visible') : 'absent';
                  var wel = document.body.innerText.match(/欢迎回来[，,：:\s]*([A-Za-z0-9_]{2,24})/);
                  out.welcome = wel ? wel[1] : null;
                  var scripts = Array.prototype.slice.call(document.querySelectorAll('script[id]')).map(function(s){ return s.id; }).slice(0, 8).join('|');
                  out.scripts = scripts;
                  return out;
                } catch(e) { return 'ERR:' + e; }
              })(),
              url: location.href
            })`,
            true
          )
        );
      }
      // 外壳层断言（chrome 层）
      let shell = {};
      try {
        shell = JSON.parse(
          await mainWin.webContents.executeJavaScript(
            `JSON.stringify({
              omni: !!document.getElementById('omni-input'),
              sitelnks: !!document.getElementById('sitelnks'),
              dock: !!document.getElementById('dock'),
              footerRemoved: !document.getElementById('bottom'),
              loadbar: !!document.getElementById('loadbar'),
              histbtns: !!document.getElementById('btn-back') && !!document.getElementById('btn-fwd') && !!document.getElementById('btn-reload'),
              layout: document.body.getAttribute('data-layout'),
              vtabShown: (function(){ var e = document.getElementById('vtab'); return !!e && getComputedStyle(e).display !== 'none'; })(),
              vtabTabs: document.querySelectorAll('#vtabs .vtab').length,
              acctMenu: !!document.getElementById('account-menu'),
              // 设置入口必须画成滑杆图标（旧版画成了太阳）；
              // 工具行那个齿轮已按用户要求撤掉，现在只认垂直栏底部那颗
              gearIcon: (function(){
                var e = document.getElementById('vtab-set');
                if (!e) return 'absent';
                var h = e.innerHTML;
                if (h.indexOf('circle') < 0) return 'empty';
                return h.indexOf('M12 2v3') >= 0 ? 'sun-like' : 'sliders-ok';
              })()
              ,vtabTabTitles: Array.prototype.map.call(document.querySelectorAll('#vtabs .vtab .t-title'), function(e){ return e.textContent; }),
              tabStyle: (function(){ var el = document.querySelector('.tab.active'); return el ? getComputedStyle(el).boxShadow : 'no-active-tab'; })(),
              omniResolve: (function(){
                var r = window.resolveOmnibox || function(){ return null; };
                return [
                  (r('P1001') || {}).url,
                  (r('deepseek', { deepseek: 'https://chat.deepseek.com' }) || {}).type,
                  (r('https://github.com') || {}).type,
                  (r('12345') || {}).url,
                  (r('最大流') || {}).type
                ];
              })()
            })`,
            true
          )
        );
      } catch (e) {
        shell = { error: String(e) };
      }
      const img = (await safeCapture(mainWin.webContents)) ; // chrome 层
      if (img) fsx.writeFileSync(selftestShot, img.toPNG());
      if (t) {
        // WebContentsView 不进整窗合成，页面层单独截
        const pimg = await safeCapture(t.view.webContents);
        if (pimg) fsx.writeFileSync(selftestShot.replace(/\.png$/, "") + "-page.png", pimg.toPNG());
      }
      fsx.writeFileSync(
        selftestShot + ".json",
        JSON.stringify({ checks, shell, tabs: tabsSnapshot() })
      );
    }
  } catch (e) {
    console.error("selftest failed:", e);
    dbg("selftest failed: " + (e && e.stack ? e.stack : String(e)));
  } finally {
    try { if (mainWin && !mainWin.isDestroyed()) mainWin.destroy(); } catch {}
    app.exit(0);
  }
}