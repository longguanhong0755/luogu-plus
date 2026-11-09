/* 快捷键探针：Ctrl+W/Alt+← 与命令面板三项。 */

async function runKeysProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_KEYS === "1") {
    // R60 回归：Ctrl+W 关页面回来源列表、Alt+← 后退——用真实合成键盘事件
    //（键发给当前页面视图的 webContents）。强制离线让页面落 lgoff:// 单条历史，
    // 保证 Alt+← 走 returnLib 分支（联网时页面自身的 SPA 跳转会先吃掉一次后退）。
    if (ctx.luogu.onlineTimer) {
      clearInterval(ctx.luogu.onlineTimer);
      ctx.luogu.onlineTimer = null;
    }
    ctx.luogu.setOnline(false);
    ctx.views.showLibrary("problems");
    await wait(400);
    ctx.views.openProblem("P1001");
    await wait(900);
    let pageWc = ctx.views.currentWebContents();
    if (pageWc) pageWc.sendInputEvent({ type: "keyDown", keyCode: "w", modifiers: ["control"] });
    await wait(700);
    const afterClose = ctx.views.currentInfo();
    ctx.views.openProblem("P1001");
    await wait(900);
    pageWc = ctx.views.currentWebContents();
    if (pageWc) pageWc.sendInputEvent({ type: "keyDown", keyCode: "Left", modifiers: ["alt"] });
    await wait(700);
    const afterBack = ctx.views.currentInfo();
    const keysOk =
      afterClose.kind === "library" &&
      afterClose.library === "problems" &&
      afterBack.kind === "library" &&
      afterBack.library === "problems";
    console.log(
      "SMOKE_KEYS " + JSON.stringify({ afterClose: afterClose.kind, afterBack: afterBack.kind, ok: keysOk })
    );
    if (!keysOk) console.log("SMOKE_FAIL 键盘关闭/后退没有生效");
    ctx.luogu.online = true; // 恢复在线标志（不触发 refresh/flushQueue 副作用）
    ctx.views.showHome();
    await wait(300);
  }
}

async function runPaletteProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_PALETTE === "1") {
    // R61 回归：命令面板含题目直达、已打开页面切换、恢复关闭页面三项
    ctx.views.openProblem("P1001");
    await wait(600);
    const palPid = await ctx.win.webContents.executeJavaScript(`window.lg.palette("P1001")`);
    const palAt = await ctx.win.webContents.executeJavaScript(`window.lg.palette("at_abc123_a")`);
    const palAll = await ctx.win.webContents.executeJavaScript(`window.lg.palette("")`);
    const hasPid = palPid.length && palPid[0].type === "problem" && palPid[0].pid === "P1001";
    const atOk = palAt.length && palAt[0].type === "problem" && palAt[0].pid === "AT_abc123_a";
    const hasReopen = palAll.some((item) => item.id === "reopen");
    const hasPage = palAll.some((item) => item.type === "page" && /P1001/.test(item.key || ""));
    console.log("SMOKE_PALETTE " + JSON.stringify({ hasPid, atOk, hasReopen, hasPage, count: palAll.length }));
    if (!hasPid || !atOk || !hasReopen || !hasPage) console.log("SMOKE_FAIL 命令面板缺项");
    ctx.views.showHome();
    await wait(300);
  }
}

module.exports = { runKeysProbe, runPaletteProbe };
