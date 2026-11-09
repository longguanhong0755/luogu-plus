/* 离线提交队列卡：展示最近 8 条并支持「全部重试」。 */
import { cardHead, el, formatWhen } from "./utils.js";
export function buildQueue(state, actions) {
  const queue = state.queue;
  if (!queue || !queue.items || !queue.items.length) return null;
  const card = el("div", "queue-card list-card card");
  const extra = el("span");
  if (queue.count > 0) {
    const retry = el("button", "q-retry", "全部重试");
    retry.type = "button";
    retry.addEventListener("click", () => actions.queueAction({ op: "retry" }));
    extra.appendChild(retry);
  }
  card.appendChild(cardHead("离线提交队列", "wifiOff", extra));

  const STATUS_LABEL = {
    pending: ["等待联网", "q-pending"],
    captcha: ["需要验证码", "q-captcha"],
    failed: ["提交被拒", "q-failed"],
    done: ["已提交", "q-done"],
  };
  for (const item of queue.items.slice(-8)) {
    const row = el("div", "q-row");
    row.tabIndex = 0;
    const label = STATUS_LABEL[item.status] || ["等待联网", "q-pending"];
    row.appendChild(el("span", "q-status " + label[1], label[0]));
    row.appendChild(el("span", "sub-pid", item.pid));
    row.appendChild(el("span", "q-note", item.lastError || ""));
    row.appendChild(el("span", "sub-time", formatWhen(item.queuedAt)));
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
  card.appendChild(el("div", "q-note-line", "断网时提交的代码会排在这里，联网后自动重放；点行打开题目。"));
  return card;
}
