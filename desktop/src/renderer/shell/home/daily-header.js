/* 问候行：欢迎语、日期、离线标记、赛事倒计时、每日寄语与今日签到位。 */
import { icon } from "../icons.js";
import { WEEK } from "./constants.js";
import { buildTodayActions } from "./fortune.js";
import { el, formatDate, pad } from "./utils.js";
export function buildDailyHeader(home, user, features, actions, offline, showCountdowns, showToday, state, summaryCard) {
  const now = new Date();
  const head = el("header", "home-daily");
  const main = el("div", "home-daily-main");
  const heading = el("div", "home-greeting-row");
  const greeting = el("h1", "home-greeting");
  const name = String((user && user.name) || "").trim();
  if (user && user.loggedIn && name) {
    greeting.appendChild(document.createTextNode("欢迎回来，"));
    greeting.appendChild(el("strong", "", name));
  } else {
    greeting.appendChild(document.createTextNode("欢迎来到洛谷"));
  }

  const refresh = el("button", "home-refresh");
  refresh.type = "button";
  refresh.title = "刷新";
  refresh.setAttribute("aria-label", "刷新");
  refresh.innerHTML = icon("refresh");
  refresh.addEventListener("click", () => actions.refresh());
  heading.append(greeting, refresh);

  const meta = el("div", "home-meta");
  const date = el("time", "home-date");
  date.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  date.title = formatDate(now);
  date.appendChild(el("span", "home-date-month", `${now.getMonth() + 1} 月`));
  date.appendChild(el("strong", "home-date-day nums", pad(now.getDate())));
  date.appendChild(el("span", "home-date-week", `星期${WEEK[now.getDay()]}`));
  meta.appendChild(date);

  const official = home.official || {};
  if (offline) {
    const chip = el("span", "offline-chip", "离线");
    chip.title = "当前没有网络：浏览缓存数据可用，提交会进入离线队列。";
    meta.appendChild(chip);
  }

  const countdowns = showCountdowns && Array.isArray(official.countdowns) ? official.countdowns.slice(0, 3) : [];
  if (countdowns.length) {
    const list = el("div", "home-countdowns");
    for (const item of countdowns) {
      if (!item || !item.name) continue;
      const chip = el("span", "home-countdown");
      chip.appendChild(el("span", "home-countdown-name", "距 " + item.name));
      const days = Number(item.days);
      chip.title = `距 ${item.name}${days <= 0 ? "今天" : ` 还剩 ${days} 天`}`;
      chip.appendChild(el("strong", "home-countdown-days nums", days <= 0 ? "今天" : String(days)));
      if (days > 0) chip.appendChild(el("span", "home-countdown-unit", "天"));
      list.appendChild(chip);
    }
    if (list.childElementCount) meta.appendChild(list);
  }

  main.append(heading, meta);
  if (home.quote) {
    const quote = el("div", "home-quote", "每日寄语：" + home.quote);
    quote.title = String(home.quote);
    main.appendChild(quote);
  }
  if (summaryCard) {
    const summary = el("div", "home-daily-summary");
    summary.appendChild(summaryCard);
    main.appendChild(summary);
  }
  head.appendChild(main);
  if (showToday) {
    const today = buildTodayActions(state, actions);
    if (today) head.appendChild(today);
  }
  return head;
}
