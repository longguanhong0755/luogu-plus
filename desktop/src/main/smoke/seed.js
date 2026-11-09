/* 演示数据：只给截图用，不代表真实账号。 */

function seedDemo(ctx) {
  const now = new Date();
  const heat = [];
  for (let i = 181; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const v = (i * 7 + Math.floor(i / 9) * 3) % 11;
    heat.push({ date: key, count: v < 3 ? 0 : (v % 5) + 1 });
  }
  const acProgress = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const passed = i % 6 === 0 ? 1 : 0;
    acProgress.push({ date: key, passed, cumulative: Math.max(0, 18 + Math.floor((29 - i) / 2)) });
  }
  const emptyHome = process.env.LG_SMOKE_EMPTY_HOME === "1";
  if (emptyHome) {
    for (const item of heat) item.count = 0;
    for (const item of acProgress) {
      item.passed = 0;
      item.cumulative = 0;
    }
  }
  ctx.luogu.user = {
    loggedIn: true,
    uid: 1,
    name: "示例用户",
    avatar: "",
    submittedProblemCount: emptyHome ? 0 : 238,
    passedProblemCount: emptyHome ? 0 : 162,
    ranking: emptyHome ? null : 8950,
  };
  ctx.luogu.home = {
    quote: "把每一道题，都当成一次新的开始。",
    heat,
    acProgress,
    acRecentTotal: acProgress[acProgress.length - 1].cumulative,
    contest: {
      id: 1,
      name: "CSP-S 模拟赛 #12",
      start: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 36000,
      end: Date.now() + 5 * 3600 * 1000,
      live: false,
    },
    contests: [
      { id: 1, name: "CSP-S 模拟赛 #12", start: Date.now() + 2 * 3600 * 1000, end: Date.now() + 5 * 3600 * 1000, live: false },
      { id: 2, name: "洛谷 11 月月赛 I", start: Date.now() + 26 * 3600 * 1000, end: Date.now() + 29 * 3600 * 1000, live: false },
    ],
    official: {
      ok: true,
      countdowns: [
        { name: "CSP-J/S 2026 第二轮", days: 3 },
        { name: "NOIP 2026", days: 27 },
      ],
      fortune: {
        result: "大凶",
        good: "",
        bad: "发朋友圈",
        advice: ["诸事不宜", "忌：发朋友圈\n会被当做卖面膜的", "忌：写洛谷日报\n发现还差得远"],
        text: "§ 大凶 §\n诸事不宜\n\n忌：发朋友圈\n会被当做卖面膜的\n忌：写洛谷日报\n发现还差得远\n你已经在洛谷连续打卡了 7 天",
      },
      sections: {
        announcement: { text: "本站公告与站内动态会同步显示在这里。", links: [] },
        tasks: {
          text: "任务计划\n完成每日一题\n练习训练题单\n参加近期比赛",
          items: [
            { title: "完成每日一题", meta: "今日任务 · 1 / 1", url: "https://www.luogu.com.cn/problem/P1001" },
            { title: "练习训练题单", meta: "基础数学 · 3 / 8", url: "https://www.luogu.com.cn/training/117" },
            { title: "参加近期比赛", meta: "周末挑战", url: "https://www.luogu.com.cn/contest" },
          ],
        },
        discussions: {
          items: [
            { title: "如何规划本月的训练计划？", author: "示例用户", replies: 12, url: "https://www.luogu.com.cn/discuss/1" },
            { title: "赛后复盘应该记录哪些内容？", author: "洛谷用户", replies: 8, url: "https://www.luogu.com.cn/discuss/2" },
          ],
        },
      },
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

module.exports = { seedDemo };
