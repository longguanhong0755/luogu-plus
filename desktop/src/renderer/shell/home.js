/* 主页：日期 + 每日寄语 + 签到 + 打卡网格 + 比赛倒计时 + 最近提交。
   数据全部来自主进程，这里只负责呈现；无动画、无骨架屏。 */
import { icon } from "./icons.js";

let countdownTimer = null;
const WEEK = "日一二三四五六";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${WEEK[date.getDay()]}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatClock(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatWhen(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  if (diff < 172800000) return "昨天";
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function resClass(status) {
  if (status === 12) return "ok";
  if ([2, 3, 4, 5, 6, 7, 8].includes(status)) return "bad";
  return "mid";
}

function buildHeat(home) {
  const card = el("div", "heat-card panel");
  const head = el("div", "heat-head");
  head.appendChild(el("span", "", "打卡记录 · 近 20 周"));

  const counts = new Map();
  for (const item of home.heat || []) counts.set(item.date, item.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 19 * 7);

  let monthDays = 0;
  const grid = el("div", "heat");
  for (let i = 0; i < 140; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const count = counts.get(key) || 0;
    const cell = document.createElement("span");
    cell.className = "hc";
    if (day > today) cell.classList.add("future");
    else if (count >= 5) cell.classList.add("l4");
    else if (count >= 3) cell.classList.add("l3");
    else if (count >= 2) cell.classList.add("l2");
    else if (count >= 1) cell.classList.add("l1");
    if (day.getTime() === today.getTime()) cell.classList.add("today");
    cell.title = `${key} · ${count} 次提交`;
    if (count > 0 && day.getMonth() === today.getMonth()) monthDays++;
    grid.appendChild(cell);
  }

  const cur = el("span", "cur");
  cur.textContent = `本月 ${monthDays} 天`;
  head.appendChild(cur);
  card.appendChild(head);
  card.appendChild(grid);
  return card;
}

function buildContest(home, actions) {
  const contest = home.contest;
  const card = el("div", "contest-card panel");
  card.appendChild(el("span", "cc-label", contest ? (contest.live ? "正在进行" : "下一场比赛") : "比赛"));

  if (!contest) {
    card.appendChild(el("span", "cc-empty", "暂无比赛信息"));
    return card;
  }

  const name = el("span", "cc-name", contest.name);
  card.appendChild(name);

  if (contest.live) {
    const chip = el("span", "cc-chip cc-live", "进行中");
    card.appendChild(chip);
  } else {
    const start = new Date(contest.start);
    card.appendChild(
      el("span", "cc-chip", `${start.getMonth() + 1} 月 ${start.getDate()} 日 ${pad(start.getHours())}:${pad(start.getMinutes())}`)
    );
  }

  const count = el("span", "cc-count");
  card.appendChild(count);
  const target = contest.live ? contest.end : contest.start;
  const tick = () => {
    count.textContent = formatClock(target - Date.now());
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
  card.addEventListener("click", () => actions.nav("contest"));
  return card;
}

function buildRecent(home, actions) {
  const card = el("div", "list-card panel");
  const head = el("div", "list-head");
  head.appendChild(el("span", "", "最近提交"));
  head.appendChild(el("span", "", home.updatedAt ? "刚刚同步" : ""));
  card.appendChild(head);

  const list = home.recent || [];
  if (!list.length) {
    card.appendChild(el("div", "empty-line", "还没有提交记录。"));
    return card;
  }

  for (const item of list) {
    const row = el("div", "sub-row");
    row.style.cursor = "pointer";
    const res = el("span", "res " + resClass(item.status), item.statusText || "—");
    row.appendChild(res);
    row.appendChild(el("span", "sub-pid", item.pid));
    row.appendChild(el("span", "sub-name", item.title || ""));
    row.appendChild(el("span", "sub-time", item.time ? formatWhen(item.time) : ""));
    row.addEventListener("click", () => actions.openProblem(item.pid));
    card.appendChild(row);
  }
  return card;
}

export function renderHome(state, actions) {
  const root = document.getElementById("home");
  if (!root) return;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  const scrollTop = root.scrollTop;
  root.textContent = "";

  const wrap = el("div", "home-wrap");
  const home = state.home || {};
  const user = state.user || {};

  const head = el("div", "home-row");
  head.appendChild(el("div", "home-date", formatDate(new Date())));
  head.appendChild(el("div", "home-quote", home.quote ? "每日寄语：" + home.quote : ""));
  const refresh = el("button", "home-refresh");
  refresh.type = "button";
  refresh.title = "刷新";
  refresh.setAttribute("aria-label", "刷新");
  refresh.innerHTML = icon("refresh");
  refresh.addEventListener("click", () => actions.refresh());
  head.appendChild(refresh);
  wrap.appendChild(head);

  if (!user.loggedIn) {
    const card = el("div", "login-card panel");
    const text = el("div", "login-text");
    text.appendChild(el("span", "login-title", "登录洛谷"));
    text.appendChild(
      document.createTextNode("登录后，这里会显示你的签到、打卡记录、比赛倒计时和最近提交。")
    );
    card.appendChild(text);
    const btn = el("button", "sign-btn", "登录洛谷");
    btn.type = "button";
    btn.addEventListener("click", () => actions.login());
    card.appendChild(btn);
    wrap.appendChild(card);
  } else {
    const sign = el("div", "sign-row");
    if (home.punched) {
      const ok = el("span", "sign-state");
      ok.innerHTML = icon("check");
      ok.appendChild(document.createTextNode("今日已签"));
      sign.appendChild(ok);
      if (home.streak) sign.appendChild(el("span", "sign-note", `连续 ${home.streak} 天`));
    } else {
      const btn = el("button", "sign-btn", "今日签到");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "签到中…";
        await actions.checkin();
        btn.disabled = false;
        btn.textContent = "今日签到";
      });
      sign.appendChild(btn);
      sign.appendChild(el("span", "sign-note", user.name ? `欢迎回来，${user.name}` : ""));
    }
    wrap.appendChild(sign);
  }

  if (user.loggedIn) {
    wrap.appendChild(buildHeat(home));
  }
  wrap.appendChild(buildContest(home, actions));
  if (user.loggedIn) {
    wrap.appendChild(buildRecent(home, actions));
  }

  if (home.error) {
    wrap.appendChild(el("div", "empty-line", "数据同步失败：" + home.error));
  }

  root.appendChild(wrap);
  root.scrollTop = scrollTop;
}
