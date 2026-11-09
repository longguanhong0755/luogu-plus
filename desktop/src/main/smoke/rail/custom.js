/* 侧栏冒烟：自定义项 keyed DOM 复用 / 滚动保持 / 八项可达。 */

async function runCustomCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.win.setContentSize(1000, 640);
  await wait(320);
  const customItems = Array.from({ length: 8 }, (_, index) => ({
    id: "smoke-" + (index + 1),
    label: "测试链接 " + (index + 1),
    url: "https://www.luogu.com.cn/article",
  }));
  ctx.cfg.setRail({ custom: customItems, pinned: false });
  ctx.views.setRailPinned(false);
  ctx.broadcastState();
  await waitFor(() => shell(`document.querySelectorAll('#rail-top .rail-btn[data-id^="custom:"]').length === 8`), 2500);
  await shell(`(() => {
    const top = document.getElementById("rail-top");
    top.scrollTop = Math.floor((top.scrollHeight - top.clientHeight) / 2);
    window.__lgRailProbeNode = document.querySelector('[data-id="custom:smoke-4"]');
    window.__lgRailScrollBefore = top.scrollTop;
    return true;
  })()`);
  const beforeKeyed = await shell(`(() => {
    const top = document.getElementById("rail-top");
    return { scrollTop: top.scrollTop, overflow: top.scrollHeight - top.clientHeight, customCount: document.querySelectorAll('#rail-top .rail-btn[data-id^="custom:"]').length };
  })()`);
  const savedScrollTop = await shell(`window.__lgRailScrollBefore`);
  ctx.cfg.setRail({ custom: customItems.map((item) => Object.assign({}, item, { label: item.label + "改" })), pinned: false });
  ctx.broadcastState();
  await wait(360);
  const afterKeyed = await shell(`(() => {
    const top = document.getElementById("rail-top");
    const node = document.querySelector('[data-id="custom:smoke-4"]');
    return {
      scrollTop: top.scrollTop,
      sameNode: !!node && node === window.__lgRailProbeNode && node.isConnected,
      customCount: document.querySelectorAll('#rail-top .rail-btn[data-id^="custom:"]').length,
      labelUpdated: !!node && /改$/.test(((node.querySelector(".rail-label") || {}).textContent || ""))
    };
  })()`);
  addCase(
    "keyed-dom-scroll-preservation",
    { before: beforeKeyed, after: afterKeyed, savedScrollTop },
    {
      overflowCreated: beforeKeyed.overflow > 0,
      scrollWasSet: beforeKeyed.scrollTop > 0,
      savedScrollMatches: Math.abs(savedScrollTop - beforeKeyed.scrollTop) <= 1,
      scrollPreserved: Math.abs(afterKeyed.scrollTop - beforeKeyed.scrollTop) <= 1,
      nodeReused: afterKeyed.sameNode,
      configApplied: afterKeyed.labelUpdated,
      allEightRendered: beforeKeyed.customCount === 8 && afterKeyed.customCount === 8,
    }
  );
  await shell(`document.getElementById("rail-top").scrollTop = document.getElementById("rail-top").scrollHeight; true`);
  await wait(80);
  const reachable = await shell(`(() => {
    const top = document.getElementById("rail-top");
    const last = document.querySelector('[data-id="custom:smoke-8"]');
    const tr = top.getBoundingClientRect();
    const lr = last ? last.getBoundingClientRect() : null;
    return {
      customCount: document.querySelectorAll('#rail-top .rail-btn[data-id^="custom:"]').length,
      lastExists: !!last,
      lastTop: lr ? Math.round(lr.top) : -1,
      lastBottom: lr ? Math.round(lr.bottom) : -1,
      scrollTop: Math.round(top.scrollTop),
      maxScroll: Math.round(top.scrollHeight - top.clientHeight),
      scrollTopEdge: Math.round(tr.top),
      scrollBottomEdge: Math.round(tr.bottom)
    };
  })()`);
  const customOpened = await shell(`document.querySelector('[data-id="custom:smoke-8"]').click(); true`);
  await waitFor(() => ((ctx.views.currentInfo() || {}).railId || "") === "custom:smoke-8", 2500);
  await wait(160);
  const customActive = await shell(`(() => {
    const current = [...document.querySelectorAll('#rail .rail-btn[aria-current="page"]')];
    const active = [...document.querySelectorAll('#rail .rail-btn.active')];
    const glyphs = [...document.querySelectorAll('#rail-top .rail-btn[data-id^="custom:"] .rail-glyph-custom')]
      .map((node) => node.textContent.trim());
    return {
      currentIds: current.map((b) => b.dataset.id),
      activeIds: active.map((b) => b.dataset.id),
      sameNode: current.length === 1 && active.length === 1 && current[0] === active[0],
      glyphCount: glyphs.length,
      uniqueGlyphs: new Set(glyphs).size,
      glyphs,
    };
  })()`);
  addCase(
    "eight-custom-items-reachable",
    { reachable, customOpened, currentInfo: ctx.views.currentInfo(), customActive },
    {
      allEightRendered: reachable.customCount === 8 && reachable.lastExists,
      overflowed: reachable.maxScroll > 0 && reachable.scrollTop > 0,
      lastItemInViewport:
        reachable.lastTop >= reachable.scrollTopEdge &&
        reachable.lastBottom <= reachable.scrollBottomEdge &&
        reachable.lastBottom > reachable.lastTop,
      clickDispatched: customOpened === true,
      customRouteOpened: ((ctx.views.currentInfo() || {}).railId || "") === "custom:smoke-8",
      customActiveUnique:
        customActive.currentIds.length === 1 &&
        customActive.activeIds.length === 1 &&
        customActive.currentIds[0] === "custom:smoke-8" &&
        customActive.activeIds[0] === "custom:smoke-8" &&
        customActive.sameNode &&
      customActive.glyphCount === 8 &&
      customActive.uniqueGlyphs === 8,
    }
  );
}

module.exports = { runCustomCases };
