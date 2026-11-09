/* 资源预算与生命周期诊断：视图/存储预算、监听器白名单、进程内存。 */
const { app } = require("electron");

async function runBudgetChecks({ ctx, wait, outDir }) {
  try {
    const viewStats = ctx.views.viewStats();
    const storeStats = ctx.store.stats();
    const lifecycleIdle = Number(process.env.LG_VIEW_IDLE_MS) || 0;
    let lifecycle = null;
    if (lifecycleIdle >= 5000) {
      ctx.views.openProblem("P1001");
      await wait(900);
      ctx.views.openProblem("P1002");
      await wait(900);
      ctx.views.openProblem("P1001");
      await wait(lifecycleIdle + 1800);
      const slept = ctx.views.viewStats();
      const p1002 = ctx.views.entries.get("problem:P1002");
      const sleptUrl = p1002 && p1002.view && !p1002.view.webContents.isDestroyed()
        ? p1002.view.webContents.getURL()
        : "";
      ctx.views.switchTo("problem:P1002");
      await wait(1800);
      const woke = ctx.views.viewStats();
      const wokeUrl = p1002 && p1002.view && !p1002.view.webContents.isDestroyed()
        ? p1002.view.webContents.getURL()
        : "";
      lifecycle = {
        slept: slept.sleeping >= 1,
        blanked: !sleptUrl || sleptUrl === "about:blank",
        woke: woke.sleeping < slept.sleeping || /P1002/i.test(wokeUrl),
        afterSleep: slept,
        afterWake: woke,
        sleptUrl: String(sleptUrl).slice(0, 80),
        wokeUrl: String(wokeUrl).slice(0, 80),
        p1002: p1002 ? { sleeping: p1002.sleeping, pending: p1002.sleepPending, timer: !!p1002.sleepTimer, lastSleep: p1002.lastSleep } : null,
      };
      console.log("SMOKE_VIEW_LIFECYCLE " + JSON.stringify(lifecycle));
      if (!lifecycle.slept || !lifecycle.blanked || !lifecycle.woke) {
        throw new Error("页面视图休眠/恢复失败 " + JSON.stringify(lifecycle));
      }
    }
    let contextDirect = null;
    if (process.env.LG_SMOKE_NET === "1") {
      const beforeContext = ctx.luogu.contextDiagnostics();
      const contest = await ctx.luogu.fetchContext("/contest/list");
      const afterContext = ctx.luogu.contextDiagnostics();
      contextDirect = {
        ok: !!(contest && contest.data),
        before: beforeContext,
        after: afterContext,
        directAdvanced: afterContext.direct > beforeContext.direct,
      };
      console.log("SMOKE_CONTEXT_TRANSPORT " + JSON.stringify(contextDirect));
      if (!contextDirect.ok || !contextDirect.directAdvanced) {
        throw new Error("session.fetch 上下文直连失败 " + JSON.stringify(contextDirect));
      }
    }
    const readinessListeners = (wc) =>
      wc.listeners("did-stop-loading").filter((listener) => {
        try {
          return /readiness\.markDomReady/.test(Function.prototype.toString.call(listener));
        } catch {
          return false;
        }
      }).length;
    const guardChecks = await Promise.all([...ctx.views.entries.entries()].map(async ([key, item]) => {
      try {
        const value = await item.view.webContents.executeJavaScript("window.__lgPasskeyGuard || \"\"", true);
        return { key, ok: value === "blocked", value: String(value || "") };
      } catch (err) {
        return { key, ok: false, value: String(err && err.message || "") };
      }
    }));
    const listenerStats = {
      appDidStopLimit: 1,
      internalDidStopLimit: 24,
      guardChecks,
      views: [...ctx.views.entries.entries()].map(([key, item]) => ({
        key,
        didStop: item.view.webContents.listenerCount("did-stop-loading"),
        appDidStop: readinessListeners(item.view.webContents),
        didFail: item.view.webContents.listenerCount("did-fail-load"),
        domReady: item.view.webContents.listenerCount("dom-ready"),
      })),
      hidden: ctx.luogu.win && !ctx.luogu.win.isDestroyed()
        ? {
            didStop: ctx.luogu.win.webContents.listenerCount("did-stop-loading"),
            didFail: ctx.luogu.win.webContents.listenerCount("did-fail-load"),
          }
        : null,
    };
    console.log("SMOKE_RESOURCE_BUDGETS " + JSON.stringify({ viewStats, storeStats, contextDirect, listenerStats }));
    if (!viewStats || viewStats.limits.total !== 4) throw new Error("页面视图预算未生效");
    if (!guardChecks.length || guardChecks.some((item) => !item.ok)) {
      throw new Error("主世界通行密钥守卫未覆盖全部页面 " + JSON.stringify(guardChecks));
    }
    if (listenerStats.views.some((item) => item.appDidStop !== 1 || item.didStop > listenerStats.internalDidStopLimit)) {
      throw new Error("页面加载监听器超出受限白名单 " + JSON.stringify(listenerStats));
    }
    if (!storeStats || !storeStats.limits || storeStats.limits.diskBytes !== 96 * 1024 * 1024 || storeStats.limits.memoryBytes !== 32 * 1024 * 1024) {
      throw new Error("Store 预算未生效");
    }
  } catch (err) {
    console.error("SMOKE_FAIL " + (err && err.stack ? err.stack : err.message));
  }
}

async function runProcessMetrics({ ctx, wait }) {
  try {
    const appMetrics = app.getAppMetrics().map((item) => ({
      pid: item.pid,
      type: item.type,
      privateMB: Math.round(((item.memory && item.memory.privateBytes) || 0) / 1024 * 10) / 10,
      workingSetMB: Math.round(((item.memory && item.memory.workingSetSize) || 0) / 1024 * 10) / 10,
    }));
    console.log("SMOKE_PROCESS_METRICS " + JSON.stringify({
      processCount: appMetrics.length,
      totalPrivateMB: Math.round(appMetrics.reduce((sum, item) => sum + item.privateMB, 0) * 10) / 10,
      totalWorkingSetMB: Math.round(appMetrics.reduce((sum, item) => sum + item.workingSetMB, 0) * 10) / 10,
      processes: appMetrics,
    }));
  } catch (err) {
    console.log("SMOKE_PROCESS_METRICS_ERROR " + err.message);
  }
}

module.exports = { runBudgetChecks, runProcessMetrics };
