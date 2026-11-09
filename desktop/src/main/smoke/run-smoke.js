/* 冒烟主流程：只做编排，各模式块在 steps/ 下按原顺序执行。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { createShotTools } = require("./shot");
const { runRailSmoke } = require("./rail");
const { runPageLoadingSmoke } = require("./page-loading");
const { runAudit } = require("./audit");
const { runSkinAudit } = require("./skin-audit");
const { runPreambleStep } = require("./steps/preamble");
const { runPerfStep } = require("./steps/perf");
const { runEnhanceStep } = require("./steps/enhance");
const { runLibraryStep } = require("./steps/library");
const { runListClickProbe, runLangTableProbe, runVisualProbe } = require("./steps/ui-probes");
const { runLuoguPageStep } = require("./steps/luogu-page");
const { runOfflineStep } = require("./steps/offline");
const { runGlassProbe, runAdblockProbe, runHistoryProbe } = require("./steps/shell-probes");
const { runDraftProbe, runToastProbe } = require("./steps/draft-toast");
const { runFindProbe, runSecurityProbe } = require("./steps/behavior-gates");
const { runKeysProbe, runPaletteProbe } = require("./steps/shortcuts");
const { runSettingsStep } = require("./steps/settings");
const { runBudgetChecks, runProcessMetrics } = require("./steps/diagnostics");

async function runSmoke(ctx) {
  const out = process.env.LG_SMOKE_OUT || path.join(app.getPath("userData"), "smoke.png");
  const outDir = path.dirname(out);
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const { shot, shotView, writeManifest } = createShotTools(ctx, outDir, wait);
  const tools = { ctx, wait, shot, shotView, outDir };

  const capture = async () => {
    try {
      await runPreambleStep(tools);
      await runPerfStep(tools);
      // 核心侧栏路径默认必跑；LG_SMOKE_RAIL 不再作为开关。
      await runRailSmoke(ctx, wait, shot, shotView);
      await runPageLoadingSmoke(ctx, wait);
      await runEnhanceStep(tools);
      await runLibraryStep(tools);
      await runListClickProbe(tools);
      await runLangTableProbe(tools);
      await runVisualProbe(tools);
      await runLuoguPageStep(tools);
      await runOfflineStep(tools);
      await runGlassProbe(tools);
      await runAdblockProbe(tools);
      await runHistoryProbe(tools);
      await runDraftProbe(tools);
      await runToastProbe(tools);
      await runFindProbe(tools);
      await runSecurityProbe(tools);
      await runKeysProbe(tools);
      await runPaletteProbe(tools);
      if (process.env.LG_SMOKE_AUDIT === "1") {
        await runAudit(ctx, outDir, wait);
      }
      if (process.env.LG_SMOKE_SKIN_AUDIT === "1") {
        await runSkinAudit(ctx, outDir, wait);
      }
      await runSettingsStep(tools);
    } catch (err) {
      console.error("SMOKE_FAIL " + (err && err.stack ? err.stack : err.message));
    }
    await runBudgetChecks(tools);
    await runProcessMetrics(tools);
    writeManifest();
    app.quitting = true;
    // 冒烟结果与 manifest 已同步落盘。Windows 下 app.quit()/app.exit() 会让
    // 隐藏 WebContentsView 进入异步销毁，偶发卡住或触发合成器访问异常；
    // 测试进程直接 exit(0)，避免把成功结果误报成崩溃（生产退出不走这里）。
    process.exit(0);
  };

  if (ctx.win.webContents.isLoading()) ctx.win.webContents.once("did-finish-load", capture);
  else capture();
}

module.exports = { runSmoke };
