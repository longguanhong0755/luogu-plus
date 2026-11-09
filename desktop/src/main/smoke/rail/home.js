/* 侧栏冒烟：环境隔离 / 单侧栏 / 首页层级 / 首页今日动作。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

async function runHomeCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.views.showHome();
  ctx.views.setRailPinned(false);
  await wait(260);

  const userData = path.resolve(app.getPath("userData"));
  const forbiddenProfiles = [
    path.resolve(app.getPath("appData"), "LuoguLab"),
    path.resolve(app.getPath("appData"), "Luogu Desktop"),
  ];
  addCase(
    "isolated-user-data",
    { userData, smoke: process.env.LG_SMOKE, forbiddenProfiles },
    {
      smokeMode: process.env.LG_SMOKE === "1",
      notProductionProfile: !forbiddenProfiles.includes(userData),
      profilePresent: fs.existsSync(userData),
    }
  );

  const singleDom = await shell(`(() => ({
    railCount: document.querySelectorAll("#rail").length,
    oldOverlayCount: document.querySelectorAll("#rail-overlay, .rail-overlay").length,
    railTopCount: document.querySelectorAll("#rail-top").length,
    railBottomCount: document.querySelectorAll("#rail-bottom").length
  }))()`);
  addCase(
    "single-render",
    Object.assign({}, singleDom, {
      railOverlayApi: ctx.views.railOverlay === undefined,
      railWebContentsApi: ctx.views.railWebContents === undefined,
    }),
    {
      oneRail: singleDom.railCount === 1,
      oneTop: singleDom.railTopCount === 1,
      oneBottom: singleDom.railBottomCount === 1,
      noOverlayDom: singleDom.oldOverlayCount === 0,
      noOverlayApi: ctx.views.railOverlay === undefined && ctx.views.railWebContents === undefined,
    }
  );

  const homeDaily = await shell(`(() => {
    const daily = document.querySelector(".home-daily");
    const name = (window.lg.getState().user || {}).name || "";
    const text = daily ? daily.innerText : "";
    const fortune = document.querySelector(".home-fortune-panel");
    const refresh = document.querySelector(".home-refresh");
    const meta = document.querySelector(".home-meta");
    return {
      greetingCount: document.querySelectorAll(".home-greeting").length,
      dateCount: document.querySelectorAll(".home-date").length,
      countdownCount: document.querySelectorAll(".home-countdown").length,
      fortuneCount: document.querySelectorAll(".home-fortune-panel").length,
      refreshCount: document.querySelectorAll(".home-refresh").length,
      mainCount: document.querySelectorAll(".home-daily-main").length,
      greetingRowCount: document.querySelectorAll(".home-greeting-row").length,
      legacySideCount: document.querySelectorAll(".home-daily-side").length,
      refreshInHeading: !!refresh && !!refresh.closest(".home-greeting-row"),
      countdownsInMeta: document.querySelectorAll(".home-countdown").length > 0 && !!meta && !!meta.querySelector(".home-countdowns"),
      nameCount: name ? text.split(name).length - 1 : 0,
      legacyCard: !!document.querySelector(".welcome-card"),
      fortuneContaminated: !!fortune && /(距|还剩|星期)/.test(fortune.innerText || "")
    };
  })()`);
  addCase(
    "home-daily-hierarchy",
    { homeDaily },
    {
      singleGreeting: homeDaily.greetingCount === 1,
      singleDate: homeDaily.dateCount === 1,
      singleMain: homeDaily.mainCount === 1 && homeDaily.greetingRowCount === 1,
      stableRefresh: homeDaily.refreshCount === 1 && homeDaily.refreshInHeading,
      countdownsInHeader: process.env.LG_SMOKE_NET === "1" || (homeDaily.countdownCount > 0 && homeDaily.countdownsInMeta),
      noLegacySide: homeDaily.legacySideCount === 0,
      noLegacyCard: homeDaily.legacyCard === false,
      structuredFortune: homeDaily.fortuneContaminated === false,
    }
  );

  const today = await shell(`(() => {
    const panel = document.querySelector(".home-fortune-panel");
    const content = document.querySelector(".home-fortune-panel");
    const action = document.querySelector(".home-today-btn.daily");
    const style = panel ? getComputedStyle(panel) : null;
    return {
      panel: !!panel,
      drawn: !!panel && panel.classList.contains("drawn"),
      fortuneText: content ? content.innerText : "",
      fortuneVisible: !!panel && !!style && style.display !== "none" && style.visibility !== "hidden",
      actionCount: document.querySelectorAll(".home-today-btn.daily").length,
      visibleActionCount: Array.from(document.querySelectorAll(".home-today-btn.daily")).filter((node) => !node.hidden).length,
      signCount: document.querySelectorAll(".home-today-btn.sign").length,
      fortuneCount: document.querySelectorAll(".home-today-btn.fortune").length,
      legacySignCount: document.querySelectorAll(".sign-card").length,
      guest: !!action && action.classList.contains("guest"),
      text: action ? action.innerText : "",
      dialogCount: document.querySelectorAll(".fortune-dialog, #fortune-dialog").length,
      officialHeading: !!document.querySelector(".home-fortune-panel h2"),
      officialResult: !!document.querySelector(".home-fortune-panel .lg-punch-result"),
      officialColumn: !!panel && panel.classList.contains("am-u-md-4") && panel.classList.contains("lg-punch"),
      adviceColumns: document.querySelectorAll(".home-fortune-panel .am-u-sm-6").length,
      headingAccountRed: !!document.querySelector(".home-fortune-panel h2 a.lg-fg-red.lg-bold"),
      goodColumnText: (document.querySelector(".home-fortune-panel .am-u-sm-6") || {}).innerText || "",
      badActionCount: (document.querySelectorAll(".home-fortune-panel .am-u-sm-6")[1] || document.createElement("div")).querySelectorAll(".lg-bold").length,
      resultColor: getComputedStyle(document.querySelector(".home-fortune-panel .lg-punch-result") || panel).color,
      panelTextColor: getComputedStyle(panel).color,
      resultFont: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel .lg-punch-result") || panel).fontSize) || 0,
      resultLineHeight: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel .lg-punch-result") || panel).lineHeight) || 0,
      headingFont: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel h2") || panel).fontSize) || 0,
      headingLineHeight: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel h2") || panel).lineHeight) || 0,
      smallFont: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel .lg-small") || panel).fontSize) || 0,
      smallLineHeight: parseFloat(getComputedStyle(document.querySelector(".home-fortune-panel .lg-small") || panel).lineHeight) || 0,
      progressInDaily: !!document.querySelector(".home-daily .official-profile-card"),
      clippedLines: Array.from(document.querySelectorAll(".home-fortune-panel .lg-small")).filter((node) => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1).length,
      localFortuneKeys: Object.keys(localStorage).filter((key) => key.startsWith("lg.daily-fortune.v1:")),
    };
  })()`);
  addCase(
    "home-today-actions",
    { today },
    {
      singleDailyAction: today.actionCount <= 1 && today.signCount === 0 && today.fortuneCount === 0,
      noLegacyAction: today.legacySignCount === 0,
      inlinePanel: today.panel,
      officialOnlyState: today.localFortuneKeys.length === 0,
      inlineFortune: !today.drawn || (
        today.fortuneVisible &&
        /大吉|中吉|小吉|末吉|凶|吉/.test(today.fortuneText) &&
        /(宜|诸事不宜)/.test(today.fortuneText) &&
        /忌/.test(today.fortuneText)
      ),
      officialFortuneLayout: !today.drawn || (
        today.officialHeading &&
        today.officialResult &&
        today.officialColumn &&
        today.adviceColumns === 2 &&
        today.headingAccountRed &&
        /诸事不宜/.test(today.goodColumnText) &&
        today.badActionCount >= 2 &&
        today.resultColor === today.panelTextColor &&
        Math.abs(today.resultFont - 60) < 1 &&
        Math.abs(today.resultLineHeight - 90) < 1 &&
        Math.abs(today.headingFont - 20) < 1 &&
        Math.abs(today.headingLineHeight - 32) < 1 &&
        Math.abs(today.smallFont - 10) < 1 &&
        Math.abs(today.smallLineHeight - 16) < 1 &&
        today.clippedLines === 0
      ),
      noDailyDeadSpace: today.progressInDaily,
      noConfirmationDialog: today.dialogCount === 0,
      actionCopy: today.guest
        ? /登录洛谷/.test(today.text)
        : today.drawn || /签到|运势/.test(today.text),
    }
  );
}

module.exports = { runHomeCases };
