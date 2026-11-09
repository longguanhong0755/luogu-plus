/* 最近提交卡：数据新鲜度按在线/离线两种口径显示。 */
import { cardHead, el, formatWhen, resClass } from "./utils.js";
export function buildRecent(home, actions, offline) {
  const card = el("div", "list-card card");
  const updated = home.updatedAt ? (offline ? "离线数据" : "更新于 " + formatWhen(home.updatedAt)) : "";
  card.appendChild(cardHead("最近提交", "clock", updated));

  const list = home.recent || [];
  if (!list.length) {
    card.appendChild(el("div", "empty-line", "还没有提交记录。"));
    return card;
  }

  for (const item of list) {
    const row = el("div", "sub-row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${item.pid} ${item.title || ""}`);
    const res = el("span", "res " + resClass(item.status), item.statusText || "—");
    row.appendChild(res);
    row.appendChild(el("span", "sub-pid", item.pid));
    row.appendChild(el("span", "sub-name", item.title || ""));
    row.appendChild(el("span", "sub-time", item.time ? formatWhen(item.time) : ""));
    const open = () => actions.openProblem(item.pid);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    card.appendChild(row);
  }
  return card;
}
