/* 官方/站内板块卡：同步提示、公告、任务计划、友情链接、最近讨论与支持项目。 */
import { icon } from "../icons.js";
import { FALLBACK_LINK_GROUPS } from "./constants.js";
import { cardHead, el } from "./utils.js";
function sectionData(home, name) {
  const sections = home.official && home.official.sections;
  return (sections && sections[name]) || {};
}

export function buildSyncNotice(home, actions) {
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
export function buildAnnouncement(home, actions) {
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
export function isPlaceholderTask(value) {
  return /还没有计划完成的题目|可以在题目详情页面收藏题目|智能推荐|暂无推荐|洛谷根据您近期的做题情况|tasklist-edit|\.ajax\(|children\(|data-pid/i.test(String(value || ""));
}
export function buildTasks(home, actions) {
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
export function buildLinks(home, actions) {
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
export function buildCommunity(home, actions) {
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
export function buildSupport(actions) {
  const card = el("div", "support-card card");
  card.appendChild(cardHead("支持项目", "star"));
  card.appendChild(el("div", "welcome-line sub", "如果这个客户端对你有帮助，可以前往仓库点一个 Star。"));
  const btn = el("button", "sign-btn", "前往项目仓库");
  btn.type = "button";
  btn.addEventListener("click", () => actions.openDetail({ url: "https://github.com/longguanhong0755/luogu-plus", title: "项目仓库" }));
  card.appendChild(btn);
  return card;
}
