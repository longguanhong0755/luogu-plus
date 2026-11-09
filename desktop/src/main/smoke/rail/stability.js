/* 侧栏冒烟：快速连点稳定 / IDE 方向自适应 / 性能模式无补间。 */

async function runStabilityCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.views.setRailPinned(false);
  await wait(240);
  ctx.views.openProblem("P1001");
  await wait(500);
  const rapidTrail = [];
  for (let index = 0; index < 20; index++) {
    await shell(`document.getElementById("rail-pin").click(); true`);
    rapidTrail.push(await shell(`(() => {
      const rail = document.getElementById("rail").getBoundingClientRect();
      const glyph = document.querySelector("#rail-top .rail-glyph")?.getBoundingClientRect();
      return { width: rail.width, iconX: glyph ? glyph.x + glyph.width / 2 : -1 };
    })()`));
    await wait(25);
  }
  await wait(420);
  const rapidFirst = await shell(`(() => {
    const rail = document.getElementById("rail");
    const pin = document.getElementById("rail-pin");
    return {
      railW: Math.round(rail.getBoundingClientRect().width),
      pinPressed: pin.getAttribute("aria-pressed"),
      bodyPinned: document.body.classList.contains("rail-pinned")
    };
  })()`);
  const rapidSecond = await shell(`Math.round(document.getElementById("rail").getBoundingClientRect().width)`);
  const rapidBounds = ctx.views.currentEntry() ? ctx.views.currentEntry().view.getBounds() : null;
  addCase(
    "rapid-pin-stability",
    {
      clicks: 20,
      trail: rapidTrail,
      first: rapidFirst,
      secondWidth: rapidSecond,
      mainRailW: ctx.views.railWidth(),
      animTimer: ctx.views.railAnimTimer,
      pinned: ctx.cfg.get().rail.pinned,
      bounds: rapidBounds,
    },
    {
      clickCount: rapidTrail.length === 20,
      sampledWidthsInRange: rapidTrail.every((sample) => Number.isFinite(Number(sample && sample.width)) && Number(sample.width) >= 64 && Number(sample.width) <= 208),
      iconAnchored: rapidTrail.every((sample) => sample && approx(sample.iconX, 32)),
      evenClicksEndCollapsed: ctx.cfg.get().rail.pinned === false,
      ariaReleased: rapidFirst.pinPressed === "false",
      bodyUnpinned: !rapidFirst.bodyPinned,
      widthStable: approx(rapidFirst.railW, 64) && approx(rapidSecond, 64) && approx(ctx.views.railWidth(), 64),
      noResidualTimer: ctx.views.railAnimTimer === null,
      pageViewX: !!rapidBounds && approx(rapidBounds.x, rapidFirst.railW),
    }
  );

  try {
    const aspectIde = [];
    for (const [width, height, expectVertical] of [[640, 480, true], [1600, 520, false]]) {
      ctx.win.setContentSize(width, height);
      await wait(220);
      ctx.views.setIde(true);
      await wait(320);
      const dom = await shell(`(() => {
        const ws = document.getElementById("workspace");
        const pane = document.getElementById("ide-pane");
        const wr = ws ? ws.getBoundingClientRect() : null;
        const pr = pane ? pane.getBoundingClientRect() : null;
        return {
          vertical: !!ws && ws.classList.contains("ide-vertical"),
          ws: wr ? { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) } : null,
          pane: pr ? { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
        };
      })()`);
      const view = ctx.views.currentEntry() ? ctx.views.currentEntry().view.getBounds() : null;
      aspectIde.push({ expectVertical, dom, view });
      ctx.views.setIde(false);
    }
    ctx.win.setContentSize(originalBounds.width, originalBounds.height);
    await wait(260);
    addCase(
      "responsive-ide-orientation",
      { cases: aspectIde },
      {
        orientationMatches: aspectIde.every((item) => item.dom.vertical === item.expectVertical),
        paneFits: aspectIde.every((item) => item.dom.pane && item.dom.ws && (item.expectVertical ? Math.abs(item.dom.pane.w - item.dom.ws.w) <= 1 : Math.abs(item.view.width + item.dom.pane.w - item.dom.ws.w) <= 2)),
        viewFits: aspectIde.every((item) => item.dom.ws && item.view && item.view.x >= item.dom.ws.x - 1 && item.view.width <= item.dom.ws.w + 1),
        heightShares: aspectIde.every((item) => item.dom.ws && item.view && item.dom.pane && (item.expectVertical ? Math.abs(item.view.height + item.dom.pane.h - item.dom.ws.h) <= 2 : Math.abs(item.dom.pane.h - item.dom.ws.h) <= 1)),
      }
    );
  } catch (err) {
    addCase("responsive-ide-orientation", { error: err.message }, { completed: false });
  }

  ctx.cfg.setGeneral({ performanceMode: true });
  await ctx.refreshAppearance({ reschedule: false });
  ctx.views.setRailPinned(false);
  await wait(220);
  ctx.views.setRailPinned(true);
  const perfPinnedImmediate = ctx.views.railWidth();
  const perfPinnedTimer = ctx.views.railAnimTimer;
  await waitFor(() => shell(`Math.round(document.getElementById("rail").getBoundingClientRect().width) === 208`), 1200);
  const perfPinnedDom = await shell(`Math.round(document.getElementById("rail").getBoundingClientRect().width)`);
  ctx.views.setRailPinned(false);
  const perfCollapsedImmediate = ctx.views.railWidth();
  const perfCollapsedTimer = ctx.views.railAnimTimer;
  await waitFor(() => shell(`Math.round(document.getElementById("rail").getBoundingClientRect().width) === 64`), 1200);
  const perfCollapsedDom = await shell(`Math.round(document.getElementById("rail").getBoundingClientRect().width)`);
  addCase(
    "performance-mode-no-tween",
    {
      perfPinnedImmediate,
      perfPinnedTimer,
      perfPinnedDom,
      perfCollapsedImmediate,
      perfCollapsedTimer,
      perfCollapsedDom,
    },
    {
      pinnedImmediate: approx(perfPinnedImmediate, 208),
      pinnedNoTimer: perfPinnedTimer === null,
      pinnedDom: approx(perfPinnedDom, 208),
      collapsedImmediate: approx(perfCollapsedImmediate, 64),
      collapsedNoTimer: perfCollapsedTimer === null,
      collapsedDom: approx(perfCollapsedDom, 64),
    }
  );
}

module.exports = { runStabilityCases };
