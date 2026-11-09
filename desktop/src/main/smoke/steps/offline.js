/* 断网链路端到端：缓存列表 / lgoff 快照 / 离线队列与重放。 */
const fs = require("node:fs");
const path = require("node:path");

async function runOfflineStep({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_OFFLINE === "1") {
    /* 断网链路端到端：全程不联网。
       1) 强制离线 → 列表走缓存（stale 标记）；
       2) 打开题目 → lgoff:// 本地快照页可读；
       3) 提交 → 进离线队列；
       4) 恢复在线（submit/refresh 打桩避免真实网络）→ 队列自动重放清空。 */
    if (ctx.luogu.onlineTimer) {
      clearInterval(ctx.luogu.onlineTimer);
      ctx.luogu.onlineTimer = null;
    }
    ctx.luogu.setOnline(false);

    const libPayload = {
      kind: "problems",
      page: 1,
      perPage: 50,
      total: 10,
      items: [
        ["P1001", "A+B Problem（离线缓存）", 1, "入门", "#fe4c61", 100, 60],
        ["P1002", "过河卒", 3, "普及/提高−", "#f39c11", 820000, 410000],
        ["P1003", "铺地毯", 2, "普及−", "#ffc116", 610000, 370000],
        ["P1004", "方格取数", 4, "普及+/提高", "#52c41a", 390000, 210000],
        ["P1005", "矩阵取数游戏", 5, "提高+/省选−", "#3498db", 180000, 62000],
        ["P1006", "传纸条", 4, "普及+/提高", "#52c41a", 300000, 170000],
        ["P1007", "独木桥", 3, "普及/提高−", "#f39c11", 210000, 120000],
        ["P1008", "三连击", 2, "普及−", "#ffc116", 720000, 510000],
        ["P1009", "阶乘之和", 2, "普及−", "#ffc116", 650000, 390000],
        ["P1010", "幂次方", 3, "普及/提高−", "#f39c11", 240000, 160000],
      ].map(([pid, title, difficulty, difficultyName, difficultyColor, submissions, accepted]) => ({
        type: "problem",
        pid,
        title,
        difficulty,
        difficultyName,
        difficultyColor,
        submissions,
        accepted,
        provider: "洛谷",
      })),
      needLogin: false,
      categories: [],
      error: "",
    };
    ctx.store.set("lib:problems|1||", { key: "lib:problems|1||", at: Date.now(), payload: libPayload }, 0);
    ctx.store.flush("lib:problems|1||");
    ctx.luogu.saveProblemSnapshot(
      "P1001",
      "A+B Problem",
      "<h2>题目描述</h2><p>OFFLINE_SNAPSHOT_MARKER 输入两个整数 a 和 b，输出它们的和。</p><p>输入格式：一行两个整数 a 和 b。输出格式：一行一个整数，表示 a+b。数据范围：1 ≤ a, b ≤ 1000，保证结果在 32 位整数范围内。</p><p>样例输入：<code>1 2</code>；样例输出：<code>3</code>。本题考察最基本的输入输出与算术运算，注意使用正确的读入方式并换行输出。</p><pre><code>#include &lt;iostream&gt;</code></pre>"
    );
    ctx.store.flush("problem:P1001");
    ctx.store.set(
      "home",
      {
        quote: "离线也能刷题。",
        heat: [],
        contest: null,
        recent: [{ pid: "P1001", title: "A+B Problem", status: 12, statusText: "AC", score: 100, time: Date.now() }],
        punched: true,
        streak: 3,
        updatedAt: Date.now(),
        error: "",
      },
      0
    );
    ctx.store.flush("home");
    ctx.luogu.home = ctx.store.get("home");

    const libOff = await ctx.luogu.fetchLibrary("problems", { force: true });
    console.log(
      "SMOKE_OFFLINE_LIB " +
        JSON.stringify({
          stale: !!libOff.stale,
          offline: !!libOff.offline,
          items: libOff.items.length,
          first: libOff.items[0] && libOff.items[0].pid,
        })
    );

    ctx.views.showLibrary("problems");
    await wait(900);
    await shot("offline-lib");
    ctx.views.showHome();
    await wait(500);

    ctx.views.openProblem("P1001");
    // ensureEntry 要先装 CDP 守卫（最多 5s）再 loadURL(lgoff)，这里等足
    await wait(7000);
    const snapUrl = ctx.luogu.problemSnapshotUrl("P1001");
    const offEntry = ctx.views.currentEntry();
    const offUrl = offEntry ? offEntry.view.webContents.getURL() : "";
    let offProbe = null;
    if (offEntry && offUrl.startsWith("lgoff://")) {
      try {
        offProbe = await offEntry.view.webContents.executeJavaScript(
          `(() => ({ marker: document.body.innerText.indexOf("OFFLINE_SNAPSHOT_MARKER") >= 0, bar: !!document.querySelector(".lg-off-bar"), bg: getComputedStyle(document.body).backgroundColor }))()`
        );
      } catch (err) {
        offProbe = { error: String(err.message).slice(0, 100) };
      }
    }
    console.log("SMOKE_OFFLINE_PROBLEM " + JSON.stringify({ url: offUrl, snapUrl, probe: offProbe }));
    await shot("offline-problem");
    await shotView("offline-problem-view");
    if (offEntry) {
      try {
        const offImage = await offEntry.view.webContents.capturePage(undefined, { stayHidden: true });
        if (offImage && !offImage.isEmpty()) {
          fs.writeFileSync(path.join(outDir, "smoke-offline-problem-view.png"), offImage.toPNG());
          console.log("SMOKE_SHOT offline-problem-view");
        }
      } catch {
        /* 隐藏窗口取帧不稳定，非产品问题 */
      }
    }

    // 未缓存的题：离线时应出「没有快照」提示页，而不是空白 + 加载失败弹窗
    ctx.views.openProblem("P9999");
    await wait(7000);
    const missEntry = ctx.views.currentEntry();
    const missUrl = missEntry ? missEntry.view.webContents.getURL() : "";
    let missProbe = null;
    try {
      missProbe = await missEntry.view.webContents.executeJavaScript(
        `(() => ({ text: document.body.innerText.slice(0, 120), hasBox: !!document.querySelector(".box") }))()`
      );
    } catch (err) {
      missProbe = { error: String(err.message).slice(0, 100) };
    }
    console.log("SMOKE_OFFLINE_MISSING " + JSON.stringify({ url: missUrl, probe: missProbe }));

    const queuedRes = await ctx.luogu.enqueueSubmit("P1001", "#include <iostream>\nint main() {}", "C++14", "当前离线");
    const qBefore = ctx.luogu.queueState();
    console.log(
      "SMOKE_OFFLINE_QUEUE " +
        JSON.stringify({ queued: !!queuedRes.queued, count: qBefore.count, statuses: qBefore.items.map((item) => item.status) })
    );

    ctx.views.showHome();
    await wait(700);
    await shot("offline-home");

    const realSubmit = ctx.luogu.submit.bind(ctx.luogu);
    const realRefresh = ctx.luogu.refresh.bind(ctx.luogu);
    ctx.luogu.submit = async () => ({ ok: true, rid: "RTEST" });
    ctx.luogu.refresh = async () => ctx.luogu.state();
    ctx.luogu.setOnline(true);
    // flushQueue 每条处理后有 1.5s 间隔，等清理写盘完成再断言
    await wait(3400);
    const qAfter = ctx.luogu.queueState();
    console.log("SMOKE_OFFLINE_FLUSH " + JSON.stringify({ count: qAfter.count, items: qAfter.items.length }));
    ctx.luogu.submit = realSubmit;
    ctx.luogu.refresh = realRefresh;
  }
}

module.exports = { runOfflineStep };
