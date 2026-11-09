/* 侧栏冒烟：原生 title 提示 / 固定态同步与落盘。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

async function runTooltipCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }, pageEntry) {
  const nativeTitles = await shell(`(() => {
    const buttons = [...document.querySelectorAll("#rail-top .rail-btn")];
    return {
      total: buttons.length,
      titled: buttons.filter((button) => button.title === button.getAttribute("aria-label")).length,
      first: buttons[0] ? buttons[0].title : "",
      floatingTooltipDom: !!document.getElementById("rail-tooltip"),
    };
  })()`);
  addCase(
    "rail-native-tooltip",
    { nativeTitles },
    {
      allTitled: nativeTitles.total > 0 && nativeTitles.titled === nativeTitles.total,
      firstTitle: nativeTitles.first === "主页",
      noFloatingDom: nativeTitles.floatingTooltipDom === false,
    }
  );

  await shell(`document.getElementById("rail-pin").click(); true`);
  await waitFor(() => ctx.cfg.get().rail.pinned === true && approx(ctx.views.railWidth(), 208), 2500);
  await wait(260);
  const pinnedDom = await shell(`(() => {
    const rail = document.getElementById("rail");
    const pin = document.getElementById("rail-pin");
    return {
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : -1,
      bodyPinned: document.body.classList.contains("rail-pinned"),
      visualWide: document.body.classList.contains("rail-visual-wide"),
      pinPressed: pin ? pin.getAttribute("aria-pressed") : null,
      pinTitle: pin ? pin.title : "",
      pinLabel: pin ? ((pin.querySelector(".rail-label") || {}).textContent || "") : "",
      labels: [...document.querySelectorAll("#rail-top .rail-label")].filter((el) => getComputedStyle(el).display !== "none").length,
      groups: [...document.querySelectorAll("#rail-top .rail-group-label")].filter((el) => getComputedStyle(el).display !== "none").length
    };
  })()`);
  const pinnedState = await shell(`window.lg.getState()`);
  const pinnedBounds = pageEntry ? pageEntry.view.getBounds() : null;
  let persistedRail = null;
  try {
    persistedRail = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8")).rail;
  } catch {}
  addCase(
    "pin-sync-and-persistence",
    { pinnedDom, pinnedState: pinnedState.rail, pinnedBounds, mainRailW: ctx.views.railWidth(), persistedPinned: persistedRail && persistedRail.pinned },
    {
      configPinned: ctx.cfg.get().rail.pinned === true,
      persistedPinned: !!(persistedRail && persistedRail.pinned === true),
      bodyPinned: pinnedDom.bodyPinned,
      visualWide: pinnedDom.visualWide,
      ariaPressed: pinnedDom.pinPressed === "true",
      pinTitle: /收起侧栏/.test(pinnedDom.pinTitle),
      pinLabel: pinnedDom.pinLabel === "收起侧栏",
      railWidth: approx(pinnedDom.railW, 208),
      mainWidth: approx(ctx.views.railWidth(), 208),
      stateWidth: approx(pinnedState && pinnedState.rail && pinnedState.rail.width, 208),
      labelsVisible: pinnedDom.labels > 0,
      groupsVisible: pinnedDom.groups > 0,
      pageViewX: !!pinnedBounds && approx(pinnedBounds.x, pinnedDom.railW),
    }
  );
  await shot("rail-pinned");
}

module.exports = { runTooltipCases };
