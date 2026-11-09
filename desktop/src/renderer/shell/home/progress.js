/* 累计通过卡：直接消费洛谷个人中心的提交/通过/排名字段。 */
import { cardHead, el } from "./utils.js";
/* 累计通过直接使用洛谷个人中心字段，不再根据客户端分页记录推算。 */
export function buildProgress(home, user) {
  const submitted = Number.isFinite(Number(user && user.submittedProblemCount))
    ? Number(user.submittedProblemCount)
    : null;
  const passed = Number.isFinite(Number(user && user.passedProblemCount))
    ? Number(user.passedProblemCount)
    : null;
  const ranking = Number.isFinite(Number(user && user.ranking)) ? Number(user.ranking) : null;
  const card = el("section", "official-profile-card card");
  card.appendChild(cardHead("累计通过", "chart", "洛谷个人中心"));
  const stats = el("div", "user-stat-data lfe-caption official-profile-stats");
  const stack = el("div", "stat stacked");
  for (const [name, value] of [
    ["提交", submitted],
    ["通过", passed],
    ["排名", ranking],
  ]) {
    const field = el("div", "field");
    field.append(
      el("span", "stat-text name", name),
      el("span", "stat-text value nums", value == null ? "—" : String(value))
    );
    stack.appendChild(field);
  }
  stats.appendChild(stack);
  card.appendChild(stats);
  if (passed == null) card.appendChild(el("p", "official-fallback-note", "洛谷暂未公开该账号的累计通过数据。"));
  return card;
}
