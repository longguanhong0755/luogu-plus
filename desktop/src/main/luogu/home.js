/* 洛谷数据服务 · 主页热度/累计通过/最近提交/比赛聚合（拆分自 src/main/luogu.js）。 */
const { STATUS_TEXT } = require("./consts");
const { dayKey, toMillis } = require("./util");

const homeMethods = {
  buildHeat(records, dailyCounts) {
    const counts = new Map();
    for (const item of Array.isArray(dailyCounts) ? dailyCounts : []) {
      if (!item || !item.date) continue;
      counts.set(String(item.date).slice(0, 10), Math.max(0, Number(item.count) || 0));
    }
    if (!counts.size) {
      for (const record of records) {
        const ms = toMillis(record.submitTime || record.time);
        if (!ms) continue;
        const key = dayKey(new Date(ms));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 与个人中心一致：26 周、以周日为一列，覆盖约半年。
    const end = new Date(today);
    end.setDate(today.getDate() + (6 - today.getDay()));
    const start = new Date(end);
    start.setDate(end.getDate() - 26 * 7 + 1);
    const days = [];
    for (let i = 0; i < 26 * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      days.push({ date: key, count: counts.get(key) || 0 });
    }
    return days;
  },

  /* 主页累计通过趋势：按题目去重，只统计首次通过，避免同一题重复提交把曲线抬高。 */
  buildProgress(records, days = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - days + 1);
    const startKey = dayKey(start);
    const todayKey = dayKey(today);
    const firstAccepted = new Map();
    for (const record of records) {
      if (Number(record && record.status) !== 12) continue;
      const ms = toMillis(record.submitTime || record.time);
      if (!ms) continue;
      const problem = record.problem || {};
      const pid = String(problem.pid || record.pid || "").toUpperCase();
      if (!pid) continue;
      if (!firstAccepted.has(pid) || ms < firstAccepted.get(pid)) firstAccepted.set(pid, ms);
    }
    const byDay = new Map();
    for (const ms of firstAccepted.values()) {
      const day = dayKey(new Date(ms));
      // 窗口前已经 AC 过的老题，窗口内再次 AC 不算“新通过”。
      if (day < startKey || day > todayKey) continue;
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    let cumulative = 0;
    const points = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const date = dayKey(d);
      const passed = byDay.get(date) || 0;
      cumulative += passed;
      points.push({ date, passed, cumulative });
    }
    return { points, total: firstAccepted.size };
  },

  buildRecent(records) {
    return records
      .slice()
      .sort((a, b) => toMillis(b.submitTime || b.time) - toMillis(a.submitTime || a.time))
      .slice(0, 5)
      .map((record) => {
        const problem = record.problem || {};
        const pid = String(problem.pid || record.pid || "");
        const title = String(problem.title || problem.name || record.title || "");
        const status = Number(record.status);
        return {
          pid,
          title,
          status: Number.isFinite(status) ? status : null,
          statusText: Number.isFinite(status) ? STATUS_TEXT[status] || String(status) : "",
          score: Number(record.score) || 0,
          time: toMillis(record.submitTime || record.time),
        };
      })
      .filter((item) => item.pid);
  },

  pickContest(contests) {
    const now = Date.now();
    const prepared = contests
      .map((contest) => ({
        id: contest.id,
        name: contest.name || contest.title || "比赛",
        start: toMillis(contest.startTime),
        end: toMillis(contest.endTime) || (toMillis(contest.startTime) + (Number(contest.duration) || 0) * 1000),
      }))
      .filter((contest) => contest.start)
      .sort((a, b) => a.start - b.start);
    const live = prepared.find((contest) => contest.start <= now && contest.end && now <= contest.end);
    if (live) return Object.assign({}, live, { live: true });
    const next = prepared.find((contest) => contest.start > now);
    if (next) return Object.assign({}, next, { live: false });
    return null;
  },

  /* 0.7.2 主页比赛日历：进行中的排前，取前 5 场 */
  buildContests(contests) {
    const now = Date.now();
    const prepared = contests
      .map((contest) => ({
        id: contest.id,
        name: contest.name || contest.title || "比赛",
        start: toMillis(contest.startTime),
        end: toMillis(contest.endTime) || (toMillis(contest.startTime) + (Number(contest.duration) || 0) * 1000),
      }))
      .filter((contest) => contest.start)
      .sort((a, b) => a.start - b.start);
    const live = prepared.filter((contest) => contest.start <= now && contest.end && now <= contest.end);
    const upcoming = prepared.filter((contest) => contest.start > now);
    return live.concat(upcoming).slice(0, 5);
  }
};

module.exports = { homeMethods };
