/* 主页：两栏仪表盘。数据全部来自主进程，这里只负责呈现。
   签到与抽签固定在问候行右侧，避免主操作沉到侧栏底部。 */
import { icon } from "./icons.js";

let countdownTimer = null;
const WEEK = "日一二三四五六";
const FALLBACK_LINK_GROUPS = [
  {
    title: "推荐题库",
    links: [
      ["LibreOJ", "https://loj.ac/"],
      ["Vijos", "https://vijos.org/"],
      ["HydroOJ", "https://hydro.ac/"],
    ],
  },
  {
    title: "洛谷开源项目",
    links: [
      ["CYaRon 测试数据生成器", "https://www.luogu.com.cn/discuss/11410"],
      ["Markdown*Palettes", "https://github.com/luogu-dev/markdown-palettes"],
    ],
  },
  {
    title: "洛谷服务",
    links: [
      ["《深入浅出程序设计竞赛》", "https://www.luogu.com.cn/discuss/273220"],
      ["洛谷网校 - 算法竞赛学习", "https://class.luogu.com.cn"],
      ["学校编程训练辅助工具", "https://www.zhihu.com/answer/1629008261"],
      ["协办企业院校在线编程比赛", "https://zhuanlan.zhihu.com/p/338174582"],
    ],
  },
];

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
    .trim();
}

/* 只消费洛谷返回的结构化运势；不在本地随机生成，也不缓存成“官方结果”。 */
function normalizeFortune(value) {
  if (!value || typeof value !== "object") return null;
  const text = String(value.text || "").replace(/\r\n?/g, "\n").trim();
  const result = String(value.result || "").trim();
  const good = cleanFortunePart(value.good);
  const bad = cleanFortunePart(value.bad);
  const advice = Array.isArray(value.advice)
    ? value.advice.map((item) => String(item || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean)
    : [];
  if (!text && !result && !good && !bad && !advice.length) return null;
  return { result, good, bad, advice, text };
}

function buildDailyHeader(home, user, features, actions, offline, showCountdowns, showToday, state, summaryCard) {
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

function heatColorLevel(count) {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  return 4;
}

/* 结构与颜色档位直接对应洛谷个人中心“做题趋势热度图”。
   即使账号没有提交，也绘制完整的 26 周网格；否则图表会消失，页面反而出现空洞。 */
function buildHeat(home) {
  const byDate = new Map();
  for (const item of Array.isArray(home.heat) ? home.heat : []) {
    const date = String((item && item.date) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, Math.max(0, Number(item && item.count) || 0));
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const end = new Date(now);
  end.setDate(now.getDate() + (6 - now.getDay()));
  const start = new Date(end);
  start.setDate(end.getDate() - 26 * 7 + 1);

  const source = [];
  for (let i = 0; i < 26 * 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    source.push({ date, count: byDate.get(date) || 0 });
  }
  const total = source.reduce((sum, item) => sum + item.count, 0);
  const card = el("section", "home-activity card");
  card.appendChild(cardHead("做题趋势热度图", "calendarCheck", `近 26 周 · ${total} 次提交`));

  const wrapper = el("div", "heat-map-wrapper");
  const map = el("div", "heat-map");
  const labels = el("div", "week-column");
  for (const label of ["日", "一", "二", "三", "四", "五", "六", ""]) {
    const hint = el("div", "hint");
    if (label) hint.appendChild(el("span", "hint-text lfe-caption", label));
    labels.appendChild(hint);
  }
  map.appendChild(labels);

  let lastMonth = -1;
  for (let offset = 0; offset < source.length; offset += 7) {
    const week = el("div", "week-column");
    let firstDay = null;
    for (const item of source.slice(offset, offset + 7)) {
      const day = new Date(item.date + "T00:00:00");
      if (!firstDay && !Number.isNaN(day.getTime())) firstDay = day;
      const cell = el("div", "heat-map-cell");
      const future = item.date > todayKey;
      if (future) {
        cell.classList.add("hidden");
        cell.style.backgroundColor = "transparent";
        cell.setAttribute("aria-hidden", "true");
      } else {
        cell.style.backgroundColor = `var(--heat-${heatColorLevel(item.count)})`;
        cell.title = `${item.date} · ${item.count} 次提交`;
      }
      week.appendChild(cell);
    }
    if (firstDay && firstDay.getMonth() !== lastMonth) {
      lastMonth = firstDay.getMonth();
      const hint = el("div", "hint");
      hint.appendChild(el("span", "hint-text month lfe-caption", `${lastMonth + 1}月`));
      week.appendChild(hint);
    }
    map.appendChild(week);
  }
  wrapper.appendChild(map);

  const legend = el("div", "heat-map-legend");
  for (const [level, label] of [[0, "= 0"], [1, "≤ 3"], [2, "≤ 5"], [3, "≤ 8"], [4, "> 8"]]) {
    const item = el("span", "heat-map-legend-item");
    const swatch = el("span", "heat-map-cell");
    swatch.style.backgroundColor = `var(--heat-${level})`;
    item.append(swatch, document.createTextNode(label));
    legend.appendChild(item);
  }
  card.append(wrapper, legend);
  return card;
}

function buildQuickJump(actions) {
  const card = el("section", "quick-jump-card card");
  card.appendChild(cardHead("问题跳转", "search"));
  const form = el("form", "quick-jump-form");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "quick-jump-input";
  input.placeholder = "例：P1001，可跳至 A+B";
  input.setAttribute("aria-label", "输入题号");
  input.autocomplete = "off";
  input.spellcheck = false;
  const go = el("button", "btn btn-primary", "跳转");
  go.type = "submit";
  const random = el("button", "btn btn-secondary", "随机跳题");
  random.type = "button";
  const submit = () => {
    const pid = input.value.trim().replace(/^\s+|\s+$/g, "");
    if (!pid) {
      input.focus();
      return;
    }
    actions.openProblem(pid);
    input.value = "";
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  // 与标题栏「搜索题号」共用同一个随机面板，避免首页和面板出现两套
  // 不同的难度/题库条件与限流反馈。
  random.addEventListener("click", () => actions.openRandomJump());
  form.append(input, go, random);
  card.appendChild(form);
  return card;
}

/* 累计通过直接使用洛谷个人中心字段，不再根据客户端分页记录推算。 */
function buildProgress(home, user) {
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

/* 近 30 天累计通过曲线。官方只公开总通过数，因此用总通过数倒推窗口起点，
   数据为空时仍保留 0 线、坐标和日期，不让卡片变成空白占位。 */
function buildTrend(home, user) {
  const raw = (Array.isArray(home.acProgress) ? home.acProgress : [])
    .map((item) => ({
      date: String((item && item.date) || "").slice(0, 10),
      passed: Math.max(0, Number(item && item.passed) || 0),
    }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(raw.map((item) => [item.date, item.passed]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - 29);
  const passedTotalRaw = user && user.passedProblemCount;
  const passedTotal = Number.isFinite(Number(passedTotalRaw)) ? Math.max(0, Number(passedTotalRaw)) : null;
  const windowPassed = raw.reduce((sum, item) => sum + item.passed, 0);
  let cumulative = passedTotal == null ? 0 : Math.max(0, passedTotal - windowPassed);
  const points = [];
  for (let i = 0; i < 30; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const passed = byDate.get(date) || 0;
    cumulative += passed;
    points.push({ date, passed, cumulative });
  }

  const width = 720;
  const height = 188;
  const left = 18;
  const right = 708;
  const top = 18;
  const bottom = 150;
  const values = points.map((point) => point.cumulative);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const changed = maxValue > minValue;
  const yMin = changed ? Math.max(0, minValue - Math.max(1, (maxValue - minValue) * 0.12)) : Math.max(0, minValue - 1);
  const yMax = changed ? maxValue + Math.max(1, (maxValue - minValue) * 0.12) : minValue + 1;
  const xAt = (index) => left + (index / (points.length - 1 || 1)) * (right - left);
  const yAt = (value) => bottom - ((value - yMin) / Math.max(1, yMax - yMin)) * (bottom - top);
  const coords = points.map((point, index) => [xAt(index), yAt(point.cumulative)]);
  const linePath = coords.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${right},${bottom} L${left},${bottom} Z`;
  const last = points[points.length - 1];

  const card = el("section", "home-trend-card card");
  const delta = last.cumulative - points[0].cumulative;
  const extra = el("span");
  extra.textContent = `近 30 天 +${delta}`;
  card.appendChild(cardHead("累计通过趋势", "chart", extra));

  const chart = el("div", "trend-chart");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trend-chart-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `近 30 天累计通过，当前 ${last.cumulative} 题`);
  const grid = [0, 1, 2, 3].map((index) => {
    const y = top + ((bottom - top) / 3) * index;
    return `<line class="trend-grid-line" x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}"></line>`;
  }).join("");
  const dots = points.map((point, index) => {
    const [x, y] = coords[index];
    return `<circle class="trend-point" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3"><title>${point.date} · 累计 ${point.cumulative} 题 · 当日通过 ${point.passed} 题</title></circle>`;
  }).join("");
  svg.innerHTML = `<defs><linearGradient id="home-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".30"></stop><stop offset="1" stop-color="var(--accent)" stop-opacity=".02"></stop></linearGradient></defs>${grid}<path class="trend-area" d="${areaPath}"></path><path class="trend-line" d="${linePath}"></path>${dots}`;
  chart.appendChild(svg);

  const axis = el("div", "trend-axis");
  axis.append(
    el("span", "", `${start.getMonth() + 1}-${pad(start.getDate())}`),
    el("span", "", `${today.getMonth() + 1}-${pad(today.getDate())}`)
  );
  chart.appendChild(axis);
  if (!changed) chart.appendChild(el("span", "trend-flat-note", "近 30 天暂无新增通过"));
  const summary = el("div", "trend-summary");
  summary.append(
    el("span", "trend-summary-label", passedTotal == null ? "当前累计" : "洛谷累计通过"),
    el("strong", "trend-summary-value nums", String(passedTotal == null ? last.cumulative : passedTotal))
  );
  chart.appendChild(summary);
  card.appendChild(chart);
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

/* 首启引导卡：仅首次启动显示（general.firstRunSeen=false），
   交代托盘退出/快捷键/离线三件事，关闭即置位不再出现。 */
function buildFirstRun(actions) {
  const card = el("div", "firstrun-card card");
  card.appendChild(cardHead("初次使用", "info"));
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

function buildSyncNotice(home, actions) {
  const notice = el("div", "home-sync-note");
  notice.setAttribute("role", "status");
  const glyph = el("span", "home-sync-icon");
  glyph.innerHTML = icon("alert");
  const copy = el("span", "home-sync-copy");
  copy.appendChild(el("strong", "", "部分数据未更新"));
  copy.appendChild(el("span", "", String(home.error || "")));
  const retry = el("button", "btn-quiet", "重试");
  retry.type = "button";
  retry.addEventListener("click", () => actions.refresh());
  notice.append(glyph, copy, retry);
  return notice;
}

function buildAnnouncement(home, actions) {
  const section = sectionData(home, "announcement");
  const card = el("div", "announcement-card card");
  card.appendChild(cardHead("本站公告", "bell"));
  const items = Array.isArray(section.links) ? section.links.slice(0, 40) : [];
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
    const fullText = String(section.text || "").replace(/\s+/g, " ").trim();
    if (fullText) {
      const details = el("details", "official-text-details");
      details.appendChild(el("summary", "", "查看洛谷公告全文"));
      details.appendChild(el("p", "", fullText));
      card.appendChild(details);
    }
    return card;
  }
  const text = String(section.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  card.appendChild(el("div", "welcome-line", text));
  return card;
}
function isPlaceholderTask(value) {
  return /还没有计划完成的题目|可以在题目详情页面收藏题目|智能推荐|暂无推荐|洛谷根据您近期的做题情况|tasklist-edit|\.ajax\(|children\(|data-pid/i.test(String(value || ""));
}

function buildTasks(home, actions) {
  const section = sectionData(home, "tasks");
  const items = (Array.isArray(section.items) ? section.items : []).filter((item) => {
    if (!item) return false;
    const title = String(item.title || "").trim();
    if (!title || isPlaceholderTask(title)) return false;
    return !!(item.url || item.meta || item.progress || item.done);
  });
  const fallbackLines = String(section.text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => line !== "任务计划" && line !== "智能推荐" && !isPlaceholderTask(line));

  const card = el("div", "tasks-card card");
  card.appendChild(cardHead("任务计划", "list", items.length ? items.length + " 项" : ""));
  if (!items.length && !fallbackLines.length) {
    card.appendChild(el("p", "task-empty", "暂无计划任务或推荐题目。"));
    return card;
  }
  const list = el("div", "task-links task-plan-list");
  for (const item of items) {
    const url = String(item.url || "");
    const row = el(url ? "button" : "div", "task-row task-plan-row" + (item.done ? " done" : ""));
    if (url) row.type = "button";
    const copy = el("span", "task-plan-copy");
    copy.appendChild(el("span", "task-title", String(item.title || "")));
    const metaText = [item.meta, item.progress, item.done ? "已完成" : ""].filter(Boolean).join(" · ");
    if (metaText) copy.appendChild(el("span", "task-plan-meta", metaText));
    row.appendChild(copy);
    row.appendChild(el("span", "task-action", item.done ? "已完成" : url ? "查看" : ""));
    if (url) row.addEventListener("click", () => actions.openDetail({ url, title: item.title || "任务计划" }));
    list.appendChild(row);
  }
  if (!items.length) {
    for (const line of fallbackLines) {
      const row = el("div", "task-row task-plan-row");
      row.appendChild(el("span", "task-title", line));
      list.appendChild(row);
    }
  }
  card.appendChild(list);
  return card;
}

function buildLinks(home, actions) {
  const section = sectionData(home, "links");
  const liveGroups = Array.isArray(section.groups) && section.groups.length;
  const groups = liveGroups ? section.groups : FALLBACK_LINK_GROUPS;
  const card = el("section", "links-card card");
  card.appendChild(cardHead("友情链接", "external", liveGroups ? "洛谷官网" : "内置回退"));
  if (!liveGroups) {
    card.appendChild(el("p", "official-fallback-note", "当前未读到洛谷官网友情链接，以下为内置的同结构链接。"));
  }
  for (const group of groups) {
    const block = el("div", "link-group");
    block.appendChild(el("div", "link-group-title", String(group.title || "相关链接")));
    const grid = el("div", "link-grid");
    for (const raw of Array.isArray(group.links) ? group.links : []) {
      const item = Array.isArray(raw) ? { title: raw[0], url: raw[1] } : (raw || {});
      const label = String(item.title || "").trim();
      const url = String(item.url || "").trim();
      if (!label || !url) continue;
      const link = el("button", "link-item", label);
      link.type = "button";
      link.title = label;
      link.addEventListener("click", () => actions.openDetail({ url, title: label }));
      grid.appendChild(link);
    }
    if (grid.childElementCount) {
      block.appendChild(grid);
      card.appendChild(block);
    }
  }
  return card;
}

function buildCommunity(home, actions) {
  const card = el("div", "community-card card");
  const section = sectionData(home, "discussions");
  const items = Array.isArray(section.items) ? section.items.slice(0, 8) : [];
  if (!items.length) return null;
  card.appendChild(cardHead("最近讨论", "discuss", "站内动态"));
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

function fortuneText(fortune) {
  if (!fortune) return "";
  if (fortune.text) return fortune.text;
  const lines = [];
  if (fortune.result) lines.push(`§ ${fortune.result} §`);
  if (fortune.good) lines.push(`宜：${fortune.good}`);
  if (fortune.bad) lines.push(`忌：${fortune.bad}`);
  for (const item of fortune.advice) {
    if (!/^[宜忌]/.test(item)) lines.push(item);
  }
  return lines.join("\n");
}

function parseFortuneActions(fortune) {
  const lines = fortuneText(fortune)
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/的运势$/.test(line) && !/^§.*§$/.test(line) && !/连续打卡/.test(line));
  const actions = [];
  let current = null;
  let seenAction = false;
  for (const line of lines) {
    const match = line.match(/^(宜|忌)\s*[:：]\s*(.*)$/);
    if (match) {
      seenAction = true;
      current = { kind: match[1], text: match[2], desc: "" };
      actions.push(current);
    } else if (current && !current.desc) {
      current.desc = line;
    } else if (!seenAction) {
      // 官网在全凶时会直接输出“诸事不宜”，它没有“忌：”前缀，不能丢。
      actions.push({ kind: "", text: line, desc: "" });
    }
  }
  return actions;
}

function appendFortuneColumn(column, actions) {
  for (const action of actions) {
    if (action.kind) {
      column.appendChild(el("span", "lg-bold", action.kind + "："));
      column.appendChild(document.createTextNode(action.text));
    } else {
      column.appendChild(el("span", "lg-bold", action.text));
    }
    column.appendChild(document.createElement("br"));
    if (action.desc) {
      column.appendChild(el("span", "lg-small", action.desc));
      column.appendChild(document.createElement("br"));
    }
  }
}

function buildTodayActions(state, actions) {
  const user = state.user || {};
  const home = state.home || {};
  const box = el("div", "home-today-actions");
  if (!user.loggedIn) {
    const login = el("button", "home-today-btn daily guest");
    login.type = "button";
    const glyph = el("span", "home-today-icon");
    glyph.innerHTML = icon("user");
    const copy = el("span", "home-today-copy");
    copy.appendChild(el("strong", "home-today-title", "登录洛谷"));
    copy.appendChild(el("span", "home-today-meta", "登录后同步签到与今日运势"));
    login.append(glyph, copy);
    login.addEventListener("click", () => actions.login());
    box.appendChild(login);
    return box;
  }

  const panel = el("section", "am-u-md-4 lg-punch am-text-center home-fortune-panel home-fortune-official");
  panel.setAttribute("aria-label", "洛谷今日运势");
  panel.setAttribute("aria-live", "polite");
  const button = el("button", "am-btn am-btn-danger am-btn-sm home-today-btn daily");
  button.type = "button";
  button.textContent = "点击打卡";
  box.appendChild(panel);

  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  let fortune = normalizeFortune(home.official && home.official.fortune);
  const paint = (next, message) => {
    if (next) fortune = next;
    panel.textContent = "";
    panel.classList.toggle("drawn", !!fortune);
    panel.classList.toggle("done", !fortune && !!home.punched);

    const heading = el("h2");
    const account = el("a", "lg-fg-red lg-bold", String(user.name || "洛谷用户"));
    account.href = user.uid ? "/user/" + user.uid : "#";
    account.addEventListener("click", (event) => {
      event.preventDefault();
      if (user.uid) actions.openUser(user.uid);
    });
    heading.append(account, document.createTextNode(" 的运势"));
    panel.appendChild(heading);

    if (!fortune) {
      // 官网打卡前显示月历与赛事倒计时，点击后才用运势整块替换。
      const now2 = new Date();
      const monthDays = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
      const calendar = el("div", "lg-index-calendar lg-fg-greendark home-fortune-calendar");
      calendar.append(
        el("span", "lg-punch-small", monthNames[now2.getMonth()] + (monthDays === 31 ? "大" : "小")),
        el("span", "lg-punch-big", pad(now2.getDate())),
        el("span", "lg-punch-small", "星期" + WEEK[now2.getDay()])
      );
      panel.appendChild(calendar);
      const countdowns = Array.isArray(home.official && home.official.countdowns)
        ? home.official.countdowns.filter((item) => item && item.name).slice(0, 3)
        : [];
      if (countdowns.length) {
        const countdownGrid = el("div", "am-g");
        const countdownBody = el("div", "am-u-sm-12 lg-small");
        for (const item of countdowns) {
          const days = Number(item.days);
          countdownBody.append(document.createTextNode("距 "));
          countdownBody.appendChild(el("strong", "", String(item.name)));
          countdownBody.append(document.createTextNode(days <= 0 ? " 就是今天" : " 还剩 "));
          if (days > 0) countdownBody.appendChild(el("strong", "", String(days) + " 天"));
          countdownBody.appendChild(document.createElement("br"));
        }
        countdownGrid.appendChild(countdownBody);
        panel.appendChild(countdownGrid);
      }
      if (message) panel.appendChild(el("p", "home-fortune-pending", message));
      button.textContent = home.punched ? "同步今日运势" : "点击打卡";
      button.disabled = false;
      button.classList.remove("loading");
      panel.appendChild(button);
      return;
    }

    panel.appendChild(el("span", "lg-punch-result", fortune.result ? "§ " + fortune.result + " §" : "§ 运势 §"));
    const grid = el("div", "am-g home-fortune-grid");
    const parsed = parseFortuneActions(fortune);
    const goodActions = parsed.filter((item) => item.kind === "宜" || !item.kind);
    const badActions = parsed.filter((item) => item.kind === "忌");
    if (!goodActions.length) {
      const goodNote = fortune.good || (badActions.length ? "诸事不宜" : "");
      if (goodNote) goodActions.push({ kind: "", text: goodNote, desc: "" });
    }
    if (!badActions.length && fortune.bad) {
      badActions.push({ kind: "忌", text: fortune.bad, desc: "" });
    }
    const good = el("div", "am-u-sm-6 lg-fg-red");
    const bad = el("div", "am-u-sm-6");
    appendFortuneColumn(good, goodActions);
    appendFortuneColumn(bad, badActions);
    grid.append(good, bad);
    const streakMatch = fortuneText(fortune).match(/连续打卡了\s*(\d+)\s*天/);
    if (streakMatch) {
      const streak = el("div", "am-u-sm-12 lg-small");
      streak.append(document.createTextNode("你已经在洛谷连续打卡了 "));
      streak.appendChild(el("strong", "", streakMatch[1]));
      streak.append(document.createTextNode(" 天"));
      grid.appendChild(streak);
    }
    panel.appendChild(grid);
  };
  paint(fortune);

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("loading");
    button.textContent = "求签中";
    let result = null;
    try {
      result = await actions.checkin();
    } catch {
      /* 主进程已 toast 具体错误 */
    }
    const payload = result && result.home && result.home.home ? result.home.home : result && result.home;
    const next = normalizeFortune(result && result.fortune ? result.fortune : payload && payload.official && payload.official.fortune);
    if (next) {
      paint(next);
      return;
    }
    if (result && result.ok && payload) {
      home.punched = !!payload.punched;
      paint(null, "今日已签到，洛谷暂未返回可显示的运势内容。");
      return;
    }
    paint(null, result && result.uncertain ? "签到状态待确认，请刷新主页。" : "签到失败，稍后再试。");
  });
  return box;
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
    ? {
        homeAnnouncement: true,
        homeTasks: true,
        homeLinks: true,
        homeCommunity: true,
        homeOfficial: true,
        homeCountdown: true,
        homeQuickJump: true,
        homeProgress: true,
        homeContest: true,
        homeHeat: true,
        homeRecent: true,
        homeFirstRun: true,
      }
    : features;

  const progressCard = user.loggedIn && sections.homeProgress !== false ? buildProgress(home, user) : null;
  wrap.appendChild(
    buildDailyHeader(
      home,
      user,
      features,
      actions,
      offline,
      sections.homeCountdown !== false,
      sections.homeOfficial !== false,
      state,
      progressCard
    )
  );

  if (offline && home.updatedAt) {
    wrap.appendChild(el("div", "offline-note", "离线模式 · 以下为本地数据，更新于 " + formatWhen(home.updatedAt) + "。"));
  }

  const hasHomeData = !!(
    home.updatedAt ||
    (home.heat || []).length ||
    (home.acProgress || []).length ||
    (home.recent || []).length ||
    (home.contests || []).length ||
    home.official
  );
  if (home.error && hasHomeData) wrap.appendChild(buildSyncNotice(home, actions));

  const grid = el("div", "home-grid");
  const main = el("div", "home-main");
  const side = el("div", "home-side");

  if (user.loggedIn) {
    if (sections.homeHeat !== false) main.appendChild(buildHeat(home));
    if (sections.homeProgress !== false) main.appendChild(buildTrend(home, user));
    if (sections.homeRecent !== false) main.appendChild(buildRecent(home, actions, offline));
  } else {
    grid.classList.add("guest");
  }
  if (sections.homeAnnouncement !== false) {
    const announcementCard = buildAnnouncement(home, actions);
    if (announcementCard) main.appendChild(announcementCard);
  }
  if (sections.homeCommunity !== false) {
    const communityCard = buildCommunity(home, actions);
    if (communityCard) main.appendChild(communityCard);
  }

  if (sections.homeFirstRun !== false && state.general && state.general.firstRunSeen === false) {
    side.appendChild(buildFirstRun(actions));
  }
  if (sections.homeQuickJump !== false) side.appendChild(buildQuickJump(actions));
  if (sections.homeContest !== false) {
    const contestCard = buildContest(home, actions);
    if (contestCard) side.appendChild(contestCard);
  }
  if (sections.homeTasks !== false) {
    const tasksCard = buildTasks(home, actions);
    if (tasksCard) side.appendChild(tasksCard);
  }
  if (sections.homeLinks !== false) side.appendChild(buildLinks(home, actions));
  if (features.supportPrompt) side.appendChild(buildSupport(actions));
  const queueCard = buildQueue(state, actions);
  if (queueCard) side.appendChild(queueCard);

  if (main.childElementCount) grid.appendChild(main);
  if (side.childElementCount) grid.appendChild(side);
  if (grid.childElementCount === 1) grid.classList.add("single");
  if (grid.childElementCount) wrap.appendChild(grid);

  if (home.error && !hasHomeData) {
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
