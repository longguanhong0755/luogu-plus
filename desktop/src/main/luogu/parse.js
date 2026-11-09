/* 洛谷数据服务 · lentille-context 数据解析（拆分自 src/main/luogu.js）。 */
const { findArray, findObject, dayKey, toMillis } = require("./util");

const parseMethods = {
  /* ---------- 数据抓取 ---------- */

  parseRecords(context) {
    if (!context) return [];
    const list = findArray(context, (item) => {
      if (!item || typeof item !== "object") return false;
      const hasTime = "submitTime" in item || "time" in item;
      const hasProblem = "problem" in item || "pid" in item;
      return hasTime && hasProblem;
    });
    return list || [];
  },

  parseContests(context) {
    if (!context) return [];
    const list = findArray(context, (item) => {
      if (!item || typeof item !== "object") return false;
      return "startTime" in item && ("name" in item || "title" in item) && ("endTime" in item || "duration" in item);
    });
    return list || [];
  },

  parseUser(context, uid) {
    if (!context) return null;
    return findObject(context, (item) => {
      if (!item || typeof item !== "object") return false;
      if (!("uid" in item) || !("name" in item)) return false;
      return uid ? Number(item.uid) === Number(uid) : true;
    });
  },

  /* 个人中心把做题趋势放在 dailyCounts 中。字段在不同页面版本里可能是
     [日期, 次数]、{ date, count } 或 { time, value }，这里统一归一化；
     看不到公开数据时返回空数组，由最近提交回退。 */
  parseDailyCounts(context) {
    if (!context) return [];
    const holder = findObject(context, (item) => item && item.dailyCounts && typeof item.dailyCounts === "object");
    if (!holder) return [];
    const rawList = Array.isArray(holder.dailyCounts)
      ? holder.dailyCounts
      : Object.entries(holder.dailyCounts).map(([date, count]) => ({ date, count }));
    const out = [];
    for (const raw of rawList) {
      let date = "";
      let count = 0;
      if (Array.isArray(raw)) {
        date = raw[0];
        count = raw[1];
      } else if (raw && typeof raw === "object") {
        date = raw.date || raw.day || raw.time || raw.timestamp || raw.at || "";
        count = raw.count ?? raw.value ?? raw.total ?? raw.num ?? 0;
      } else {
        continue;
      }
      // 官方 dailyCounts 的值为 [等级, 提交次数]；旧解析把数组直接 Number()
      // 会得到 NaN 并显示成全零。兼容普通数字和 [次数, 等级] 两种变体。
      if (Array.isArray(count)) {
        const first = Number(count[0]) || 0;
        const second = Number(count[1]) || 0;
        count = first >= 1 && first <= 5 && second >= first ? second : first;
      }
      const numeric = Number(date);
      let key = "";
      if (Number.isFinite(numeric) && numeric > 0) key = dayKey(new Date(toMillis(numeric)));
      else key = String(date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      out.push({ date: key, count: Math.max(0, Number(count) || 0) });
    }
    return out;
  }
};

module.exports = { parseMethods };
