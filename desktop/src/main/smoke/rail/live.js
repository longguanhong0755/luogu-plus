/* 侧栏冒烟：训练题单联网腿 / 用户搜索与随机题真实网络腿。 */

async function runLiveCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  if (process.env.LG_SMOKE_TRAINING === "1") {
    try {
      ctx.views.openDetail("/training/117", "【数学1】基础数学问题");
      await waitFor(() => {
        const wc = ctx.views.currentWebContents();
        return !!wc && /\/training\/117(?:$|[?#])/.test(wc.getURL()) && !wc.isLoading();
      }, 24000);
      const trainingWc = ctx.views.currentWebContents();
      if (!trainingWc || !/\/training\/117(?:$|[?#])/.test(trainingWc.getURL())) {
        throw new Error("training/117 navigation timeout");
      }
      await wait(2400);
      const trainingDom = await trainingWc.executeJavaScript(`(() => {
        const text = String(document.body?.innerText || "").trim();
        return {
          title: document.title,
          url: location.href,
          app: !!document.querySelector("#app"),
          appChildren: document.querySelector("#app")?.childElementCount || 0,
          textLength: text.length,
          summary: /题单简介/.test(text) && /题单编号/.test(text) && /117/.test(text),
          trainingId: (() => { try { return Number(JSON.parse(document.getElementById("lentille-context")?.textContent || "{}")?.data?.training?.id) || 0; } catch { return 0; } })(),
          skeletonGone: !document.getElementById("lg-boot-skeleton")
        };
      })()`);
      const trainingShot = await shot("training-117", ctx.win);
      addCase(
        "training-117-loads",
        { trainingDom, trainingShot },
        {
          route: /\/training\/117/.test(trainingDom.url) && trainingDom.app && trainingDom.appChildren > 0,
          titled: /数学1/.test(trainingDom.title) && trainingDom.textLength > 100,
          content: trainingDom.summary && trainingDom.trainingId === 117,
          skeletonCleared: trainingDom.skeletonGone,
        }
      );
    } catch (err) {
      addCase("training-117-loads", { error: String(err && err.message || err) }, { route: false, titled: false, content: false, skeletonCleared: false });
    }
  }

  if (process.env.LG_SMOKE_NET === "1") {
    try {
      const liveUsers = await ctx.luogu.searchUsers("kkksc03");
      addCase(
        "user-search-network",
        { liveUsers },
        {
          ok: !!liveUsers && liveUsers.ok === true,
          hasUser: !!liveUsers && Array.isArray(liveUsers.users) && liveUsers.users.some((user) => Number(user.uid) > 0),
        }
      );
    } catch (err) {
      addCase("user-search-network", { error: err.message }, { ok: false });
    }
    try {
      ctx.luogu.randomCounts.clear();
      if (ctx.store) ctx.store.delete("randomJumpGuard");
      const liveRandom = await ctx.luogu.randomProblem({ difficulty: 1, source: "P" });
      addCase(
        "random-problem-network",
        { liveRandom },
        {
          ok: !!liveRandom && liveRandom.ok === true,
          validPid: !!liveRandom && /^P\d+$/i.test(String(liveRandom.pid || "")),
          title: !!liveRandom && String(liveRandom.title || "").trim().length > 0,
        }
      );
    } catch (err) {
      addCase("random-problem-network", { error: err.message }, { ok: false });
    } finally {
      if (ctx.store) ctx.store.delete("randomJumpGuard");
    }
  }
}

module.exports = { runLiveCases };
