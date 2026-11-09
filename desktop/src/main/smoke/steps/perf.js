/* 性能模式探针：降载变量、缩放冻结与恢复。 */

async function runPerfStep({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_PERF === "1") {
    ctx.cfg.setGeneral({ performanceMode: true });
    await ctx.refreshAppearance({ reschedule: false });
    await wait(700);
    const perf1 = await ctx.win.webContents.executeJavaScript(`(() => {
      const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : ""; };
      return {
        perf: document.body.classList.contains("perf"),
        blurVar: getComputedStyle(document.documentElement).getPropertyValue("--blur").trim(),
        titleBlur: css("#titlebar", "backdropFilter"),
        railBlur: css("#rail", "backdropFilter"),
        contentBlur: css("#content", "backdropFilter"),
        zoom: getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim(),
      };
    })()`);
    await wait(600);
    const zoom2 = await ctx.win.webContents.executeJavaScript(
      `getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim()`
    );
    console.log("SMOKE_PERF " + JSON.stringify(Object.assign({}, perf1, { zoom2 })));
    ctx.cfg.setGeneral({ performanceMode: false });
    await ctx.refreshAppearance({ reschedule: false });
    await wait(500);

    // 动态降载：失焦后冻结，重新聚焦后恢复
    const sampleZoom = () =>
      ctx.win.webContents.executeJavaScript(
        `getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim()`
      );
    ctx.win.emit("focus");
    await wait(700);
    const z1 = await sampleZoom();
    await wait(500);
    const z2 = await sampleZoom();
    ctx.win.emit("blur");
    await wait(500);
    const z3 = await sampleZoom();
    await wait(500);
    const z4 = await sampleZoom();
    ctx.win.emit("focus");
    await wait(500);
    const z5 = await sampleZoom();
    console.log(
      "SMOKE_LAZY " +
        JSON.stringify({
          moving: z1 !== z2,
          frozen: z3 === z4,
          resumed: z5 !== z4,
          z: [z1, z2, z3, z4, z5],
        })
    );

  }
}

module.exports = { runPerfStep };
