/* 近期比赛卡：最多 5 条日历行 + 进行中比赛的剩余时间。 */
import { setCountdownTimer } from "./timer.js";
import { cardHead, el, formatCalDate, formatClock } from "./utils.js";
export function buildContest(home, actions) {
  const contests = Array.isArray(home.contests) ? home.contests.slice(0, 5) : [];
  if (!contests.length) return null;
  const card = el("div", "contest-card card");
  card.appendChild(cardHead("近期比赛", "contest"));

  let live = null;
  for (const contest of contests) {
    if (contest.live) live = contest;
    const row = el("div", "cal-row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "打开比赛页面：" + contest.name);
    const chip = el("span", "cal-chip" + (contest.live ? " live" : ""), contest.live ? "进行中" : formatCalDate(contest.start));

    row.appendChild(chip);
    row.appendChild(el("span", "cal-name", contest.name));
    const open = () => {
      if (contest.id) actions.openDetail({ url: "/contest/" + contest.id, title: contest.name });
      else actions.nav("contest");
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    card.appendChild(row);
  }
  if (live) {
    const footer = el("div", "contest-live");
    footer.appendChild(el("span", "contest-live-name", live.name || "比赛"));
    const count = el("span", "cc-count");
    footer.appendChild(count);
    card.appendChild(footer);
    const target = live.end;
    const tick = () => {
      count.textContent = "剩余 " + formatClock(target - Date.now());
    };
    tick();
    setCountdownTimer(setInterval(tick, 1000));
  }
  return card;
}
