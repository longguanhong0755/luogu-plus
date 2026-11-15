/* 侧栏冒烟：自定义主题与壁纸透出 / 极端尺寸自适应。 */

async function runLayoutCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  const originalAppearance = JSON.parse(JSON.stringify(ctx.cfg.get().appearance));
  const themeVars = () => shell(`(async () => {
    const root = getComputedStyle(document.documentElement);
    const state = await window.lg.getState();
    return {
      accent: root.getPropertyValue("--accent").trim(),
      glassTint: root.getPropertyValue("--glass-tint").trim(),
      bg: root.getPropertyValue("--bg").trim(),
      rail: root.getPropertyValue("--rail").trim(),
      surface: root.getPropertyValue("--surface").trim(),
      themeAccent: state.theme && state.theme.colors && state.theme.colors.accent,
    };
  })()`);
  const themeBefore = await themeVars();
  const themedAccent = String(originalAppearance.accent).toLowerCase() === "#d6538f" ? "#2fa57b" : "#d6538f";
  ctx.cfg.setAppearance({ accent: themedAccent });
  await ctx.refreshAppearance({ reschedule: false });
  await wait(180);
  const themeAfter = await themeVars();
  ctx.cfg.setAppearance({ accent: originalAppearance.accent });
  await ctx.refreshAppearance({ reschedule: false });
  await wait(180);
  addCase(
    "custom-theme-glass",
    { before: themeBefore, after: themeAfter },
    {
      accentApplied: themeAfter.accent.toLowerCase() === themedAccent && String(themeAfter.themeAccent || "").toLowerCase() === themedAccent,
      glassTintApplied: themeAfter.glassTint.toLowerCase() === themedAccent,
      shellTinted: themeAfter.bg !== themeBefore.bg && themeAfter.rail !== themeBefore.rail && themeAfter.surface !== themeBefore.surface,
    }
  );

  const aspectTrail = [];
  for (const [width, height] of [[640, 480], [760, 900], [1600, 520]]) {
    ctx.win.setContentSize(width, height);
    await wait(220);
    aspectTrail.push(await shell(`(() => {
      const home = document.getElementById("home");
      const app = document.getElementById("app");
      const head = document.querySelector(".wc-head");
      const actions = document.querySelector(".wc-actions");
      const mr = head ? head.getBoundingClientRect() : null;
      const ar = actions ? actions.getBoundingClientRect() : null;
      const overlap = !!(mr && ar && ar.right > mr.left + 1 && ar.left < mr.right - 1 && ar.bottom > mr.top + 1 && ar.top < mr.bottom - 1);
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        appWidth: app ? Math.round(app.getBoundingClientRect().width) : -1,
        homeOverflow: !!home && home.scrollWidth > home.clientWidth + 1,
        actionsOverlap: overlap,
        actionsVisible: !!actions && ar && ar.width > 0 && ar.height > 0,
      };
    })()`));
  }
  ctx.win.setContentSize(884, 756);
  await wait(240);
  const narrowHomeSide = await shell(`(() => {
    const side = document.querySelector('.home-side');
    const cards = side ? Array.from(side.children) : [];
    const last = cards[cards.length - 1];
    const sr = side ? side.getBoundingClientRect() : null;
    const lr = last ? last.getBoundingClientRect() : null;
    return {
      cards: cards.length,
      odd: cards.length % 2 === 1,
      fullWidth: !!sr && !!lr && Math.abs(lr.left - sr.left) <= 1 && Math.abs(lr.right - sr.right) <= 1,
      columns: side ? getComputedStyle(side).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
    };
  })()`);
  ctx.win.setContentSize(640, 480);
  ctx.views.showLibrary("problems");
  await wait(500);
  const narrowLibrary = await shell(`(() => {
    const wrap = document.querySelector(".lib-wrap");
    const list = document.querySelector(".lib-list");
    const row = document.querySelector(".lib-problem");
    const content = document.getElementById("content").getBoundingClientRect();
    const wr = wrap ? wrap.getBoundingClientRect() : null;
    return {
      wrapInside: !!wr && wr.left >= content.left - 1 && wr.right <= content.right + 1,
      listOverflow: !!list && list.scrollWidth > list.clientWidth + 1,
      rowOverflow: !!row && row.scrollWidth > row.clientWidth + 1,
      titleWrapped: !!document.querySelector(".lib-title-row .lib-search"),
    };
  })()`);
  ctx.views.showHome();
  ctx.win.setContentSize(originalBounds.width, originalBounds.height);
  await wait(260);
  addCase(
    "responsive-aspects",
    { sizes: [[640, 480], [760, 900], [884, 756], [1600, 520]], trail: aspectTrail, narrowLibrary, narrowHomeSide },
    {
      noPageOverflow: aspectTrail.every((item) => !item.docOverflow && !item.homeOverflow && item.appWidth === item.innerWidth),
      noControlOverlap: aspectTrail.every((item) => !item.actionsOverlap && item.actionsVisible),
      minSizeReached: aspectTrail[0].innerWidth === 640 && aspectTrail[0].innerHeight === 480,
      libraryFits: narrowLibrary.wrapInside && !narrowLibrary.listOverflow && !narrowLibrary.rowOverflow && narrowLibrary.titleWrapped,
      sideGapClosed: narrowHomeSide.columns === 2 && (!narrowHomeSide.odd || narrowHomeSide.fullWidth),
    }
  );
}

module.exports = { runLayoutCases };
