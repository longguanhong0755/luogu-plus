/* 侧栏冒烟：打卡按钮 / 首页双曲线 / 官方任务 / 官方板块。 */

async function runHomePanelCases({ ctx, wait, shot, shell, addCase }) {
  const drawnHomeBackup = JSON.parse(JSON.stringify(ctx.luogu.home));
  ctx.luogu.home.official.fortune = null;
  ctx.luogu.home.punched = false;
  ctx.views.showHome();
  await wait(320);
  const fortuneButton = await shell(`(() => {
    const button = document.querySelector(".home-punch .punch-checkin");
    if (!button) return null;
    const style = getComputedStyle(button);
    return {
      text: button.innerText.trim(),
      display: style.display,
      height: parseFloat(style.height) || 0,
      fontSize: parseFloat(style.fontSize) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      borderTopWidth: parseFloat(style.borderTopWidth) || 0,
      borderRadius: parseFloat(style.borderRadius) || 0,
      background: style.backgroundColor,
      color: style.color,
      count: document.querySelectorAll(".home-punch .punch-checkin").length,
      calendar: !!document.querySelector(".home-punch .punch-calendar"),
      calendarDay: (document.querySelector(".home-punch .punch-calendar-day") || {}).innerText || "",
      calendarParts: document.querySelectorAll(".home-punch .punch-calendar > span").length,
      countdownDays: document.querySelectorAll(".home-punch .punch-countdown strong").length,
    };
  })()`);
  await shot("fortune-button", ctx.win);
  addCase(
    "home-fortune-button-official",
    { fortuneButton },
    {
      oneButton: !!fortuneButton && fortuneButton.count === 1,
      copy: !!fortuneButton && fortuneButton.text === "点击打卡",
      amazeGeometry: !!fortuneButton &&
        fortuneButton.display === "inline-block" &&
        Math.abs(fortuneButton.height - 34) < 1 &&
        Math.abs(fortuneButton.fontSize - 13) < 1 &&
        Math.abs(fortuneButton.paddingRight - 20) < 1 &&
        Math.abs(fortuneButton.borderTopWidth) < 1 &&
        Math.abs(fortuneButton.borderRadius - 4) < 1,
      amazeDanger: !!fortuneButton &&
        fortuneButton.background === "rgb(221, 81, 76)" &&
        fortuneButton.color === "rgb(255, 255, 255)",
      officialCalendar: !!fortuneButton &&
        fortuneButton.calendar &&
        /^\d{2}$/.test(fortuneButton.calendarDay) &&
        fortuneButton.calendarParts === 3 &&
        fortuneButton.countdownDays >= 2,
    }
  );

  ctx.views.showHome();
  await wait(420);
  const homeCharts = await shell(`(() => {
    const card = document.querySelector(".home-chart-card");
    const panes = Array.from(document.querySelectorAll(".home-chart-card .chart-pane"));
    const svgs = Array.from(document.querySelectorAll(".home-chart-card .chart-svg"));
    const rect = card ? card.getBoundingClientRect() : null;
    return {
      card: !!card,
      visible: !!rect && rect.width > 500 && rect.height >= 180,
      panes: panes.length,
      svgs: svgs.length,
      svgSizes: svgs.map((node) => {
        const box = node.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      }),
      areas: document.querySelectorAll(".home-chart-card .chart-svg path").length,
      bars: document.querySelectorAll(".home-chart-card .chart-svg rect").length,
      points: document.querySelectorAll(".home-chart-card .chart-svg circle").length,
      titles: Array.from(document.querySelectorAll(".home-chart-card .chart-svg text")).map((node) => node.textContent),
      tips: document.querySelectorAll(".home-chart-card .chart-tip").length,
      empty: !!document.querySelector(".home-chart-card .chart-empty"),
    };
  })()`);
  addCase(
    "home-charts",
    { homeCharts },
    {
      dualPane: homeCharts.card && homeCharts.visible && homeCharts.panes === 2 && homeCharts.svgs === 2,
      officialGeometry: homeCharts.svgSizes.length === 2 && homeCharts.svgSizes.every((item) => item.width > 300 && item.height === 180),
      curvesAndBars: homeCharts.areas >= 4 && homeCharts.bars >= 10 && homeCharts.points >= 10,
      axisTitles: homeCharts.titles.includes("累积通过") && homeCharts.titles.includes("新通过"),
      emptyFallback: !homeCharts.empty && homeCharts.tips === 2,
    }
  );

  const taskDom = await shell(`(() => {
    const card = document.querySelector(".task-card");
    return {
      exists: !!card,
      rows: document.querySelectorAll(".task-card .tasklist-item").length,
      states: document.querySelectorAll(".task-card .task-state").length,
      uniqueTitles: new Set(Array.from(document.querySelectorAll(".task-card .task-item-link")).map((node) => node.textContent.trim())).size,
      text: card ? card.innerText : "",
    };
  })()`);
  addCase(
    "official-task-list",
    { taskDom },
    {
      rendered: taskDom.exists && taskDom.rows >= 3 && taskDom.states === taskDom.rows,
      fullItems: /每日一题/.test(taskDom.text) && /训练题单/.test(taskDom.text) && /比赛/.test(taskDom.text),
      noDuplicateRows: taskDom.rows === taskDom.uniqueTitles,
    }
  );

  const officialSections = await shell(`(() => ({
    hero: !!document.querySelector(".home-top-card .welcome-card"),
    fortune: !!document.querySelector(".home-punch"),
    quickJump: !!document.querySelector(".home-jump-card"),
    contests: document.querySelectorAll(".home-contest").length,
    discussions: document.querySelectorAll(".discuss-card .disc").length,
    feedCompose: !!document.querySelector(".feed-compose"),
    feedEmpty: !!document.querySelector(".feed-empty"),
    tasks: !!document.querySelector(".task-card"),
    announcement: !!document.querySelector(".notice-card"),
    links: !!document.querySelector(".links-card"),
    footer: !!document.querySelector(".lg-footer"),
  }))()`);
  addCase(
    "official-home-sections",
    { officialSections },
    {
      heroAndFortune: officialSections.hero && officialSections.fortune,
      problemJump: officialSections.quickJump,
      contestsAndDiscussions: officialSections.contests >= 2 && officialSections.discussions >= 2,
      feedBlocks: officialSections.feedCompose && officialSections.feedEmpty,
      announcementsAndCommunity: officialSections.announcement && officialSections.tasks && officialSections.links,
      officialFooter: officialSections.footer,
    }
  );

  ctx.luogu.home = drawnHomeBackup;
  ctx.views.showHome();
  await wait(240);
}

module.exports = { runHomePanelCases };
