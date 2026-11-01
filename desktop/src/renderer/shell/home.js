/* 主页：两栏仪表盘。数据全部来自主进程，这里只负责呈现。
   左栏是打卡与最近提交，右栏是签到、比赛和离线队列。 */
import { icon } from "./icons.js";

let countdownTimer = null;
const WEEK = "日一二三四五六";

/* 会截断的文本类统一补原生 tooltip */
const ELLIPSIS_CLASSES = new Set(["sub-name", "q-note", "home-quote", "lib-name"]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    node.textContent = text;
    if (ELLIPSIS_CLASSES.has(className)) node.title = String(text);
  }
  return node;
}

function formatDate(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${WEEK[date.getDay()]}`;
}

function cleanFortunePart(value) {
  return String(value || "")
    .replace(/^[宜忌]\s*[:：]?\s*/, "")
    .replace(/[§·,，。;；]+$/g, "")
    .trim()
    .slice(0, 18);
}

function normalizeFortune(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const result = String(value.result || "").trim().slice(0, 8);
    const good = cleanFortunePart(value.good);
    const bad = cleanFortunePart(value.bad);
    return result || good || bad ? { result, good, bad } : null;
  }
  const raw = String(value).replace(/\s+/g, " ").trim();
  const result = (raw.match(/(大吉|中吉|小吉|末吉|吉|大凶|凶)/) || [])[1] || "";
  const good = cleanFortunePart((raw.match(/(?:^|[·,，。;；\s])宜\s*[:：]?\s*([^·,，。;；]+)/) || [])[1]);
  const bad = cleanFortunePart((raw.match(/(?:^|[·,，。;；\s])忌\s*[:：]?\s*([^·,，。;；]+)/) || [])[1]);
  return result || good || bad ? { result, good, bad } : null;
}

function buildDailyHeader(home, user, features, actions, offline, showOfficial) {
  const now = new Date();
  const head = el("header", "home-daily");
  const copy = el("div", "home-daily-copy");
  const greeting = el("h1", "home-greeting");
  const name = String((user && user.name) || "").trim();
  if (user && user.loggedIn && name) {
    greeting.appendChild(document.createTextNode("欢迎回来，"));
    greeting.appendChild(el("strong", "", name));
  } else {
    greeting.appendChild(document.createTextNode("欢迎来到洛谷"));
  }
  copy.appendChild(greeting);

  const meta = el("div", "home-meta");
  const date = el("time", "home-date");
  date.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  date.title = formatDate(now);
  date.appendChild(el("span", "home-date-month", `${now.getMonth() + 1} 月`));
  date.appendChild(el("strong", "home-date-day nums", pad(now.getDate())));
  date.appendChild(el("span", "home-date-week", `星期${WEEK[now.getDay()]}`));
  meta.appendChild(date);

  const official = home.official || {};
  const fortune = showOfficial
    ? normalizeFortune(features.changeFortune ? { result: "大吉", good: "万事皆宜" } : official.fortune)
    : null;
  if (fortune) {
    const badge = el("span", "home-fortune");
    if (fortune.result) badge.appendChild(el("strong", "home-fortune-result", fortune.result));
    if (fortune.good) badge.appendChild(el("span", "home-fortune-good", "宜 " + fortune.good));
    if (fortune.bad) badge.appendChild(el("span", "home-fortune-bad", "忌 " + fortune.bad));
    meta.appendChild(badge);
  }
  if (offline) {
    const chip = el("span", "offline-chip", "离线");
    chip.title = "当前没有网络：浏览缓存数据可用，提交会进入离线队列。";
    meta.appendChild(chip);
  }
  copy.appendChild(meta);

  if (home.quote) {
    const quote = el("div", "home-quote", "每日寄语：" + home.quote);
    quote.title = String(home.quote);
    copy.appendChild(quote);
  }

  const side = el("div", "home-daily-side");
  const countdowns = showOfficial && Array.isArray(official.countdowns) ? official.countdowns.slice(0, 3) : [];
  if (countdowns.length) {
    const list = el("div", "home-countdowns");
    for (const item of countdowns) {
      if (!item || !item.name) continue;
      const chip = el("span", "home-countdown");
      chip.appendChild(el("span", "home-countdown-name", "距 " + item.name));
      const days = Number(item.days);
      chip.appendChild(el("strong", "home-countdown-days nums", days <= 0 ? "今天" : String(days)));
      if (days > 0) chip.appendChild(el("span", "home-countdown-unit", "天"));
      list.appendChild(chip);
    }
    if (list.childElementCount) side.appendChild(list);
  }
  const refresh = el("button", "home-refresh");
  refresh.type = "button";
  refresh.title = "刷新";
  refresh.setAttribute("aria-label", "刷新");
  refresh.innerHTML = icon("refresh");
  refresh.addEventListener("click", () => actions.refresh());
  if (side.childElementCount) side.appendChild(refresh);
  else meta.appendChild(refresh);
  head.append(copy, side);
  return head;
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

function formatCalDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  /* 热力图只占卡片左半边，右边空着最显“莫名其妙留白”。
     把学习概览并进同一张卡：宽屏放右侧竖排，窄屏折到下方横排。 */
  const sideStats = el("div", "heat-side stats-card");
  sideStats.appendChild(buildStatGrid(home));
  const body = el("div", "heat-body");
  body.appendChild(wrap);
  body.appendChild(sideStats);

  card.appendChild(cardHead("打卡记录", "calendarCheck", `本月 ${monthDays} 天`));
  card.appendChild(body);
  card.appendChild(foot);
  return card;
}

function buildContest(home, actions) {
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
    const count = el("span", "cc-count");
    card.appendChild(count);
    const target = live.end;
    const tick = () => {
      count.textContent = (live.name || "比赛") + " · 剩余 " + formatClock(target - Date.now());
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
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

function buildStatGrid(home) {
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
  return grid;
}

/* 首启引导卡：仅首次启动显示（general.firstRunSeen=false），
   交代托盘退出/快捷键/离线三件事，关闭即置位不再出现。 */
function buildFirstRun(actions) {
  const card = el("div", "firstrun-card card");
  card.appendChild(cardHead("初次使用", "home"));
  const lines = el("div", "firstrun-lines");
  const tips = [
    ["关闭窗口默认收进托盘，退出请右键托盘图标选「退出」。", "info"],
    ["Ctrl+L 输入题号直达题目；Ctrl+F 页内查找；Ctrl+=/- 缩放阅读面。", "clock"],
    ["看过的题目自动留离线快照，断网也能复习。", "wifiOff"],
  ];
  for (const [text, ic] of tips) {
    const row = el("div", "firstrun-row");
    const g = el("span", "firstrun-icon");
    g.innerHTML = icon(ic);
    row.appendChild(g);
    row.appendChild(el("span", "firstrun-text", text));
    lines.appendChild(row);
  }
  const btn = el("button", "firstrun-btn", "知道了");
  btn.type = "button";
  btn.addEventListener("click", () => actions.setGeneral({ firstRunSeen: true }));
  card.appendChild(lines);
  card.appendChild(btn);
  return card;
}

function sectionData(home, name) {
  const sections = home.official && home.official.sections;
  return (sections && sections[name]) || {};
}

function buildAnnouncement(home, actions) {
  const section = sectionData(home, "announcement");
  const card = el("div", "announcement-card card");
  card.appendChild(cardHead("本站公告", "bell"));
  const items = Array.isArray(section.links) ? section.links.slice(0, 6) : [];
  if (items.length) {
    const list = el("div", "task-links announcement-links");
    for (const item of items) {
      const row = el("button", "task-row");
      row.type = "button";
      row.appendChild(el("span", "task-title", item.title));
      row.appendChild(el("span", "task-action", "查看"));
      row.addEventListener("click", () => actions.openDetail({ url: item.url, title: item.title }));
      list.appendChild(row);
    }
    card.appendChild(list);
    return card;
  }
  const text = String(section.text || "欢迎使用洛谷桌面版。公告、通知与站内动态会继续在这里同步。")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  card.appendChild(el("div", "welcome-line", text));
  return card;
}
function buildTasks(actions) {
  const card = el("div", "tasks-card card");
  card.appendChild(cardHead("任务计划", "calendarCheck"));
  const list = el("div", "task-links");
  const items = [
    ["每日练习", "打开题库", () => actions.nav("problems")],
    ["专项训练", "进入训练", () => actions.nav("training")],
    ["检查记录", "查看提交", () => actions.nav("record")],
  ];
  for (const [title, label, run] of items) {
    const row = el("button", "task-row");
    row.type = "button";
    row.appendChild(el("span", "task-title", title));
    row.appendChild(el("span", "task-action", label));
    row.addEventListener("click", run);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function buildLinks(actions) {
  const card = el("div", "links-card card");
  card.appendChild(cardHead("友情链接", "external"));
  const list = el("div", "task-links");
  const links = [
    ["洛谷讨论区", "https://www.luogu.com.cn/discuss"],
    ["洛谷帮助", "https://help.luogu.com.cn/"],
    ["桌面版项目", "https://github.com/longguanhong0755/luogu-plus"],
  ];
  for (const [label, url] of links) {
    const row = el("button", "task-row");
    row.type = "button";
    row.appendChild(el("span", "task-title", label));
    row.appendChild(el("span", "task-action", "打开"));
    row.addEventListener("click", () => actions.openDetail({ url, title: label }));
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function buildCommunity(home, actions) {
  const card = el("div", "community-card card");
  const section = sectionData(home, "discussions");
  const items = Array.isArray(section.items) ? section.items.slice(0, 4) : [];
  card.appendChild(cardHead("最近讨论", "discuss", items.length ? "站内动态" : ""));
  if (!items.length) {
    card.appendChild(el("div", "empty-line", "暂无讨论数据，打开讨论区查看最新内容。"));
  } else {
    for (const item of items) {
      const row = el("button", "community-row");
      row.type = "button";
      row.appendChild(el("span", "community-title", String(item.title || "未命名讨论").slice(0, 80)));
      const meta = [item.author, item.replies ? item.replies + " 回复" : ""].filter(Boolean).join(" · ");
      if (meta) row.appendChild(el("span", "community-meta", meta));
      if (item.url) row.addEventListener("click", () => actions.openDetail({ url: item.url, title: item.title || "讨论" }));
      else row.addEventListener("click", () => actions.nav("discuss"));
      card.appendChild(row);
    }
  }
  const more = el("button", "sign-btn", "打开讨论区");
  more.type = "button";
  more.addEventListener("click", () => actions.nav("discuss"));
  card.appendChild(more);
  return card;
}

function buildSupport(actions) {
  const card = el("div", "support-card card");
  card.appendChild(cardHead("支持项目", "star"));
  card.appendChild(el("div", "welcome-line sub", "如果这个客户端对你有帮助，可以前往仓库点一个 Star。"));
  const btn = el("button", "sign-btn", "前往项目仓库");
  btn.type = "button";
  btn.addEventListener("click", () => actions.openDetail({ url: "https://github.com/longguanhong0755/luogu-plus", title: "项目仓库" }));
  card.appendChild(btn);
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
  const features = state.features || {};
  root.classList.toggle("plain-home", features.beautifyUI === false);
  root.classList.toggle("smooth-home", features.smoothHome !== false);
  const sections = features.customSections === false
    ? { homeAnnouncement: true, homeTasks: true, homeLinks: true, homeCommunity: true, homeOfficial: true, homeContest: true, homeHeat: true, homeRecent: true, homeFirstRun: true }
    : features;

  wrap.appendChild(
    buildDailyHeader(home, user, features, actions, offline, sections.homeOfficial !== false)
  );

  if (offline && home.updatedAt) {
    wrap.appendChild(el("div", "offline-note", "离线模式 · 以下为本地数据，更新于 " + formatWhen(home.updatedAt) + "。"));
  }

  const grid = el("div", "home-grid");
  const main = el("div", "home-main");
  const side = el("div", "home-side");

  if (user.loggedIn) {
    if (sections.homeHeat !== false) main.appendChild(buildHeat(home));
    if (sections.homeRecent !== false) main.appendChild(buildRecent(home, actions, offline));
  } else {
    grid.classList.add("single");
  }
  if (sections.homeAnnouncement !== false) main.appendChild(buildAnnouncement(home, actions));

  if (sections.homeFirstRun !== false && state.general && state.general.firstRunSeen === false) {
    side.appendChild(buildFirstRun(actions));
  }
  if (sections.homeContest !== false) {
    const contestCard = buildContest(home, actions);
    if (contestCard) side.appendChild(contestCard);
  }
  if (sections.homeTasks !== false) side.appendChild(buildTasks(actions));
  if (sections.homeCommunity !== false) side.appendChild(buildCommunity(home, actions));
  if (sections.homeLinks !== false) side.appendChild(buildLinks(actions));
  side.appendChild(buildSign(state, actions));
  if (features.supportPrompt) side.appendChild(buildSupport(actions));
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
