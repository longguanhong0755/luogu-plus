/* 今日签到与官方运势面板：只消费洛谷返回的结构化运势，本地不随机生成。 */
import { icon } from "../icons.js";
import { WEEK } from "./constants.js";
import { el, normalizeFortune, pad } from "./utils.js";
export function fortuneText(fortune) {
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
export function parseFortuneActions(fortune) {
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
export function appendFortuneColumn(column, actions) {
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
export function buildTodayActions(state, actions) {
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
