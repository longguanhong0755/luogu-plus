/* 主页：两栏仪表盘。数据全部来自主进程，这里只负责呈现。
   左栏是打卡与最近提交，右栏是签到、比赛和离线队列。 */
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

function cardHead(title, iconName, extra) {
  const head = el("div", "card-head");
  const titleNode = el("span", "card-title");
  titleNode.innerHTML = icon(iconName);
  titleNode.appendChild(document.createTextNode(title));
  head.appendChild(titleNode);
  if (extra !== undefined && extra !== null) {
    const extraNode = el("span", "card-extra");
    if (typeof extra === "string") extraNode.textContent = extra;
    else extraNode.appendChild(extra);
    head.appendChild(extraNode);
  }
  return head;
}

function buildHeat(home) {
  const card = el("div", "heat-card card");
  const counts = new Map();
  for (const item of home.heat || []) counts.set(item.date, item.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 19 * 7);

  let monthDays = 0;
  const grid = el("div", "heat");
  grid.setAttribute("role", "img");
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
  grid.setAttribute("aria-label", `近 20 周打卡热力图，本月 ${monthDays} 天有提交`);

  const days = el("div", "heat-days");
  for (let i = 0; i < 7; i++) days.appendChild(el("span", "", WEEK[i]));

  const months = el("div", "heat-months");
  const runs = [];
  for (let week = 0; week < 20; week++) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week * 7);
    const month = weekStart.getMonth();
    if (!runs.length || runs[runs.length - 1].month !== month) runs.push({ month, weeks: 1 });
    else runs[runs.length - 1].weeks++;
  }
  for (const run of runs) {
    const label = el("span", "", `${run.month + 1} 月`);
    label.style.width = `${run.weeks * 16 - 2}px`;
    months.appendChild(label);
  }

  const legend = el("div", "heat-legend");
  legend.appendChild(el("span", "lg-label", "少"));
  for (const level of ["", "l1", "l2", "l3", "l4"]) {
    const swatch = el("span", "hc " + level);
    legend.appendChild(swatch);
  }
  legend.appendChild(el("span", "lg-label", "多"));

  const foot = el("div", "heat-foot");
  foot.appendChild(el("span", "card-sub", "近 20 周"));
  foot.appendChild(legend);

  const heatColumn = el("div", "heat-col");
  heatColumn.appendChild(months);
  heatColumn.appendChild(grid);
  const wrap = el("div", "heat-wrap");
  wrap.appendChild(days);
  wrap.appendChild(heatColumn);

  card.appendChild(cardHead("打卡记录", "calendarCheck", `本月 ${monthDays} 天`));
  card.appendChild(wrap);
  card.appendChild(foot);
  return card;
}

function buildContest(home, actions) {
  const contest = home.contest;
  const card = el("div", "contest-card card");
  card.appendChild(cardHead("比赛", "contest"));
  card.appendChild(el("span", "cc-label", contest ? (contest.live ? "正在进行" : "下一场比赛") : "赛程"));

  if (!contest) {
    card.appendChild(el("span", "cc-empty", "暂无比赛信息"));
    return card;
  }

  const name = el("span", "cc-name", contest.name);
  card.appendChild(name);

  if (contest.live) {
    card.appendChild(el("span", "cc-chip cc-live", "进行中"));
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

  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "打开比赛页面：" + contest.name);
  const open = () => actions.nav("contest");
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function buildRecent(home, actions, offline) {
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

function buildQueue(state, actions) {
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

function buildStats(home) {
  const counts = new Map();
  for (const item of home.heat || []) counts.set(item.date, item.count);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 19 * 7);
  let monthDays = 0;
  let total = 0;
  for (let i = 0; i < 140; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    if (day > today) continue;
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const count = counts.get(key) || 0;
    total += count;
    if (count > 0 && day.getMonth() === today.getMonth()) monthDays++;
  }

  const card = el("div", "stats-card card");
  card.appendChild(cardHead("学习概览", "record"));
  const grid = el("div", "stats-grid");
  const stats = [
    [home.streak || 0, "连续签到"],
    [monthDays, "本月打卡"],
    [total, "近 20 周提交"],
  ];
  for (const [value, label] of stats) {
    const cell = el("div", "stat");
    cell.appendChild(el("span", "stat-value nums", String(value)));
    cell.appendChild(el("span", "stat-label", label));
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  return card;
}

function buildSign(state, actions) {
  const user = state.user || {};
  if (!user.loggedIn) {
    const card = el("div", "login-card card");
    const text = el("div", "login-text");
    text.appendChild(el("span", "login-title", "登录洛谷"));
    text.appendChild(document.createTextNode("登录后查看签到、打卡记录和最近提交。"));
    card.appendChild(text);
    const btn = el("button", "sign-btn", "登录洛谷");
    btn.type = "button";
    btn.addEventListener("click", () => actions.login());
    card.appendChild(btn);
    return card;
  }

  const home = state.home || {};
  const card = el("div", "sign-card card");
  const copy = el("div", "sign-copy");
  copy.appendChild(el("span", "sign-title", "今日签到"));
  const note = home.streak ? `连续 ${home.streak} 天` : user.name ? `欢迎回来，${user.name}` : "";
  copy.appendChild(el("span", "sign-note", note));
  card.appendChild(copy);

  if (home.punched) {
    const ok = el("span", "sign-state");
    ok.innerHTML = icon("check");
    ok.appendChild(document.createTextNode("今日已签"));
    card.appendChild(ok);
  } else {
    const btn = el("button", "sign-btn", "今日签到");
    btn.type = "button";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "签到中…";
      let res = null;
      try {
        res = await actions.checkin();
      } catch {
        /* 主进程已 toast 失败原因 */
      }
      btn.disabled = false;
      if (res && res.ok) {
        btn.textContent = res.already ? "已签到" : "签到成功";
        setTimeout(() => {
          btn.textContent = "今日签到";
        }, 2400);
      } else {
        // 失败不能无痕：按钮上留字，主进程同时 toast 具体原因
        btn.textContent = "签到失败 · 稍后再试";
        setTimeout(() => {
          btn.textContent = "今日签到";
        }, 3600);
      }
    });
    card.appendChild(btn);
  }
  return card;
}

export function disposeHome() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

export function renderHome(state, actions) {
  const root = document.getElementById("home");
  if (!root) return;
  disposeHome();
  const scrollTop = root.scrollTop;
  root.textContent = "";

  const wrap = el("div", "home-wrap");
  const home = state.home || {};
  const user = state.user || {};
  const offline = state.online === false;

  const head = el("div", "home-row");
  head.appendChild(el("div", "home-date", formatDate(new Date())));
  if (home.quote) head.appendChild(el("div", "home-quote", "每日寄语：" + home.quote));
  if (offline) {
    const chip = el("span", "offline-chip", "离线");
    chip.title = "当前没有网络：浏览缓存数据可用，提交会进入离线队列。";
    head.appendChild(chip);
  }
  const refresh = el("button", "home-refresh");
  refresh.type = "button";
  refresh.title = "刷新";
  refresh.setAttribute("aria-label", "刷新");
  refresh.innerHTML = icon("refresh");
  refresh.addEventListener("click", () => actions.refresh());
  head.appendChild(refresh);
  wrap.appendChild(head);

  if (offline && home.updatedAt) {
    wrap.appendChild(el("div", "offline-note", "离线模式 · 以下为本地数据，更新于 " + formatWhen(home.updatedAt) + "。"));
  }

  const grid = el("div", "home-grid");
  const main = el("div", "home-main");
  const side = el("div", "home-side");

  if (user.loggedIn) {
    main.appendChild(buildHeat(home));
    main.appendChild(buildRecent(home, actions, offline));
  } else {
    grid.classList.add("single");
  }

  side.appendChild(buildSign(state, actions));
  if (user.loggedIn) side.appendChild(buildStats(home));
  side.appendChild(buildContest(home, actions));
  const queueCard = buildQueue(state, actions);
  if (queueCard) side.appendChild(queueCard);

  if (main.childElementCount) grid.appendChild(main);
  grid.appendChild(side);
  wrap.appendChild(grid);

  if (home.error) {
    const card = el("div", "card");
    const stateBox = el("div", "lib-state");
    stateBox.innerHTML = icon("alert");
    stateBox.appendChild(el("strong", "", "数据同步失败"));
    stateBox.appendChild(el("span", "", home.error));
    card.appendChild(stateBox);
    wrap.appendChild(card);
  }

  root.appendChild(wrap);
  root.scrollTop = scrollTop;
}
