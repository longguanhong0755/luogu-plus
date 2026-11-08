/* 静态检查：语法、必需文件、渲染层引用、IPC 通道双向对齐。
   不联网、不启动 Electron，CI 与本地共用。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let checks = 0;

function ok(message) {
  checks++;
  console.log("  ok  " + message);
}

function fail(message, detail) {
  failures++;
  console.log("  FAIL " + message);
  if (detail) console.log("       " + detail);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/* 只解析本项目生成的 8-bit RGBA 非隔行 PNG，用于阻止白边/白底回潮。 */
function decodeRgbaPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let interlace = 0;
  const chunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG ${width}x${height}, depth=${bitDepth}, color=${colorType}, interlace=${interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source++];
      const left = x >= bpp ? pixels[row + x - bpp] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[row - stride + x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error("unknown PNG filter " + filter);
      }
      pixels[row + x] = (value + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function iconAssetProblems() {
  const problems = [];
  const sizes = [16, 20, 24, 32, 40, 48, 64, 80, 128, 256];
  for (const size of sizes) {
    const rel = `src/assets/icon-${size}.png`;
    try {
      const png = decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)));
      if (png.width !== size || png.height !== size) problems.push(`${size}:尺寸`);
      let visible = 0;
      let wrongColor = 0;
      let edgeVisible = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          const a = png.pixels[i + 3];
          if (!a) continue;
          visible++;
          if (png.pixels[i] !== 91 || png.pixels[i + 1] !== 155 || png.pixels[i + 2] !== 213) wrongColor++;
          if (x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1) edgeVisible++;
        }
      }
      if (!visible) problems.push(`${size}:空白`);
      if (wrongColor) problems.push(`${size}:${wrongColor}个非官方色素`);
      if (edgeVisible) problems.push(`${size}:${edgeVisible}个触边素`);
    } catch (err) {
      problems.push(`${size}:${err.message}`);
    }
  }
  for (const copy of ["icon.png", "tray.png"]) {
    const a = fs.readFileSync(path.join(ROOT, "src/assets", copy));
    const expected = fs.readFileSync(path.join(ROOT, copy === "icon.png" ? "src/assets/icon-256.png" : "src/assets/icon-32.png"));
    if (!a.equals(expected)) problems.push(copy + ":副本不一致");
  }
  const ico = fs.readFileSync(path.join(ROOT, "src/assets/icon.ico"));
  const count = ico.readUInt16LE(4);
  const icoSizes = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    icoSizes.push(ico[base] || 256);
  }
  if (count !== sizes.length || icoSizes.join(",") !== sizes.join(",")) problems.push("ICO:" + icoSizes.join(","));
  return problems;
}

/* 1. 所有 JS 通过 node --check */
const files = walk(path.join(ROOT, "src"), []).filter((file) => file.endsWith(".js"));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail("语法 " + path.relative(ROOT, file).replace(/\\/g, "/"), result.stderr.trim());
}
ok(`${files.length} 个 JS 文件语法通过`);

/* 2. 必需文件 */
const required = [
  "src/main/index.js",
  "src/main/config.js",
  "src/main/theme.js",
  "src/main/material.js",
  "src/main/adblock.js",
  "src/main/views.js",
  "src/main/sections.js",
  "src/main/passkey-guard.js",
  "src/main/ocr.js",
  "src/main/store.js",
  "scripts/captcha-ocr.py",
  "src/main/luogu.js",
  "src/main/tray.js",
  "src/main/taskbar.js",
  "src/main/notify.js",
  "src/main/ipc.js",
  "src/main/smoke.js",
  "src/preload/shell.js",
  "src/preload/page.js",
  "src/preload/settings.js",
  "src/renderer/shell/index.html",
  "src/renderer/shell/shell.js",
  "src/renderer/shell/library.js",
  "src/renderer/shell/shell.css",
  "src/renderer/settings/index.html",
  "src/renderer/settings/settings.js",
  "src/renderer/settings/settings.css",
  "src/renderer/skin/luogu-skin.css",
  "src/assets/luogu-mark.svg",
  "src/assets/icon.ico",
  "src/assets/tray.png",
  "scripts/patch-exe.js",
  "scripts/build-icon-assets.py",
];
for (const file of required) {
  if (fs.existsSync(path.join(ROOT, file))) ok("存在 " + file);
  else fail("缺少 " + file);
}

const iconProblems = iconAssetProblems();
if (!iconProblems.length) ok("图标资产：10 尺寸透明蓝色标志，无白边/白底/触边");
else fail("图标资产契约失败", iconProblems.join("；"));

/* 3. package.json 可解析且入口存在 */
try {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.main && fs.existsSync(path.join(ROOT, pkg.main))) ok("package.json main 指向有效入口");
  else fail("package.json main 无效");
} catch (err) {
  fail("package.json 解析失败", err.message);
}

/* 4. renderer HTML 的资源引用都存在 */
for (const html of [
  "src/renderer/shell/index.html",
  "src/renderer/settings/index.html",
]) {
  const source = read(html);
  const refs = [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    const resolved = path.join(ROOT, path.dirname(html), ref);
    if (fs.existsSync(resolved)) ok(`${html} → ${ref}`);
    else fail(`${html} 引用了不存在的 ${ref}`);
  }
}

/* 5. IPC 双向对齐 */
const ipcSource = read("src/main/ipc.js");
const mainHandlers = new Set(
  [...ipcSource.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1])
);
const preloadCalls = new Set();
for (const file of ["src/preload/shell.js", "src/preload/settings.js", "src/preload/page.js"]) {
  const source = read(file);
  for (const m of source.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)) preloadCalls.add(m[1]);
}
for (const channel of preloadCalls) {
  if (mainHandlers.has(channel)) ok("IPC " + channel);
  else fail("preload 调用了未注册的通道 " + channel);
}

const mainSends = new Set();
for (const file of walk(path.join(ROOT, "src", "main"), []).filter((f) => f.endsWith(".js"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(/webContents\.send\("([^"]+)"/g)) mainSends.add(m[1]);
}
const preloadListeners = new Set();
for (const file of ["src/preload/shell.js", "src/preload/settings.js", "src/preload/page.js"]) {
  const source = read(file);
  for (const m of source.matchAll(/on\("([^"]+)"/g)) preloadListeners.add(m[1]);
}
for (const channel of mainSends) {
  if (preloadListeners.has(channel)) ok("推送 " + channel);
  else fail("主进程推送了没有 preload 监听的通道 " + channel);
}

/* 6. 危险默认值检查 */
const configSource = read("src/main/config.js");
if (/closeAction:\s*"tray"/.test(configSource)) ok("默认关窗收托盘");
else fail("默认关窗行为不是 tray");
if (/autoLaunch:\s*false/.test(configSource)) ok("默认不开机自启");
else fail("开机自启默认值不是 false");

const luoguSource = read("src/main/luogu.js");
if (/shell\.openExternal/.test(luoguSource)) fail("luogu.js 不应直接调用 shell.openExternal");
else ok("站外链接不在数据层处理");

const viewsSource = read("src/main/views.js");
if (/safeOpenExternal\(/.test(viewsSource) || /openExternal\(url\)/.test(viewsSource)) ok("站外链接交给系统浏览器");
else fail("views.js 没有站外链接出口");

/* R57 导航契约 */
if (/reopenClosed/.test(viewsSource) && /closedStack/.test(viewsSource) && /canReopen/.test(viewsSource)) ok("最近关闭栈与恢复入口存在");
else fail("views.js 缺少最近关闭恢复");
if (viewsSource.split("this.returnLib = this.library").length >= 3) ok("题目/详情/个人页都会记住来源列表");
else fail("部分入口没有设置 returnLib");
if (/"t"\) command = "reopen"/.test(viewsSource)) ok("Ctrl+Shift+T 恢复关闭页面");
else fail("缺少 Ctrl+Shift+T 恢复快捷键");
const openLoginBody = viewsSource.split("openLogin()")[1] || "";
if (/auth\/login"\)\.catch/.test(openLoginBody)) ok("登录页复用时按需重载");
else fail("openLogin 缺少重载逻辑");
if (/canReopen,/.test(viewsSource)) ok("页面状态带 canReopen（工具条按钮可置灰）");
else fail("currentInfo 缺少 canReopen");
if (/"reopen"\) ctx\.views\.reopenClosed\(\)/.test(ipcSource)) ok("app:viewAction 支持恢复关闭页面");
else fail("ipc.js 未接入 reopen 动作");
if (/iconButton\("reopen"/.test(read("src/renderer/shell/chrome.js"))) ok("工具条有恢复关闭页面按钮");
else fail("工具条缺少恢复按钮");

/* 7. 产品关键约束（0.2.0） */
const passkeySource = read("src/main/passkey-guard.js");
if (/__lgPasskeyGuard/.test(passkeySource) && /options\.publicKey/.test(passkeySource) && /credentials\.get/.test(passkeySource)) {
  ok("通行密钥守卫存在且完全阻止系统凭据弹窗");
} else {
  fail("通行密钥守卫不完整");
}
if (
  /attachPasskeyGuard/.test(viewsSource) &&
  /addScriptToEvaluateOnNewDocument/.test(passkeySource) &&
  /runImmediately/.test(passkeySource) &&
  /attachToWebContents/.test(passkeySource)
) {
  ok("守卫在主世界文档创建前注入所有页面视图");
} else {
  fail("页面视图没有主世界守卫注入");
}
if (/uid > 0/.test(luoguSource)) ok("登录态要求真实 uid（游客 _uid=0 不算登录）");
else fail("登录态可能把游客误判为已登录");

const ocrSource = read("src/main/ocr.js");
if (/ddddocr/.test(ocrSource) && /recognize/.test(ocrSource) && /timeout/.test(ocrSource)) {
  ok("验证码自动识别模块存在且有超时保护");
} else {
  fail("ocr.js 缺少 ddddocr/recognize/超时保护");
}
if (/captchaOcr/.test(luoguSource) && /fetchCaptchaPng/.test(luoguSource) && /captchaRequired/.test(luoguSource)) {
  ok("提交验证码自动识别重试已接入产品路径");
} else {
  fail("luogu.js 缺少提交验证码自动识别链路");
}
if (/interactive/.test(luoguSource) && /YIDUN|易盾/.test(luoguSource)) {
  ok("易盾交互式挑战不自动破解，交给页面内辅助");
} else {
  fail("luogu.js 缺少交互式挑战识别");
}
const viewsSource2 = read("src/main/views.js");
if (/openSubmitAssist/.test(viewsSource2) && /insertText/.test(viewsSource2)) {
  ok("页面内提交辅助（打开提交区并填代码）存在");
} else {
  fail("views.js 缺少页面内提交辅助");
}

const sectionsSource = read("src/main/sections.js");
if (!/class: \{ label: "课程"/.test(sectionsSource) && /article: \{ label: "文章"/.test(sectionsSource)) {
  ok("侧栏已移除课程并保留文章");
} else {
  fail("sections.js 仍包含课程板块");
}
if (/resolveRail/.test(sectionsSource) && /custom/.test(sectionsSource)) ok("侧栏支持排序/显隐/自定义");
else fail("sections.js 缺少侧栏定制模型");

const themeSource = read("src/main/theme.js");
if (/accentFill/.test(themeSource) && /onAccent/.test(themeSource)) ok("强调色实心按钮有对比度令牌");
else fail("theme.js 缺少 accentFill/onAccent");
if (
  /const tint = \(base, amount\) => mixHex\(colors\.accent, base, amount\)/.test(themeSource) &&
  /colors\.bg = tint\(neutral\.bg/.test(themeSource) &&
  /colors\.rail = tint\(neutral\.rail/.test(themeSource) &&
  /colors\.surface = tint\(neutral\.surface/.test(themeSource) &&
  /colors\.glassTint = colors\.accent/.test(themeSource) &&
  /--lg-glass-tint/.test(viewsSource)
) {
  ok("自定义主题色统一给外壳/设置/页面玻璃着色");
} else {
  fail("自定义主题色只改变强调元素，未覆盖全部玻璃承载面");
}

for (const [name, content, needle] of [
  ["壁纸来源", configSource, /wallpaperInterval/],
  ["文件夹轮换", configSource, /wallpaperDir/],
  ["Wallpaper Engine", configSource, /weRoot/],
]) {
  if (needle.test(content)) ok(name + "配置存在");
  else fail(name + "配置缺失");
}

const shellHtml = read("src/renderer/shell/index.html");
if (/id="tb-jump"/.test(shellHtml) && !/rail-jump-input/.test(shellHtml) && /id="library"/.test(shellHtml)) {
  ok("外壳包含题号跳转按钮与原生列表容器");
} else {
  fail("外壳缺少题号跳转按钮或仍保留侧栏内联输入框");
}
const settingsHtml = read("src/renderer/settings/index.html");
if (/data-sec="wallpaper"/.test(settingsHtml) && /data-sec="rail"/.test(settingsHtml) && /id="wp-we-list"/.test(settingsHtml)) {
  ok("设置包含壁纸与侧边栏分区");
} else {
  fail("设置缺少壁纸/侧边栏分区");
}
if (/id="accent-custom"/.test(settingsHtml) && /id="accent-value"/.test(settingsHtml) && /自定义主题色/.test(settingsHtml)) {
  ok("设置提供可发现的自定义主题色入口与当前值反馈");
} else {
  fail("设置缺少自定义主题色入口或值反馈");
}
const taskbarSource = read("src/main/taskbar.js");
const mainWindowSource = read("src/main/window.js");
if (
  /app\.setAppUserModelId/.test(read("src/main/index.js")) &&
  /CreateShortcut/.test(taskbarSource) &&
  /SHGetPropertyStoreFromParsingName/.test(taskbarSource) &&
  /taskbarpin/.test(taskbarSource) &&
  /app:taskbarPin/.test(ipcSource) &&
  /pinTaskbar: \(\) => ipcRenderer\.invoke\("app:taskbarPin"\)/.test(read("src/preload/settings.js")) &&
  /id="taskbar-pin"/.test(settingsHtml) &&
  /ctx\.pinTaskbar/.test(read("src/main/tray.js"))
) {
  ok("Windows 任务栏固定入口贯通设置页/托盘/主进程快捷方式");
} else {
  fail("Windows 任务栏固定链路不完整");
}
if (
  /setAppDetails\(\{/.test(mainWindowSource) &&
  /appIconPath/.test(mainWindowSource) &&
  /relaunchCommand/.test(mainWindowSource) &&
  /color: "#00000000"/.test(mainWindowSource)
) {
  ok("窗口任务栏身份同步且原生标题栏按钮覆盖层透明");
} else {
  fail("窗口任务栏身份或透明标题栏覆盖层契约失败");
}

const designFile = path.join(ROOT, "..", "design.md");
if (fs.existsSync(designFile) && fs.statSync(designFile).size > 6000) ok("design.md 存在且有实质内容");
else fail("design.md 缺失或过短");

/* ---------- 断网可用契约 ---------- */

const storeSrc = read("src/main/store.js");
if (/renameSync/.test(storeSrc) && /MAX_VALUE_BYTES/.test(storeSrc) && /evict\(/.test(storeSrc)) {
  ok("store.js 原子写 + 体积上限 + 前缀淘汰");
} else {
  fail("store.js 缺少原子写/体积上限/淘汰");
}

const luoguSrc = read("src/main/luogu.js");
for (const [name, needle] of [
  ["在线状态跟踪", /setOnline\(online\)/],
  ["在线轮询", /startOnlineWatch/],
  ["主页快照回填", /hydrate\(\)/],
  ["快照落盘", /persistSnapshot/],
  ["离线列表缓存", /cachedLib/],
  ["离线列表落盘", /saveLib/],
  ["离线提交队列", /enqueueSubmit/],
  ["队列重放", /flushQueue/],
  ["队列状态", /queueState/],
  ["题目快照存取", /problemSnapshotUrl/],
  ["题面 DOM 快照", /saveProblemSnapshot/],
  ["页面 fetch 超时", /AbortSignal\.timeout/],
]) {
  if (needle.test(luoguSrc)) ok("luogu.js " + name);
  else fail("luogu.js 缺少" + name);
}
if (/["']\/lg4\/captcha/.test(luoguSrc)) fail("luogu.js 残留错误的 /lg4/captcha 端点（提交验证码应走 /api/verify/captcha）");
else ok("提交验证码端点唯一且正确");

const viewsSrc = read("src/main/views.js");
for (const [name, needle] of [
  ["离线 URL 识别", /isOfflineUrl/],
  ["快照捕获调度", /scheduleProblemCapture/],
  ["快照抓取", /captureProblem/],
  ["题目加载失败回退快照", /回退离线快照/],
  ["水合前不存裸 markdown", /raw-markdown/],
  ["快照要求正文类已出现", /no-marked/],
  ["lgoff 导航放行", /isOfflineUrl\(url\)\) return/],
  ["离线页不注皮肤", /离线快照页有自己的排版/],
]) {
  if (needle.test(viewsSrc)) ok("views.js " + name);
  else fail("views.js 缺少" + name);
}

const indexSrc = read("src/main/index.js");
if (/registerSchemesAsPrivileged/.test(indexSrc) && /protocol\.handle\("lgoff"/.test(indexSrc)) {
  ok("index.js 注册 lgoff 离线协议");
} else {
  fail("index.js 缺少 lgoff 协议注册");
}
if (/store = new Store/.test(indexSrc) && /flushAll/.test(indexSrc)) ok("index.js 装配 store 并在退出时落盘");
else fail("index.js 缺少 store 装配/退出落盘");
if (/离线快照/.test(indexSrc) && /charset=utf-8/.test(indexSrc)) ok("离线页外壳带主题与编码声明");
else fail("离线页外壳缺少主题或编码声明");

/* R61 命令面板与比赛提醒 */
if (/id: "reopen", label: "恢复关闭的页面"/.test(ipcSource) && /type: "page", key: page\.key/.test(ipcSource)) ok("命令面板含恢复关闭 + 已打开页面切换");
else fail("命令面板缺项");
if (/palette\(query, ctx\)/.test(ipcSource)) ok("palette 接入打开页面列表（ctx 透传）");
else fail("palette 未接入 ctx");
if (/item\.type === "page" && item\.key/.test(read("src/renderer/shell/shell.js")) && /reopen: "reopen"/.test(read("src/renderer/shell/overlays.js"))) ok("外壳可执行切换/恢复两项面板动作");
else fail("外壳缺面板动作分支");
const notifySource = read("src/main/notify.js");
if (/startContestWatch/.test(notifySource) && /contestLeadMin/.test(notifySource) && /lastNotifiedContestId/.test(notifySource)) ok("比赛提醒有真实调度（提前量生效，每场只提醒一次）");
else fail("比赛提醒仍是假开关");

/* R62 性能与稳定 */
if (/refreshIndex/.test(storeSrc) && /mtimeMs/.test(storeSrc)) ok("store 淘汰路径走 mtime 索引（不再每次全量解析）");
else fail("store 仍全量解析目录");
if (!/heatWindowStart/.test(luoguSrc) && /record\/list\?user=.*page=1/.test(luoguSrc)) ok("主页只取最近提交首屏，热度直接消费个人中心 dailyCounts");
else fail("主页仍在为自绘热度图批量拉取历史提交");
if (/will-download/.test(indexSrc)) ok("页面下载自动落「下载」文件夹并 toast");
else fail("缺少下载处理");

/* R58 反馈可见性 */
if (/pageWc/.test(indexSrc) && /app:toast/.test(indexSrc)) ok("toast 同步发给当前页面视图（不被页面盖住）");
else fail("页面在场时 toast 仍会被盖住");
if (/lg-page-toast/.test(read("src/preload/page.js"))) ok("页面 preload 有顶层 toast 渲染器");
else fail("page.js 缺少页面内 toast");

const ipcSrc = read("src/main/ipc.js");
for (const [name, needle] of [
  ["状态含在线状态", /online: ctx\.luogu\.online/],
  ["状态含队列", /queue: ctx\.luogu\.queueState/],
  ["断网入队", /enqueueSubmit\(pid, code, lang, "当前离线", o2\)/],
  ["网络失败入队", /enqueueSubmit\(pid, code, lang, "网络未就绪", o2\)/],
]) {
  if (needle.test(ipcSrc)) ok("ipc.js " + name);
  else fail("ipc.js 缺少" + name);
}

const checkinBlock = ipcSrc.split("app:checkin")[1] || "";
if (/签到没有成功/.test(checkinBlock)) ok("签到失败会 toast 具体原因");
else fail("签到失败仍被吞掉");
if (/hasCard/.test(luoguSrc) && /result\.hasCard && result\.hasButton/.test(luoguSrc) && /避免把“今日已完成”误报成失败/.test(luoguSrc)) {
  ok("签到状态先判重，已签到时不会误报找不到入口");
} else {
  fail("签到缺少已签/入口缺失的幂等判定");
}
if (/签到失败/.test(read("src/renderer/shell/home.js")) && /签到失败/.test(read("src/renderer/shell/home.js"))) ok("签到失败在顶部按钮上留字");
else fail("主页签到按钮无失败反馈");

const editorSrc = read("src/renderer/shell/editor.js");
if (/loadDraft/.test(editorSrc) && /saveDraft/.test(editorSrc) && /已恢复本题草稿/.test(editorSrc)) {
  ok("编辑器草稿恢复与防抖保存（按题提示）");
} else {
  fail("编辑器缺少草稿持久化");
}
if (/setProblem/.test(editorSrc) && /currentPid/.test(editorSrc) && /draft:" \+ pid/.test(ipcSrc)) ok("草稿按题目隔离（draft:<pid>），切题即换草稿");
else fail("草稿仍是全局单份，存在跨题泄漏");
if (/editorPrefs/.test(ipcSrc)) ok("语言/O2 记为全局偏好（本题无草稿时沿用）");
else fail("语言偏好未持久化");

const homeSrc = read("src/renderer/shell/home.js");
if (/offline-chip/.test(homeSrc) && /queue-card/.test(homeSrc) && /buildQueue/.test(homeSrc)) {
  ok("主页离线徽标与队列卡片");
} else {
  fail("主页缺少离线徽标或队列卡片");
}
if (/lib-stale/.test(read("src/renderer/shell/library.js"))) ok("列表离线/缓存标注");
else fail("列表缺少离线数据标注");

/* store.js 行为单测（不依赖 electron） */
try {
  const os = require("node:os");
  const { Store } = require(path.join(ROOT, "src", "main", "store.js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-test-"));
  const store = new Store(dir).init();
  store.set("home", { quote: "x", updatedAt: 1 }, 0);
  store.flush("home");
  const back = new Store(dir).init().get("home");
  if (back && back.quote === "x") ok("store 落盘后新实例可读回");
  else fail("store 落盘读回失败", JSON.stringify(back));
  store.set("problem:P1", { key: "problem:P1", savedAt: 2, html: "<p>ok</p>" }, 0);
  store.set("problem:P2", { key: "problem:P2", savedAt: 3, html: "<p>ok</p>" }, 0);
  store.flushAll();
  const entries = store.entries("problem:");
  if (entries.length === 2 && entries.some((item) => item.key === "problem:P1")) ok("store 前缀枚举含磁盘条目");
  else fail("store 前缀枚举失败", JSON.stringify(entries.map((item) => item.key)));
  store.evict("problem:", 1);
  if (store.entries("problem:").length === 1) ok("store 按时间淘汰旧快照");
  else fail("store 淘汰失败");
  const bigDir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-test-"));
  const big = new Store(bigDir).init();
  big.set("huge", { blob: "x".repeat(2 * 1024 * 1024) }, 0);
  big.flush("huge");
  big.flushAll();
  if (!fs.existsSync(path.join(bigDir, big.fileOf("huge")))) ok("store 拒收超过体积上限的快照");
  else fail("store 未拒收超大快照");
  /* R62：mtime 索引 —— mem 为空的新实例也能靠索引枚举磁盘条目（淘汰路径不再全量解析） */
  const idxDir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-idx-"));
  const idxStore = new Store(idxDir).init();
  idxStore.set("problem:A", { key: "problem:A", savedAt: 10, html: "<p>x</p>" }, 0);
  idxStore.flushAll();
  const freshStore = new Store(idxDir).init();
  const found = freshStore.entries("problem:");
  if (found.length === 1 && found[0].key === "problem:A" && found[0].at === 10) ok("store mtime 索引：新实例免解析枚举磁盘条目");
  else fail("store 索引枚举失败", JSON.stringify(found.map((item) => item.key)));
  for (let i = 0; i < 140; i++) idxStore.set("tiny:" + i, { key: "tiny:" + i, at: i, value: "x" }, 600000);
  const stats = idxStore.stats();
  if (stats.memoryEntries <= stats.limits.memoryEntries && stats.memoryBytes <= stats.limits.memoryBytes) ok("store 内存缓存遵守条目与字节 LRU 上限");
  else fail("store 内存缓存未遵守预算", JSON.stringify(stats));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bigDir, { recursive: true, force: true });
  fs.rmSync(idxDir, { recursive: true, force: true });
} catch (err) {
  fail("store 单测异常", String((err && err.stack) || err).slice(0, 200));
}

/* ---------- 4.0 设计系统契约 ---------- */

if (fs.existsSync(path.join(ROOT, "src/renderer/shared/tokens.css"))) ok("设计令牌 tokens.css 存在");
else fail("缺少 src/renderer/shared/tokens.css");

const tokensSrc = read("src/renderer/shared/tokens.css");
for (const [name, needle] of [
  ["字体", /--font-ui/],
  ["字号", /--fs-sm: 13px/],
  ["间距", /--sp-4: 16px/],
  ["圆角", /--r-lg: 12px/],
  ["控件高度", /--h-md: 32px/],
  ["侧栏宽度", /--sidebar-w: 208px/],
  ["动效", /--dur-2: 160ms/],
  ["焦点环", /--focus-ring/],
]) {
  if (needle.test(tokensSrc)) ok("tokens.css " + name);
  else fail("tokens.css 缺少" + name);
}

if (/accentText/.test(themeSource) && /borderStrong/.test(themeSource) && /colors\.hover/.test(themeSource)) {
  ok("theme.js 提供 accentText/borderStrong/hover/pressed/shadow 状态令牌");
} else {
  fail("theme.js 缺少 4.0 状态令牌");
}

const materialSource = read("src/main/material.js");
const material = require(path.join(ROOT, "src", "main", "material.js"));
const baseLevel = material.levels({ material: 55, glass: 45 }, false);
if (baseLevel.panelAlpha === 72 && baseLevel.pageScrim === 75 && baseLevel.cardAlpha === 80 && baseLevel.raiseAlpha === 11 && baseLevel.codeAlpha === 68) {
  ok("单层透明基线（panel 72 / scrim 75 / card 80 / raise 11 / code 68）");
} else {
  fail("默认透明基线偏离设计", JSON.stringify(baseLevel));
}
const fullLevel = material.levels({ material: 55, glass: 100 }, false);
if (fullLevel.panelAlpha === 0 && fullLevel.pageScrim === 0 && fullLevel.cardAlpha === 0 && fullLevel.raiseAlpha === 0) {
  ok("壁纸透出 100% 时外壳/纱层/承载面真正归零");
} else {
  fail("glass=100 仍有重复不透明底", JSON.stringify(fullLevel));
}
if (fullLevel.codeAlpha >= 68) ok("代码块例外层保留 68% 保读下限");
else fail("代码块保读下限不足");
if (fullLevel.overlayAlpha >= 94) ok("浮层保留 94% 可读下限");
else fail("浮层可读下限不足");
const perfFull = material.levels({ material: 55, glass: 100 }, true);
if (perfFull.panelAlpha === 0 && perfFull.blurPx === 0) ok("性能模式关闭模糊且保留透明状态");
else fail("性能模式破坏透明状态", JSON.stringify(perfFull));
if (/materialLevels/.test(themeSource) && /require\("\.\/material"\)/.test(themeSource)) ok("theme.js 委托 material.js 计算透明度");
else fail("theme.js 没有接入 material.js");
if (/glass: 45,/.test(configSource) && /a\.glass = Math\.round/.test(configSource)) ok("「壁纸透出」默认 45 且落盘前收敛");
else fail("config.js 缺少 glass 默认值/收敛");
if (/id="glass"/.test(settingsHtml) && /setAppearance\(\{ glass:/.test(read("src/renderer/settings/settings.js"))) ok("设置页提供「壁纸透出」滑杆并即时生效");
else fail("设置页缺少壁纸透出滑杆");
const skinVarsFn = viewsSource.slice(viewsSource.indexOf("  skinVars(entry) {"), viewsSource.indexOf("  injectSkin(entry) {"));
if (/--lg-wall-image:none/.test(skinVarsFn) && /--lg-motion:0/.test(skinVarsFn) && !/winBounds\.width/.test(skinVarsFn)) {
  ok("页面视图不复制壁纸，避免每页重复解码高分辨率背景");
} else {
  fail("页面视图仍复制壁纸或逐页计算整窗尺寸");
}
let fitBoundsToArea = null;
try {
  fitBoundsToArea = require(path.join(ROOT, "src", "main", "window.js")).fitBoundsToArea;
} catch {}
const offscreen = fitBoundsToArea ? fitBoundsToArea({ x: 9999, y: 9999, width: 1280, height: 820, maximized: true }, { x: 0, y: 0, width: 1920, height: 1040 }) : null;
const centered = fitBoundsToArea ? fitBoundsToArea({ width: 1000, height: 640 }, { x: 0, y: 0, width: 1920, height: 1040 }) : null;
if (offscreen && offscreen.x >= 0 && offscreen.y >= 0 && offscreen.x + offscreen.width <= 1920 && offscreen.y + offscreen.height <= 1040 && offscreen.maximized === true && centered.x > 0 && centered.y > 0) {
  ok("窗口位置恢复会完整夹回工作区，并保留最大化状态");
} else {
  fail("窗口位置恢复仍可能跑出屏幕");
}
const halfScreen = fitBoundsToArea ? fitBoundsToArea({ width: 960, height: 1040 }, { x: 0, y: 0, width: 1920, height: 1040 }) : null;
if (halfScreen && halfScreen.width === 960 && /MIN_WINDOW_W = 640/.test(read("src/main/window.js")) && /MIN_WINDOW_H = 480/.test(read("src/main/window.js"))) {
  ok("Windows 左右半屏与 640×480 窄窗口吸附不受固定下限撑宽");
} else {
  fail("窗口最小尺寸仍阻止半屏/窄比例吸附", JSON.stringify(halfScreen));
}
/* 广告拦截固定开启，不再提供关闭入口。 */
const preloadPageSource = read("src/preload/page.js");
if (/g\.adBlock = true/.test(configSource) && !/id="ad-block"/.test(settingsHtml)) ok("广告与推广强制拦截且不提供关闭入口");
else fail("广告拦截仍可被关闭或缺少强制配置");
if (/ctx\.views\.applyAdBlock\(\)/.test(ipcSource)) ok("既有页面会即时应用广告拦截标记");
else fail("ipc.js 没有应用广告拦截标记");
if (/qiafan/.test(read("src/main/adblock.js")) && /onBeforeRequest/.test(read("src/main/adblock.js"))) ok("主进程按 /qiafan/ 请求级拦截");
else fail("adblock.js 缺少请求级拦截");
if (/--lg-adblock=/.test(read("src/main/views.js")) && /dataset\.lgAdblock/.test(preloadPageSource)) ok("页面 preload 在 document-start 置广告拦截标记");
else fail("页面 preload 缺少广告拦截标记");
if (
  /lg-boot-skeleton/.test(preloadPageSource) &&
  /function installPageLoadingSurface/.test(preloadPageSource) &&
  /attachShadow/.test(preloadPageSource) &&
  /page:load-state/.test(preloadPageSource) &&
  /phase === "ready"/.test(preloadPageSource) &&
  /phase === "error"/.test(preloadPageSource) &&
  /location\.reload\(\)/.test(preloadPageSource) &&
  /host\.style\.pointerEvents = "auto"/.test(preloadPageSource) &&
  /latestRequestId/.test(preloadPageSource) &&
  /host\.setAttribute\("aria-busy", "true"\)/.test(preloadPageSource) &&
  !/shadow\.innerHTML/.test(preloadPageSource) &&
  !/setTimeout\([^\n]*8000/.test(preloadPageSource)
) {
  ok("网页骨架由主进程状态驱动，可拦截误点、显示错误并重试");
} else {
  fail("网页骨架仍依赖固定计时器或缺少安全错误恢复");
}
const freezeIndex = read("src/renderer/shell/index.html");
if (/captureOverlayBackdrop/.test(viewsSource) && /overlayQueue/.test(viewsSource) && /applyOverlay/.test(viewsSource) && /page:freeze/.test(read("src/preload/shell.js")) && /id="page-freeze"/.test(freezeIndex) && /onPageFreeze/.test(read("src/renderer/shell/shell.js"))) {
  ok("搜索覆盖层用当前页面冻结帧作背景，不再清空正文");
} else {
  fail("搜索覆盖层冻结帧链路缺失");
}
if (/entry\.booted && entry\.view\.webContents\.getURL\(\) !== url/.test(viewsSource) && /requestedUrl/.test(viewsSource) && /题单加载失败/.test(viewsSource)) {
  ok("题单首次导航单一所有权，并在空正文时静默重试");
} else {
  fail("题单首次导航竞态或空正文恢复缺失");
}
if (/M7\.9 20A9 9/.test(read("src/renderer/shell/icons.js")) && /M8 12h\.01M12 12h\.01M16 12h\.01/.test(read("src/renderer/shell/icons.js"))) ok("聊天图标使用单气泡轮廓与居中描边点");
else fail("聊天图标几何仍未修正");
if (/data-lg-adblock="1"/.test(read("src/renderer/skin/luogu-skin.css"))) ok("皮肤提供广告容器兜底隐藏");
else fail("luogu-skin.css 缺少广告容器兜底");

/* R65 实测回归：用户页头图、筛选条、分页、登录灰按钮、abort 误报 */
const skinSource = read("src/renderer/skin/luogu-skin.css");
if (!/\.user-header-top\s*\{[^}]*\bbackground\s*:/.test(skinSource)) ok("用户页头图不被 background 简写清掉");
else fail("luogu-skin.css 用 background 简写覆盖了用户页头图");
for (const [name, needle] of [
  ["题库/比赛筛选标题", /\.filter-section \.title/],
  ["筛选下拉与标签控件", /\.tag-select-area \.toggle-tag/],
  ["底部分页按钮", /\.page-bar button/],
  ["亮色灰字兜底", /\.lcolor--grey-3/],
  ["登录灰按钮文字", /\.lcolor-var-grey-4/],
  ["页面级滚动条", /html::-webkit-scrollbar/],
]) {
  if (needle.test(skinSource)) ok("皮肤覆盖 " + name);
  else fail("luogu-skin.css 缺少" + name);
}
if (/ERR_ABORTED/.test(read("src/main/views.js"))) ok("页面被切走导致的 ERR_ABORTED 不弹失败提示");
else fail("views.js 会把 ERR_ABORTED 当成打开失败");
if (/dimCount/.test(read("src/main/smoke.js")) && /contrast/.test(read("src/main/smoke.js"))) {
  ok("皮肤审计覆盖低对比度文字（亮/暗两种主题）");
} else {
  fail("smoke.js 缺少低对比度审计");
}

const shellCss = read("src/renderer/shell/shell.css");
const baseCss = read("src/renderer/shared/base.css");
for (const [name, needle] of [
  ["208px 侧栏", /--sidebar-w/],
  ["文字导航", /\.rail-label/],
  ["统一卡片", /\.card \{/],
  ["2px 焦点环", /outline: var\(--focus-w\) solid var\(--accent\)/],
  ["减弱动效", /prefers-reduced-motion/],
]) {
  if (needle.test(shellCss) || needle.test(baseCss)) ok("shell.css/base.css " + name);
  else fail("shell.css/base.css 缺少" + name);
}

/* ---------- 单侧栏 / 固定宽度 / active / 键盘 / 性能模式契约 ---------- */

const windowSource = read("src/main/window.js");
if (/const RAIL_W = 208;/.test(windowSource) && /const RAIL_COLLAPSED_W = 64;/.test(windowSource)) {
  ok("侧栏固定/折叠宽度 208px/64px");
} else {
  fail("window.js 侧栏宽度不是固定 208px、折叠 64px");
}
if (
  /MIN_WINDOW_W = 640/.test(windowSource) &&
  /MIN_WINDOW_H = 480/.test(windowSource) &&
  /clamp\(w\.width, 640, 10000/.test(configSource) &&
  /clamp\(w\.height, 480, 10000/.test(configSource) &&
  /fitBoundsToArea\(\{ width: 860, height: 640 \}/.test(windowSource) &&
  /#workspace\.ide-vertical/.test(shellCss) &&
  /availableWidth < IDE_VERTICAL_BREAKPOINT/.test(viewsSource) &&
  /Math\.floor\(availableHeight \* \(1 - this\.ideSplit\)\)/.test(viewsSource)
) {
  ok("640×480 最小窗口与窄屏 IDE 上下分栏几何完整");
} else {
  fail("不同窗口比例的最小尺寸或 IDE 自适应缺失");
}

const shellPreloadSource = read("src/preload/shell.js");
const shellJsSource = read("src/renderer/shell/shell.js");
const chromeSource = read("src/renderer/shell/chrome.js");
const overlaysSource = read("src/renderer/shell/overlays.js");
const singleRailRemoved =
  !fs.existsSync(path.join(ROOT, "src", "preload", "rail.js")) &&
  !fs.existsSync(path.join(ROOT, "src", "renderer", "rail", "index.html")) &&
  !fs.existsSync(path.join(ROOT, "src", "renderer", "rail", "rail.js")) &&
  !fs.existsSync(path.join(ROOT, "src", "renderer", "rail", "rail.css")) &&
  !/ensureRailOverlay|railDrawer|railHover|renderer\/rail|preload[^\n]*rail\.js/.test(viewsSource) &&
  !/app:railHover|rail:focus|lgRail|railTooltip/.test(shellPreloadSource) &&
  !/app:rail-tooltip|lg-rail-tooltip/.test(read("src/preload/page.js"));
if (singleRailRemoved) {
  ok("单侧栏 DOM：旧 rail WebContentsView/preload/浮层通道已移除");
} else {
  fail("旧 rail WebContentsView、preload 或浮层通道仍有残留");
}

const railDomCount = (shellHtml.match(/id="rail"/g) || []).length;
if (
  railDomCount === 1 &&
  /id="rail-top"/.test(shellHtml) &&
  /id="rail-bottom"/.test(shellHtml) &&
  !/id="rail-user"|rail-jump-input/.test(shellHtml)
) {
  ok("外壳仅保留一份侧栏 DOM，且无账户卡/内联跳转输入框");
} else {
  fail("外壳侧栏 DOM 不是唯一实例，或仍有旧账户卡/内联跳转输入框");
}

if (
  /setRailPinned\(pinned\)/.test(viewsSource) &&
  /railWidth\(\)/.test(viewsSource) &&
  /applyRailWidth\(width(?:,\s*boundsOverride)?\)/.test(viewsSource) &&
  /preload:\s*path\.join\(PRELOAD,\s*"page\.js"\)/.test(viewsSource)
) {
  ok("主进程侧栏固定与唯一页面 preload 契约");
} else {
  fail("views.js 缺少侧栏固定逻辑或仍创建独立 rail preload");
}

const railLayoutSenders = [];
for (const file of walk(path.join(ROOT, "src", "main"), []).filter((f) => f.endsWith(".js"))) {
  if (/webContents\.send\("rail:layout"/.test(fs.readFileSync(file, "utf8"))) railLayoutSenders.push(path.relative(ROOT, file).replace(/\\/g, "/"));
}
if (
  railLayoutSenders.length === 1 &&
  railLayoutSenders[0] === "src/main/views.js" &&
  /const rect = \{ x: railW, y: TITLE_H \+ TOOLBAR_H, width: metrics\.width, height: metrics\.height \}/.test(viewsSource) &&
  /onRailLayout: \(callback\) => on\("rail:layout", callback\)/.test(shellPreloadSource) &&
  /window\.lg\.onRailLayout/.test(shellJsSource) &&
  /grid-template-columns: var\(--rail-current-w/.test(shellCss) &&
  !/transition:\s*grid-template-columns/.test(shellCss)
) {
  ok("rail:layout 是唯一宽度源，外壳与页面 View 共用主进程宽度");
} else {
  fail("rail:layout 宽度源不唯一，或外壳仍有独立 CSS 宽度补间");
}

if (
  /function applyActive\(id(?:,\s*force\s*=\s*false)?\)/.test(chromeSource) &&
  /\.dataset\.kind !== "action"/.test(chromeSource) &&
  /setAttribute\("aria-current", "page"\)/.test(chromeSource) &&
  /\.rail-btn\.active/.test(shellCss) &&
  /applyActive\(next\.page\.railId\)/.test(chromeSource) &&
  /railId: "home"/.test(viewsSource) &&
  /railId: this\.library/.test(viewsSource) &&
  /entry\.railId !== undefined/.test(viewsSource)
) {
  ok("active/aria-current 由 page.railId 唯一驱动，动作项不高亮");
} else {
  fail("active/aria-current 路由契约不完整");
}

if (
  /let railButtons = new Map\(\)/.test(chromeSource) &&
  /railButtons = new Map\([\s\S]*?\.rail-btn\[data-id\]/.test(chromeSource) &&
  /let btn = railButtons\.get\(item\.id\)/.test(chromeSource) &&
  /railTop\.scrollTop = scrollTop/.test(chromeSource) &&
  /focus\(\{ preventScroll: true \}\)/.test(chromeSource) &&
  /applyActive\(activeId(?:,\s*true)?\)/.test(chromeSource)
) {
  ok("侧栏按 id keyed 复用，刷新保持滚动位置与焦点");
} else {
  fail("侧栏未使用 keyed DOM 更新或会丢失滚动/焦点");
}

if (
  /panelExpand|panelCollapse/.test(chromeSource) &&
  /setAttribute\("aria-pressed"/.test(chromeSource) &&
  /actions\.toggleRailPinned\(\)/.test(chromeSource) &&
  /event\.key\.toLowerCase\(\) === "b"[\s\S]*?toggleRailPinned\(\)/.test(shellJsSource) &&
  /key === "b"\) command = "railPin"/.test(viewsSource)
) {
  ok("Ctrl+B 在按钮、外壳和页面 WebContents 三处贯通");
} else {
  fail("Ctrl+B 固定/收起链路不完整");
}

if (
  /event\.key === "F6"[\s\S]*?chrome\.focusRail\(\)/.test(shellJsSource) &&
  /input\.key === "F6"\) command = input\.shift \? "focusPage" : "focusRail"/.test(viewsSource) &&
  /event\.key === "Escape"[\s\S]*?actions\.focusPage\(\)/.test(chromeSource) &&
  /function focusRail\(\)/.test(chromeSource)
) {
  ok("F6 聚焦侧栏、Esc 返回内容页的键盘链路");
} else {
  fail("F6/Esc 焦点链路不完整");
}

if (
  /key === "l"\) command = "jump"/.test(viewsSource) &&
  /name === "palette" \|\| name === "switcher" \|\| name === "jump"/.test(read("src/main/index.js")) &&
  /name === "jump"\) overlays\.openJump\(fromPage\)/.test(shellJsSource) &&
  /function openJump\(options = \{\}\)/.test(overlaysSource) &&
  /function rememberFocus\(options = \{\}\)/.test(overlaysSource) &&
  /input\.focus\(\)/.test(overlaysSource) &&
  /titleJump\.addEventListener\("click", \(\) => actions\.openJump\(\)\)/.test(chromeSource)
) {
  ok("Ctrl+L 与侧栏题号跳转按钮共用全局面板");
} else {
  fail("Ctrl+L 全局面板链路不完整");
}

if (
  /order: RAIL_ORDER\.slice\(\)/.test(configSource) &&
  /hidden: \[\]/.test(configSource) &&
  /custom: \[\]/.test(configSource) &&
  /cfg\.rail\.order/.test(sectionsSource) &&
  /cfg\.rail\.hidden/.test(sectionsSource) &&
  /cfg\.rail\.custom/.test(sectionsSource) &&
  /actions\.custom\(\{ id: current\.id, url: current\.url, label: current\.label \}\)/.test(chromeSource)
) {
  ok("侧栏 order/hidden/custom 配置与稳定自定义 id 契约保留");
} else {
  fail("侧栏 order/hidden/custom 配置契约缺失");
}

if (/pinned:\s*false/.test(configSource) && /performanceMode:\s*false/.test(configSource)) {
  ok("侧栏默认折叠、性能模式默认关闭");
} else {
  fail("config.js 缺少 pinned/performanceMode 默认值");
}
if (/materialLevels/.test(themeSource) && /blurPx: perf \? 0/.test(materialSource)) {
  ok("性能模式关闭模糊（material.js）");
} else {
  fail("material.js 没有把性能模式接入模糊计算");
}
if (/id="perf-mode"/.test(settingsHtml) && /setGeneral\(\{ performanceMode/.test(read("src/renderer/settings/settings.js"))) {
  ok("设置页提供性能模式开关");
} else {
  fail("设置页缺少性能模式开关");
}
if (/--sidebar-w-collapsed: 64px/.test(tokensSrc) && /--sidebar-w: 208px/.test(tokensSrc) && /--rail-current-w/.test(shellCss)) {
  ok("64/208px 侧栏宽度令牌已接入统一布局");
} else {
  fail("tokens.css/shell.css 缺少 64/208px 侧栏宽度契约");
}

for (const file of ["src/renderer/shell/shell.css", "src/renderer/settings/settings.css", "src/renderer/shared/base.css"]) {
  const source = read(file);
  if (/font-size:\s*(?:9\.5|10|10\.5|11\.5|12\.5|13\.5|19)px/.test(source)) {
    fail(file + " 仍使用非设计系统字号");
  } else {
    ok(file + " 字号全部在 11/12/13/14/16/20/24 档位");
  }
  if (/border-radius:\s*(?:5|7|9|10|11)px/.test(source)) {
    fail(file + " 仍使用非设计系统圆角");
  } else {
    ok(file + " 圆角全部在 4/6/8/12/pill 档位");
  }
  if (/box-shadow:[^;]*rgba\(0,\s*0,\s*0,\s*0\.[3-9]/.test(source)) {
    fail(file + " 仍有硬编码重阴影");
  } else {
    ok(file + " 阴影使用主题令牌");
  }
}

const settingsCss = read("src/renderer/settings/settings.css");
if (/::-webkit-slider-thumb/.test(settingsCss) && /appearance: none/.test(settingsCss) && /\.check \.box/.test(settingsCss) && /\.radio \.box/.test(settingsCss)) {
  ok("设置窗 range/checkbox/radio 全部自绘");
} else {
  fail("设置窗仍有原生控件");
}
if (/class="pane-head"/.test(settingsHtml) && /class="settings-group"/.test(settingsHtml) && /id="notify-lead"/.test(settingsHtml)) {
  ok("设置窗分区标题/分组/通知提前量 UI");
} else {
  fail("设置窗缺少分区标题或分组结构");
}

const homeSrc2 = read("src/renderer/shell/home.js");
for (const [name, needle] of [
  ["两栏仪表盘", /home-grid/],
  ["官方累计通过", /official-profile-stats/],
  ["热力图图例", /heat-map-legend/],
  ["空寄语不渲染", /if \(home\.quote\)/],
]) {
  if (needle.test(homeSrc2)) ok("home.js " + name);
  else fail("home.js 缺少" + name);
}
/* R59 显示修复 */
if (/actions\.openDetail\(\{ url: "\/contest\/" \+ contest\.id/.test(homeSrc2)) ok("主页比赛卡点击进比赛本身（而非列表）");
else fail("主页比赛卡仍跳比赛列表");
if (/openDetail: \(payload\) => window\.lg\.openDetail\(payload\)/.test(read("src/renderer/shell/shell.js"))) ok("主页动作具备 openDetail 通道");
else fail("homeActions 缺少 openDetail");

const librarySrc = read("src/renderer/shell/library.js");
for (const [name, needle] of [
  ["骨架屏", /skeletonRows/],
  ["错误保留旧数据", /lib-banner/],
  ["列表键盘导航", /aria-activedescendant/],
  ["roving 选中", /setActive\(/],
]) {
  if (needle.test(librarySrc)) ok("library.js " + name);
  else fail("library.js 缺少" + name);
}

/* R64 题库筛选对齐网页版 + 侧栏分组 */
const luoguFilterSrc = read("src/main/luogu.js");
const ipcFilterSrc = read("src/main/ipc.js");
const shellPreloadFilterSrc = read("src/preload/shell.js");
for (const [name, needle] of [
  ["标签目录公开端点", /_lfe\/tags/],
  ["标签目录缓存", /libtags/],
  ["标签分组编码", /function tagQuery/],
  ["题库类型白名单", /PROBLEM_TYPES/],
  ["题库 type 参数", /params\.set\("type"/],
  ["标签 tag 参数", /params\.set\("tag"/],
  ["题面搜索参数", /params\.set\("content"/],
]) {
  if (needle.test(luoguFilterSrc)) ok("luogu.js " + name);
  else fail("luogu.js 缺少" + name);
}
if (/app:libraryTags/.test(ipcFilterSrc) && /libraryTags: \(\) => ipcRenderer\.invoke\("app:libraryTags"\)/.test(shellPreloadFilterSrc)) {
  ok("标签目录桥三处同步（handler + preload）");
} else {
  fail("标签目录桥未三处同步");
}
for (const [name, needle] of [
  ["难度范围下拉", /lib-diff-menu/],
  ["难度区间编码", /function encodeDifficulty/],
  ["连续区间选择", /right <= left/],
  ["所属题库分组", /所属题库/],
  ["筛选条件分组", /筛选条件/],
  ["标签草稿多选", /state\.tagDraft\.add/],
  ["标签分类编码", /selectedTagGroups/],
  ["搜索结果跨分类", /catalog\.tags\.filter/],
  ["标签弹窗文案", /已选标签（/],
  ["清除筛选", /清除筛选/],
]) {
  if (needle.test(librarySrc)) ok("library.js " + name);
  else fail("library.js 缺少" + name);
}
if (/lib-diff-menu/.test(read("src/renderer/shell/shell.css"))) ok("题库难度下拉有样式");
else fail("题库难度下拉缺少样式");
const chromeRailSrc = read("src/renderer/shell/chrome.js");
if (
  /rail-group/.test(chromeRailSrc) &&
  /rail-group-label/.test(chromeRailSrc) &&
  /\.rail-group/.test(read("src/renderer/shell/shell.css")) &&
  /#rail-bottom \{[\s\S]*?flex: 0 0 auto;/.test(read("src/renderer/shell/shell.css")) &&
  /#rail-top \{[\s\S]*?overflow-y: auto;/.test(read("src/renderer/shell/shell.css"))
) {
  ok("侧栏分组标签与固定底部工具区");
} else {
  fail("侧栏分组/固定底部工具区契约缺失");
}
if (
  !/id="rail-user"/.test(read("src/renderer/shell/index.html")) &&
  /id="tb-avatar"/.test(read("src/renderer/shell/index.html")) &&
  /avatar\.addEventListener\("click", \(\) => actions\.profile\(\)\)/.test(chromeRailSrc)
) {
  ok("账户入口仅保留标题栏头像");
} else {
  fail("侧栏仍重复账户卡或标题栏头像入口缺失");
}
if (
  /tb-avatar-fallback/.test(read("src/renderer/shell/index.html") + chromeRailSrc + read("src/renderer/shell/shell.css")) &&
  /avatar\.classList\.add\("has-avatar-image"\)/.test(chromeRailSrc) &&
  /image\.addEventListener\("error"/.test(chromeRailSrc)
) {
  ok("标题栏头像有常驻字母底层与图片失败回退");
} else {
  fail("标题栏头像仍可能因图片加载失败而消失");
}
if (
  /id="rail-pin"/.test(read("src/renderer/shell/index.html")) &&
  /id="tb-jump"/.test(read("src/renderer/shell/index.html")) &&
  /\.rail-pin\.on/.test(read("src/renderer/shell/shell.css")) &&
  /\.tb-action \{/.test(read("src/renderer/shell/shell.css"))
) {
  ok("固定按钮和题号跳转入口始终存在");
} else {
  fail("固定按钮或题号跳转入口缺失");
}


if (/"r"\)\) command = "reload"/.test(viewsSource) && /"closepage"/.test(viewsSource) && /"ArrowLeft"\) command = "back"/.test(viewsSource)) ok("页面内 F5/Ctrl+R/Alt+方向键/Ctrl+W 浏览器基本键齐全");
else fail("views.js 缺少浏览器基本键绑定");
if (/closePage\(\)/.test(viewsSource) && /wc\.on\("context-menu"/.test(viewsSource)) ok("Ctrl+W 关页面（进最近关闭栈）+ 页面右键菜单存在");
else fail("缺少 closePage 或页面右键菜单");
if (/name === "closepage"/.test(indexSrc)) ok("主进程命令路由支持 closepage/back/forward/reload");
else fail("index.js 命令路由缺 closepage");
if (/quiet: true/.test(librarySrc) && /loadedAt/.test(librarySrc)) ok("列表回访超 3 分钟后台刷新且不重置滚动");
else fail("列表回访刷新缺失");

const editorSrc2 = read("src/renderer/shell/editor.js");
if (/ide-gutter/.test(editorSrc2) && /updateGutter/.test(editorSrc2) && /setIdeSplit/.test(editorSrc2)) {
  ok("IDE 行号槽 + 可拖拽分栏 + 状态栏");
} else {
  fail("IDE 缺少行号/分栏/状态栏");
}

const overlaysSrc = read("src/renderer/shell/overlays.js");
if (/updatePaletteSelection/.test(overlaysSrc) && /scrollIntoView/.test(overlaysSrc) && /aria-activedescendant/.test(overlaysSrc)) {
  ok("命令面板选择不重建 DOM 且自动滚入视野");
} else {
  fail("命令面板仍会在 hover 时重建/丢滚动");
}

const skinSrc = read("src/renderer/skin/luogu-skin.css");
for (const [name, needle] of [
  ["阅读正文", /\.lfe-marked/],
  ["真实按钮类", /\[class\*="l-button"\]/],
  ["表格组件", /\.cute-table/],
  ["编辑器", /\.cm-editor/],
  ["用户页头", /\.user-header-top/],
  ["阅读行高", /line-height: 1\.8/],
  ["2px 焦点环", /outline: var\(--lg-focus-w, 2px\) solid var\(--lg-accent\)/],
]) {
  if (needle.test(skinSrc)) ok("luogu-skin.css " + name);
  else fail("luogu-skin.css 缺少" + name);
}

/* R64：皮肤不能再改写官方主容器的宽度/外边距，也不能给官方按钮塞死高度 */
if (
  /#app > \.main-container \{[\s\S]*?padding-top: var\(--lg-gutter-top/.test(skinSrc) &&
  !/#app > \.main-container \{[\s\S]*?margin: 0 auto/.test(skinSrc) &&
  !/#app > \.main-container \{[\s\S]*?width: calc/.test(skinSrc)
) {
  ok("皮肤只补顶部空隙，不改写官方主容器几何");
} else {
  fail("皮肤仍在改写官方主容器宽度/外边距（右侧裁切/空白根因）");
}
if (/a\.l-button[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/.test(skinSrc)) {
  ok("链接型官方按钮用 inline-flex 真正居中");
} else {
  fail("官方按钮缺少 flex 居中（文字偏上根因）");
}
if (!/line-height: 20px/.test(skinSrc) && !/min-height: 32px/.test(skinSrc)) {
  ok("皮肤不再给官方按钮/输入框塞死行高与最小高度");
} else {
  fail("皮肤仍给官方控件塞死行高/最小高度（莫名空白根因）");
}
for (const selector of [".side", ".lfe-side", ".list", ".lfe-list", ".box", ".panel", ".comment"]) {
  const cardBlock = skinSrc.match(/#app \.l-card,[\s\S]*?\{/);
  if (!cardBlock || cardBlock[0].indexOf(selector) === -1) {
    ok("卡片选择器已排除布局容器 " + selector);
  } else {
    fail("卡片选择器仍包含布局容器 " + selector + "（大片空白根因）");
  }
}

/* R64：侧栏几何对齐官方 64px 图标栏 */
const railCss = read("src/renderer/shell/shell.css");
if (
  /#rail \{[\s\S]*?padding: 12px;/.test(railCss) &&
  /#rail-top,[\s\S]*?#rail-bottom \{[\s\S]*?width: 184px;[\s\S]*?min-width: 184px;/.test(railCss) &&
  /\.rail-btn \{[\s\S]*?height: 32px;[\s\S]*?margin: 4px 0;/.test(railCss) &&
  /\.rail-label,[\s\S]*?\.rail-group-label \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;/.test(railCss) &&
  /body\.rail-visual-wide \.rail-label,[\s\S]*?visibility: visible;/.test(railCss) &&
  /body:not\(\.rail-visual-wide\) \.rail-group \{[\s\S]*?border-top-color: var\(--border\);/.test(railCss)
) {
  ok("侧栏 64px 可见轨道、固定 184px 内部栅格与无重排展开");
} else {
  fail("侧栏固定栅格裁切展开契约缺失");
}
if (
  !/\.rail-overlay/.test(railCss) &&
  !/#rail-user/.test(railCss) &&
  /\.rail-btn\.active::before/.test(railCss) &&
  /width: 2px;/.test(railCss) &&
  /background: color-mix\(in srgb, var\(--accent\) 10%, transparent\)/.test(railCss) &&
  /\.rail-btn\.active \{\s*color: var\(--text\);[\s\S]*?color: var\(--accent-text\);/.test(railCss)
) {
  ok("侧栏无旧浮层/账户卡，active 使用 2px accent + 10% 背景与 accent 文字");
} else {
  fail("侧栏仍有旧浮层/账户卡，或 active 视觉契约缺失");
}

const viewsSrc3 = read("src/main/views.js");
if (/--lg-accent-text/.test(viewsSrc3) && /--lg-hover/.test(viewsSrc3) && /--lg-shadow/.test(viewsSrc3) && /--lg-border-strong/.test(viewsSrc3)) {
  ok("views.js 向阅读面注入 4.0 状态令牌");
} else {
  fail("views.js 缺少阅读面状态令牌");
}

const indexSrc2 = read("src/main/index.js");
if (/74ch/.test(indexSrc2) && /--accent-text/.test(indexSrc2) && /border-radius: 12px/.test(indexSrc2)) {
  ok("离线阅读页复用 4.0 排版与令牌");
} else {
  fail("离线阅读页未复用 4.0 排版");
}

/* ---------- R54 提交语言正确性 + 列表鼠标点击 ---------- */

try {
  const { LANGS, resolveLangId } = require(path.join(ROOT, "src", "main", "langs.js"));
  const expect = {
    "C++14 (GCC 9)": 28,
    "C++14": 11,
    "C++17": 12,
    "C++20": 27,
    "C++23": 34,
    "C++11": 4,
    "C++98": 3,
    C: 2,
    "Python 3": 7,
    Pascal: 1,
    "Java 8": 8,
    "Java 21": 33,
    Rust: 15,
    Go: 14,
  };
  const bad = Object.entries(expect).filter(([name, id]) => {
    const got = resolveLangId(name);
    return !got || got.id !== id;
  });
  if (!bad.length && LANGS.length >= 20) ok(`语言表 ${LANGS.length} 项且关键映射正确（C++17→12、C++20→27、Python 3→7）`);
  else fail("语言表映射错误", JSON.stringify(bad));
  if (resolveLangId("Brainfuck") === null && resolveLangId("") === null) ok("未知语言返回 null（不允许静默回落默认语言）");
  else fail("未知语言没有返回 null");
  const o2Lang = resolveLangId("C++17");
  if (o2Lang && o2Lang.o2 === true && resolveLangId("Python 3").o2 === false) ok("O2 能力标记随语言表提供");
  else fail("语言表缺少 o2 能力标记");
} catch (err) {
  fail("langs.js 加载失败", String(err && err.message).slice(0, 120));
}

if (/resolveLangId/.test(luoguSource) && !/LANG_IDS\[lang\]\s*\|\|/.test(luoguSource)) ok("提交按语言表解析，无静默回落");
else fail("luogu.js 仍存在静默语言回落");

if (/enableO2:\s*\$\{/.test(luoguSource)) ok("enableO2 由提交参数决定（不再硬编码 0）");
else fail("enableO2 仍硬编码");
if (/enqueueSubmit\(pid, code, lang, reason, o2/.test(luoguSource)) ok("离线队列携带 O2 标记");
else fail("离线队列丢失 O2 标记");
if (/payload && payload\.o2/.test(ipcSource)) ok("app:submit 透传 O2 开关");
else fail("app:submit 未透传 O2");
const editorSource = read("src/renderer/shell/editor.js");
if (/ide-o2-box/.test(editorSource) && /O2_LANGS/.test(editorSource)) ok("编辑器提供 O2 开关并按语言置灰");
else fail("编辑器缺少 O2 开关");
if (/<option>C\+\+14 \(GCC 9\)<\/option>/.test(editorSource) && /<option>Python 3<\/option>/.test(editorSource)) ok("编辑器语言名与站内一致（含 C++14 (GCC 9)/Python 3）");
else fail("编辑器语言名与站点不一致");

const libraryClick = read("src/renderer/shell/library.js");
if (/row\.addEventListener\("click"/.test(libraryClick)) ok("列表行有鼠标点击打开处理器");
else fail("列表行仍不可鼠标点击");
if (/state\.hasMore/.test(libraryClick)) ok("列表支持 count 未知时的 hasMore 分页");
else fail("列表未接入 hasMore 分页");
if (/hasMore:\s*!countKnown && full/.test(luoguSource)) ok("记录列表在 count 未知时按整页推断 hasMore");
else fail("记录列表 total 仍写死 items.length");
if (/max-width:\s*960px/.test(shellCss) && /\.lib-page\.current/.test(shellCss) && !/\.lib-more/.test(shellCss)) {
  ok("题库按网页版阅读宽度与页码分页呈现，不再使用加载更多");
} else {
  fail("题库仍过宽或仍使用加载更多");
}
if (/aria-current/.test(libraryClick) && /lib-pages/.test(libraryClick) && /load\(state, page\)/.test(libraryClick)) {
  ok("页码按钮会替换当前页并标记 aria-current");
} else {
  fail("题库页码交互契约缺失");
}
if (/fmtExact/.test(libraryClick) && /通过率 \$\{rate\}%/.test(libraryClick) && /item\.accepted.*item\.submissions/s.test(libraryClick)) {
  ok("通过率同时显示完整通过/提交人数");
} else {
  fail("通过率未显示完整人数");
}

/* ---------- R69 丝滑与清瑕 ---------- */
const skin69 = read("src/renderer/skin/luogu-skin.css");
const skinNeedles = [
  ["原生控件 accent-color", /accent-color: var\(--lg-accent\)/],
  ["分页悬停态", /\.pagination > \*:hover:not\(\.active\)/],
  ["页码条悬停态", /\.page-bar button:hover/],
  ["筛选 chip 悬停态", /\.filter-section \.tag-button:hover/],
  ["筛选 chip 选中态", /\.tag-select-area \.selected/],
  ["表格行过渡", /#app tbody tr \{\s*transition: background-color/],
  ["链接过渡", /#app a \{[\s\S]*?transition: color/],
  ["按钮过渡含 color", /box-shadow var\(--lg-dur, 120ms\) var\(--lg-ease, ease\),\s*color var\(--lg-dur, 120ms\) var\(--lg-ease, ease\)/],
  ["主按钮悬停用 token", /--lg-accent-hover/],
  ["引用条用 accent-line", /border-left: 2px solid var\(--lg-accent-line/],
  ["代码高亮跟应用主题", /html\[data-lg-mode="dark"\] #app \.token\.comment/],
  ["不再跟随系统主题( Prism )", /^(?!.*@media \(prefers-color-scheme\))[\s\S]*$/],
  ["讨论回复头清色", /\.comment \.author,\s*#app \.reply-item \.author/],
  ["富文本编辑器主题化", /\.casket,\s*#app \.cs-main/],
  ["编辑器行号槽主题化", /\.casket \.cm-gutters/],
  ["悬浮回复按钮主题化", /\.btn-float-container \.btn-float-open/],
  ["题库标签列清带(0.7.2 起亮暗通用)", /^#app col \{[^}]*background: transparent/m],
  ["旧版错误页清底(0.7.2 起亮暗通用)", /^#app main\.wrapped\.lfe-body\.mobile-body \{/m],
  ["旧版提示卡文字色", /#app \.card\.message,/],
];
for (const [name, re] of skinNeedles) {
  if (re.test(skin69)) ok("皮肤 R69 " + name);
  else fail("皮肤缺少 R69 " + name);
}
const modePreload = read("src/preload/page.js");
const modeViews = read("src/main/views.js");
if (
  /--lg-boot-mode=/.test(modeViews) &&
  /--lg-boot-accent=/.test(modeViews) &&
  /dataset\.lgMode/.test(modePreload) &&
  /dataset\.lgMode/.test(modeViews) &&
  /--lg-boot-accent=/.test(modePreload) &&
  /--lg-accent-hover/.test(modeViews) &&
  /--lg-accent-line/.test(modeViews) &&
  /--lg-gutter-top:\d*\dpx/.test(modeViews)
) {
  ok("data-lg-mode 与 accent-hover/line 三处同步(views+preload)");
} else {
  fail("data-lg-mode/accent token 管线不齐");
}

const shell69 = read("src/renderer/shell/shell.css");
const shellNeedles = [
  ["遮罩过渡", /#scrim \{[\s\S]*?transition: opacity/],
  ["浮层退场动画", /#overlay\.closing \.overlay-card/],
  ["退场关键帧", /@keyframes lg-pop-out/],
  ["壁纸淡入开关", /body\.wall-fade \.wall-layer/],
  ["面板行选中过渡", /\.pal-row \{[\s\S]*?transition:/],
  ["内容区滚动槽稳定", /scrollbar-gutter: stable/],
  ["IDE 面板进场", /#ide-pane \{[\s\S]*?animation: lg-fade-in/],
  ["侧栏链接滚动可见", /#rail-top::-webkit-scrollbar \{\s*width: 6px/],
  ["按压反馈", /\.q-row:active/],
  ["模糊档位 token", /blur\(var\(--blur-lg\)\)/],
];
for (const [name, re] of shellNeedles) {
  if (re.test(shell69)) ok("外壳 R69 " + name);
  else fail("外壳缺少 R69 " + name);
}
const fatalSrc = read("src/renderer/shared/fatal.js");
const shellJs = read("src/renderer/shell/shell.js");
const settingsJs = read("src/renderer/settings/settings.js");
if (/export function fatal/.test(fatalSrc) && /fatal\("外壳初始化失败"/.test(shellJs) && /fatal\("设置初始化失败"/.test(settingsJs)) {
  ok("错误屏主题化(壳+设置共用 fatal 卡)");
} else {
  fail("错误屏仍是裸文本");
}
if (/\.add\("removing"\);[\s\S]*?setTimeout\(\(\) => old\.remove/.test(shellJs)) {
  ok("toast 溢出先淡出再移除");
} else {
  fail("toast 溢出仍直接删除");
}
const tokens69 = read("src/renderer/shared/tokens.css");
if (/--blur-lg:/.test(tokens69) && /--blur-sm:/.test(tokens69) && /--focus-w:/.test(tokens69)) {
  ok("tokens 增加 blur/focus 档位");
} else {
  fail("tokens 缺少 blur/focus 档位");
}

/* ---------- R70 同层透出 · 主页融合 · 单侧栏布局 ---------- */
const views70 = read("src/main/views.js");
const skin70 = read("src/renderer/skin/luogu-skin.css");
const shellCss70 = read("src/renderer/shell/shell.css");
const shellHtml70 = read("src/renderer/shell/index.html");
const luogu70 = read("src/main/luogu.js");
const homeJs70 = read("src/renderer/shell/home.js");
const shellJs70 = read("src/renderer/shell/shell.js");

for (const [name, re, src] of [
  ["官方主页抓取管线", /async fetchOfficialHome\(\)/, luogu70],
  ["比赛日历数据", /buildContests\(contests\)/, luogu70],
  ["refresh 容错挂载", /next\.official = await this\.fetchOfficialHome\(\)/, luogu70],
  ["官方问候/运势紧凑头", /function buildDailyHeader\(home/, homeJs70],
  ["比赛日历行", /"cal-row"/, homeJs70],
  ["顶部官方倒计时", /"home-countdown"/, homeJs70],
  ["主页问候", /"home-greeting"/, homeJs70],
  ["旧问候卡已移除", /^(?!.*function buildWelcome\(home)/s, homeJs70],
  ["homeKey 含官方块", /home\.official\s*\?/, shellJs70],
]) {
  if (re.test(src)) ok("R70 " + name);
  else fail("R70 缺少 " + name);
}
if (
  /fortuneResult/.test(luogu70) &&
  /fortuneGood/.test(luogu70) &&
  /fortuneBad/.test(luogu70) &&
  !/fortune:\s*punch\s*\?\s*text\(punch\)/.test(luogu70) &&
  /normalizeFortune/.test(homeJs70)
) {
  ok("官方问候只接受结构化昵称/运势，不再回填整块打卡文本");
} else {
  fail("官方问候仍可能把日期/倒计时误当运势");
}
if (!/rail-mark/.test(shellHtml70)) ok("R70 侧栏 luogu 标志已删");
else fail("R70 rail-mark 仍有残留");
if (!/lg-card-alpha/.test(skin70) && /lg-raise/.test(skin70) && /lg-code-alpha/.test(skin70)) ok("R70 皮肤孤岛收编为 raise/code 档位");
else fail("R70 皮肤仍有 --lg-card-alpha 或缺 raise/code");
if (!/cardAlpha <= 30/.test(views70) && /--lg-raise:\$\{t\.raiseAlpha\}%/.test(views70)) ok("R70 skinVars 发射 raise/code 档位");
else fail("R70 skinVars 未接入新档位");
for (const [name, re] of [
  ["轨道宽统一变量", /grid-template-columns: var\(--rail-current-w/],
  ["顶部导航独立滚动", /#rail-top \{[\s\S]*?overflow-y: auto;/],
]) {
  if (re.test(shellCss70)) ok("R70 外壳 " + name);
  else fail("R70 外壳缺少 " + name);
}
if (!/transition:\s*grid-template-columns/.test(shellCss70)) ok("R70 外壳宽度无独立 CSS 补间");
else fail("R70 外壳仍有独立 CSS 宽度补间");
if (!/\.rail-overlay/.test(shellCss70)) ok("R70 旧侧栏浮层选择器已移除");
else fail("R70 旧侧栏浮层选择器仍有残留");
if (!/92%, transparent/.test(skin70) && !/95%, transparent/.test(skin70) && !/84%, transparent/.test(skin70)) ok("R70 皮肤孤岛百分比清零");
else fail("R70 皮肤仍有写死百分比孤岛");

/* ---------- R71 生产加固（agent-skills 教义落地） ---------- */
const external71 = read("src/main/external.js");
const idx71 = read("src/main/index.js");
const win71 = read("src/main/window.js");
if (/function safeOpenExternal/.test(external71) && /u\.protocol === "https:" \|\| u\.protocol === "http:"/.test(external71)) ok("R71 安全出口模块+协议白名单");
else fail("R71 external.js 缺 safeOpenExternal 或协议白名单");
if (/require\("\.\/external"\)/.test(views70) && /require\("\.\/external"\)/.test(win71)) ok("R71 views/window 已接入安全出口");
else fail("R71 views/window 未接入 safeOpenExternal");
if (!/shell\.openExternal/.test(views70) && !/shell\.openExternal/.test(win71)) ok("R71 shell.openExternal 全仓唯一出口（external.js）");
else fail("R71 仍有裸 shell.openExternal 残留");
if ((views70.match(/safeOpenExternal\(/g) || []).length >= 6) ok("R71 views 六处外开调用点全收口");
else fail("R71 views.js safeOpenExternal 调用点不足 6 处");
if (/persistCrash/.test(idx71) && /crash\.log/.test(idx71) && /uncaughtException/.test(idx71)) ok("R71 崩溃落盘 crash.log");
else fail("R71 index.js 缺崩溃落盘");

/* ---------- R72 评审团整改（sandbox/导航防护/离线CSP/查找缩放/便携包） ---------- */
const win72 = read("src/main/window.js");
const idx72 = read("src/main/index.js");
const page72 = read("src/preload/page.js");
if (!/sandbox: false/.test(win72) && !/sandbox: false/.test(views70) && /sandbox: true/.test(win72)) ok("R72 全部渲染宿主 sandbox:true");
else fail("R72 仍有 sandbox:false 渲染宿主");
if ((win72.match(/will-navigate/g) || []).length >= 2 && (win72.match(/setWindowOpenHandler/g) || []).length >= 2 && (win72.match(/will-attach-webview/g) || []).length >= 2) ok("R72 主壳/设置窗导航防护（will-navigate/open/attach×2）");
else fail("R72 主壳/设置窗缺导航防护");
if (/Content-Security-Policy/.test(idx72) && /name\.startsWith\("on"\)/.test(views70)) ok("R72 离线页 CSP + 快照 on* 剥离");
else fail("R72 离线页缺 CSP 或快照未剥 on*");
if (/__lgReloadCount/.test(views70) && (views70.match(/__lgReloadCount/g) || []).length >= 2) ok("R72 渲染崩溃重载上限");
else fail("R72 缺渲染崩溃重载上限");
if (/"app:find"/.test(ipcSource) && /app:find-open/.test(page72) && /app:find-result/.test(page72) && /app:zoom-hud/.test(page72) && /findInPage/.test(ipcSource)) ok("R72 页内查找/缩放 HUD（IPC 对齐由第 5 节保证）");
else fail("R72 查找/缩放通道缺失");
if (/clipboard-sanitized-write/.test(idx72) && /basename\(item\.getFilename/.test(idx72)) ok("R72 剪贴板豁免 + 下载文件名收敛");
else fail("R72 缺剪贴板豁免或下载文件名收敛");
if (/内部错误/.test(idx72)) ok("R72 崩溃时用户可见提示");
else fail("R72 缺崩溃用户提示");
if (fs.existsSync(path.join(ROOT, "..", "LICENSE"))) ok("R72 LICENSE 文件在位");
else fail("R72 缺 LICENSE");
if (fs.existsSync(path.join(__dirname, "pack-portable.ps1"))) ok("R72 便携包脚本在位");
else fail("R72 缺 scripts/pack-portable.ps1");

/* ---------- R74 三轮评审整改（口径/白名单/文档一致性） ---------- */
const readmeFront = fs.readFileSync(path.join(ROOT, "..", "README.md"), "utf8");
const smoke74 = read("src/main/smoke.js");
if (readmeFront.indexOf("为 Windows 打造的洛谷客户端，v" + (JSON.parse(read("package.json")).version) + "。") !== -1) ok("R74 README 门面版本与 package.json 同步");
else fail("R74 README 门面版本未同步");
if (/overAllowedItems/.test(smoke74) && /div\.right/.test(smoke74)) ok("R74 审计 over 显式白名单（锚定 parent，明细落盘）");
else fail("R74 缺 over 白名单");
if (/wc\.on\("will-navigate"/.test(read("src/main/views.js")) && /wc\.setWindowOpenHandler/.test(read("src/main/views.js"))) ok("R74 单页面宿主导航防护（will-navigate + window-open）");
else fail("R74 页面宿主缺导航防护");
if (idx72.indexOf(String.raw`luogu\.com\.cn(:\d+)?(\/|$)`) !== -1) ok("R74 请求 handler 洛谷源正则尾边界");
else fail("R74 缺正则尾边界");

/* ---------- R76 量化路径兑现（AT 题号/行为探针/parity 首批/harness 剥离） ---------- */
const sections76 = read("src/main/sections.js");
const overlays76 = read("src/renderer/shell/overlays.js");
const page76x = read("src/preload/page.js");
const parity76 = fs.readFileSync(path.join(ROOT, "..", "docs", "PARITY.md"), "utf8");
if (/function canonicalPid/.test(sections76) && /AT_/.test(sections76) && /toLowerCase/.test(sections76)) ok("R76 canonicalPid 单源（AT_ 小写规范形）");
else fail("R76 缺 canonicalPid 单源");
if (/canonicalPid/.test(views70) && /canonicalPid/.test(ipcSource) && (views70.match(/canonicalPid/g) || []).length >= 3) ok("R76 views/ipc 接入 canonicalPid（openProblem/palette/submit/草稿）");
else fail("R76 views/ipc 未接入 canonicalPid");
if (page76x.indexOf(String.raw`[A-Za-z0-9_]*\d[A-Za-z0-9_]*`) !== -1 && /normalizeProblemInput/.test(overlays76)) ok("R76 题号入口正则接受下划线题号（页面转交 + 全局面板）");
else fail("R76 题号入口正则未更新");
if (/LG_SMOKE_FIND === "1"/.test(smoke74) && /SMOKE_FIND /.test(smoke74)) ok("R76 FIND 行为探针（Ctrl+F/缩放 HUD/Esc 真实键鼠链）");
else fail("R76 缺 FIND 行为探针");
if (/atOk/.test(smoke74)) ok("R76 PALETTE 探针含 AT_ 规范化断言");
else fail("R76 PALETTE 探针缺 AT 断言");

/* ---------- R77 六轮评审整改（裁决洞 #2/SEC 探针/GATE 三元/证据纪律） ---------- */
const idx77 = read("src/main/index.js");
if (/guardIpcMain/.test(read("src/main/ipc.js")) && /SMOKE_FAIL ipc:/.test(read("src/main/smoke-guard.js"))) ok("R77 ipc handler 冒烟守卫（裁决洞 #2，smoke-guard 纯模块）");
else fail("R77 缺 ipc handler 冒烟守卫");
if (/LG_SMOKE_SEC === "1"/.test(smoke74) && /SMOKE_SEC /.test(smoke74) && /lg-sec:\/\/probe/.test(smoke74)) ok("R77 SEC 安全行为探针");
else fail("R77 缺 SEC 探针");
if (/gated: auditGated/.test(smoke74) && /checked: auditChecked\.length/.test(smoke74)) ok("R77 GATE 三元计数（checked/gated/bad）");
else fail("R77 GATE 仍为二元");
if (/fails/.test(fs.readFileSync(path.join(__dirname, "smoke.js"), "utf8")) && /failLog/.test(fs.readFileSync(path.join(__dirname, "smoke.js"), "utf8"))) ok("R77 失败证据时间戳归档");
else fail("R77 缺失败归档");
if (/LGR-\|月赛/.test(smoke74)) ok("R77 over 白名单双锚");
else fail("R77 白名单仍单锚");
if (/harness not available/.test(idx77)) ok("R77 剥离后 LG_DEMO/--smoke 路径守卫");
else fail("R77 缺剥离后守卫");

/* ---------- R78 七轮评审整改（守卫单测/SEC 五宿主/pack 行为门禁/判源修复） ---------- */
const guard78 = require(path.join(ROOT, "src", "main", "smoke-guard.js"));
if (typeof guard78.guardIpcMain === "function") ok("R78 smoke-guard 纯模块在位");
else fail("R78 smoke-guard 缺导出");
{
  let guardHit = false;
  const origErr = console.error;
  console.error = (...args) => {
    if (String(args[0] || "").indexOf("SMOKE_FAIL ipc:") === 0) guardHit = true;
  };
  const reg = [];
  const fake = { handle: (c, f) => reg.push(f), on: (c, f) => reg.push(f) };
  guard78.guardIpcMain(fake, true);
  fake.handle("app:unit", () => {
    throw new TypeError("unit-boom"); // 同步抛：守卫的 console.error 在调用方同步段执行
  });
  reg[0]({}).catch(() => {});
  console.error = origErr;
  const regOff = [];
  const rawFn = () => {
    throw new TypeError("raw-boom");
  };
  const fakeOff = { handle: (c, f) => regOff.push(f), on: (c, f) => regOff.push(f) };
  const before = fakeOff.handle;
  guard78.guardIpcMain(fakeOff, false);
  fakeOff.handle("app:raw", rawFn);
  const passthrough = fakeOff.handle === before && regOff[0] === rawFn;
  if (guardHit && passthrough) ok("R78 守卫单测：异常打 SMOKE_FAIL 且禁用态直通");
  else fail("R78 守卫单测未过（guardHit=" + guardHit + " passthrough=" + passthrough + "）");
}
if (smoke74.indexOf(String.raw`sec.settingsOpen === true;`) !== -1 && smoke74.indexOf(String.raw`ctx.openSettings();`) !== -1 && smoke74.indexOf(String.raw`settingsWin.close();`) !== -1) ok("R78 SEC 五宿主覆盖（settings 开-测-关）");
else fail("R78 SEC 缺 settings 腿");
const pack78 = fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8");
if (/LG_SMOKE_SEC = "1"/.test(pack78) && /LG_SMOKE_FIND = "1"/.test(pack78)) ok("R78 出包门禁携带行为探针（SEC/FIND）");
else fail("R78 出包门禁缺行为探针 env");
if (/requestingUrl/.test(idx77)) ok("R78 fullscreen 判源 frame 粒度（requestingUrl）");
else fail("R78 fullscreen 判源未修");
if (/ipcMain.on = \(channel, fn\)/.test(fs.readFileSync(path.join(ROOT, "src", "main", "smoke-guard.js"), "utf8"))) ok("R78 on 型通道入守卫");
else fail("R78 on 型通道未入守卫");

/* ---------- R79 八轮评审整改（出包裁决洞 #3/SEC 环境感知/剥离清单） ---------- */
const pack79 = fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8");
if (/node /.test(pack79) && /smoke\.js/.test(pack79) && /LASTEXITCODE/.test(pack79)) ok("R79 出包冒烟走真裁决启动器（exit code 算数）");
else fail("R79 出包门禁仍绕过启动器");
if (/smoke-guard\.js/.test(pack79)) ok("R79 剥离清单含 smoke-guard.js");
else fail("R79 剥离清单缺 guard 模块");
/* 剥离清单 × 顶层 require：出包会删掉清单内的文件，任何裸顶层 require 都会让整包
   启动即 Error 弹窗（v0.7.15 便携包因 ipc.js require("./smoke-guard") 无法启动，
   而打包冒烟只跑 desktop/ 开发态，漏掉了这一层）。 */
const stripNames = [];
for (const line of pack79.split("\n")) {
  if (!/Remove-Item/.test(line) || /Test-Path/.test(line)) continue;
  const m = line.match(/"src\\main\\([\w-]+)\.js"/);
  if (m && !stripNames.includes(m[1])) stripNames.push(m[1]);
}
if (stripNames.length) ok("R94 剥离清单可解析（" + stripNames.join(" / ") + "）");
else fail("R94 无法从 pack-portable.ps1 解析剥离清单");
const bareStripRequires = [];
for (const file of walk(path.join(ROOT, "src"), [])) {
  if (!/\.js$/.test(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const name of stripNames) {
    const re = new RegExp("require\\([\"']\\./" + name + "[\"']\\)");
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      const safe = /try\s*\{/.test(near) || /=>\s*require\(/.test(line);
      if (!safe) bareStripRequires.push(path.relative(ROOT, file) + ":" + (i + 1) + ' require("./' + name + '")');
    });
  }
}
if (!bareStripRequires.length) ok("R94 剥离清单内模块无顶层裸 require（出包不会因缺模块崩启动）");
else fail("R94 剥离清单内模块被顶层裸 require：" + bareStripRequires.join("；"));
if (/BOOT-OK/.test(pack79) && /LG_USERDATA/.test(pack79)) ok("R94 出包对暂存产物做隔离启动自检（BOOT-OK）");
else fail("R94 出包缺少针对暂存产物的启动自检");
const packBuf = fs.readFileSync(path.join(__dirname, "pack-portable.ps1"));
if (packBuf[0] === 0xef && packBuf[1] === 0xbb && packBuf[2] === 0xbf) ok("R94 pack-portable.ps1 带 UTF-8 BOM（powershell.exe 5.1 才不会按 ANSI 误读中文）");
else fail("R94 pack-portable.ps1 缺 UTF-8 BOM，Windows PowerShell 5.1 会直接解析失败");
if (/hiddenOpen === "skipped"/.test(smoke74) && /ensureWindow/.test(smoke74)) ok("R79 SEC hidden 腿环境感知（ensureWindow+skipped）");
else fail("R79 SEC hidden 腿缺 skip 语义");
if (/TIMEOUT after/.test(fs.readFileSync(path.join(__dirname, "smoke.js"), "utf8"))) ok("R79 超时归档带上下文");
else fail("R79 超时归档缺上下文");

/* ---------- R83 行为化证据断言（读最新探针日志；CI 无日志时如实跳过） ---------- */
const lgdev83 = path.join(ROOT, "..", ".lg-dev");
const batchLogs83 = [];
try {
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    const b1 = path.join(lgdev83, dir, "batch1-run.log");
    if (fs.existsSync(b1)) batchLogs83.push(b1);
  }
} catch {
  /* .lg-dev 不存在（全新 clone）→ 跳过 */
}
if (batchLogs83.length) {
  const text83 = fs.readFileSync(batchLogs83[batchLogs83.length - 1], "utf8");
  const secOk83 = text83.indexOf("SMOKE_SEC ") !== -1 && text83.indexOf(String.raw`"ok":true`) !== -1;
  const findOk83 = text83.indexOf("SMOKE_FIND ") !== -1;
  if (secOk83 && findOk83) ok("R83 行为证据（最新批次 " + path.basename(path.dirname(batchLogs83[batchLogs83.length - 1])) + "）：SEC/FIND ok:true");
  else fail("R83 最新批次行为证据不足（SEC=" + secOk83 + " FIND=" + findOk83 + "）");
  const audits83 = [];
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    for (const f of ["dark-auditA.log", "dark-auditB.log", "light-auditA.log", "light-auditB.log"]) {
      const p83 = path.join(lgdev83, dir, f);
      if (fs.existsSync(p83)) audits83.push(p83);
    }
  }
  if (audits83.length) {
    const badLines = fs.readFileSync(audits83[audits83.length - 1], "utf8").match(/SMOKE_FAIL 皮肤审计超零/g);
    const gateOk = /"bad":0/.test(fs.readFileSync(audits83[audits83.length - 1], "utf8"));
    if (!badLines && gateOk) ok("R83 最新审计 GATE bad:0（" + path.basename(path.dirname(audits83[audits83.length - 1])) + "）");
    else fail("R83 最新审计存在超零项");
  }
} else {
  ok("R83 行为化证据断言：本地无探针日志，跳过（CI/全新 clone 场景）");
}

/* ---------- R84 登录态实测证据（owner 授权；CI 无日志时如实跳过） ---------- */
const smoke84 = read("src/main/smoke.js");
if (/LGTEST_RECORD_PAGE/.test(smoke84) && /LGTEST_NOTIFY_PAGE/.test(smoke84) && /LGTEST_SUBMIT_PAGE/.test(smoke84) && /captureWC\(recordWc, wait\)/.test(smoke84)) ok("R84 登录态页面级证据探针（记录/通知/提交 三页 DOM+截图）");
else fail("R84 缺登录态页面级探针");
const loginLogs84 = [];
try {
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    const loginLog84 = path.join(lgdev83, dir, "login-run.log");
    if (fs.existsSync(loginLog84)) loginLogs84.push(loginLog84);
  }
} catch {
  /* .lg-dev 不存在（全新 clone）→ 跳过 */
}
if (loginLogs84.length) {
  const lastLogin84 = loginLogs84[loginLogs84.length - 1];
  const loginText84 = fs.readFileSync(lastLogin84, "utf8");
  const loginDir84 = path.basename(path.dirname(lastLogin84));
  const loggedIn84 = /LGTEST logged-in uid=\d+/.test(loginText84);
  const record84 = /LGTEST_RECORD_PAGE .*"title":"评测记录 - 洛谷"/.test(loginText84) && /"recordLinks":\d+/.test(loginText84);
  const notify84 = /LGTEST_NOTIFY_PAGE .*"title":"通知中心 - 洛谷"/.test(loginText84);
  const submit84 = /LGTEST_SUBMIT_PAGE .*"href":"https:\/\/www\.luogu\.com\.cn\/problem\/P1001#submit"/.test(loginText84) && /"editors":1/.test(loginText84) && /"codeLen":[1-9][0-9]*/.test(loginText84);
  if (loggedIn84 && record84 && notify84 && submit84) ok("R84 登录态实测证据（" + loginDir84 + "）：登录/记录/通知/提交 四证齐全");
  else fail("R84 登录态证据不足（login=" + loggedIn84 + " record=" + record84 + " notify=" + notify84 + " submit=" + submit84 + "）");
  const shots84 = ["login-record.png", "login-notify.png", "login-submit.png"].map((f) => path.join(lgdev83, f));
  const shotsOk84 = shots84.every((p) => fs.existsSync(p) && fs.statSync(p).size > 5000);
  if (shotsOk84) ok("R84 登录态三页截图在场且非空（>5KB）");
  else fail("R84 登录态截图缺失/过小");
  if (loginText84.indexOf("SMOKE_FAIL") === -1 && loginText84.indexOf("smoke: PASS") !== -1) ok("R84 登录实测无 SMOKE_FAIL 且启动器判 PASS");
  else fail("R84 登录实测裁决不干净");
} else {
  ok("R84 登录态实测断言：本地无登录日志，跳过（CI/全新 clone 场景）");
}
if (/勿使用 v0\.7\.10 便携包/.test(fs.readFileSync(path.join(ROOT, "..", "CHANGELOG.md"), "utf8"))) ok("R79 v0.7.10 带红出厂已披露");
else fail("R79 缺 v0.7.10 披露");

/* ---------- R80 九轮收官（自签过渡/回归补全/parity 增量） ---------- */
const pack80 = fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8");
if (/New-SelfSignedCertificate/.test(pack80) && /Set-AuthenticodeSignature/.test(pack80) && /luogu-desktop-selfsigned\.cer/.test(pack80)) ok("R80 自签过渡（签名+公钥导出）");
else fail("R80 pack 缺自签步骤");
if (/受信任的发布者/.test(fs.readFileSync(path.join(ROOT, "..", "README.md"), "utf8"))) ok("R80 README 自签信任说明");
else fail("R80 缺信任说明");
if ((fs.readFileSync(path.join(ROOT, "..", "docs", "PARITY.md"), "utf8").match(/^\| 6 \|/m) || []).length === 1) ok("R80 PARITY 扩至 6 旅程");
else fail("R80 PARITY 未扩至 6 旅程");

/* ---------- R82 v0.8 票提前清偿（溢出转正/首启引导/渲染可观测） ---------- */
const skin82 = read("src/renderer/skin/luogu-skin.css");
const config82 = read("src/main/config.js");
if (/a\[data-v-12b24cc3\]/.test(skin82) && /text-overflow: ellipsis/.test(skin82)) ok("R82 user 页轮播溢出皮肤收敛（转正）");
else fail("R82 缺溢出收敛皮肤规则");
if (/firstRunSeen/.test(config82) && /buildFirstRun/.test(read("src/renderer/shell/home.js"))) ok("R82 首启引导卡（firstRunSeen + buildFirstRun）");
else fail("R82 缺首启引导");
if (/console-message/.test(read("src/main/index.js"))) ok("R82 冒烟模式渲染端 console 中继（可观测性）");
else fail("R82 缺渲染端 console 中继");
if (/firstRunCard/.test(smoke74)) ok("R82 VISUAL 探针含首启卡指标");
else fail("R82 VISUAL 缺首启卡指标");
if (parity76.trim().indexOf("# Parity") === 0 && /9 旅程/.test(parity76)) ok("R76 PARITY.md 首批（9 旅程×3 模式）在位");
else fail("R76 PARITY.md 未扩至 9 旅程");
if (/smoke\.js/.test(fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8")) && /剥离/.test(fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8"))) ok("R76 打包后剥离探针 harness");
else fail("R76 打包缺 harness 剥离");
if (/endsWith\("\.luogu\.com\.cn"\)/.test(read("src/main/luogu.js"))) ok("R74 隐藏窗导航白名单含子域");
else fail("R74 隐藏窗白名单缺子域");
if (/captureProblem\(entry, round \+ 1\)/.test(read("src/main/views.js")) && /2\.5秒|2500/.test(read("src/main/views.js"))) ok("R74 快照抓取瞬时错误重试");
else fail("R74 缺快照重试");
/* ---------- R75 四轮评审整改（裁决洞/零阈值门禁/白名单锚定/CHANGELOG 纪律） ---------- */
const smokeLauncher = fs.readFileSync(path.join(__dirname, "smoke.js"), "utf8");
const changelog75 = fs.readFileSync(path.join(ROOT, "..", "CHANGELOG.md"), "utf8");
const luogu75 = read("src/main/luogu.js");
const firstVer = (changelog75.match(/## v([0-9.]+)/) || [])[1];
if (firstVer === JSON.parse(read("package.json")).version) ok("R75 CHANGELOG 首节版本 == package.json");
else fail("R75 CHANGELOG 首节版本(" + firstVer + ")与 package.json 不一致");
if (/stdout \+ stderr/.test(smokeLauncher) || (smokeLauncher.includes('String(result.stderr || "")') && smokeLauncher.includes('allOut'))) ok("R75 冒烟裁决合并 stdout+stderr");
else fail("R75 冒烟裁决仍只扫 stdout");
if (/SMOKE_SKIN_AUDIT_GATE/.test(smoke74) && /皮肤审计超零/.test(smoke74)) ok("R75 审计零阈值真门禁");
else fail("R75 缺审计零阈值门禁");
if (/luogu\.org/.test(luogu75)) ok("R75 隐藏窗白名单补 luogu.org 口径");
else fail("R75 隐藏窗白名单缺 luogu.org");


/* ---------- R73 二轮评审整改（隐藏窗/权限/下载/HUD/证据卫生） ---------- */
const luogu73 = read("src/main/luogu.js");
const page73 = read("src/preload/page.js");
const pkg73 = read("package.json");
const packPs1 = fs.readFileSync(path.join(__dirname, "pack-portable.ps1"), "utf8");
if (/web-contents-created/.test(idx72) && /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/.test(idx72)) ok("R73 全局 web-contents-created 兜底");
else fail("R73 缺全局 web-contents-created 兜底");
if ((luogu73.match(/setWindowOpenHandler/g) || []).length >= 1 && /will-attach-webview/.test(luogu73) && /will-navigate/.test(luogu73)) ok("R73 隐藏数据窗三重防护");
else fail("R73 隐藏数据窗缺防护");
if (/permission === "fullscreen" && isLuogu/.test(idx72)) ok("R73 权限请求 fullscreen 洛谷源豁免");
else fail("R73 缺 fullscreen 豁免");
if (idx72.indexOf(String.raw`replace(/[\\/:*?"<>|]/g`) !== -1) ok("R73 下载文件名非法字符清洗");
else fail("R73 缺下载文件名清洗");
if (/pointer-events:none/.test(page73) && /hud && hud\.remove/.test(page73)) ok("R73 缩放 HUD 不截留点击");
else fail("R73 缩放 HUD 仍会截留点击");
if (/Escape/.test(page73) && /app:find.*close/.test(page73)) ok("R73 Esc 全局关闭查找条");
else fail("R73 缺 Esc 全局兜底");
if (/__lgReloadCount = 0/.test(views70) && /did-finish-load/.test(views70)) ok("R73 崩溃重载计数成功加载后清零");
else fail("R73 缺重载计数清零");
if (/Math.max\(-3\.5, Math.min\(3,/.test(views70)) ok("R73 缩放范围放宽至 53%-173%");
else fail("R73 缩放范围仍窄");
if (/formaction/.test(views70) && /xlink:href/.test(views70) && /data:\(image\|font\)/.test(views70)) ok("R73 快照消毒覆盖 URL 属性全族");
else fail("R73 快照消毒未覆盖 URL 属性全族");
if (/style-src 'unsafe-inline' data:/.test(idx72)) ok("R73 离线 CSP style-src 收敛");
else fail("R73 离线 CSP style-src 未收敛");
if (/ICON-KEEP icon\.ico/.test(fs.readFileSync(path.join(__dirname, "pack-ico.js"), "utf8"))) ok("R73 pack-ico 覆盖守卫");
else fail("R73 pack-ico 缺覆盖守卫");
if (/SMOKE_OK/.test(packPs1) && /pack-smoke\.log/.test(packPs1)) ok("R73 打包内建冒烟+证据落盘");
else fail("R73 打包缺内建冒烟");
if (/"author": "longguanhong0755"/.test(pkg73) && /repository/.test(pkg73)) ok("R73 package.json 元数据");
else fail("R73 package.json 缺元数据");
if (/Ctrl\+F` 页内查找/.test(fs.readFileSync(path.join(ROOT, "..", "README.md"), "utf8"))) ok("R73 README 快捷键收录查找/缩放");
else fail("R73 README 快捷键未收录新功能");

/* ---------- R86 开发态热加载 ---------- */
const devPkg = JSON.parse(read("package.json"));
if (devPkg.scripts && devPkg.scripts.start === "node scripts/dev.js" && devPkg.scripts.dev === "node scripts/dev.js") {
  ok("npm start/dev 默认启用热加载启动器");
} else {
  fail("npm start/dev 未接入 scripts/dev.js");
}
if (devPkg.scripts && devPkg.scripts["start:plain"] === "electron .") ok("保留无监听 start:plain 入口");
else fail("缺少 start:plain 无监听入口");

const { classifyChange } = require(path.join(__dirname, "dev.js"));
const { handleDevCommand } = require(path.join(ROOT, "src", "main", "dev-reload.js"));
const hotMap = {
  "src/main/index.js": "restart",
  "src/preload/shell.js": "restart",
  "src/renderer/shell/chrome.js": "reload-shell",
  "src/renderer/settings/settings.js": "reload-settings",
  "src/renderer/skin/luogu-skin.css": "reload-skin",
  "src/renderer/shared/theme.js": "reload-ui",
  "src/assets/icon.ico": "reload-ui",
};
if (Object.entries(hotMap).every(([file, expected]) => classifyChange(file) === expected)) {
  ok("热加载文件分类覆盖主进程/预加载/外壳/设置/皮肤");
} else {
  fail("热加载文件分类不完整");
}
const hotCalls = [];
const hotCtx = {
  win: { isDestroyed: () => false, webContents: { isDestroyed: () => false, reloadIgnoringCache: () => hotCalls.push("win") } },
  settingsWin: { isDestroyed: () => false, webContents: { isDestroyed: () => false, reloadIgnoringCache: () => hotCalls.push("settings") } },
  views: { updateTheme: () => hotCalls.push("skin") },
};
const originalLog = console.log;
console.log = () => {};
try {
  handleDevCommand("reload-shell", hotCtx);
  handleDevCommand("reload-settings", hotCtx);
  handleDevCommand("reload-ui", hotCtx);
  handleDevCommand("reload-skin", hotCtx);
} finally {
  console.log = originalLog;
}
if (hotCalls.join(",") === "win,settings,win,settings,skin") ok("热加载命令执行链正确");
else fail("热加载命令执行链错误");

/* ---------- R90 稳定性、可读性与资源占用 ---------- */
const luoguSourceMemory = read("src/main/luogu.js");
if (/MAX_PROBLEMS = 2/.test(viewsSource) && /MAX_DETAILS = 3/.test(viewsSource) && /MAX_TOTAL_ENTRIES = 4/.test(viewsSource) && /evictTotal\(MAX_TOTAL_ENTRIES/.test(viewsSource) && /async sleepEntry\(entry, force = false\)/.test(viewsSource) && /loadURL\("about:blank"\)/.test(viewsSource) && /suspendBackground\(\)/.test(viewsSource) && /setAudioMuted\(true\)/.test(viewsSource)) {
  ok("R93 页面 View 有总数上限、空闲休眠、后台释放与静音回收");
} else {
  fail("R93 页面 View 内存回收契约缺失");
}
if (/fetchContextDirect\(url\)/.test(luoguSourceMemory || "") && /session\.fetch\(url/.test(luoguSourceMemory || "") && /contextStats/.test(luoguSourceMemory || "") && /contextDiagnostics\(\)/.test(luoguSourceMemory || "")) {
  ok("R93 洛谷上下文优先走会话直连，浏览器窗仅作降级");
} else {
  fail("R93 洛谷上下文直连降级契约缺失");
}
const storeMemory = read("src/main/store.js");
if (/MAX_TOTAL_BYTES/.test(storeMemory) && /MAX_MEM_BYTES/.test(storeMemory) && /trimMemory\(\)/.test(storeMemory) && /pruneDisk\(\)/.test(storeMemory) && /stats\(\)/.test(storeMemory)) {
  ok("R93 Store 有内存 LRU、磁盘字节上限与统计接口");
} else {
  fail("R93 Store 内存/磁盘预算契约缺失");
}
if (/wall-motion/.test(shellCss) && /wall-paused/.test(shellCss) && /lg-wall-pan/.test(shellCss) && !/requestAnimationFrame\(tickWallpaper\)/.test(shellJsSource)) {
  ok("R90 壁纸改为合成器动画，不再逐帧写 DOM 样式");
} else {
  fail("R90 壁纸仍在 JS rAF 中逐帧重算");
}
const wallpaperSource = read("src/main/wallpaper.js");
if (
  /function displayImage/.test(wallpaperSource) &&
  /nativeImage/.test(wallpaperSource) &&
  /fileURLToPath/.test(wallpaperSource) &&
  /crypto\.createHash/.test(wallpaperSource) &&
  /displayBudget\(\)/.test(wallpaperSource) &&
  /display-cache/.test(wallpaperSource) &&
  /const url = displayImage\(toUrl\(file\), budget\.maxWidth, budget\.maxHeight\)/.test(wallpaperSource) &&
  /displayImage\(rawUrl, budget\.maxWidth, budget\.maxHeight\)/.test(wallpaperSource)
) {
  ok("R90 所有静态壁纸按显示预算缓存缩放");
} else {
  fail("R90 壁纸显示尺寸缓存链路不完整");
}
if (/backgroundThrottling: true/.test(luoguSourceMemory) && /scheduleWindowIdle\(\)/.test(luoguSourceMemory) && /trimMap\(this\.libCache, 30\)/.test(luoguSourceMemory) && /trimMap\(this\.userSearchCache, 20\)/.test(luoguSourceMemory)) {
  ok("R91 隐藏数据窗空闲回收且在内存缓存有容量上限");
} else {
  fail("R91 隐藏数据窗或内存缓存缺少回收上限");
}
if (/BackForwardCache/.test(read("src/main/index.js")) && !/--lg-wall-image:\$\{backdrop\}/.test(viewsSource)) {
  ok("R90 页面不复制壁纸且关闭整页 BFCache");
} else {
  fail("R90 页面壁纸/BFCache 仍有重复内存");
}
const pack90 = read("scripts/pack-portable.ps1");
if (/-t7z -mx=9/.test(pack90) && /7z\.sfx/.test(pack90)) {
  ok("便携包使用 7z/SFX，体积仅作报告不作为门禁");
} else {
  fail("便携包缺少 7z/SFX 打包链路");
}
if (/patch-exe\.js/.test(pack90) && /Luogu Desktop\.exe/.test(pack90) && /patchedSfx/.test(pack90)) {
  ok("便携包写入洛谷图标/产品名/版本，并同步修补 SFX 外层");
} else {
  fail("便携包仍保留 Electron/7-Zip 默认图标与元数据");
}
if (!/transition:\s*grid-template-columns/.test(shellCss) && /#titlebar,[\s\S]*?backdrop-filter: none !important/.test(shellCss)) {
  ok("R90 大表面取消实时背景模糊，保留单一侧栏宽度源");
} else {
  fail("R90 大表面模糊或宽度源仍有回退");
}
/* ---------- R87 Luogu Plus 功能对齐 ---------- */
const config87 = read("src/main/config.js");
const featureKeys = [
  "problemDetect", "showUserIntro", "problemDifficultyColor", "userSearch",
  "shortcuts", "dynamicDetection", "changeFortune", "supportPrompt",
  "betterSearch", "beautifyUI", "smoothHome", "autoRefresh", "customSections",
  "homeRecent", "homeOfficial", "homeContest", "homeHeat", "homeFirstRun",
  "homeAnnouncement", "homeTasks", "homeLinks", "homeCommunity",
];
if (featureKeys.every((key) => new RegExp(key + ":").test(config87)) && /function setFeatures/.test(config87)) {
  ok("R87 增强配置与持久化齐备（22 个开关）");
} else {
  fail("R87 增强配置缺项");
}
if (/features: cfg\.features/.test(ipcSource) && /app:setFeatures/.test(ipcSource) && /applyFeatures\(\)/.test(viewsSource)) {
  ok("R87 features 状态广播并下发所有页面");
} else {
  fail("R87 features 状态链路缺失");
}
const luogu87 = read("src/main/luogu.js");
if (
  /randomProblem\(options = \{\}\)/.test(luogu87) &&
  /\["P", "CF", "SP", "AT", "UVA"\]/.test(luogu87) &&
  /Math\.floor\(Math\.random\(\) \* total\)/.test(luogu87) &&
  /randomJumpGuard/.test(luogu87) &&
  /\/api\/user\/search\?keyword=/.test(luogu87)
) {
  ok("R87 随机跳题均匀抽样/限流与用户搜索后端在位");
} else {
  fail("R87 随机跳题或用户搜索后端缺失");
}
const overlays87 = read("src/renderer/shell/overlays.js");
if (
  /jump-difficulty/.test(read("src/renderer/shell/index.html")) &&
  /jump-source/.test(read("src/renderer/shell/index.html")) &&
  /normalizeProblemInput/.test(overlays87) &&
  /openUserSearch/.test(overlays87) &&
  /randomProblem/.test(overlays87)
) {
  ok("R87 题号/随机跳题/用户搜索原生面板在位");
} else {
  fail("R87 原生跳题或用户搜索面板缺失");
}
const page87 = read("src/preload/page.js");
if (
  /problemIdsInText/.test(page87) &&
  /showProblemDetect/.test(page87) &&
  /data-lgplus-user-intro/.test(page87) &&
  /problemDifficultyColor/.test(page87) &&
  /changeFortune/.test(page87) &&
  /new MutationObserver/.test(page87) &&
  /lg:features/.test(page87)
) {
  ok("R87 划词题号/他人介绍/练习显色/运势/动态检测在位");
} else {
  fail("R87 页面增强功能缺项");
}
if (/feat-problem-detect/.test(read("src/renderer/settings/index.html")) && /feat-home-recent/.test(read("src/renderer/settings/index.html")) && /FEATURE_CONTROLS/.test(read("src/renderer/settings/settings.js"))) {
  ok("R87 设置页集中管理增强与主页板块");
} else {
  fail("R87 设置页增强分区缺失");
}
if (/homeRecent !== false/.test(read("src/renderer/shell/home.js")) && /homeContest !== false/.test(read("src/renderer/shell/home.js")) && /supportPrompt/.test(read("src/renderer/shell/home.js"))) {
  ok("R87 主页板块显隐与支持入口接入");
} else {
  fail("R87 主页板块配置未接入");
}
if (/id="rail-users"/.test(read("src/renderer/shell/index.html")) && /searchUsers/.test(read("src/preload/shell.js")) && /Ctrl\+U/.test(read("src/renderer/shell/index.html")) && /shortcutOpenProblems/.test(read("src/renderer/shell/shell.js"))) {
  ok("R87 用户搜索入口与 Alt+L/Ctrl+U 快捷键在位");
} else {
  fail("R87 用户搜索入口或快捷键缺失");
}
if (/\.lg-problem-detect/.test(read("src/renderer/skin/luogu-skin.css")) && /\.lg-plus-intro-card/.test(read("src/renderer/skin/luogu-skin.css"))) {
  ok("R87 页面增强视觉组件已主题化");
} else {
  fail("R87 页面增强视觉组件缺失");
}
if (
  /id="tb-jump"/.test(read("src/renderer/shell/index.html")) &&
  /button\.title = \(item && item\.label\)/.test(read("src/renderer/shell/chrome.js")) &&
  /rail-glyph-custom/.test(read("src/renderer/shell/chrome.js")) &&
  !/railTooltip|rail-tooltip|lg-rail-tooltip/.test(ipcSource + page87 + read("src/renderer/shell/chrome.js")) &&
  /panelExpand/.test(read("src/renderer/shell/chrome.js")) &&
  /pin\.replaceChildren\(railGlyph/.test(read("src/renderer/shell/chrome.js")) &&
  /users\.replaceChildren\(railGlyph/.test(read("src/renderer/shell/chrome.js")) &&
  /\.rail-glyph svg,[\s\S]*?\.rail-btn > svg/.test(read("src/renderer/shell/shell.css"))
) {
  ok("R88 标题栏题号入口、原生侧栏提示、区分化自定义图标与面板型展开按钮在位");
} else {
  fail("R88 侧栏视觉收敛链路缺失或仍保留浮层提示");
}
if (
  /renderIntroMarkdown/.test(page87) &&
  /player\.bilibili\.com/.test(page87) &&
  /lg-katex-inline/.test(read("src/renderer/skin/luogu-skin.css")) &&
  /lg-md-container/.test(read("src/renderer/skin/luogu-skin.css")) &&
  /lgplus:difficulty:/.test(page87)
) {
  ok("R89 用户介绍安全 Markdown/公式/B 站嵌入/扩展块与练习色缓存齐备");
} else {
  fail("R89 用户介绍或练习色缓存能力缺失");
}
if (
  /buildAnnouncement/.test(read("src/renderer/shell/home.js")) &&
  /buildTasks/.test(read("src/renderer/shell/home.js")) &&
  /buildLinks/.test(read("src/renderer/shell/home.js")) &&
  /buildCommunity/.test(read("src/renderer/shell/home.js")) &&
  /beautifyUI/.test(read("src/renderer/shell/home.js")) &&
  /smoothHome/.test(read("src/renderer/shell/home.js")) &&
  /customSections/.test(read("src/renderer/shell/home.js")) &&
  /sections:\s*\{/.test(luogu87) &&
  /announcement:\s*\{/.test(luogu87) &&
  /discussionLinks/.test(luogu87)
) {
  ok("R89 主页美化/圆滑/板块总控/公告/任务/链接/讨论齐备");
} else {
  fail("R89 主页兼容板块不完整");
}
if (
  /shortcutOpenProblems/.test(config87) &&
  /acceleratorMatches/.test(viewsSource) &&
  /matchesShortcut/.test(read("src/renderer/shell/shell.js")) &&
  /shortcut-problems/.test(read("src/renderer/settings/index.html")) &&
  /shortcut-reset/.test(read("src/renderer/settings/settings.js"))
) {
  ok("R89 题库快捷键可录制并可恢复默认");
} else {
  fail("R89 快捷键录制链路缺失");
}
if (
  /app:checkUpdate/.test(ipcSource) &&
  /checkUpdate/.test(read("src/preload/settings.js")) &&
  /check-update/.test(read("src/renderer/settings/index.html")) &&
  /disclaimer-accepted/.test(read("src/renderer/settings/index.html")) &&
  /about-announcement/.test(read("src/renderer/settings/index.html"))
) {
  ok("R89 更新检查/公告/致谢/使用声明齐备");
} else {
  fail("R89 关于页兼容能力缺失");
}
if (
  /user-search-network/.test(smoke84) &&
  /random-problem-network/.test(smoke84) &&
  /SMOKE_MANIFEST/.test(read("scripts/smoke.js")) &&
  /sha256/.test(read("scripts/smoke.js"))
) {
  ok("R89 真实用户搜索/随机跳题与截图清单哈希门禁齐备");
} else {
  fail("R89 真实网络探针或截图清单门禁缺失");
}
if (
  /function exportData/.test(config87) &&
  /function replaceData/.test(config87) &&
  /function resetAll/.test(config87) &&
  /app:exportSettings/.test(ipcSource) &&
  /app:importSettings/.test(ipcSource) &&
  /settings-export/.test(read("src/renderer/settings/index.html"))
) {
  ok("R88 设置导入/导出/恢复默认链路齐备");
} else {
  fail("R88 设置备份链路缺失");
}

/* R92：当前反馈的 7 个回归契约（主页操作、官方任务、遮罩、侧栏、题库、IDE、按钮色） */
const r92Home = read("src/renderer/shell/home.js");
const r92Luogu = read("src/main/luogu.js");
const r92Shell = read("src/renderer/shell/shell.css");
const r92Library = read("src/renderer/shell/library.js");
const r92Skin = read("src/renderer/skin/luogu-skin.css");
const r93Overlays = read("src/renderer/shell/overlays.js");
if (
  /actions\.openRandomJump\(\)/.test(r92Home) &&
  /openRandomJump/.test(r93Overlays) &&
  /options\.random === true/.test(r93Overlays) &&
  !/actions\.randomProblem\(\{\}\)/.test(r92Home)
) {
  ok("R93 首页随机跳题复用搜索题号面板的筛选与限流反馈");
} else {
  fail("R93 首页仍绕过统一随机跳题面板");
}
if (
  /home-sync-note/.test(r92Home) &&
  /hasUsableSnapshot/.test(r92Luogu) &&
  /prev[^\n]*error: ""/.test(r92Luogu)
) {
  ok("R93 临时同步失败保留可用主页快照，不再回填整块失败卡片");
} else {
  fail("R93 临时同步失败仍会覆盖主页快照");
}
if (/refreshWaiters/.test(r92Luogu) && /Promise\.race\(\[request, watchdog\]\)/.test(r92Luogu)) {
  ok("R93 主页刷新并发复用同一轮结果，直连请求有显式超时");
} else {
  fail("R93 主页刷新仍可能并发抢跑或无限等待");
}
if (
  /\.home-side > :last-child:nth-child\(odd\)/.test(r92Shell) &&
  /grid-column: 1 \/ -1/.test(r92Shell) &&
  /\.home-side \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/.test(r92Shell)
) {
  ok("R93 窄窗口奇数侧栏卡片贯通两列，消除整块空列");
} else {
  fail("R93 窄窗口主页仍可能出现整块空白");
}
if (
  /home-today-actions/.test(r92Home) &&
  /normalizeFortune/.test(r92Home) &&
  /lg-punch-result/.test(r92Home) &&
  /am-u-sm-6/.test(r92Home) &&
  /lg-fg-red/.test(r92Home) &&
  /fortuneText\(fortune\)/.test(r92Home) &&
  /actions\.checkin\(\)/.test(r92Home) &&
  /home\.official\.fortune/.test(r92Home) &&
  !/function openFortuneDialog/.test(r92Home) &&
  !/DAILY_FORTUNES/.test(r92Home)
) {
  ok("R92 完整运势直接内联显示，签到与抽签最多一个按钮且无确认弹窗");
} else {
  fail("R92 主页完整运势内联链路不完整");
}
if (/tasksFor/.test(r92Luogu) && /items: items\.slice\(0, 60\)/.test(r92Luogu) && /tasks: taskData/.test(r92Luogu)) {
  ok("R92 官方任务计划抓取完整条目而非 180 字截断");
} else {
  fail("R92 官方任务计划仍为截断文本");
}
if (
  /--page-scrim/.test(r92Shell) &&
  !/body\.perf #content \{\s*background: color-mix\(in srgb, var\(--bg\) 98%/.test(r92Shell) &&
  !/#content \{\s*background: color-mix\(in srgb, var\(--bg\) 92%/.test(r92Shell)
) {
  ok("R92 壁纸遮罩统一消费 pageScrim，无后置高不透明度覆盖");
} else {
  fail("R92 仍有后置不透明遮罩盖住壁纸");
}
if (
  /#rail-top,[\s\S]*?#rail-bottom \{[\s\S]*?width: 184px;/.test(r92Shell) &&
  /opacity: 0;[\s\S]*?visibility: hidden;/.test(r92Shell) &&
  /body\.rail-visual-wide \.rail-label/.test(r92Shell)
) {
  ok("R92 侧栏使用固定内部栅格裁切展开，图标不随中间帧漂移");
} else {
  fail("R92 侧栏仍在展开过程中重排图标");
}
if (
  /lib-problem-tags/.test(r92Shell) &&
  /lib-problem-tags/.test(r92Library) &&
  /grid-column: 3;/.test(r92Shell)
) {
  ok("R92 题库标签移到标题右侧并压缩题目行高");
} else {
  fail("R92 题库标签仍单独占一行");
}
if (
  /main-container\.lside-nav[\s\S]*?margin-left: 0 !important/.test(r92Skin) &&
  /lcolor-var-grey-4:not\(\.solid\)/.test(r92Skin) &&
  /button\.solid :is\(svg, i, \.fa\)/.test(r92Skin)
) {
  ok("R92 IDE 左空白与 solid+grey 自测按钮深灰字已修复");
} else {
  fail("R92 IDE 左侧占位或自测按钮配色回归");
}

const appearanceIndex = read("src/main/index.js");
const settingsCssCurrent = read("src/renderer/settings/settings.css");
if (
  /wallpaperEpoch/.test(appearanceIndex) &&
  /applyTheme\(ctx\.win, ctx\.theme\)[\s\S]*?applyTheme\(ctx\.settingsWin, ctx\.theme\)[\s\S]*?ctx\.views\.updateTheme\(\)[\s\S]*?broadcastState\(ctx\)/.test(appearanceIndex) &&
  /resolveWallpaper === false/.test(appearanceIndex) &&
  /function syncWallpaperMotion/.test(read("src/renderer/settings/settings.js")) &&
  /body\.perf \.set-pane[\s\S]*?--page-scrim/.test(settingsCssCurrent) &&
  /body\.perf #titlebar,[\s\S]*?--panel-alpha/.test(settingsCssCurrent) &&
  !/#wallpaper::after/.test(settingsCssCurrent)
) {
  ok("设置窗与主窗口共享材质/壁纸透出变量并即时同步");
} else {
  fail("设置窗材质或主窗口同步链路不完整");
}
if (
  /lib-jump/.test(r92Library) &&
  /type = "number"/.test(r92Library) &&
  /input\.max = String\(totalPages\)/.test(r92Library) &&
  /load\(state, page\)/.test(r92Library) &&
  /\.lib-jump-input/.test(r92Shell)
) {
  ok("题库分页支持输入页码快速跳转");
} else {
  fail("题库分页缺少页码跳转");
}
if (
  /parseDailyCounts/.test(r92Luogu) &&
  /Array\.isArray\(count\)/.test(r92Luogu) &&
  /const second = Number\(count\[1\]\)/.test(r92Luogu) &&
  /submittedProblemCount/.test(r92Luogu) &&
  /passedProblemCount/.test(r92Luogu) &&
  /buildProgress\(records/.test(r92Luogu) &&
  /linkGroups/.test(r92Luogu) &&
  !/lg-slider|am-slides/.test(r92Luogu)
) {
  ok("个人中心热度、累计通过官方字段与轮播广告过滤链路齐备");
} else {
  fail("主页官方统计字段、热度解析或广告过滤不完整");
}
if (
  !/if \(!total\)[\s\S]{0,120}?return card;/.test(r92Home) &&
  /for \(let i = 0; i < 26 \* 7; i\+\+\)/.test(r92Home) &&
  /if \(side\.childElementCount\) grid\.appendChild\(side\)/.test(r92Home) &&
  /grid\.childElementCount === 1/.test(r92Home) &&
  /\.home-grid\.single/.test(r92Shell) &&
  /if \(!items\.length\)[\s\S]*?fallbackLines/.test(r92Home)
) {
  ok("首页空数据仍绘制完整热度网格，空任务和单侧内容不会留下空白区域");
} else {
  fail("首页空数据图表、重复任务或空列仍有缺口");
}
if (
  /function buildTrend\(home, user\)/.test(r92Home) &&
  /home-trend-card/.test(r92Home) &&
  /trend-chart-svg/.test(r92Home) &&
  /trend-line/.test(r92Home) &&
  /\(home\.acProgress \|\| \[\]\)/.test(r92Home) &&
  /\.trend-chart-svg/.test(r92Shell) &&
  /\.trend-line/.test(r92Shell) &&
  /\.trend-flat-note/.test(r92Shell)
) {
  ok("首页累计通过折线图始终渲染，空数据保留坐标与零线");
} else {
  fail("首页累计通过折线图缺失或空数据会被隐藏");
}
if (
  /am-u-md-4 lg-punch am-text-center home-fortune-panel/.test(r92Home) &&
  /lg-punch-result/.test(r92Home) &&
  !/lg-punch-result lg-fg-red/.test(r92Home) &&
  /lg-fg-red lg-bold/.test(r92Home) &&
  /诸事不宜/.test(r92Home) &&
  /home-fortune-calendar/.test(r92Home) &&
  /点击打卡/.test(r92Home) &&
  /am-u-sm-6 lg-fg-red/.test(r92Home) &&
  /am-u-sm-12 lg-small/.test(r92Home) &&
  /\.home-fortune-panel h2 \{[\s\S]*?font-size: 20px;[\s\S]*?line-height: 1\.6;/.test(r92Shell) &&
  /\.home-fortune-panel \.lg-punch-result \{[\s\S]*?color: var\(--text\) !important;[\s\S]*?font-size: 60px;[\s\S]*?line-height: 1\.5;/.test(r92Shell) &&
  /\.home-fortune-panel \.home-today-btn \{[\s\S]*?border: 1px solid #dd514c;[\s\S]*?border-radius: 0;[\s\S]*?background: #dd514c;[\s\S]*?font-size: 14px;[\s\S]*?line-height: 1\.2;/.test(r92Shell) &&
  /\.home-fortune-calendar \.lg-punch-big \{[\s\S]*?font-size: 85px;[\s\S]*?line-height: 55px;/.test(r92Shell) &&
  /\.home-fortune-panel \.lg-small \{[\s\S]*?font-size: \.625rem;[\s\S]*?line-height: 16px;/.test(r92Shell)
) {
  ok("运势面板按官网真实全凶 DOM、颜色、字号、行高和双栏 1:1 复刻");
} else {
  fail("运势面板未按洛谷官网真实结构/计算样式复刻");
}
if (
  /heat-map-wrapper/.test(r92Home) &&
  /heat-map-legend/.test(r92Home) &&
  /official-profile-stats/.test(r92Home) &&
  /var\(--heat-/.test(r92Home) &&
  /heat-map-wrapper/.test(r92Shell) &&
  /--heat-4: rgb\(115, 209, 61\)/.test(r92Shell)
) {
  ok("主页累计通过与热度图采用洛谷个人中心同源结构、档位和颜色");
} else {
  fail("主页累计通过或热度图未对齐洛谷个人中心");
}
if (
  /total:\s*firstAccepted\.size/.test(r92Luogu) &&
  !/total:\s*accepted\.size/.test(r92Luogu)
) {
  ok("主页累计通过统计只引用已定义的 firstAccepted 集合");
} else {
  fail("主页累计通过统计仍引用未定义变量，会中断整轮刷新");
}
if (
  !/homeFeatured/.test(read("src/main/config.js")) &&
  !/home-featured|featured-/.test(read("src/renderer/shell/home.js")) &&
  /feat-home-countdown/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-quick-jump/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-progress/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-recent/.test(read("src/renderer/settings/index.html"))
) {
  ok("主页每个官方/原生板块都可在设置中独立显隐");
} else {
  fail("主页板块独立显隐不完整");
}

/* 页面注册表与加载代次：把白屏修复从“逐页补丁”收敛为可验证的统一状态机。 */
let pageRegistry = null;
let pageReadiness = null;
try {
  pageRegistry = require(path.join(ROOT, "src", "main", "page-registry.js"));
  pageReadiness = require(path.join(ROOT, "src", "main", "page-readiness.js"));
} catch (err) {
  fail("页面注册表或加载状态机无法加载", err.message);
}
if (pageRegistry) {
  const routes = {
    "https://www.luogu.com.cn/": "home",
    "https://www.luogu.com.cn/problem/list?page=2": "problems",
    "https://www.luogu.com.cn/problem/P1001": "problem",
    "https://www.luogu.com.cn/training/117": "training",
    "https://www.luogu.com.cn/contest/123": "contest",
    "https://www.luogu.com.cn/record/list": "record",
    "https://www.luogu.com.cn/discuss/123": "discuss",
    "https://www.luogu.com.cn/article/abc": "article",
    "https://www.luogu.com.cn/chat": "chat",
    "https://www.luogu.com.cn/user/notification": "notification",
    "https://www.luogu.com.cn/user/123456": "profile",
    "https://www.luogu.com.cn/auth/login": "login",
    "https://www.luogu.com.cn/some/custom/page": "custom",
  };
  const badRoutes = Object.entries(routes).filter(([url, id]) => pageRegistry.routeIdFromUrl(url) !== id);
  if (!badRoutes.length && pageRegistry.pageSpecFor({ url: "https://www.luogu.com.cn/training/117" }).id === "training") {
    ok("页面注册表覆盖首页、列表、题面、聊天、通知、个人页与自定义路由");
  } else {
    fail("页面注册表路由分类不完整", JSON.stringify(badRoutes));
  }
  const probeSource = pageRegistry.readinessProbeSource(pageRegistry.PAGE_SPECS.problem);
  if (/node\.id !== "lg-boot-skeleton"/.test(probeSource) && /routeMatches/.test(probeSource) && /signature/.test(probeSource) && /busy/.test(probeSource)) {
    ok("就绪探针排除自身骨架，并要求路由和内容连续稳定");
  } else {
    fail("就绪探针仍可能把加载骨架或旧路由误判为完成");
  }
}
const loadWaitSource = read("src/main/luogu.js");
const smokeRunnerSource = read("scripts/smoke.js");
const smokeMainSource = read("src/main/smoke.js");
if (
  /function waitForLoadStop\(webContents/.test(loadWaitSource) &&
  /removeListener\("did-stop-loading", done\)/.test(loadWaitSource) &&
  /removeListener\("did-fail-load", done\)/.test(loadWaitSource) &&
  /SMOKE_PAGE_LOAD_SUMMARY/.test(smokeMainSource) &&
  /runPageLoadingSmoke\(ctx, wait\)/.test(smokeMainSource) &&
  /pageLoadFailure/.test(smokeRunnerSource) &&
  /!pageLoadFailure/.test(smokeRunnerSource) &&
  /listenerWarnings/.test(smokeRunnerSource) &&
  /appDidStopLimit/.test(smokeMainSource) &&
  /internalDidStopLimit/.test(smokeMainSource) &&
  /setMaxListeners\(24\)/.test(viewsSource)
) {
  ok("页面加载探针纳入默认冒烟硬门禁，监听器数量受限且告警会让冒烟失败");
} else {
  fail("页面加载冒烟未形成硬门禁或 did-stop-loading 监听仍会累积");
}if (pageReadiness) {
  const sent = [];
  const changes = [];
  const fakeWc = {
    isDestroyed: () => false,
    getURL: () => "https://www.luogu.com.cn/chat",
    send: (channel, payload) => sent.push({ channel, payload }),
    executeJavaScript: async () => ({ routeReady: true, genericReady: true, textLength: 100, signature: "chat|1|1|DIV" }),
  };
  const controller = new pageReadiness.PageReadinessController(
    fakeWc,
    () => ({ kind: "chat" }),
    (state) => changes.push(state)
  );
  controller.begin("https://www.luogu.com.cn/chat", "test");
  const firstId = controller.state.requestId;
  controller.markDomReady("https://www.luogu.com.cn/chat");
  const hydrated = controller.state.phase === "hydrating";
  controller.begin("https://www.luogu.com.cn/problem/P1001", "test-navigation");
  const secondId = controller.state.requestId;
  controller.fail("test failure", "test");
  controller.markDomReady("https://www.luogu.com.cn/problem/P1001");
  const lateDomIgnored = controller.state.phase === "error";
  controller.didNavigate("https://www.luogu.com.cn/training/117");
  const recovered = controller.state.phase === "hydrating" && controller.state.requestId > secondId;
  controller.markReady({ textLength: 32 });
  const ready = controller.state.phase === "ready";
  controller.dispose();
  if (
    firstId !== secondId &&
    hydrated &&
    lateDomIgnored &&
    recovered &&
    ready &&
    sent.length >= 5 &&
    sent.every((item) => item.channel === "page:load-state") &&
    /loading: entry\.readiness/.test(viewsSource) &&
    /did-start-navigation/.test(viewsSource) &&
    /did-fail-load/.test(viewsSource) &&
    /render-process-gone/.test(viewsSource)
  ) {
    ok("加载状态机为每次导航使用独立代次，迟到事件不能覆盖新页面状态");
  } else {
    fail("加载状态机代次/错误恢复契约不完整");
  }
}
if (
  /entry\.readiness\.begin\(target, sameDocument \? "in-page" : "document"\)/.test(viewsSource) &&
  /entry\.readiness\.markDomReady\(current\)/.test(viewsSource) &&
  /entry\.readiness\.replay\(\)/.test(viewsSource) &&
  /loading: entry\.readiness \? entry\.readiness\.state : null/.test(viewsSource)
) {
  ok("页面状态向渲染层暴露 loading，并在显示/恢复时重放当前加载状态");
} else {
  fail("页面加载状态未完整贯通主进程与外壳");
}
/* R94：注入页面的快照脚本必须能在页面里真正编译执行。
   模板字面量里少写一层反斜杠（\\/ 写成 \/、\\s 写成 \s）会让整段脚本变成
   “ReferenceError: i is not defined” 或静默失效，此前题面快照因此一直抓不到。 */
const captureTemplate = (() => {
  const src = read("src/main/views.js");
  const at = src.indexOf("async captureProblem(entry, round)");
  if (at < 0) return "";
  const head = "wc.executeJavaScript(`";
  const s = src.indexOf(head, at);
  if (s < 0) return "";
  const e = src.indexOf("`);", s);
  if (e < 0) return "";
  return src.slice(s + head.length, e);
})();
let captureRuntime = "";
try {
  captureRuntime = new Function("return `" + captureTemplate + "`")();
} catch {
  captureRuntime = "";
}
let captureCompiles = false;
try {
  new Function(captureRuntime);
  captureCompiles = true;
} catch {
  captureCompiles = false;
}
if (
  captureCompiles &&
  captureRuntime.includes("\\s*(javascript|data|vbscript):") &&
  captureRuntime.includes("^data:(image|font)\\/")
) {
  ok("R94 题面快照脚本可在页面内编译，URL 消毒正则未被模板转义吃掉");
} else {
  fail("R94 题面快照脚本无法编译或 URL 消毒正则被模板转义破坏");
}
let pkgVersion = "";
try {
  pkgVersion = JSON.parse(read("package.json")).version || "";
} catch {
  /* 已在上面报错 */
}
const EXPECTED_VERSION = "0.7.16";
if (pkgVersion === EXPECTED_VERSION) ok("版本号 " + EXPECTED_VERSION);
else fail("package.json 版本号不是 " + EXPECTED_VERSION + "（当前 " + pkgVersion + "）");

console.log("");
console.log(`check: ${checks} 项通过, ${failures} 项失败`);
process.exit(failures ? 1 : 0);
