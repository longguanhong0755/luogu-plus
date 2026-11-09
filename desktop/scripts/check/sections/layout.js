/* 单侧栏 / 固定宽度 / active / 键盘 / 性能模式契约（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function layout(ctx) {
  const { ok, fail, read, walk, ROOT, fs, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { configSource, fitBoundsToArea, material, materialSource, sectionsSource, settingsHtml, shellCss, shellHtml, themeSource, tokensSrc, viewsSource } = store;
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

/* 去注释后再数发送点，避免注释/文档字符串冒充实现（R96 拆分后 views 族是目录）。 */
function stripCodeComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const railLayoutSenders = [];
let railLayoutChannelDefs = 0;
for (const file of walk(path.join(ROOT, "src", "main"), []).filter((f) => f.endsWith(".js"))) {
  const text = stripCodeComments(fs.readFileSync(file, "utf8"));
  if (/webContents\.send\(\s*(?:"rail:layout"|RAIL_LAYOUT_CHANNEL)/.test(text)) railLayoutSenders.push(path.relative(ROOT, file).replace(/\\/g, "/"));
  if (/RAIL_LAYOUT_CHANNEL\s*=\s*"rail:layout"/.test(text)) railLayoutChannelDefs++;
}
if (
  railLayoutSenders.length === 1 &&
  /^src\/main\/views(?:\.js$|\/)/.test(railLayoutSenders[0]) &&
  railLayoutChannelDefs === 1 &&
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

  /* 后续段落复用的中间变量 */
  Object.assign(store, { homeSrc2, shellJsSource });
};
