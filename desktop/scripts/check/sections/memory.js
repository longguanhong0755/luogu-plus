/* R90 稳定性、可读性与资源占用（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function memory(ctx) {
  const { ok, fail, read } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { shellCss, shellJsSource, viewsSource } = store;
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
};
