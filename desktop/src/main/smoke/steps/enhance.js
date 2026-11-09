/* 增强探针：用户简介卡与练习难度着色（需联网）。 */

async function runEnhanceStep({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_ENHANCE === "1" && process.env.LG_SMOKE_NET === "1") {
    const beforeEnhance = JSON.parse(JSON.stringify(ctx.cfg.get().features));
    ctx.cfg.setFeatures({ showUserIntro: true, problemDifficultyColor: true, dynamicDetection: true });
    ctx.views.applyFeatures();
    ctx.views.openProfile(2);
    await wait(9000);
    const introWc = ctx.views.currentWebContents();
    const introProbe = await introWc.executeJavaScript(`(() => {
      const card = document.querySelector('[data-lgplus-user-intro]');
      const rect = card ? card.getBoundingClientRect() : null;
      return {
        exists: !!card,
        text: card ? card.textContent.trim().slice(0, 200) : "",
        images: card ? card.querySelectorAll("img").length : 0,
        codeBlocks: card ? card.querySelectorAll("pre code").length : 0,
        videos: card ? card.querySelectorAll("iframe.lg-intro-video").length : 0,
        markdownBlocks: card ? card.querySelectorAll(".lg-md-container, table").length : 0,
        rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      };
    })()`);
    console.log("SMOKE_ENHANCE_INTRO " + JSON.stringify(introProbe));
    if (!introProbe.exists) console.error("SMOKE_FAIL enhance user intro missing");
    if (introProbe.images + introProbe.codeBlocks + introProbe.videos + introProbe.markdownBlocks === 0 && !introProbe.text) console.error("SMOKE_FAIL enhance user intro empty");
    await introWc.executeJavaScript(`document.querySelector('[data-lgplus-user-intro]')?.scrollIntoView({ block: "center" }); true`);
    await wait(500);
    await shot("enhance-user-intro");
    await shotView("enhance-user-intro-view");

    ctx.views.openDetail("https://www.luogu.com.cn/user/2/practice", "练习");
    await wait(9000);
    const colorProbe = await ctx.views
      .currentWebContents()
      .executeJavaScript(`(() => {
        const nodes = [...document.querySelectorAll('a[data-lgplus-difficulty]')];
        return { count: nodes.length, colors: nodes.slice(0, 5).map((n) => ({ pid: n.textContent.trim(), difficulty: n.dataset.lgplusDifficulty, color: getComputedStyle(n).color })) };
      })()`);
    console.log("SMOKE_ENHANCE_COLORS " + JSON.stringify(colorProbe));
    if (!colorProbe.count) console.error("SMOKE_FAIL enhance practice colors missing");
    await shot("enhance-practice-colors");
    await shotView("enhance-practice-colors-view");
    ctx.cfg.setFeatures(beforeEnhance);
    ctx.views.applyFeatures();
  }
}

module.exports = { runEnhanceStep };
