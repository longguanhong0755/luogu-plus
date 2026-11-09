/* 侧栏冒烟：各路由的 aria-current 唯一高亮。 */

async function runActiveCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  const activeProbe = async (route, expected) => {
    let activated = false;
    try {
      await route();
      activated = true;
    } catch {}
    await waitFor(() => ((ctx.views.currentInfo() || {}).railId || "") === expected, 2200);
    await wait(100);
    const info = ctx.views.currentInfo() || {};
    const dom = await shell(`(() => {
      const buttons = [...document.querySelectorAll('#rail .rail-btn[data-id]')];
      const current = buttons.filter((b) => b.getAttribute("aria-current") === "page");
      const active = buttons.filter((b) => b.classList.contains("active"));
      const settings = buttons.find((b) => b.dataset.kind === "action" && b.dataset.id === "settings");
      return {
        expectedIds: current.map((b) => b.dataset.id),
        activeIds: active.map((b) => b.dataset.id),
        currentCount: current.length,
        activeCount: active.length,
        sameNode: current.length === 1 && active.length === 1 && current[0] === active[0],
        settingsCurrent: !!settings && (settings.hasAttribute("aria-current") || settings.classList.contains("active"))
      };
    })()`);
    addCase(
      "active-" + expected,
      { expected, info, dom, activated },
      {
        activated,
        stateRailId: info.railId === expected,
        uniqueCurrent: dom.currentCount === 1 && dom.expectedIds[0] === expected,
        uniqueActive: dom.activeCount === 1 && dom.activeIds[0] === expected,
        sameElement: dom.sameNode,
        actionNotActive: !dom.settingsCurrent,
      }
    );
  };

  await activeProbe(() => ctx.views.showHome(), "home");
  for (const kind of ["problems", "training", "contest", "record", "discuss", "article"]) {
    await activeProbe(() => ctx.views.showLibrary(kind), kind);
  }
  await activeProbe(() => ctx.views.openProblem("P1001"), "problems");
  await activeProbe(() => ctx.views.openWeb("chat"), "chat");
  await activeProbe(() => ctx.views.openWeb("notification"), "notification");
}

module.exports = { runActiveCases };
