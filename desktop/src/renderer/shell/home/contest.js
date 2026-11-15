/* 近期比赛卡：优先使用官方主页抓到的结构化比赛，离线快照回退到比赛日历接口。 */
import { el } from "./utils.js";

function contestBadge(text, tone) {
  if (!text) return null;
  return el("span", "badge " + (tone || "gray"), String(text).slice(0, 24));
}

function formatClock(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function fallbackItems(home) {
  const now = Date.now();
  return (Array.isArray(home.contests) ? home.contests : []).map((item) => {
    const start = Number(item.start) || 0;
    const end = Number(item.end) || 0;
    const live = item.live || (start && end && start <= now && now <= end);
    const statusText = live ? "进行中" : start > now ? "未开始" : "已结束";
    return {
      title: item.name || "洛谷比赛",
      url: item.id ? "https://www.luogu.com.cn/contest/" + item.id : "",
      tone: live ? "primary" : start > now ? "success" : "danger",
      rated: [],
      badges: [{ text: "洛谷比赛", tone: "red" }],
      statusText,
      statusTone: live ? "primary" : start > now ? "success" : "danger",
      remaining: "",
      team: "洛谷",
      teamUrl: "",
      start: start ? formatClock(start) : "",
      end: end ? formatClock(end) : "",
      _start: start,
      _end: end,
      _live: live,
    };
  });
}

function remainingFor(item) {
  if (item.remaining) return item.remaining;
  if (!item._start) return "";
  const target = item._live ? item._end : item._start;
  const diff = target - Date.now();
  if (diff <= 0) return "";
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const value = (days ? days + "天" : "") + (hours ? hours + "时" : "") + (minutes ? minutes + "分" : "");
  if (!value) return "不足 1 分";
  return item._live ? "剩" + value : value + "后";
}

function open(actions, url, title) {
  if (url) actions.openDetail({ url, title });
}

export function buildContest(home, actions) {
  const section = home.official && home.official.sections && home.official.sections.contests;
  const official = section && Array.isArray(section.items) ? section.items : [];
  const items = official.length ? official : fallbackItems(home);
  const card = el("article", "lg-article contest-card");
  card.appendChild(el("h2", "", "近期比赛"));
  const flow = el("div", "contest-flow");
  if (!items.length) {
    flow.appendChild(el("p", "home-empty-note", "暂无比赛信息。"));
    card.appendChild(flow);
    return card;
  }

  for (const item of items.slice(0, 8)) {
    const tone = item.tone === "success" || item.tone === "danger" ? item.tone : "primary";
    const row = el("section", "contest home-contest " + tone);
    const head = el("header", "contest-hd");
    const title = el("h3");
    const link = el("a", "", String(item.title || "洛谷比赛"));
    link.href = "#";
    link.title = String(item.title || "洛谷比赛");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      open(actions, item.url, item.title || "比赛");
    });
    title.appendChild(link);
    head.appendChild(title);
    for (const badge of Array.isArray(item.rated) ? item.rated : []) {
      const node = contestBadge(badge.text, badge.tone);
      if (node) head.appendChild(node);
    }
    row.appendChild(head);

    const body = el("div", "contest-bd");
    const badges = el("div", "contest-col badges");
    for (const badge of Array.isArray(item.badges) ? item.badges : []) {
      const node = contestBadge(badge.text, badge.tone);
      if (node) badges.appendChild(node);
    }
    body.appendChild(badges);

    const status = el("div", "contest-col status");
    const statusLine = el("div");
    if (item.statusText) {
      statusLine.appendChild(el("strong", "status-strong " + (item.statusTone || tone), String(item.statusText)));
    }
    const remaining = remainingFor(item);
    if (remaining) statusLine.appendChild(el("span", "", remaining));
    status.appendChild(statusLine);
    if (item.team) {
      const team = el("a", "contest-team", String(item.team));
      team.href = "#";
      team.addEventListener("click", (event) => {
        event.preventDefault();
        open(actions, item.teamUrl, item.team);
      });
      status.appendChild(team);
    }
    body.appendChild(status);

    const time = el("div", "contest-col time");
    time.appendChild(el("div", "", String(item.start || "")));
    time.appendChild(el("div", "", String(item.end || "")));
    body.appendChild(time);
    row.appendChild(body);
    flow.appendChild(row);
  }
  card.appendChild(flow);
  return card;
}
