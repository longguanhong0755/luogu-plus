/* 今日签到与官方运势面板：只消费洛谷返回的结构化运势，本地不随机生成。 */
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

function buildGuest(actions) {
  const panel = el("section", "lg-punch home-punch punch-guest-panel");
  const guest = el("div", "punch-guest");
  const orb = el("span", "punch-orb");
  orb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="3.6"/></svg>';
  guest.appendChild(orb);
  guest.appendChild(el("h2", "", "洛谷运势"));
  const copy = el("p");
  copy.append(document.createTextNode("登录后查看今日运势"), document.createElement("br"), document.createTextNode("与连续打卡记录"));
  guest.appendChild(copy);
  const login = el("button", "punch-login", "登录洛谷");
  login.type = "button";
  login.addEventListener("click", () => actions.login());
  guest.appendChild(login);
  panel.appendChild(guest);
  return panel;
}

/* 把官网运势面板原样铺进欢迎卡右侧：标题、结果、宜忌双栏、连续打卡。 */
export function buildFortunePanel(state, actions) {
  const user = state.user || {};
  const home = state.home || {};
  if (!user.loggedIn) return buildGuest(actions);

  const panel = el("section", "lg-punch home-punch");
  panel.setAttribute("aria-label", "洛谷今日运势");
  panel.setAttribute("aria-live", "polite");
  const userBox = el("div", "punch-user");
  panel.appendChild(userBox);

  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  let fortune = normalizeFortune(home.official && home.official.fortune);
  let punched = home.punched !== null && home.punched !== undefined
    ? !!home.punched
    : !!(home.official && home.official.punch && home.official.punch.punched);

  const paint = (next, message) => {
    if (next) fortune = next;
    userBox.textContent = "";
    panel.classList.toggle("drawn", !!fortune);

    const heading = el("h2");
    const account = el("a", "lg-fg-red lg-bold", String(user.name || "洛谷用户"));
    account.title = "打开个人主页";
    account.addEventListener("click", (event) => {
      event.preventDefault();
      if (user.uid) actions.openUser(user.uid);
    });
    heading.appendChild(account);
    heading.appendChild(document.createTextNode(" 的运势"));
    const check = el("span", "punch-check");
    check.title = "运势与打卡结果来自洛谷官网";
    check.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="#5eb95e"><path d="M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z"/></svg>';
    heading.appendChild(check);
    userBox.appendChild(heading);

    if (!fortune) {
      // 官网打卡前显示月历与赛事倒计时，点击后才用运势整块替换。
      const now = new Date();
      const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const calendar = el("div", "punch-calendar");
      calendar.append(
        el("span", "punch-calendar-month", monthNames[now.getMonth()] + (monthDays === 31 ? "大" : "小")),
        el("span", "punch-calendar-day", pad(now.getDate())),
        el("span", "punch-calendar-week", "星期" + WEEK[now.getDay()])
      );
      userBox.appendChild(calendar);
      const countdowns = Array.isArray(home.official && home.official.countdowns)
        ? home.official.countdowns.filter((item) => item && item.name).slice(0, 3)
        : [];
      if (countdowns.length) {
        const list = el("div", "punch-countdowns");
        for (const item of countdowns) {
          const row = el("div", "punch-countdown");
          const days = Number(item.days);
          row.append(document.createTextNode("距 "));
          row.appendChild(el("strong", "", String(item.name)));
          row.append(document.createTextNode(days <= 0 ? " 就是今天" : " 还剩 "));
          if (days > 0) row.appendChild(el("strong", "", String(days) + " 天"));
          list.appendChild(row);
        }
        userBox.appendChild(list);
      }
      if (message) userBox.appendChild(el("p", "punch-pending", message));
      const button = el("button", "punch-checkin", punched ? "同步今日运势" : "点击打卡");
      button.type = "button";
      button.addEventListener("click", () => runCheckin(button));
      userBox.appendChild(button);
      return;
    }

    const resultText = fortune.result ? "§ " + fortune.result + " §" : "§ 运势 §";
    const result = el("span", "punch-result lg-punch-result lg-fg-red", resultText);
    userBox.appendChild(result);

    const grid = el("div", "punch-cols");
    const parsed = parseFortuneActions(fortune);
    const goodActions = parsed.filter((item) => item.kind === "宜" || !item.kind);
    const badActions = parsed.filter((item) => item.kind === "忌");
    if (!goodActions.length) {
      const goodNote = fortune.good || (badActions.length ? "诸事不宜" : "");
      if (goodNote) goodActions.push({ kind: "", text: goodNote, desc: "" });
    }
    if (!badActions.length && fortune.bad) badActions.push({ kind: "忌", text: fortune.bad, desc: "" });
    const good = el("div", "punch-col");
    const bad = el("div", "punch-col");
    appendFortuneColumn(good, goodActions);
    appendFortuneColumn(bad, badActions);
    grid.append(good, bad);
    const streakValue = Number(home.streak || (home.official && home.official.punch && home.official.punch.streak) || 0);
    const streakMatch = fortuneText(fortune).match(/连续打卡了\s*(\d+)\s*天/);
    const streakDays = streakValue || (streakMatch ? Number(streakMatch[1]) : 0);
    if (streakDays > 0) {
      const streak = el("div", "punch-streak lg-small");
      streak.append(document.createTextNode("你已经在洛谷连续打卡了 "));
      streak.appendChild(el("strong", "", String(streakDays)));
      streak.append(document.createTextNode(" 天"));
      grid.appendChild(streak);
    }
    userBox.appendChild(grid);
  };

  const runCheckin = async (button) => {
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
      punched = !!payload.punched;
      paint(null, "今日已签到，洛谷暂未返回可显示的运势内容。");
      return;
    }
    paint(null, result && result.uncertain ? "签到状态待确认，请刷新主页。" : "签到失败，稍后再试。");
  };

  paint(fortune);
  return panel;
}
