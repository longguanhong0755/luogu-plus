/* 侧栏冒烟：设置导入往返 / 首页兼容开关（plain/smooth/官方板块）。 */

async function runSettingsImportCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
const settingsBackup = ctx.cfg.exportData();
const imported = JSON.parse(JSON.stringify(settingsBackup));
imported.features = Object.assign({}, imported.features, { showUserIntro: true, homeRecent: false });
ctx.cfg.replaceData(imported);
const importedState = ctx.cfg.get();
ctx.cfg.replaceData(settingsBackup);
ctx.views.applyFeatures();
addCase(
  "settings-import-roundtrip",
  { importedFeatures: importedState.features, restoredFeatures: ctx.cfg.get().features },
  {
    importedFlag: importedState.features.showUserIntro === true && importedState.features.homeRecent === false,
    restoredFlag: ctx.cfg.get().features.showUserIntro === settingsBackup.features.showUserIntro,
    restoredHome: ctx.cfg.get().features.homeRecent === settingsBackup.features.homeRecent,
  }
);
}

async function runHomeCompatCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
const homeFeatureBackup = JSON.parse(JSON.stringify(ctx.cfg.get().features));
ctx.cfg.setFeatures({ beautifyUI: false, smoothHome: false, homeAnnouncement: false, homeTasks: false, homeLinks: false, homeCommunity: false });
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const homeCompatOff = await shell(`(() => {
  const root = document.getElementById("home");
  return {
    plain: root.classList.contains("plain-home"),
    smooth: root.classList.contains("smooth-home"),
    announcement: !!document.querySelector(".announcement-card"),
    tasks: !!document.querySelector(".tasks-card"),
    links: !!document.querySelector(".links-card"),
    community: !!document.querySelector(".community-card"),
  };
})()`);
ctx.cfg.setFeatures(Object.assign({}, homeFeatureBackup, { homeAnnouncement: true }));
ctx.views.showHome();
ctx.broadcastState();
await wait(420);
const homeCompatOn = await shell(`(() => {
  const root = document.getElementById("home");
  const state = window.lg.getState();
  return {
    plain: root.classList.contains("plain-home"),
    smooth: root.classList.contains("smooth-home"),
    announcement: !!document.querySelector(".announcement-card"),
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
