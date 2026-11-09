/* 侧栏冒烟：打卡按钮 / 首页图表 / 官方任务 / 官方板块。 */

async function runHomePanelCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  const drawnHomeBackup = JSON.parse(JSON.stringify(ctx.luogu.home));
  ctx.luogu.home.official.fortune = null;
  ctx.luogu.home.punched = false;
  ctx.views.showHome();
  await wait(320);
  const fortuneButton = await shell(`(() => {
    const button = document.querySelector(".home-fortune-panel .home-today-btn.daily");
    if (!button) return null;
    const style = getComputedStyle(button);
    return {
      text: button.innerText.trim(),
      display: style.display,
      fontSize: parseFloat(style.fontSize) || 0,
      lineHeight: parseFloat(style.lineHeight) || 0,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      borderTopWidth: parseFloat(style.borderTopWidth) || 0,
      borderRadius: parseFloat(style.borderRadius) || 0,
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
      color: style.color,
      count: document.querySelectorAll(".home-fortune-panel .home-today-btn.daily").length,
      calendar: !!document.querySelector(".home-fortune-panel .home-fortune-calendar"),
      calendarBig: (document.querySelector(".home-fortune-panel .lg-punch-big") || {}).innerText || "",
      calendarSmallCount: document.querySelectorAll(".home-fortune-panel .lg-punch-small").length,
      countdownDays: document.querySelectorAll(".home-fortune-panel .am-u-sm-12.lg-small strong").length,
    };
  })()`);
  await shot("fortune-button", ctx.win);
  ctx.luogu.home = drawnHomeBackup;
  ctx.views.showHome();
  await wait(320);
  addCase(
    "home-fortune-button-official",
    { fortuneButton },
    {
      oneButton: !!fortuneButton && fortuneButton.count === 1,
      copy: !!fortuneButton && fortuneButton.text === "点击打卡",
      amazeGeometry: !!fortuneButton &&
        fortuneButton.display === "inline-block" &&
        Math.abs(fortuneButton.fontSize - 14) < 1 &&
        Math.abs(fortuneButton.lineHeight - 16.8) < 0.2 &&
        Math.abs(fortuneButton.paddingTop - 7) < 1 &&
        Math.abs(fortuneButton.paddingRight - 14) < 1 &&
        Math.abs(fortuneButton.borderTopWidth - 1) < 1 &&
        Math.abs(fortuneButton.borderRadius) < 1,
      amazeDanger: !!fortuneButton &&
        fortuneButton.background === "rgb(221, 81, 76)" &&
        fortuneButton.borderColor === "rgb(221, 81, 76)" &&
        fortuneButton.color === "rgb(255, 255, 255)",
      officialCalendar: !!fortuneButton &&
        fortuneButton.calendar &&
        /^\d{2}$/.test(fortuneButton.calendarBig) &&
        fortuneButton.calendarSmallCount === 2 &&
        fortuneButton.countdownDays >= 2,
    }
  );

  const homeCharts = await shell(`(() => {
    const heat = document.querySelector(".heat-map-wrapper .heat-map");
    const trend = document.querySelector(".home-trend-card");
    const svg = document.querySelector(".trend-chart-svg");
    const line = document.querySelector(".trend-line");
    const heatRect = heat ? heat.getBoundingClientRect() : null;
    const trendRect = trend ? trend.getBoundingClientRect() : null;
    return {
      heatCells: document.querySelectorAll(".heat-map-wrapper .heat-map-cell").length,
      heatVisible: !!heatRect && heatRect.width > 300 && heatRect.height > 100,
      heatLegend: !!document.querySelector(".heat-map-legend"),
      trendVisible: !!trendRect && trendRect.width > 300 && trendRect.height > 140,
      trendSvg: !!svg && svg.tagName.toLowerCase() === "svg",
      trendLine: !!line && String(line.getAttribute("d") || "").length > 20,
      trendPoints: document.querySelectorAll(".trend-point").length,
      trendLabel: (document.querySelector(".trend-summary-label") || {}).textContent || "",
      trendValue: (document.querySelector(".trend-summary-value") || {}).textContent || "",
    };
  })()`);
  addCase(
    "home-charts",
    { homeCharts },
    {
      completeHeatGrid: homeCharts.heatCells === 26 * 7 && homeCharts.heatVisible && homeCharts.heatLegend,
      cumulativeCurve: homeCharts.trendVisible && homeCharts.trendSvg && homeCharts.trendLine && homeCharts.trendPoints === 30,
      curveSource: /累计通过/.test(homeCharts.trendLabel) && Number(homeCharts.trendValue) >= 0,
    }
  );

  const taskDom = await shell(`(() => {
    const card = document.querySelector(".tasks-card");
    return {
      exists: !!card,
      rows: document.querySelectorAll(".tasks-card .task-plan-row").length,
      uniqueTitles: new Set(Array.from(document.querySelectorAll(".tasks-card .task-title")).map((node) => node.textContent.trim())).size,
      text: card ? card.innerText : "",
    };
  })()`);
  addCase(
    "official-task-list",
    { taskDom },
    {
      rendered: process.env.LG_SMOKE_NET === "1" || (taskDom.exists && taskDom.rows >= 3),
      fullItems: process.env.LG_SMOKE_NET === "1" || (/每日一题/.test(taskDom.text) && /训练题单/.test(taskDom.text) && /比赛/.test(taskDom.text)),
      noDuplicateRows: process.env.LG_SMOKE_NET === "1" || taskDom.rows === taskDom.uniqueTitles,
    }
  );


  const officialSections = await shell(`(() => ({
    quickJump: !!document.querySelector(".quick-jump-card"),
    progress: !!document.querySelector(".official-profile-card .official-profile-stats"),
    recent: !!document.querySelector(".list-card"),
    linkGroups: document.querySelectorAll(".links-card .link-group").length,
    links: document.querySelectorAll(".links-card .link-item").length,
    announcement: !!document.querySelector(".announcement-card"),
    community: !!document.querySelector(".community-card")
  }))()`);
  addCase(
    "official-home-sections",
    { officialSections },
    {
      problemJump: officialSections.quickJump,
      cumulativeProgress: process.env.LG_SMOKE_NET === "1" || officialSections.progress,
      recentSubmissionsKept: process.env.LG_SMOKE_NET === "1" || officialSections.recent,
      fullFriendLinks: officialSections.linkGroups >= 3 && officialSections.links >= 9,
      announcementsAndCommunity: officialSections.announcement && officialSections.community,
    }
  );
}

module.exports = { runHomePanelCases };
