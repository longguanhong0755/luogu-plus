/* 侧栏冒烟：随机跳题面板 / 随机题后端（打桩，不联网）。 */

async function runJumpCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.win.setContentSize(originalBounds.width, originalBounds.height);
  await wait(260);
  ctx.views.showHome();
  await waitFor(() => shell(`!document.getElementById("home").hidden && !!document.querySelector(".home-jump-card .home-jump-random")`), 1800);
  await shell(`document.querySelector(".home-jump-card .home-jump-random").click(); true`);
  await waitFor(() => shell(`!document.getElementById("overlay").hidden && !document.getElementById("jump-options").hidden`), 1500);
  await wait(360);
  const jumpPanel = await shell(`(() => ({
    homeEntry: !document.getElementById("home").hidden,
    optionsVisible: !document.getElementById("jump-options").hidden,
    difficulties: document.querySelectorAll("#jump-difficulty option").length,
    sources: document.querySelectorAll("#jump-source option").length,
    randomButton: !!document.getElementById("jump-random"),
    trueRandom: !!document.getElementById("jump-true-random"),
    focused: document.activeElement && document.activeElement.id
  }))()`);
  const originalRandomProblem = ctx.luogu.randomProblem;
  let randomRequest = null;
  ctx.luogu.randomProblem = async (payload) => {
    randomRequest = payload;
    return { ok: false, reason: "interval", waitMs: 5000 };
  };
  await shell(`(() => {
    document.getElementById("jump-difficulty").value = "4";
    document.getElementById("jump-source").value = "CF";
    document.getElementById("jump-random").click();
    return true;
  })()`);
  await waitFor(() => shell(`/5 秒/.test(document.getElementById("jump-status").textContent)`), 1800);
  const jumpAfter = await shell(`(() => ({
    status: document.getElementById("jump-status").textContent,
    disabled: document.getElementById("jump-random").disabled
  }))()`);
  addCase(
    "random-jump-panel",
    { jumpPanel, randomRequest, jumpAfter },
    {
      homeEntry: jumpPanel.homeEntry && jumpPanel.focused === "jump-random",
      optionsVisible: jumpPanel.optionsVisible,
      eightDifficulties: jumpPanel.difficulties === 8,
      fiveSources: jumpPanel.sources === 5,
      actionButtons: jumpPanel.randomButton && jumpPanel.trueRandom,
      payload: !!randomRequest && randomRequest.difficulty === 4 && randomRequest.source === "CF",
      feedback: /5 秒/.test(jumpAfter.status),
      reenabled: jumpAfter.disabled === false,
    }
  );
  if (process.env.LG_SMOKE_VISUAL === "1") await shot("rail-jump", ctx.win);
  ctx.luogu.randomProblem = originalRandomProblem;
  ctx.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
  ctx.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
  await waitFor(() => shell(`document.getElementById("overlay").hidden`), 1500);

  const originalFetchLibrary = ctx.luogu.fetchLibrary;
  const originalRandom = Math.random;
  const randomCalls = [];
  ctx.luogu.randomCounts.clear();
  if (ctx.store) ctx.store.delete("randomJumpGuard");
  ctx.luogu.fetchLibrary = async (kind, options) => {
    randomCalls.push({ kind, page: options.page, difficulty: options.difficulty, type: options.type });
    const items = options.page === 1
      ? [{ pid: "P1", title: "one", difficulty: 3 }, { pid: "P2", title: "two", difficulty: 3 }]
      : [{ pid: "P3", title: "three", difficulty: 3 }, { pid: "P4", title: "four", difficulty: 3 }];
    return { kind, page: options.page, perPage: 2, total: 4, items, error: "" };
  };
  Math.random = () => 0.75;
  const randomResult = await ctx.luogu.randomProblem({ difficulty: 3, source: "SP" });
  const randomGate = ctx.luogu.randomGuard();
  Math.random = originalRandom;
  ctx.luogu.fetchLibrary = originalFetchLibrary;
  if (ctx.store) ctx.store.delete("randomJumpGuard");
  addCase(
    "random-problem-backend",
    { randomResult, randomGate, randomCalls },
    {
      selectedUniformIndex: randomResult.ok && randomResult.pid === "P4",
      twoRequests: randomCalls.length === 2 && randomCalls[0].page === 1 && randomCalls[1].page === 2,
      filtersForwarded: randomCalls.every((call) => call.kind === "problems" && call.difficulty === "3" && call.type === "SP"),
      cooldownApplied: randomGate.allowed === false && randomGate.reason === "interval" && randomGate.waitMs > 0,
    }
  );
}

module.exports = { runJumpCases };
