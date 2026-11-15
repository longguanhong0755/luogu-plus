/* 侧栏冒烟：设置导入往返 / 首页兼容开关（plain/smooth/官方板块）。 */

async function runSettingsImportCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
const settingsBackup = ctx.cfg.exportData();
const imported = JSON.parse(JSON.stringify(settingsBackup));
imported.features = Object.assign({}, imported.features, { showUserIntro: true, homeFeedCompose: false });
ctx.cfg.replaceData(imported);
const importedState = ctx.cfg.get();
ctx.cfg.replaceData(settingsBackup);
ctx.views.applyFeatures();
addCase(
  "settings-import-roundtrip",
  { importedFeatures: importedState.features, restoredFeatures: ctx.cfg.get().features },
  {
    importedFlag: importedState.features.showUserIntro === true && importedState.features.homeFeedCompose === false,
    restoredFlag: ctx.cfg.get().features.showUserIntro === settingsBackup.features.showUserIntro,
    restoredHome: ctx.cfg.get().features.homeFeedCompose === settingsBackup.features.homeFeedCompose,
  }
);
}

async function runHomeCompatCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
const homeFeatureBackup = JSON.parse(JSON.stringify(ctx.cfg.get().features));
const sixOff = {
  customSections: true,
  homeContest: false,
  homeAnnouncement: false,
  homeTasks: false,
  homeCommunity: false,
  homeFeedCompose: false,
  homeFeedEmpty: false,
};
ctx.cfg.setFeatures(sixOff);
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const sixHidden = await shell(`(() => ({
  contest: document.querySelectorAll(".home-contest").length,
  contestCard: !!document.querySelector(".contest-card"),
  announcement: !!document.querySelector(".notice-card"),
  tasks: !!document.querySelector(".task-card"),
  discussions: document.querySelectorAll(".discuss-card .disc").length,
  feedCompose: !!document.querySelector(".feed-compose"),
  feedEmpty: !!document.querySelector(".feed-empty"),
  feedTabs: !!document.querySelector(".feed-tabs-card"),
  hero: !!document.querySelector(".welcome-card"),
  quickJump: !!document.querySelector(".home-jump-card"),
}))()`);
ctx.cfg.setFeatures(homeFeatureBackup);
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const sixRestored = await shell(`(() => ({
  contest: document.querySelectorAll(".home-contest").length,
  announcement: !!document.querySelector(".notice-card"),
  tasks: !!document.querySelector(".task-card"),
  discussions: document.querySelectorAll(".discuss-card .disc").length,
  feedCompose: !!document.querySelector(".feed-compose"),
  feedEmpty: !!document.querySelector(".feed-empty"),
  feedTabs: !!document.querySelector(".feed-tabs-card"),
}))()`);
addCase(
  "home-six-section-toggles",
  { sixHidden, sixRestored },
  {
    hiddenIndependently: !sixHidden.contestCard && sixHidden.contest === 0 && !sixHidden.announcement &&
      !sixHidden.tasks && sixHidden.discussions === 0 && !sixHidden.feedCompose && !sixHidden.feedEmpty && !sixHidden.feedTabs,
    unrelatedKept: sixHidden.hero && sixHidden.quickJump,
    restored: sixRestored.contest >= 2 && sixRestored.announcement && sixRestored.tasks &&
      sixRestored.discussions >= 2 && sixRestored.feedCompose && sixRestored.feedEmpty && sixRestored.feedTabs,
  }
);

ctx.cfg.setFeatures({ beautifyUI: false, smoothHome: false, homeAnnouncement: false, homeTasks: false, homeLinks: false, homeCommunity: false });
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const homeCompatOff = await shell(`(() => {
  const root = document.getElementById("home");
  return {
    plain: root.classList.contains("plain-home"),
    smooth: root.classList.contains("smooth-home"),
    announcement: !!document.querySelector(".notice-card"),
    tasks: !!document.querySelector(".task-card"),
    links: !!document.querySelector(".links-card"),
    community: !!document.querySelector(".discuss-card"),
  };
})()`);
ctx.cfg.setFeatures(Object.assign({}, homeFeatureBackup, { homeAnnouncement: true }));
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const homeCompatOn = await shell(`(async () => {
  const root = document.getElementById("home");
  const state = await window.lg.getState();
  return {
    plain: root.classList.contains("plain-home"),
    smooth: root.classList.contains("smooth-home"),
    announcement: !!document.querySelector(".notice-card"),
    feature: !!(state.features && state.features.homeAnnouncement),
    sectionText: String(state.home?.official?.sections?.announcement?.text || "").slice(0, 80),
  };
})()`);
addCase(
  "home-compat-toggles",
  { homeCompatOff, homeCompatOn },
  {
    plainMode: homeCompatOff.plain && !homeCompatOn.plain,
    smoothOff: !homeCompatOff.smooth,
    sectionsHidden: !homeCompatOff.announcement && !homeCompatOff.tasks && !homeCompatOff.links && !homeCompatOff.community,
    sectionsRestored: homeCompatOn.smooth && (process.env.LG_SMOKE_NET === "1" || homeCompatOn.announcement),
  }
);
}

module.exports = { runSettingsImportCases, runHomeCompatCases };
