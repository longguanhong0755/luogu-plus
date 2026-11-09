/* 侧栏行为冒烟：步骤按主题拆在 rail/ 下，调用顺序与日志语义与原实现一致。 */
const { runHomeCases } = require("./home");
const { runHomePanelCases } = require("./home-panels");
const { runLayoutCases } = require("./layout");
const { runGeometryCases } = require("./geometry");
const { runTooltipCases } = require("./tooltip");
const { runFocusCases } = require("./focus");
const { runActiveCases } = require("./active");
const { runCustomCases } = require("./custom");
const { runJumpCases } = require("./jump");
const { runSearchCases } = require("./search");
const { runLiveCases } = require("./live");
const { runDetectCases } = require("./detect");
const { runSettingsImportCases, runHomeCompatCases } = require("./settings-home");
const { runStabilityCases } = require("./stability");

async function runRailSmoke(ctx, wait, shot, shotView) {
  const shell = (expression) => ctx.win.webContents.executeJavaScript(expression);
  const waitFor = async (probe, timeout = 2200, interval = 30) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await probe()) return true;
      } catch {}
      await wait(interval);
    }
    return false;
  };
  const approx = (actual, expected, tolerance = 1) =>
    Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= tolerance;
  const results = [];
  const addCase = (name, details, checks) => {
    const ok = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
    const entry = { name, ok, checks, details };
    results.push(entry);
    console.log("SMOKE_RAIL_CASE " + JSON.stringify(entry));
    return ok;
  };
  const originalRail = JSON.parse(JSON.stringify(ctx.cfg.get().rail));
  const originalPerformance = !!ctx.cfg.get().general.performanceMode;
  const originalBounds = ctx.win.getContentBounds();
  const tools = { ctx, wait, shot, shotView, shell, waitFor, approx, addCase, results, originalBounds };
  tools.focusCleanup = () => {};

  try {
    await runHomeCases(tools);
    await runHomePanelCases(tools);
    await runLayoutCases(tools);
    const pageEntry = await runGeometryCases(tools);
    await runTooltipCases(tools, pageEntry);
    await runFocusCases(tools, pageEntry);
    await runActiveCases(tools);
    await runCustomCases(tools);
    await runJumpCases(tools);
    await runSearchCases(tools);
    await runLiveCases(tools);
    await runDetectCases(tools);
    await runSettingsImportCases(tools);
    await runHomeCompatCases(tools);
    await runStabilityCases(tools);
  } finally {
    tools.focusCleanup();
    try {
      ctx.cfg.setRail(originalRail);
      ctx.cfg.setGeneral({ performanceMode: originalPerformance });
      await ctx.refreshAppearance({ reschedule: false });
      ctx.views.setRailPinned(!!originalRail.pinned);
      ctx.win.setContentSize(originalBounds.width, originalBounds.height);
      ctx.views.showHome();
      ctx.broadcastState();
      await wait(260);
    } catch (err) {
      console.log("SMOKE_FAIL 侧栏探针恢复失败: " + err.message);
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log("SMOKE_RAIL_SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((entry) => entry.name) }));
  if (!results.length || failed.length) {
    console.log("SMOKE_FAIL 侧栏行为探针: " + (failed.map((entry) => entry.name).join(", ") || "no-cases"));
  }
}

module.exports = { runRailSmoke };
