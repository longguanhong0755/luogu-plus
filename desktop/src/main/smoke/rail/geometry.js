/* 侧栏冒烟：折叠态几何与页面视图让位 / hover 不展开不抢焦点。 */

async function runGeometryCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.views.openProblem("P1001");
  await waitFor(() => !!ctx.views.currentEntry(), 2200);
  await waitFor(() => {
    const wc = ctx.views.currentWebContents();
    return !!wc && !wc.isDestroyed() && /\/problem\/P1001/i.test(wc.getURL());
  }, 5000);
  await wait(350);
  const pageEntry = ctx.views.currentEntry();
  const collapsedDom = await shell(`(() => {
    const rail = document.getElementById("rail");
    const pin = document.getElementById("rail-pin");
    const btn = document.querySelector("#rail-top .rail-btn");
    const br = btn ? btn.getBoundingClientRect() : null;
    const glyphs = [...document.querySelectorAll("#rail .rail-glyph")].map((el) => {
      const r = el.getBoundingClientRect();
      const svg = el.querySelector("svg");
      const sr = svg ? svg.getBoundingClientRect() : null;
      return { w: Math.round(r.width), h: Math.round(r.height), sw: sr ? Math.round(sr.width) : -1, sh: sr ? Math.round(sr.height) : -1 };
    });
    return {
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : -1,
      pinPressed: pin ? pin.getAttribute("aria-pressed") : null,
      pinVisible: !!pin && getComputedStyle(pin).display !== "none",
      labelsVisible: [...document.querySelectorAll("#rail-top .rail-label")].filter((el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"; }).length,
      btnW: br ? Math.round(br.width) : -1,
      btnH: br ? Math.round(br.height) : -1,
      glyphs,
      directSvg: document.querySelectorAll("#rail .rail-btn > svg").length
    };
  })()`);
  const collapsedState = await shell(`window.lg.getState()`);
  const collapsedBounds = pageEntry ? pageEntry.view.getBounds() : null;
  addCase(
    "collapsed-geometry",
    { collapsedDom, collapsedState: collapsedState.rail, collapsedBounds, mainRailW: ctx.views.railWidth() },
    {
      railWidth: approx(collapsedDom.railW, 64),
      mainWidth: approx(ctx.views.railWidth(), 64),
      stateWidth: approx(collapsedState && collapsedState.rail && collapsedState.rail.width, 64),
      pinReleased: collapsedDom.pinPressed === "false",
      pinVisible: collapsedDom.pinVisible,
      labelsHidden: collapsedDom.labelsVisible === 0,
      navHitWidth: approx(Math.min(collapsedDom.btnW, collapsedDom.railW - 24), 40),
      navHitHeight: collapsedDom.btnH >= 30,
      pageViewX: !!collapsedBounds && approx(collapsedBounds.x, collapsedDom.railW),
      iconSlots: collapsedDom.glyphs.length >= 10 && collapsedDom.glyphs.every((g) => g.w === 24 && g.h === 20 && g.sw === 20 && g.sh === 20),
      noDirectSvg: collapsedDom.directSvg === 0,
    }
  );

  ctx.win.webContents.sendInputEvent({ type: "mouseMove", x: 1000, y: 120, movementX: 0, movementY: 0 });
  await wait(60);
  ctx.win.webContents.sendInputEvent({ type: "mouseMove", x: 30, y: 120, movementX: -970, movementY: 0 });
  await wait(280);
  const hoverDom = await shell(`(() => {
    const rail = document.getElementById("rail");
    const active = document.activeElement;
    return {
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : -1,
      labelsVisible: [...document.querySelectorAll("#rail-top .rail-label")].filter((el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"; }).length,
      activeRailId: active && active.classList && active.classList.contains("rail-btn") ? active.dataset.id || "pin" : ""
    };
  })()`);
  const hoverBounds = pageEntry ? pageEntry.view.getBounds() : null;
  addCase(
    "hover-does-not-expand-or-focus",
    { hoverDom, mainRailW: ctx.views.railWidth(), hoverBounds },
    {
      widthStable: approx(hoverDom.railW, 64) && approx(ctx.views.railWidth(), 64),
      labelsHidden: hoverDom.labelsVisible === 0,
      focusStayedOutsideRail: hoverDom.activeRailId === "",
      pageViewX: !!hoverBounds && approx(hoverBounds.x, hoverDom.railW),
    }
  );
  ctx.win.webContents.sendInputEvent({ type: "mouseMove", x: 1000, y: 120, movementX: 970, movementY: 0 });
  await wait(60);
  return pageEntry;
}

module.exports = { runGeometryCases };
