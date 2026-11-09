/* 列表点击 / 语言表 / 视觉指标探针。 */

async function runListClickProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_LIST_CLICK === "1") {
    // P0 回归：列表行必须能被鼠标左键打开（数据打桩进 libCache，不联网）
    const clickPayload = {
      kind: "problems",
      page: 1,
      perPage: 50,
      total: 3,
      items: [
        { type: "problem", pid: "P1001", title: "A+B Problem", difficulty: 1, difficultyName: "入门", difficultyColor: "#fe4c61", submissions: 100, accepted: 60, provider: "洛谷" },
        { type: "problem", pid: "P1002", title: "过河卒", difficulty: 3, difficultyName: "普及/提高−", difficultyColor: "#f39c11", submissions: 82, accepted: 41, provider: "洛谷" },
        { type: "problem", pid: "P1003", title: "铺地毯", difficulty: 2, difficultyName: "普及−", difficultyColor: "#ffc116", submissions: 61, accepted: 37, provider: "洛谷" },
      ],
      needLogin: false,
      categories: [],
      error: "",
    };
    ctx.luogu.libCache.set("problems|1||", { at: Date.now(), payload: clickPayload });
    ctx.views.showLibrary("problems");
    await wait(900);
    const clickBefore = ctx.views.currentInfo();
    const clickResult = await ctx.win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector("#library .lib-row");
      if (!row) return "no-row";
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return "clicked";
    })()`);
    await wait(1200);
    const clickAfter = ctx.views.currentInfo();
    const clickOk =
      clickBefore.kind === "library" &&
      clickResult === "clicked" &&
      clickAfter.kind === "problem" &&
      clickAfter.pid === "P1001";
    console.log(
      "SMOKE_LIST_CLICK " +
        JSON.stringify({ before: clickBefore.kind, click: clickResult, after: clickAfter.kind, pid: clickAfter.pid, ok: clickOk })
    );
    if (!clickOk) console.log("SMOKE_FAIL 列表行点击没有打开题目");
    ctx.views.showHome();
    await wait(300);
  }
}

async function runLangTableProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_LANG === "1") {
    // P0 回归：语言表映射正确；联网时再和真实 /_lfe/config 对照
    const { LANGS, resolveLangId } = require("../../langs");
    const expect = {
      "C++14 (GCC 9)": 28,
      "C++14": 11,
      "C++17": 12,
      "C++20": 27,
      "C++23": 34,
      "C++11": 4,
      "C++98": 3,
      C: 2,
      "Python 3": 7,
      Pascal: 1,
      "Java 8": 8,
      "Java 21": 33,
      Rust: 15,
      Go: 14,
    };
    const mismatch = Object.entries(expect).filter(([name, id]) => {
      const got = resolveLangId(name);
      return !got || got.id !== id || got.o2 === undefined;
    });
    const unknown = resolveLangId("Brainfuck");
    console.log("SMOKE_LANG_TABLE " + JSON.stringify({ langs: LANGS.length, mismatch, unknownRejected: unknown === null }));
    if (mismatch.length || unknown !== null) console.log("SMOKE_FAIL 语言表映射错误");
    if (process.env.LG_SMOKE_NET === "1") {
      const live = await ctx.luogu.exec(
        `(async () => { try { const r = await fetch("/_lfe/config", { credentials: "include" }); return await r.json(); } catch { return null; } })()`
      );
      if (live && live.CodeLanguage) {
        const byName = new Map(Object.values(live.CodeLanguage).map((item) => [item.name, item]));
        const drift = LANGS.filter((lang) => {
          const cur = byName.get(lang.name);
          return !cur || cur.id !== lang.id || !!cur.canO2 !== !!lang.o2;
        }).map((lang) => lang.name);
        console.log("SMOKE_LANG_LIVE " + JSON.stringify({ liveCount: byName.size, drift }));
        if (drift.length) console.log("SMOKE_FAIL 线上语言表漂移: " + drift.join(","));
      } else {
        console.log("SMOKE_LANG_LIVE skipped（config 拉取失败）");
      }
    }
  }
}

async function runVisualProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_VISUAL === "1") {
    // 显式回主页并等待渲染就绪（新 profile 下 home 数据异步到达，直读会拿空 DOM）
    ctx.views.showHome();
    for (let i = 0; i < 20; i++) {
      const ready = await ctx.win.webContents
        .executeJavaScript(`!!document.querySelector(".home-wrap")`)
        .catch(() => false);
      if (ready) break;
      await wait(300);
    }
    await wait(400);
    await ctx.win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true, bubbles: true }))`
    );
    await wait(700);
    await shot("palette");
    await ctx.win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }))`
    );
    await wait(300);
    await ctx.win.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true, bubbles: true }))`
    );
    await wait(700);
    await shot("switcher");
    await ctx.win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }))`
    );
    await wait(300);
    ctx.toast("已保存", "草稿已保存到本机，断网也不会丢。");
    await wait(500);
    await shot("toast");
    await ctx.win.webContents.executeJavaScript(`document.querySelector(".toast") && document.querySelector(".toast").click()`);
    await wait(250);
    const metrics = await ctx.win.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s);
      const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.x * 10) / 10 }; };
      const css = (s) => { const e = q(s); return e ? getComputedStyle(e) : null; };
      return {
        rail: rect("#rail"),
        title: rect("#titlebar"),
        avatar: rect("#tb-avatar"),
        titlePadding: css("#titlebar") ? css("#titlebar").paddingRight : "",
        innerWidth: window.innerWidth,
        toolbar: rect("#toolbar"),
        contentBg: css("#content") ? css("#content").backgroundColor : "",
        homeMax: css(".home-wrap") ? css(".home-wrap").maxWidth : "",
        heatCell: rect(".heat-map-cell"),
        cardRadius: css(".card") ? css(".card").borderRadius : "",
        bodyFont: css("body") ? css("body").fontSize : "",
        heatLegend: !!q(".heat-map-legend"),
        statsCard: !!q(".official-profile-stats"),
        sidebarLabel: q("#rail-top .rail-label") ? q("#rail-top .rail-label").textContent : "",
        homeCards: document.querySelectorAll(".home-wrap .card").length,
        homeGreeting: !!q(".home-greeting"),
        homeDaily: !!q(".home-daily"),
        firstRunCard: !!q(".firstrun-card"),
        welcomeCard: !!q(".welcome-card"),
        fortuneChips: document.querySelectorAll(".home-fortune-panel").length,
        countdownChips: document.querySelectorAll(".home-countdown").length,
        calRows: document.querySelectorAll(".cal-row").length,
        cdRows: document.querySelectorAll(".cd-row").length
      };
    })()`);
    console.log("SMOKE_VISUAL_METRICS " + JSON.stringify(metrics));
  }
}

module.exports = { runListClickProbe, runLangTableProbe, runVisualProbe };
