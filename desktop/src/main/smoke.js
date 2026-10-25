/* 仅测试用：不可见冒烟启动、截图、皮肤/深色审计；以及演示数据。
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
    const win = target || ctx.win;
    let image = await win.capturePage();
    for (let attempt = 0; attempt < 3 && image.isEmpty(); attempt++) {
      await wait(700);
      image = await win.capturePage();
    }
    const file = path.join(outDir, `smoke-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log("SMOKE_SHOT " + name + " " + file);
    return file;
  };

  const capture = async () => {
    try {
      if (process.env.LG_SMOKE_THEME === "light" || process.env.LG_SMOKE_THEME === "dark") {
        ctx.cfg.setAppearance({ mode: process.env.LG_SMOKE_THEME });
        await ctx.refreshAppearance();
        await wait(700);
      }
      if (process.env.LG_SMOKE_FOLDER) {
        ctx.cfg.setAppearance({
          wallpaper: "folder",
          wallpaperDir: process.env.LG_SMOKE_FOLDER,
          wallpaperInterval: 15,
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(500);
        console.log("SMOKE_WALL_FOLDER " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
        await ctx.nextWallpaper();
        console.log("SMOKE_WALL_NEXT " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
      }
      if (process.env.LG_SMOKE_WE) {
        const items = ctx.scanWe(process.env.LG_SMOKE_WE);
        const first = process.env.LG_SMOKE_WE_ID
          ? items.find((item) => item.id === process.env.LG_SMOKE_WE_ID) || items[0]
          : items.find((item) => item.playable) || items[0];
        ctx.cfg.setAppearance({
          wallpaper: "we",
          weRoot: process.env.LG_SMOKE_WE,
          weId: first ? first.id : "",
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(600);
        console.log("SMOKE_WALL_WE " + JSON.stringify({ count: items.length, items: items.slice(0, 3), label: ctx.wallpaper.label, video: ctx.wallpaper.video }));
      }
      ctx.win.setOpacity(0);
      ctx.win.showInactive();
      await wait(process.env.LG_SMOKE_NET === "1" ? 9000 : 1400);
      const homeShot = await shot("home");
      console.log("SMOKE_OK " + homeShot);

      if (process.env.LG_SMOKE_LIB === "1") {
        const libKinds = String(process.env.LG_SMOKE_LIB_ONLY || "problems,contest,article,discuss,training,record")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        for (const kind of libKinds) {
          ctx.views.showLibrary(kind);
          await wait(process.env.LG_SMOKE_NET === "1" ? 2600 : 700);
          await shot("lib-" + kind);
        }
        ctx.views.showHome();
        await wait(400);
      }

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
              JSON.stringify(entry.view.getBounds())
          );
          let viewImage = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              viewImage = await entry.view.webContents.capturePage();
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
            console.log("SMOKE_SHOT problem-view SKIPPED（隐藏窗口取帧不稳定，非产品问题）");
          }
          try {
            const skin = await entry.view.webContents.executeJavaScript(`(() => {
              const probe = getComputedStyle(document.body, "::before");
              return {
                bgImage: probe.backgroundImage.slice(0, 160),
                bgSize: probe.backgroundSize,
                scrim: getComputedStyle(document.documentElement).getPropertyValue("--lg-scrim").trim(),
                backdrop: probe.transform,
                bodyBg: getComputedStyle(document.body).backgroundColor,
                htmlBg: getComputedStyle(document.documentElement).backgroundColor
              };
            })()`);
            console.log("SMOKE_SKIN " + JSON.stringify(skin));
          } catch (err) {
            console.log("SMOKE_SKIN probe failed: " + err.message);
          }
        }
      }

      if (process.env.LG_SMOKE_AUDIT === "1") {
        await runAudit(ctx, outDir, wait);
      }

      ctx.openSettings();
      await wait(1400);
      if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
        ctx.settingsWin.setOpacity(0);
        await shot("settings", ctx.settingsWin);
        if (process.env.LG_SMOKE_DEBUG === "1") {
          const dbg = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
            const box = document.getElementById("wallpaper");
            const layers = box ? [...box.querySelectorAll(".wall-layer")] : [];
            return {
              hasBox: !!box,
              layers: layers.length,
              opacity: layers.map((l) => getComputedStyle(l).opacity),
              bg: layers.map((l) => getComputedStyle(l).backgroundImage.slice(0, 100)),
              htmlBg: getComputedStyle(document.documentElement).backgroundColor,
              bodyBg: getComputedStyle(document.body).backgroundColor,
              appBg: getComputedStyle(document.getElementById("app")).backgroundColor,
              paneBg: getComputedStyle(document.querySelector(".set-pane")).backgroundColor,
              rect: box ? JSON.stringify(box.getBoundingClientRect()) : ""
            };
          })()`);
          console.log("SMOKE_SETTINGS " + JSON.stringify(dbg));
        }
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="wallpaper"]').click()`
        );
        await wait(900);
        const wallShown = await ctx.settingsWin.webContents.executeJavaScript(
          `!document.querySelector('[data-panel="wallpaper"]').hidden`
        );
        console.log("SMOKE_SETTINGS_SECTION " + wallShown);
        await shot("settings-wallpaper", ctx.settingsWin);
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="rail"]').click()`
        );
        await wait(400);
        await shot("settings-rail", ctx.settingsWin);

        if (process.env.LG_SMOKE_RAIL === "1") {
          const before = ctx.cfg.get().rail.order.slice();
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelectorAll('#rail-list .rail-mini')[1] && document.querySelectorAll('#rail-list .rail-mini')[1].click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelector('#rail-list .rail-eye') && document.querySelector('#rail-list .rail-eye').click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `(() => { const f = document.getElementById('rail-add'); document.getElementById('rail-add-label').value = 'GitHub'; document.getElementById('rail-add-url').value = 'https://github.com'; f.requestSubmit(); })()`
          );
          await wait(450);
          const railState = ctx.cfg.get().rail;
          const railDom = await ctx.win.webContents.executeJavaScript(
            `[...document.querySelectorAll('#rail-top .rail-btn')].map((b) => ({ id: b.dataset.id, title: b.title }))`
          );
          console.log("SMOKE_RAIL " + JSON.stringify({ before, order: railState.order, hidden: railState.hidden, custom: railState.custom, dom: railDom }));
          await shot("settings-rail-after", ctx.settingsWin);
          ctx.cfg.resetRail();
          ctx.broadcastState();
        }
      }
    } catch (err) {
      console.error("SMOKE_FAIL " + (err && err.stack ? err.stack : err.message));
    }
    app.quitting = true;
    app.quit();
  };

  if (ctx.win.webContents.isLoading()) ctx.win.webContents.once("did-finish-load", capture);
  else capture();
}

async function loadAndWait(ctx, url, title) {
  ctx.views.openDetail(url, title, "audit");
  const wc = ctx.views.currentWebContents();
  if (!wc) return null;
  for (let i = 0; i < 80; i++) {
    if (!wc.isLoading()) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 900));
  return wc;
}

async function runAudit(ctx, outDir, wait) {
  const only = String(process.env.LG_AUDIT_ONLY || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pages = [
    ["problem", "https://www.luogu.com.cn/problem/P1001"],
    ["article", "https://www.luogu.com.cn/article"],
    ["discuss", "https://www.luogu.com.cn/discuss"],
    ["training", "https://www.luogu.com.cn/training/100"],
    ["user", "https://www.luogu.com.cn/user/1"],
    ["login", "https://www.luogu.com.cn/auth/login"],
  ].filter(([name]) => !only.length || only.includes(name));
  const report = {};
  for (const [name, url] of pages) {
    const wc = await loadAndWait(ctx, url, name);
    if (!wc) continue;
    try {
      const data = await wc.executeJavaScript(`(() => {
        const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
        const parse = (c) => {
          const s = String(c || "").trim();
          let m = s.match(/^#([0-9a-f]{6})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
          }
          m = s.match(/^#([0-9a-f]{3})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
          }
          m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
          m = s.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
          return null;
        };
        const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        const pathOf = (el) => {
          const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
          return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
        };
        const themeBg = parse(getComputedStyle(document.documentElement).getPropertyValue("--lg-bg").trim()) || { r: 27, g: 28, b: 32, a: 1 };
        const effectiveBg = (el) => {
          let node = el;
          while (node) {
            const bg = parse(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0.5) return bg;
            node = node.parentElement;
          }
          return themeBg;
        };
        const contrast = (a, b) => {
          const L = (c) => {
            const f = (v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
          };
          const l1 = L(a);
          const l2 = L(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const light = new Map();
        const darkText = new Map();
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.height < 8) continue;
          if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          const bg = parse(cs.backgroundColor);
          if (isDark && bg && bg.a > 0.5 && lum(bg) > 0.55) {
            const key = pathOf(el);
            const item = light.get(key);
            const area = Math.round(r.width * r.height);
            if (!item || item.area < area) light.set(key, {
              path: key,
              bg: cs.backgroundColor,
              color: cs.color,
              area,
              chain: [el.parentElement, el.parentElement && el.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
              html: el.outerHTML.slice(0, 220),
              text: (el.textContent || "").trim().slice(0, 40)
            });
          }
          const text = (el.textContent || "").trim();
          if (text && el.childElementCount === 0) {
            const fg = parse(cs.color);
            if (fg && fg.a > 0.5) {
              const ratio = contrast(fg, effectiveBg(el));
              if (ratio < 3.0) {
                const key = pathOf(el);
                darkText.set(key, {
                  path: key,
                  color: cs.color,
                  fontSize: cs.fontSize,
                  ratio: Math.round(ratio * 100) / 100,
                  chain: [el.parentElement, el.parentElement && el.parentElement.parentElement, el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
                  html: el.outerHTML.slice(0, 220),
                  text: text.slice(0, 40)
                });
              }
            }
          }
        }
        const vars = {};
        const cs = getComputedStyle(document.documentElement);
        for (const name of ["--theme-body-back","--theme-body-color","--theme-body-image","--theme-card-background","--theme-navi-back","--theme-dropdown","--theme-tooltip"]) {
          vars[name] = cs.getPropertyValue(name).trim().slice(0, 80);
        }
        return {
          isDark,
          passkeyGuard: window.__lgPasskeyGuard === true,
          light: [...light.values()].sort((a, b) => b.area - a.area).slice(0, 35),
          darkText: [...darkText.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 30),
          vars
        };
      })()`);
      report[name] = data;
      if (name === "login" || name === "user" || name === "article") {
        try {
          const image = await wc.capturePage();
          fs.writeFileSync(path.join(outDir, `audit-${name}.png`), image.toPNG());
          console.log("SMOKE_SHOT audit-" + name);
        } catch {
          /* ignore */
        }
      }
      console.log("AUDIT_" + name.toUpperCase() + " light=" + data.light.length + " darkText=" + data.darkText.length + " passkey=" + data.passkeyGuard);
      console.log("AUDIT_LIGHT_" + name.toUpperCase() + " " + JSON.stringify(data.light.slice(0, 6)));
      if (data.darkText.length) console.log("AUDIT_DARKTEXT_" + name.toUpperCase() + " " + JSON.stringify(data.darkText.slice(0, 8)));
    } catch (err) {
      console.log("AUDIT_FAIL_" + name + " " + err.message);
    }
    await wait(300);
  }
  fs.writeFileSync(path.join(outDir, "audit-dark.json"), JSON.stringify(report, null, 2));
  console.log("SMOKE_AUDIT " + path.join(outDir, "audit-dark.json"));
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
