/* 设置窗探针：材质同步 / 分区 / 任务栏 / 响应式 / 快捷键录制 / 增强面板。 */

async function runSettingsStep({ ctx, wait, shot, shotView, outDir }) {
  ctx.openSettings();
  await wait(1400);
  if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
    ctx.settingsWin.setOpacity(0);
    await shot("settings", ctx.settingsWin);
    if (process.env.LG_SMOKE_DEBUG === "1") {
      const dbg = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
        const box = document.getElementById("wallpaper");
        const layers = box ? [...box.querySelectorAll(".wall-layer")] : [];
        return {
          hasBox: !!box,
          layers: layers.length,
          opacity: layers.map((l) => getComputedStyle(l).opacity),
          bg: layers.map((l) => getComputedStyle(l).backgroundImage.slice(0, 100)),
          htmlBg: getComputedStyle(document.documentElement).backgroundColor,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          appBg: getComputedStyle(document.getElementById("app")).backgroundColor,
          paneBg: getComputedStyle(document.querySelector(".set-pane")).backgroundColor,
          rect: box ? JSON.stringify(box.getBoundingClientRect()) : ""
        };
      })()`);
      console.log("SMOKE_SETTINGS " + JSON.stringify(dbg));
    }
    const originalMaterial = ctx.cfg.get().appearance.material;
    const appearanceSync = await ctx.settingsWin.webContents.executeJavaScript(`(async () => {
      document.querySelector('.snav[data-sec="appearance"]').click();
      const mat = document.getElementById("mat");
      mat.value = "82";
      mat.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 520));
      const settingsRoot = getComputedStyle(document.documentElement);
      return {
        material: window.lgSettings ? (await window.lgSettings.getState()).appearance.material : -1,
        settingsPanel: settingsRoot.getPropertyValue("--panel-alpha").trim(),
        settingsScrim: settingsRoot.getPropertyValue("--page-scrim").trim(),
        settingsMat: settingsRoot.getPropertyValue("--mat").trim(),
        settingsPseudo: getComputedStyle(document.getElementById("wallpaper"), "::after").content,
        paneBg: getComputedStyle(document.querySelector(".set-pane")).backgroundColor
      };
    })()`);
    const shellAppearance = await ctx.win.webContents.executeJavaScript(`(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        panel: root.getPropertyValue("--panel-alpha").trim(),
        scrim: root.getPropertyValue("--page-scrim").trim(),
        mat: root.getPropertyValue("--mat").trim()
      };
    })()`);
    console.log("SMOKE_APPEARANCE_SYNC " + JSON.stringify({ appearanceSync, shellAppearance }));
    const sameAlpha = (a, b) => Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) <= 0.1;
    if (
      appearanceSync.material !== 82 ||
      appearanceSync.settingsMat !== "82" ||
      shellAppearance.mat !== "82" ||
      !sameAlpha(appearanceSync.settingsPanel, shellAppearance.panel) ||
      !sameAlpha(appearanceSync.settingsScrim, shellAppearance.scrim) ||
      !["none", "normal", "auto", ""].includes(appearanceSync.settingsPseudo)
    ) {
      console.error("SMOKE_FAIL settings material not synchronized with shell");
    }
    await ctx.settingsWin.webContents.executeJavaScript(
      `window.lgSettings.setAppearance({ material: ${Number(originalMaterial)} })`
    );
    await wait(260);
    await ctx.settingsWin.webContents.executeJavaScript(
      `document.querySelector('.snav[data-sec="wallpaper"]').click()`
    );
    await wait(900);
    const wallShown = await ctx.settingsWin.webContents.executeJavaScript(
      `!document.querySelector('[data-panel="wallpaper"]').hidden`
    );
    console.log("SMOKE_SETTINGS_SECTION " + wallShown);
    const taskbarPin = await ctx.settingsWin.webContents.executeJavaScript(`window.lgSettings.pinTaskbar()`);
    const taskbarDom = await ctx.settingsWin.webContents.executeJavaScript(`(() => ({
      button: !!document.getElementById("taskbar-pin"),
      status: !!document.getElementById("taskbar-pin-status"),
      accentPicker: !!document.getElementById("accent-custom"),
      accentValue: document.getElementById("accent-value")?.textContent || ""
    }))()`);
    console.log("SMOKE_SETTINGS_TASKBAR " + JSON.stringify({ taskbarPin, taskbarDom }));
    if (!taskbarPin || !taskbarPin.smoke || !taskbarDom.button || !taskbarDom.status || !taskbarDom.accentPicker || !taskbarDom.accentValue) {
      console.error("SMOKE_FAIL settings taskbar/theme controls incomplete");
    }
    const settingsSize = ctx.settingsWin.getContentSize();
    ctx.settingsWin.setContentSize(640, 480);
    await wait(220);
    const settingsRatio = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
      const nav = document.querySelector(".set-nav");
      const pane = document.querySelector(".set-pane");
      const row = document.querySelector(".setting-row");
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollHeight > window.innerHeight + 1,
        navHorizontal: !!nav && nav.getBoundingClientRect().height < 80,
        paneFits: !!pane && pane.getBoundingClientRect().right <= window.innerWidth + 1,
        rowStacked: !!row && getComputedStyle(row).gridTemplateColumns.split(" ").length === 1,
      };
    })()`);
    ctx.settingsWin.setContentSize(settingsSize[0], settingsSize[1]);
    await wait(160);
    console.log("SMOKE_SETTINGS_RATIO " + JSON.stringify(settingsRatio));
    if (settingsRatio.innerWidth !== 640 || settingsRatio.innerHeight !== 480 || settingsRatio.overflow || !settingsRatio.navHorizontal || !settingsRatio.paneFits || !settingsRatio.rowStacked) {
      console.error("SMOKE_FAIL settings responsive ratio");
    }
    await shot("settings-wallpaper", ctx.settingsWin);
    await ctx.settingsWin.webContents.executeJavaScript(
      `document.querySelector('.snav[data-sec="rail"]').click()`
    );
    await wait(400);
    await shot("settings-rail", ctx.settingsWin);
    await ctx.settingsWin.webContents.executeJavaScript(
      `document.querySelector('.snav[data-sec="enhance"]').click()`
    );
    await wait(350);
    await shot("settings-enhance", ctx.settingsWin);
    const originalShortcut = ctx.cfg.get().general.shortcutOpenProblems;
    const shortcutRecorded = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById("shortcut-problems");
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      return input.value;
    })()`);
    await wait(180);
    const shortcutSaved = ctx.cfg.get().general.shortcutOpenProblems;
    await ctx.settingsWin.webContents.executeJavaScript(`document.getElementById("shortcut-reset").click(); true`);
    await wait(180);
    const shortcutReset = ctx.cfg.get().general.shortcutOpenProblems;
    ctx.cfg.setGeneral({ shortcutOpenProblems: originalShortcut });
    console.log("SMOKE_SETTINGS_SHORTCUT " + JSON.stringify({ shortcutRecorded, shortcutSaved, shortcutReset }));
    if (shortcutRecorded !== "Ctrl+Shift+K" || shortcutSaved !== "Ctrl+Shift+K" || shortcutReset !== "Alt+L") {
      console.error("SMOKE_FAIL settings shortcut recorder");
    }        const enhanceSettings = await ctx.settingsWin.webContents.executeJavaScript(`(() => ({
      panelVisible: !document.querySelector('[data-panel="enhance"]').hidden,
      toggles: document.querySelectorAll('[data-panel="enhance"] input[type="checkbox"]').length,
      importButton: !!document.getElementById("settings-import"),
      exportButton: !!document.getElementById("settings-export"),
      resetButton: !!document.getElementById("settings-reset"),
      sectionToggles: ["feat-home-quick-jump", "feat-home-progress", "feat-home-recent"].every((id) => !!document.getElementById(id))
    }))()`);
    console.log("SMOKE_SETTINGS_ENHANCE " + JSON.stringify(enhanceSettings));
    if (!enhanceSettings.panelVisible || enhanceSettings.toggles < 22 || !enhanceSettings.importButton || !enhanceSettings.exportButton || !enhanceSettings.resetButton || !enhanceSettings.sectionToggles) {
      console.error("SMOKE_FAIL settings enhance incomplete");
    }

    if (process.env.LG_SMOKE_VISUAL === "1") {
      for (const sec of ["enhance", "general", "notify", "account", "about"]) {
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="${sec}"]').click()`
        );
        await wait(350);
        await shot("settings-" + sec, ctx.settingsWin);
      }
      const settingsMetrics = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
        const q = (s) => document.querySelector(s);
        const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
        const css = (s) => { const e = q(s); return e ? getComputedStyle(e) : null; };
        return {
          nav: rect(".set-nav"),
          paneMax: css(".set-pane section[data-panel]") ? css(".set-pane section[data-panel]").maxWidth : "",
          groupRadius: css(".settings-group") ? css(".settings-group").borderRadius : "",
          rowH: rect(".setting-row"),
          rangeAppearance: css("#mat") ? css("#mat").appearance : "",
          rangeHeight: rect("#mat"),
          navCurrent: q(".snav[aria-current='page']") ? q(".snav[aria-current='page']").textContent.trim() : ""
        };
      })()`);
      console.log("SMOKE_SETTINGS_METRICS " + JSON.stringify(settingsMetrics));
    }

  }
}

module.exports = { runSettingsStep };
