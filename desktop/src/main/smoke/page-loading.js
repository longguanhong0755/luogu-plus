

async function runPageLoadingSmoke(ctx, wait) {
  const results = [];
  const addCase = (name, details, checks) => {
    const ok = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
    const entry = { name, ok, checks, details };
    results.push(entry);
    console.log("SMOKE_PAGE_LOAD_CASE " + JSON.stringify(entry));
    return ok;
  };
  const readSurface = async (entry) => {
    if (!entry || !entry.view || entry.view.webContents.isDestroyed()) return null;
    try {
      return await entry.view.webContents.executeJavaScript(`(() => {
        const host = document.getElementById("lg-boot-skeleton");
        return host ? {
          connected: host.isConnected,
          busy: host.getAttribute("aria-busy"),
          pointer: host.style.pointerEvents,
          opacity: host.style.opacity
        } : { connected: false, busy: "", pointer: "", opacity: "" };
      })()`);
    } catch (err) {
      return { error: err.message };
    }
  };

  try {
    let entry = [...ctx.views.entries.values()].find(
      (item) => item.kind === "problem" && item.view && !item.view.webContents.isDestroyed()
    );
    if (!entry) {
      ctx.views.openProblem("P1001");
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline && !entry) {
        await wait(40);
        entry = ctx.views.currentEntry();
      }
    }
    if (!entry) throw new Error("没有可用的页面视图");
    ctx.views.showEntry(entry);
    await wait(260);
    const url = entry.view.webContents.getURL() || "https://www.luogu.com.cn/problem/P1001";

    entry.readiness.begin(url, "smoke-loading-surface");
    await wait(220);
    const loading = await readSurface(entry);
    addCase(
      "loading-surface-present",
      { state: entry.readiness.state, surface: loading },
      {
        phase: entry.readiness.state.phase === "loading",
        visible: !!loading && loading.connected === true,
        busy: !!loading && loading.busy === "true",
        intercepts: !!loading && loading.pointer === "auto",
      }
    );

    const oldRequest = entry.readiness.state.requestId;
    entry.readiness.begin(url + "#smoke-newer", "smoke-newer-navigation");
    const newerRequest = entry.readiness.state.requestId;
    entry.readiness.fail("smoke expected failure", "smoke-fail");
    entry.readiness.markDomReady(url + "#smoke-newer");
    const lateDomIgnored = entry.readiness.state.phase === "error";
    await wait(160);
    const errorSurface = await readSurface(entry);
    addCase(
      "error-surface-and-token",
      { oldRequest, newerRequest, state: entry.readiness.state, surface: errorSurface },
      {
        newerToken: newerRequest > oldRequest,
        errorPhase: entry.readiness.state.phase === "error",
        lateDomIgnored,
        visible: !!errorSurface && errorSurface.connected === true,
        interactive: !!errorSurface && errorSurface.pointer === "auto",
        notBusy: !!errorSurface && errorSurface.busy === "false",
      }
    );

    entry.readiness.begin(url, "smoke-recovery");
    entry.readiness.markReady({ textLength: 1 });
    let readySurface = null;
    const hiddenDeadline = Date.now() + 1800;
    while (Date.now() < hiddenDeadline) {
      readySurface = await readSurface(entry);
      if (readySurface && (!readySurface.connected || (readySurface.opacity === "0" && readySurface.pointer === "none" && readySurface.hidden === "true"))) break;
      await wait(80);
    }
    addCase(
      "ready-hides-surface",
      { state: entry.readiness.state, surface: readySurface },
      {
        readyPhase: entry.readiness.state.phase === "ready",
        inaccessible:
          !!readySurface &&
          (readySurface.connected === false ||
            (readySurface.opacity === "0" && readySurface.pointer === "none" && readySurface.hidden === "true")),
      }
    );
  } catch (err) {
    addCase("page-loading-surface", { error: err.message }, { completed: false });
  } finally {
    try {
      ctx.views.showHome();
      await wait(160);
    } catch {}
  }

  const failed = results.filter((item) => !item.ok);
  console.log("SMOKE_PAGE_LOAD_SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((item) => item.name) }));
  if (!results.length || failed.length) {
    console.log("SMOKE_FAIL 页面加载状态探针: " + (failed.map((item) => item.name).join(", ") || "no-cases"));
  }
}

module.exports = { runPageLoadingSmoke };
