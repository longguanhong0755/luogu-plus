/* R87 Luogu Plus 功能对齐（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function features(ctx) {
  const { ok, fail, read } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { ipcSource, smoke84, viewsSource } = store;
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
};
