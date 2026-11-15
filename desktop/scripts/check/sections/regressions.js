/* R92 七个回归契约、R93 外观一致性（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function regressions(ctx) {
  const { ok, fail, read } = ctx;
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
  /buildFortunePanel/.test(r92Home) &&
  /normalizeFortune/.test(r92Home) &&
  /punch-result/.test(r92Home) &&
  /punch-cols/.test(r92Home) &&
  /punch-checkin/.test(r92Home) &&
  /fortuneText\(fortune\)/.test(r92Home) &&
  /actions\.checkin\(\)/.test(r92Home) &&
  /official\.fortune/.test(r92Home) &&
  !/function openFortuneDialog/.test(r92Home) &&
  !/DAILY_FORTUNES/.test(r92Home)
) {
  ok("R92 完整运势直接内联显示，签到与抽签最多一个按钮且无确认弹窗");
} else {
  fail("R92 主页完整运势内联链路不完整");
}
const r92Official = read("src/main/luogu/official.js");
if (/tasklist-item/.test(r92Official) && /items: taskItems/.test(r92Official) && /slice\(0, 40\)/.test(r92Official) && /tasks: taskPlan/.test(r92Official)) {
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
  /chart-empty/.test(r92Home) &&
  /home-empty-note/.test(r92Home) &&
  /if \(main\.childElementCount\) grid\.appendChild\(main\)/.test(r92Home) &&
  /if \(side\.childElementCount\) grid\.appendChild\(side\)/.test(r92Home) &&
  /grid\.childElementCount === 1/.test(r92Home) &&
  /\.home-grid\.single/.test(r92Shell)
) {
  ok("首页空数据保留空态卡与单列布局，空侧栏不会留下空白区域");
} else {
  fail("首页空数据图表、重复任务或空列仍有缺口");
}
if (
  /function buildChartCard/.test(r92Home) &&
  /home-chart-card/.test(r92Home) &&
  /chart-pane/.test(r92Home) &&
  /chart-svg/.test(r92Home) &&
  /Array\.isArray\(official\.charts\)/.test(r92Home) &&
  /chart-empty/.test(r92Home) &&
  /--home-chart-blue/.test(r92Shell) &&
  /\.chart-svg/.test(r92Shell)
) {
  ok("首页双联通过曲线始终渲染，空数据保留提示而非整卡消失");
} else {
  fail("首页累计通过折线图缺失或空数据会被隐藏");
}
if (
  /buildFortunePanel/.test(r92Home) &&
  /punch-result/.test(r92Home) &&
  /punch-result lg-punch-result lg-fg-red/.test(r92Home) &&
  /lg-fg-red lg-bold/.test(r92Home) &&
  /诸事不宜/.test(r92Home) &&
  /点击打卡/.test(r92Home) &&
  /punch-cols/.test(r92Home) &&
  /punch-streak/.test(r92Home) &&
  /\.punch-result \{[\s\S]*?font-size: 46px;[\s\S]*?line-height: 1\.3;/.test(r92Shell) &&
  /\.punch-col:first-child \{ color: var\(--home-green\); \}/.test(r92Shell) &&
  /\.punch-streak strong \{ color: var\(--text\); font-weight: 600; \}/.test(r92Shell)
) {
  ok("运势面板按官网真实结构、红色结果字与宜忌双栏复刻");
} else {
  fail("运势面板未按洛谷官网真实结构/计算样式复刻");
}
if (
  /home-stat-grid/.test(r92Home) &&
  /buildQuickJump/.test(r92Home) &&
  /buildChartCard/.test(r92Home) &&
  /home-chart-card/.test(r92Home) &&
  /--home-chart-blue/.test(r92Shell) &&
  /\.home-stat-grid \{ display: flex; align-items: stretch; gap: 10px; \}/.test(r92Shell) &&
  /\.home-jump-card \{[\s\S]*?height: 190px/.test(r92Shell)
) {
  ok("主页统计行按官方 25/75 栅格，跳转卡与双曲线同高 190px");
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
  /feat-home-contest/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-announcement/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-tasks/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-community/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-feed-compose/.test(read("src/renderer/settings/index.html")) &&
  /feat-home-feed-empty/.test(read("src/renderer/settings/index.html")) &&
  !/feat-home-countdown|feat-home-progress|feat-home-recent|feat-home-heat|feat-home-first-run/.test(read("src/renderer/settings/index.html"))
) {
  ok("近期比赛/本站公告/任务计划/最近讨论/动态发布/动态空态均可独立显隐");
} else {
  fail("主页板块独立显隐不完整");
}
};
