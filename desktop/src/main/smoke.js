/* 仅测试用：不可见冒烟启动、截图、皮肤调试；以及演示数据。
   生产路径不会加载这里的逻辑（只有 --smoke / LG_DEMO 时调用）。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

async function runSmoke(ctx) {
  const out = process.env.LG_SMOKE_OUT || path.join(app.getPath("userData"), "smoke.png");
  const outDir = path.dirname(out);
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name, target) => {
    const image = await (target || ctx.win).capturePage();
    const file = path.join(outDir, `smoke-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log("SMOKE_SHOT " + name + " " + file);
    return file;
  };

  const capture = async () => {
    try {
      ctx.win.setOpacity(0);
      ctx.win.showInactive();
      await wait(process.env.LG_SMOKE_NET === "1" ? 12000 : 1400);
      const homeShot = await shot("home");
      console.log("SMOKE_OK " + homeShot);

      if (process.env.LG_SMOKE_LUOGU === "1") {
        ctx.views.openProblem("P1001");
        await wait(8000);
        await shot("problem");
        const entry = ctx.views.currentEntry();
        if (entry) {
          console.log(
            "SMOKE_VIEW url=" +
              entry.view.webContents.getURL() +
              " bounds=" +
              JSON.stringify(entry.view.getBounds()) +
              " attached=" +
              entry.attached
          );
          fs.writeFileSync(
            path.join(outDir, "smoke-problem-view.png"),
            (await entry.view.webContents.capturePage()).toPNG()
          );
          console.log("SMOKE_SHOT problem-view");
          if (process.env.LG_SMOKE_DEBUG === "1") {
            const info = await entry.view.webContents.executeJavaScript(`(() => {
              const walk = (el, depth) => {
                if (!el || depth > 2) return null;
                const cs = getComputedStyle(el);
                return { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 120), bg: cs.backgroundImage.slice(0, 100), bgc: cs.backgroundColor, children: [...el.children].slice(0, 10).map((c) => walk(c, depth + 1)) };
              };
              const probe = (needle) => {
                const els = [...document.querySelectorAll("h1,h2,h3,h4,h5,div,span,a,p,button")].filter((el) => el.childElementCount === 0 && (el.textContent || "").trim().includes(needle));
                const el = els.sort((a, b) => a.textContent.length - b.textContent.length)[0];
                if (!el) return null;
                const cs = getComputedStyle(el);
                const chain = [];
                let node = el;
                for (let i = 0; i < 4 && node; i++) { chain.push(node.tagName + "." + String(node.className).slice(0, 60)); node = node.parentElement; }
                return { tag: el.tagName, cls: String(el.className).slice(0, 100), color: cs.color, chain };
              };
              return {
                title: document.title,
                app: walk(document.getElementById("app"), 0),
                textColors: { title: probe("A+B Problem"), tags: probe("标签"), discuss: probe("相关讨论") },
                theme: (document.getElementById("luogu-theme") || {}).textContent || null
              };
            })()`);
            console.log("SMOKE_DOM " + JSON.stringify(info).slice(0, 8000));
          }
        }
      }

      ctx.openSettings();
      await wait(1400);
      if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
        ctx.settingsWin.setOpacity(0);
        await shot("settings", ctx.settingsWin);
      }
    } catch (err) {
      console.error("SMOKE_FAIL " + err.message);
    }
    app.quitting = true;
    app.quit();
  };

  if (ctx.win.webContents.isLoading()) ctx.win.webContents.once("did-finish-load", capture);
  else capture();
}

/* 演示数据：只给截图用，不代表真实账号。 */
function seedDemo(ctx) {
  const now = new Date();
  const heat = [];
  for (let i = 139; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const v = (i * 7 + Math.floor(i / 9) * 3) % 11;
    heat.push({ date: key, count: v < 3 ? 0 : (v % 5) + 1 });
  }
  ctx.luogu.user = { loggedIn: true, uid: 1, name: "示例用户", avatar: "" };
  ctx.luogu.home = {
    quote: "把每一道题，都当成一次新的开始。",
    heat,
    contest: {
      id: 1,
      name: "CSP-S 模拟赛 #12",
      start: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 36000,
      end: Date.now() + 5 * 3600 * 1000,
      live: false,
    },
    recent: [
      { pid: "P1001", title: "A+B Problem", status: 12, statusText: "AC", score: 100, time: Date.now() - 2 * 60 * 1000 },
      { pid: "P1048", title: "采药", status: 6, statusText: "WA", score: 0, time: Date.now() - 60 * 60 * 1000 },
      { pid: "P1216", title: "数字三角形", status: 12, statusText: "AC", score: 100, time: Date.now() - 26 * 3600 * 1000 },
      { pid: "P1002", title: "过河卒", status: 5, statusText: "TLE", score: 60, time: Date.now() - 30 * 3600 * 1000 },
    ],
    punched: true,
    streak: 7,
    updatedAt: Date.now(),
    error: "",
  };
}

module.exports = { runSmoke, seedDemo };
