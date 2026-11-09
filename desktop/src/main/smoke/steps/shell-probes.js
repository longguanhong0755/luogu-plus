/* 外壳探针：壁纸透出档位 / 广告拦截 / 详情返回与最近关闭恢复。 */
const adblock = require("../../adblock");

async function runGlassProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_GLASS === "1") {
    // R64 回归：「壁纸透出」滑杆必须真实改变内容面/纱层透明度，100% 时归零，
    // 浮层仍保留 60% 可读下限（0.7.0 语义：70→100 线性压到全透）。
    const readGlassVars = () =>
      ctx.win.webContents.executeJavaScript(`(() => ({
        scrim: getComputedStyle(document.documentElement).getPropertyValue("--page-scrim").trim(),
        card: getComputedStyle(document.documentElement).getPropertyValue("--card-alpha").trim(),
        panel: getComputedStyle(document.documentElement).getPropertyValue("--panel-alpha").trim(),
        overlay: getComputedStyle(document.documentElement).getPropertyValue("--overlay-alpha").trim(),
        textShadow: getComputedStyle(document.documentElement).getPropertyValue("--lg-text-shadow").trim(),
      }))()`);
    ctx.cfg.setAppearance({ glass: 0 });
    await ctx.refreshAppearance({ reschedule: false });
    await wait(400);
    const glass0 = await readGlassVars();
    ctx.cfg.setAppearance({ glass: 100 });
    await ctx.refreshAppearance({ reschedule: false });
    await wait(400);
    const glass100 = await readGlassVars();
    const pctNum = (value) => Number(String(value).replace("%", "")) || 0;
    const glassOk =
      pctNum(glass0.scrim) >= 50 &&
      pctNum(glass0.card) >= 55 &&
      pctNum(glass100.scrim) === 0 &&
      pctNum(glass100.card) === 0 &&
      pctNum(glass100.panel) === 0 &&
      pctNum(glass100.overlay) >= 60;
    console.log("SMOKE_GLASS " + JSON.stringify({ glass0, glass100, ok: glassOk }));
    if (!glassOk) console.log("SMOKE_FAIL 壁纸透出 100% 没有归零或浮层可读下限丢失");
    ctx.cfg.setAppearance({ glass: 45 });
    await ctx.refreshAppearance({ reschedule: false });
    await wait(300);
  }
}

async function runAdblockProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_ADBLOCK === "1") {
    // R64 回归：广告与推广固定开启，不存在关闭路径。
    const forcedOn = ctx.cfg.get().general.adBlock === true;
    const wired = adblock.stats().wired;
    const before = adblock.stats().blocked;
    let requestError = "";
    try {
      await ctx.session.fetch("https://doubleclick.net/lgprobe-on-" + Date.now(), { cache: "no-store" });
    } catch (err) {
      requestError = String((err && err.message) || err).slice(0, 80);
    }
    await wait(300);
    const blocked = adblock.stats().blocked - before;
    let dataset = "";
    const wc = ctx.views.currentWebContents();
    if (wc) {
      try {
        const url = wc.getURL();
        if (/^https?:/i.test(url)) dataset = await wc.executeJavaScript("document.documentElement.dataset.lgAdblock || ''");
      } catch {
        dataset = "";
      }
    }
    const adOk = forcedOn && wired && blocked >= 1;
    console.log("SMOKE_ADBLOCK " + JSON.stringify({ forcedOn, wired, blocked, dataset, requestError, ok: adOk }));
    if (!adOk) console.log("SMOKE_FAIL 广告拦截没有强制生效");
  }
}

async function runHistoryProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_HISTORY === "1") {
    // R57 回归：详情页能返回来源列表；最近关闭的页面可一键恢复
    const histPayload = {
      kind: "problems",
      page: 1,
      perPage: 50,
      total: 1,
      items: [
        { type: "problem", pid: "P1001", title: "A+B Problem", difficulty: 1, difficultyName: "入门", difficultyColor: "#fe4c61", submissions: 100, accepted: 60, provider: "洛谷" },
      ],
      needLogin: false,
      categories: [],
      error: "",
    };
    ctx.luogu.libCache.set("problems|1||", { at: Date.now(), payload: histPayload });
    ctx.views.showLibrary("problems");
    await wait(700);
    ctx.views.openDetail("/contest/1", "比赛详情");
    await wait(500);
    const detailInfo = ctx.views.currentInfo();
    ctx.views.back();
    await wait(400);
    const backInfo = ctx.views.currentInfo();
    const backOk = !!detailInfo.canBack && backInfo.kind === "library" && backInfo.library === "problems";
    console.log(
      "SMOKE_HISTORY_BACK " + JSON.stringify({ canBack: detailInfo.canBack, backKind: backInfo.kind, lib: backInfo.library, ok: backOk })
    );
    if (!backOk) console.log("SMOKE_FAIL 详情页返回不到来源列表");

    ctx.views.openProblem("P1001");
    await wait(600);
    const closeEntry = ctx.views.entries.get("problem:P1001");
    const hadEntry = !!closeEntry;
    if (closeEntry) ctx.views.destroyEntry(closeEntry);
    await wait(200);
    const reopenable = ctx.views.canReopen();
    const reopened = ctx.views.reopenClosed();
    await wait(500);
    const reopenInfo = ctx.views.currentInfo();
    const reopenOk =
      hadEntry && reopenable && reopened && reopenInfo.kind === "problem" && reopenInfo.pid === "P1001";
    console.log(
      "SMOKE_HISTORY_REOPEN " +
        JSON.stringify({ hadEntry, reopenable, reopenedKind: reopened && reopened.kind, nowPid: reopenInfo.pid, ok: reopenOk })
    );
    if (!reopenOk) console.log("SMOKE_FAIL 最近关闭恢复失败");
    ctx.views.showHome();
    await wait(300);
  }
}

module.exports = { runGlassProbe, runAdblockProbe, runHistoryProbe };
