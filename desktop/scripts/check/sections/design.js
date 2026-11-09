/* 4.0 设计系统契约、材质、广告拦截、遮罩（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function design(ctx) {
  const { ok, fail, read, ROOT, fs, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { configSource, ipcSource, settingsHtml, themeSource, viewsSource } = store;
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

  /* 后续段落复用的中间变量 */
  Object.assign(store, { fitBoundsToArea, material, materialSource, shellCss, tokensSrc });
};
