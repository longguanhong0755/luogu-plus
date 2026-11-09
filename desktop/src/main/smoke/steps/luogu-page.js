/* 题面渲染探针：真实题面、侧栏让位、皮肤/按钮度量、IDE、DOM 快照。 */
const fs = require("node:fs");
const path = require("node:path");

async function runLuoguPageStep({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_LUOGU === "1") {
    ctx.views.openProblem("P1001");
    const maxWait = Number(
      process.env.LG_SMOKE_LUOGU_WAIT || (process.env.LG_SMOKE_NET === "1" ? 30000 : 8000)
    );
    const deadline = Date.now() + maxWait;
    let rendered = false;
    while (Date.now() < deadline) {
      const wc = ctx.views.currentWebContents();
      if (wc) {
        try {
          rendered = await wc.executeJavaScript(`(() => {
            const m = document.querySelector(".lfe-marked");
            const text = m ? (m.innerText || "") : "";
            return !!(m && text.trim().length > 200 && !/\\*\\*[^*\\n]{1,80}\\*\\*/.test(text.slice(0, 4000)));
          })()`);
        } catch {
          rendered = false;
        }
        if (rendered) break;
      }
      await wait(1000);
    }
    console.log("SMOKE_LUOGU_READY " + rendered);
    await shot("problem");
    await shotView("problem-view");
    const entry = ctx.views.currentEntry();
    if (entry) {
      console.log(
        "SMOKE_VIEW url=" +
          entry.view.webContents.getURL() +
          " bounds=" +
          JSON.stringify(entry.view.getBounds())
      );
      // 折叠/固定侧栏时页面视图让位：64 → 208 → 64（真实题面在场）
      try {
        const collapsed = entry.view.getBounds();
        ctx.views.setRailPinned(true);
        await wait(400);
        const pinned = entry.view.getBounds();
        ctx.views.setRailPinned(false);
        await wait(400);
        const restored = entry.view.getBounds();
        const railBoundsOk =
          collapsed.x === 64 && pinned.x === 208 && restored.x === 64;
        console.log(
          "SMOKE_RAIL_BOUNDS " +
            JSON.stringify({
              collapsed: collapsed.x,
              pinned: pinned.x,
              restored: restored.x,
              ok: railBoundsOk,
            })
        );
        if (!railBoundsOk) console.log("SMOKE_FAIL rail bounds mismatch");
      } catch (err) {
        console.log("SMOKE_FAIL rail bounds: " + err.message);
      }
      if (process.env.LG_SMOKE_VIEW_CAPTURE === "1") {
        let viewImage = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            viewImage = await entry.view.webContents.capturePage(undefined, { stayHidden: true });
            if (!viewImage.isEmpty()) break;
          } catch (err) {
            viewImage = null;
          }
          await wait(900);
        }
        if (viewImage && !viewImage.isEmpty()) {
          fs.writeFileSync(path.join(outDir, "smoke-problem-view.png"), viewImage.toPNG());
          console.log("SMOKE_SHOT problem-view");
        } else {
          console.log("SMOKE_NOTE problem-view 隐藏窗口取帧不可用");
        }
      }
      try {
        const skin = await entry.view.webContents.executeJavaScript(`(() => {
          const probe = getComputedStyle(document.body, "::before");
          const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };
          const app = document.querySelector("#app");
          const main = document.querySelector("#app > .main-container");
          const card = document.querySelector("#app .l-card");
          const appCS = app ? getComputedStyle(app) : null;
          const mainCS = main ? getComputedStyle(main) : null;
          return {
            bgImage: probe.backgroundImage.slice(0, 160),
            bgSize: probe.backgroundSize,
            scrim: getComputedStyle(document.documentElement).getPropertyValue("--lg-scrim").trim(),
            backdrop: probe.transform,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            htmlBg: getComputedStyle(document.documentElement).backgroundColor,
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            app: rect(app),
            appPad: appCS ? appCS.padding : "",
            appMargin: appCS ? appCS.margin : "",
            main: rect(main),
            mainPad: mainCS ? mainCS.padding : "",
            mainMargin: mainCS ? mainCS.margin : "",
            card: rect(card),
            scrollbar: {
              width: getComputedStyle(document.documentElement).scrollbarWidth,
              thumb: (() => { try { return getComputedStyle(document.documentElement, "::-webkit-scrollbar-thumb").backgroundColor; } catch { return ""; } })(),
            },
          };
        })()`);
        console.log("SMOKE_SKIN " + JSON.stringify(skin));
      } catch (err) {
        console.log("SMOKE_SKIN probe failed: " + err.message);
      }
      try {
        const buttons = await entry.view.webContents.executeJavaScript(`(() => {
          return [...document.querySelectorAll("button, a")].filter((el) => /提交|登录/.test((el.textContent || "").trim())).slice(0, 8).map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === "string" ? el.className : "",
            bg: getComputedStyle(el).backgroundColor,
            color: getComputedStyle(el).color,
            h: Math.round(el.getBoundingClientRect().height)
          }));
        })()`);
        console.log("SMOKE_BUTTONS " + JSON.stringify(buttons));
      } catch (err) {
        console.log("SMOKE_BUTTONS probe failed: " + err.message);
      }
      if (process.env.LG_SMOKE_IDE === "1") {
        ctx.views.setIde(true);
        await wait(1000);
        await shot("ide");
    await shotView("ide-view");
        try {
          const ideProbe = await ctx.win.webContents.executeJavaScript(`(() => {
            const pane = document.querySelector("#ide-pane");
            const resizer = document.querySelector("#ide-resizer");
            const gutter = document.querySelector(".ide-gutter");
            const rect = pane.getBoundingClientRect();
            return {
              paneHidden: pane.hidden,
              paneRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              split: getComputedStyle(document.querySelector("#workspace")).getPropertyValue("--ide-split").trim(),
              resizerHidden: resizer.hidden,
              lines: gutter ? gutter.textContent.split("\\n").length : 0,
              codeFont: getComputedStyle(document.querySelector(".ide-code")).fontSize,
              headH: Math.round(document.querySelector(".ide-head").getBoundingClientRect().height)
            };
          })()`);
          console.log("SMOKE_IDE " + JSON.stringify(ideProbe));
          const ideEntry = ctx.views.currentEntry();
          console.log(
            "SMOKE_IDE_BOUNDS " +
              JSON.stringify({
                view: ideEntry ? ideEntry.view.getBounds() : null,
                content: ctx.win.getContentBounds(),
              })
          );
          if (ideEntry && !ideEntry.view.webContents.isDestroyed()) {
            const pageIde = await ideEntry.view.webContents.executeJavaScript(`(() => {
              const main = document.querySelector("#app > .main-container");
              const rect = main ? main.getBoundingClientRect() : null;
              const style = main ? getComputedStyle(main) : null;
              return {
                innerWidth: window.innerWidth,
                main: rect ? { x: Math.round(rect.x), width: Math.round(rect.width) } : null,
                marginLeft: style ? style.marginLeft : "",
                bodyOverflowX: getComputedStyle(document.body).overflowX,
              };
            })()`);
            const pageIdeOk = !pageIde.main || (Math.abs(pageIde.main.x) <= 1 && Math.abs(parseFloat(pageIde.marginLeft) || 0) <= 1);
            console.log("SMOKE_IDE_PAGE " + JSON.stringify(Object.assign({ ok: pageIdeOk }, pageIde)));
            if (!pageIdeOk) console.log("SMOKE_FAIL IDE 页面主容器仍有左侧占位");
          }
        } catch (err) {
          console.log("SMOKE_IDE probe failed: " + err.message);
        }
        ctx.views.setIde(false);
        await wait(400);
      }
    }

    // 真实题目页的 DOM 快照应在导航停稳 + 4.5s 后落盘（SPA 水合慢会再重试）
    await wait(7000);
    const snapHit = ctx.luogu.problemSnapshot("P1001");
    console.log(
      "SMOKE_SNAPSHOT " +
        JSON.stringify({
          has: !!snapHit,
          len: snapHit ? snapHit.html.length : 0,
          title: snapHit ? String(snapHit.title || "").slice(0, 40) : "",
          hasPid: !!(snapHit && snapHit.html && snapHit.html.toLowerCase().indexOf("a+b") >= 0),
        })
    );
  }
}

module.exports = { runLuoguPageStep };
