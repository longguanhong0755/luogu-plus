/* 登录后诊断输出：上下文直连 / 首页数据 / 记录 / 打卡 / 比赛与语言表 / 头像入口。 */

async function reportLoginState(ctx, wait, outDir, state) {
  const diag = await ctx.luogu.exec(`(async () => {
    const out = {};
    const paths = ["/contest/list", "/user/${state.uid}", "/record/list?user=${state.uid}"];
    for (const p of paths) {
      try {
        const r = await fetch("https://www.luogu.com.cn" + p, { credentials: "include" });
        const t = await r.text();
        out[p] = {
          status: r.status,
          url: String(r.url).slice(0, 100),
          len: t.length,
          hasCtx: t.indexOf("lentille-context") !== -1,
          hasUid: t.indexOf("${state.uid}") !== -1,
          head: t.slice(0, 90)
        };
      } catch (e) {
        out[p] = { error: String(e).slice(0, 120) };
      }
    }
    out.pageHref = location.href.slice(0, 100);
    out.cookieHasUid = document.cookie.indexOf("_uid") !== -1;
    return out;
  })()`);
  console.log("LGTEST_DIAG " + JSON.stringify(diag));

  // 隐藏窗口在登录前加载过首页，刷新一次让打卡按钮出现
  try {
    ctx.luogu.reloadHidden();
  } catch {
    /* ignore */
  }
  await wait(2600);

  ctx.views.showHome();
  const refreshState = await ctx.luogu.refresh(true);
  const home = (refreshState && refreshState.home) || {};
  console.log(
    "LGTEST user=" +
      JSON.stringify({ uid: ctx.luogu.user.uid, name: ctx.luogu.user.name, avatar: !!ctx.luogu.user.avatar })
  );
  console.log(
    "LGTEST home=" +
      JSON.stringify({
        punched: home.punched,
        streak: home.streak,
        heatDays: (home.heat || []).filter((d) => d.count > 0).length,
        recent: (home.recent || []).length,
        contest: home.contest ? home.contest.name : null,
        error: home.error || "",
      })
  );

  const records = await ctx.luogu.fetchLibrary("record", { page: 1, force: true });
  console.log(
    "LGTEST records=" +
      JSON.stringify({
        items: (records.items || []).length,
        needLogin: records.needLogin,
        error: records.error || "",
        first: records.items && records.items[0] ? { pid: records.items[0].pid, status: records.items[0].statusText } : null,
      })
  );

  const punch = await ctx.luogu.checkin();
  console.log("LGTEST checkin=" + JSON.stringify({ ok: punch.ok, already: punch.already, message: punch.message || "" }));

  return punch;
}

async function reportPunchFailure(ctx, punch) {
  if (!punch.ok) {
    const pageDbg = await ctx.luogu.exec(`(() => ({
      title: document.title,
      href: location.href.slice(0, 100),
      buttons: document.querySelectorAll("button").length,
      anchors: document.querySelectorAll("a").length,
      punchTextCount: ((document.body.innerText || "").match(/打卡|签到/g) || []).length,
      punchEl: (() => {
        const el = [...document.querySelectorAll("*")].find((n) => n.childElementCount === 0 && /打卡|签到/.test(n.textContent || ""));
        return el ? el.tagName + "." + String(el.className).slice(0, 40) : "";
      })(),
      csrfMeta: (document.querySelector('meta[name="csrf-token"]') || {}).content || "",
      csrfGlobals: Object.keys(window).filter((k) => /csrf|token/i.test(k)).slice(0, 10),
      csrfWin: typeof window._FeCSRFToken !== "undefined" ? String(window._FeCSRFToken).slice(0, 8) : "",
      cookieNames: document.cookie.split(";").map((x) => x.trim().split("=")[0]).slice(0, 10)
    }))()`);
    console.log("LGTEST_PAGE " + JSON.stringify(pageDbg));
  }
}

async function reportContestProbes(ctx) {
  // 结构探针：登录态下的比赛列表与题目页语言表
  const contestCtx = await ctx.luogu.fetchContext("/contest/list");
  console.log(
    "LGTEST_CONTEST " +
      JSON.stringify(
        contestCtx
          ? {
              dataKeys: Object.keys(contestCtx.data || {}),
              first: contestCtx.data && contestCtx.data.contests && contestCtx.data.contests.result
                ? JSON.stringify(contestCtx.data.contests.result[0]).slice(0, 240)
                : null,
            }
          : null
      )
  );
  const parsedContests = ctx.luogu.parseContests(contestCtx);
  console.log(
    "LGTEST_PICK " +
      JSON.stringify({ parsedLen: parsedContests.length, picked: ctx.luogu.pickContest(parsedContests) })
  );
  const problemCtx = await ctx.luogu.fetchContext("/problem/P1001");
  console.log(
    "LGTEST_LANGS " +
      JSON.stringify(
        problemCtx
          ? {
              lastLanguage: problemCtx.data ? problemCtx.data.lastLanguage : null,
              lastCodeLen: problemCtx.data && problemCtx.data.lastCode ? String(problemCtx.data.lastCode).length : 0,
              acceptLanguages: problemCtx.data && problemCtx.data.problem ? problemCtx.data.problem.acceptLanguages : null,
            }
          : null
      )
  );

  const refreshState2 = await ctx.luogu.refresh(true);
  const home2 = (refreshState2 && refreshState2.home) || {};
  console.log(
    "LGTEST home2=" +
      JSON.stringify({
        heatDays: (home2.heat || []).filter((d) => d.count > 0).length,
        recent: (home2.recent || []).length,
        contest: home2.contest ? home2.contest.name : null,
        error: home2.error || "",
      })
  );
}

async function reportProfileEntry(ctx, wait) {
  // 头像打开独立个人主页，且侧栏任何项目都不高亮
  try {
    await ctx.win.webContents.executeJavaScript(`document.getElementById("tb-avatar").click()`);
    await wait(1800);
    const entry = ctx.views.currentEntry();
    const railState = await ctx.win.webContents.executeJavaScript(`(() => ({
      active: document.querySelectorAll('#rail .active, #rail [aria-current="page"]').length,
      navPressed: [...document.querySelectorAll("#rail .rail-btn")].filter((b) => b.getAttribute("aria-pressed") === "true").length,
    }))()`);
    console.log(
      "LGTEST_PROFILE " +
        JSON.stringify({
          key: entry ? entry.key : null,
          url: entry ? entry.view.webContents.getURL() : null,
          active: railState.active,
          navPressed: railState.navPressed,
        })
    );
  } catch (err) {
    console.log("SMOKE_FAIL profile probe: " + err.message);
  }
}

module.exports = { reportLoginState, reportPunchFailure, reportContestProbes, reportProfileEntry };
