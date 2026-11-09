/* R75/R73 发布口径与打包、R86 开发态热加载（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function release(ctx) {
  const { ok, fail, read, ROOT, fs, path, scriptsDir } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { idx72, smoke74, views70 } = store;
/* ---------- R75 四轮评审整改（裁决洞/零阈值门禁/白名单锚定/CHANGELOG 纪律） ---------- */
const smokeLauncher = fs.readFileSync(path.join(scriptsDir, "smoke.js"), "utf8");
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
const packPs1 = fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8");
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
if (/ICON-KEEP icon\.ico/.test(fs.readFileSync(path.join(scriptsDir, "pack-ico.js"), "utf8"))) ok("R73 pack-ico 覆盖守卫");
else fail("R73 pack-ico 缺覆盖守卫");
if (/SMOKE_OK/.test(packPs1) && /pack-smoke\.log/.test(packPs1)) ok("R73 打包内建冒烟+证据落盘");
else fail("R73 打包缺内建冒烟");
if (/Remove-Item \(Join-Path \$appDir "src\\main\\smoke"\) -Recurse/.test(packPs1) && /Test-Path \(Join-Path \$appDir "src\\main\\smoke"\)\)/.test(packPs1)) ok("R96 出包剥离清单覆盖探针目录 src/main/smoke/**");
else fail("出包剥离清单仍只删 smoke.js，探针目录会被打进便携包");
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

const { classifyChange } = require(path.join(scriptsDir, "dev.js"));
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
};
