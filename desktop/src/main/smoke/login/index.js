/* 真实账号登录测试（LG_SMOKE_LOGIN=<账号文件>）：解析账号 → 登录尝试 → 登录后诊断。 */
const { readLoginAccounts } = require("./accounts");
const { createLoginHelpers } = require("./helpers");
const { runLoginAttempts } = require("./attempts");
const { captureLoginPageEvidence } = require("./evidence");
const { submitDiagnostics } = require("./submit");
const { reportLoginState, reportPunchFailure, reportContestProbes, reportProfileEntry } = require("./report");

async function loginFlow(ctx, wait, outDir) {
  const accounts = readLoginAccounts();
  if (!accounts) return;
  if (!accounts.length) {
    console.log("LGTEST_FAIL 账号文件里没有可用行");
    return;
  }
  console.log("LGTEST 候选账号 " + accounts.length + " 个");

  // 测试期间不弹系统通知
  ctx.cfg.setNotify({ judge: false, contest: false });

  if (process.env.LG_SMOKE_FORCE_LOGIN === "1") {
    try {
      await ctx.luogu.logout();
      console.log("LGTEST 已清除旧会话");
    } catch {
      /* ignore */
    }
  }
  const existing = await ctx.luogu.loginState();
  if (existing.loggedIn) {
    console.log("LGTEST profile 已有登录态 uid=" + existing.uid);
  } else {
    const loggedInState = await runLoginAttempts(ctx, wait, outDir, accounts, createLoginHelpers(ctx, wait, outDir));
    if (!loggedInState) return;
  }

  const state = await ctx.luogu.loginState();
  if (!state || !state.loggedIn) {
    console.log("LGTEST_FAIL 登录未完成");
    return;
  }
  console.log("LGTEST logged-in uid=" + state.uid);

  const punch = await reportLoginState(ctx, wait, outDir, state);
  await captureLoginPageEvidence(ctx, wait, outDir, state);
  await reportPunchFailure(ctx, punch);
  await submitDiagnostics(ctx, wait, outDir);
  await reportContestProbes(ctx);
  await reportProfileEntry(ctx, wait);
}

module.exports = { loginFlow };
