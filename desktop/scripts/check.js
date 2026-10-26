/* 静态检查：语法、必需文件、渲染层引用、IPC 通道双向对齐。
   不联网、不启动 Electron，CI 与本地共用。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  "src/main/views.js",
  "src/main/sections.js",
  "src/main/passkey-guard.js",
  "src/main/ocr.js",
  "src/main/store.js",
  "scripts/captcha-ocr.py",
  "src/main/luogu.js",
  "src/main/tray.js",
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
  "src/assets/icon.ico",
  "src/assets/tray.png",
];
for (const file of required) {
  if (fs.existsSync(path.join(ROOT, file))) ok("存在 " + file);
  else fail("缺少 " + file);
}

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
if (/openExternal\(url\)/.test(viewsSource)) ok("站外链接交给系统浏览器");
else fail("views.js 没有站外链接出口");

/* 7. 产品关键约束（0.2.0） */
const passkeySource = read("src/main/passkey-guard.js");
if (/__lgPasskeyGuard/.test(passkeySource) && /allowUntil/.test(passkeySource) && /credentials\.get/.test(passkeySource)) {
  ok("通行密钥守卫存在且需要显式点击");
} else {
  fail("通行密钥守卫不完整");
}
if (/addScriptToEvaluateOnNewDocument/.test(viewsSource) && /runImmediately/.test(viewsSource)) {
  ok("守卫在主世界文档创建前注入");
} else {
  fail("views.js 没有主世界守卫注入");
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
if (/class: \{ label: "课程"/.test(sectionsSource) && /article: \{ label: "文章"/.test(sectionsSource)) {
  ok("侧栏包含课程/文章等内置页面");
} else {
  fail("sections.js 缺少课程或文章板块");
}
if (/resolveRail/.test(sectionsSource) && /custom/.test(sectionsSource)) ok("侧栏支持排序/显隐/自定义");
else fail("sections.js 缺少侧栏定制模型");

const themeSource = read("src/main/theme.js");
if (/accentFill/.test(themeSource) && /onAccent/.test(themeSource)) ok("强调色实心按钮有对比度令牌");
else fail("theme.js 缺少 accentFill/onAccent");

for (const [name, content, needle] of [
  ["壁纸来源", configSource, /wallpaperInterval/],
  ["文件夹轮换", configSource, /wallpaperDir/],
  ["Wallpaper Engine", configSource, /weRoot/],
]) {
  if (needle.test(content)) ok(name + "配置存在");
  else fail(name + "配置缺失");
}

const shellHtml = read("src/renderer/shell/index.html");
if (/rail-jump-input/.test(shellHtml) && /id="library"/.test(shellHtml)) ok("外壳包含题号跳转与原生列表容器");
else fail("外壳缺少题号跳转或列表容器");
const settingsHtml = read("src/renderer/settings/index.html");
if (/data-sec="wallpaper"/.test(settingsHtml) && /data-sec="rail"/.test(settingsHtml) && /id="wp-we-list"/.test(settingsHtml)) {
  ok("设置包含壁纸与侧边栏分区");
} else {
  fail("设置缺少壁纸/侧边栏分区");
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

const ipcSrc = read("src/main/ipc.js");
for (const [name, needle] of [
  ["状态含在线状态", /online: ctx\.luogu\.online/],
  ["状态含队列", /queue: ctx\.luogu\.queueState/],
  ["断网入队", /enqueueSubmit\(pid, code, lang, "当前离线"\)/],
  ["网络失败入队", /enqueueSubmit\(pid, code, lang, "网络未就绪"\)/],
]) {
  if (needle.test(ipcSrc)) ok("ipc.js " + name);
  else fail("ipc.js 缺少" + name);
}

const editorSrc = read("src/renderer/shell/editor.js");
if (/loadDraft/.test(editorSrc) && /saveDraft/.test(editorSrc) && /已恢复上次草稿/.test(editorSrc)) {
  ok("编辑器草稿恢复与防抖保存");
} else {
  fail("编辑器缺少草稿持久化");
}

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
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bigDir, { recursive: true, force: true });
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
if (/94 - material \* 0\.2/.test(themeSource) && /99 - material \* 0\.08/.test(themeSource)) {
  ok("内容面不透明度下限 >= 91%");
} else {
  fail("material 公式仍会让正文过度透明");
}

const shellCss = read("src/renderer/shell/shell.css");
const baseCss = read("src/renderer/shared/base.css");
for (const [name, needle] of [
  ["208px 侧栏", /--sidebar-w/],
  ["文字导航", /\.rail-label/],
  ["统一卡片", /\.card \{/],
  ["2px 焦点环", /outline: 2px solid var\(--accent\)/],
  ["减弱动效", /prefers-reduced-motion/],
]) {
  if (needle.test(shellCss) || needle.test(baseCss)) ok("shell.css/base.css " + name);
  else fail("shell.css/base.css 缺少" + name);
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
  ["学习概览", /buildStats/],
  ["热力图图例", /heat-legend/],
  ["空寄语不渲染", /if \(home\.quote\)/],
]) {
  if (needle.test(homeSrc2)) ok("home.js " + name);
  else fail("home.js 缺少" + name);
}

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
  ["2px 焦点环", /outline: 2px solid var\(--lg-accent\)/],
]) {
  if (needle.test(skinSrc)) ok("luogu-skin.css " + name);
  else fail("luogu-skin.css 缺少" + name);
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

let pkgVersion = "";
try {
  pkgVersion = JSON.parse(read("package.json")).version || "";
} catch {
  /* 已在上面报错 */
}
if (pkgVersion === "0.4.0") ok("版本号 0.4.0");
else fail("package.json 版本号不是 0.4.0（当前 " + pkgVersion + "）");

console.log("");
console.log(`check: ${checks} 项通过, ${failures} 项失败`);
process.exit(failures ? 1 : 0);
