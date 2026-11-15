/* 侧栏冒烟：环境隔离 / 单侧栏 / 官方主页欢迎行 / 运势面板。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

async function runHomeCases({ ctx, wait, shot, shell, addCase, originalBounds }) {
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

  const homeHero = await shell(`(async () => {
    const hero = document.querySelector(".home-top-card");
    const welcome = document.querySelector(".welcome-card");
    const state = await window.lg.getState();
    const name = (state.user || {}).name || "";
    const avatar = document.querySelector(".wc-avatar");
    const avatarStyle = avatar ? getComputedStyle(avatar) : null;
    const buttons = Array.from(document.querySelectorAll(".wc-btn"));
    return {
      heroCount: document.querySelectorAll(".home-top-card").length,
      welcomeCount: document.querySelectorAll(".welcome-card").length,
      nameCount: welcome && name ? welcome.innerText.split(name).length - 1 : 0,
      avatarSize: avatarStyle ? Math.round(parseFloat(avatarStyle.width)) : 0,
      buttonCount: buttons.length,
      buttonTexts: buttons.map((node) => node.innerText.trim()),
      buttonColors: buttons.map((node) => getComputedStyle(node).backgroundColor),
      heroGrid: document.querySelectorAll(".home-hero-grid").length,
      heroMain: document.querySelectorAll(".home-hero-main").length,
      heroSide: document.querySelectorAll(".home-hero-side").length,
      fortuneCount: document.querySelectorAll(".home-punch").length,
      fortuneInHero: !!document.querySelector(".home-top-card .home-punch"),
      legacyDaily: document.querySelectorAll(".home-daily, .home-fortune-panel").length,
      footer: !!document.querySelector(".lg-footer"),
    };
  })()`);
  await shot("home-hero", ctx.win);
  addCase(
    "home-daily-hierarchy",
    { homeHero },
    {
      singleGreeting: homeHero.heroCount === 1 && homeHero.welcomeCount === 1 && homeHero.nameCount === 1,
      officialGrid: homeHero.heroGrid === 1 && homeHero.heroMain === 1 && homeHero.heroSide === 1,
      avatarSize: homeHero.avatarSize === 80,
      threeActions: homeHero.buttonCount === 3 && homeHero.buttonTexts.join("|") === "今日推荐|算法笔记|社区讨论",
      officialButtonColors: homeHero.buttonColors.join("|") === "rgb(74, 123, 217)|rgb(92, 184, 92)|rgb(240, 173, 78)",
      fortuneInline: homeHero.fortuneCount === 1 && homeHero.fortuneInHero,
      noLegacyDaily: homeHero.legacyDaily === 0,
      officialFooter: homeHero.footer,
    }
  );

  const today = await shell(`(() => {
    const panel = document.querySelector(".home-punch");
    const result = document.querySelector(".punch-result");
    const cols = Array.from(document.querySelectorAll(".punch-cols .punch-col"));
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const resultStyle = result ? getComputedStyle(result) : null;
    const text = panel ? panel.innerText : "";
    return {
      panel: !!panel,
      drawn: !!panel && panel.classList.contains("drawn"),
      fortuneText: text,
      fortuneVisible: !!panel && !!panelStyle && panelStyle.display !== "none" && panelStyle.visibility !== "hidden",
      heading: !!document.querySelector(".home-punch h2"),
      accountRed: !!document.querySelector(".home-punch h2 a.lg-fg-red.lg-bold"),
      officialResult: !!result,
      resultFont: resultStyle ? parseFloat(resultStyle.fontSize) || 0 : 0,
      resultLineHeight: resultStyle ? parseFloat(resultStyle.lineHeight) || 0 : 0,
      resultColor: resultStyle ? resultStyle.color : "",
      panelColor: panelStyle ? panelStyle.color : "",
      adviceColumns: cols.length,
      goodColumnText: cols[0] ? cols[0].innerText : "",
      badActionCount: cols[1] ? cols[1].querySelectorAll(".lg-bold").length : 0,
      streak: !!document.querySelector(".home-punch .punch-streak"),
      checkinCount: document.querySelectorAll(".home-punch .punch-checkin").length,
      dialogCount: document.querySelectorAll(".fortune-dialog, #fortune-dialog").length,
      localFortuneKeys: Object.keys(localStorage).filter((key) => key.startsWith("lg.daily-fortune.v1:")),
      clippedLines: Array.from(document.querySelectorAll(".home-punch .lg-small")).filter((node) => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1).length,
      legacyProgress: document.querySelectorAll(".official-profile-card, .heat-map-wrapper, .home-trend-card").length,
    };
  })()`);
  await shot("home-fortune", ctx.win);
  addCase(
    "home-today-actions",
    { today },
    {
      singleDailyAction: today.drawn ? today.checkinCount === 0 : today.checkinCount === 1,
      noLegacyAction: today.legacyProgress === 0,
      inlinePanel: today.fortuneVisible,
      officialOnlyState: today.localFortuneKeys.length === 0,
      inlineFortune: !today.drawn || (
        /大吉|中吉|小吉|末吉|凶|吉/.test(today.fortuneText) &&
        /(宜|诸事不宜)/.test(today.fortuneText) &&
        /忌/.test(today.fortuneText)
      ),
      officialFortuneLayout: !today.drawn || (
        today.heading &&
        today.officialResult &&
        today.accountRed &&
        today.adviceColumns === 2 &&
        /诸事不宜/.test(today.goodColumnText) &&
        today.badActionCount >= 2 &&
        today.resultColor !== today.panelColor &&
        Math.abs(today.resultFont - 46) < 1 &&
        Math.abs(today.resultLineHeight - 59.8) < 1 &&
        today.streak &&
        today.clippedLines === 0
      ),
      noConfirmationDialog: today.dialogCount === 0,
    }
  );
}

module.exports = { runHomeCases };
