/* 命令面板候选：题号、已打开页面与固定动作三路合并。 */
const { canonicalPid } = require("../sections");

const ACTIONS = [
  { type: "action", id: "home", label: "主页" },
  { type: "action", id: "problems", label: "题库" },
  { type: "action", id: "training", label: "训练" },
  { type: "action", id: "contest", label: "比赛" },
  { type: "action", id: "record", label: "记录" },
  { type: "action", id: "reopen", label: "恢复关闭的页面" },
  { type: "action", id: "discuss", label: "讨论" },
  { type: "action", id: "article", label: "文章" },
  { type: "action", id: "chat", label: "聊天" },
  { type: "action", id: "notification", label: "通知" },
  { type: "action", id: "checkin", label: "今日签到" },
  { type: "action", id: "login", label: "登录洛谷" },
  { type: "action", id: "settings", label: "设置" },
];

function palette(query, ctx) {
  const q = String(query || "").trim();
  const out = [];
  const pid = canonicalPid(q);
  if (pid) {
    out.push({ type: "problem", pid, label: "打开题目 " + pid });
  }
  // 已经打开的页面可以直接切过去（Ctrl+K 也是页面间跳转的入口）
  if (ctx && ctx.views && ctx.views.listOpen) {
    for (const page of ctx.views.listOpen()) {
      if (q && !(page.title || "").includes(q) && !(page.key || "").toLowerCase().includes(q.toLowerCase())) continue;
      out.push({ type: "page", key: page.key, label: "切换到 " + (page.title || page.key) });
    }
  }
  for (const action of ACTIONS) {
    if (!q || action.label.includes(q) || action.id.includes(q.toLowerCase())) out.push(action);
  }
  return out.slice(0, 12);
}

module.exports = { ACTIONS, palette };
