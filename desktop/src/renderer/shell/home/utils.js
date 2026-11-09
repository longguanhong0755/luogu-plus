/* 主页通用小工具：DOM 构造、日期/时间格式化、结果配色与卡片标题。 */
import { icon } from "../icons.js";
import { WEEK } from "./constants.js";
/* 会截断的文本类统一补原生 tooltip */
export const ELLIPSIS_CLASSES = new Set(["sub-name", "q-note", "home-quote", "lib-name"]);
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    node.textContent = text;
    if (ELLIPSIS_CLASSES.has(className)) node.title = String(text);
  }
  return node;
}
export function formatDate(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${WEEK[date.getDay()]}`;
}
function cleanFortunePart(value) {
  return String(value || "")
    .replace(/^[宜忌]\s*[:：]?\s*/, "")
    .replace(/[§·,，。;；]+$/g, "")
    .trim();
}
/* 只消费洛谷返回的结构化运势；不在本地随机生成，也不缓存成“官方结果”。 */
export function normalizeFortune(value) {
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
export function pad(n) {
  return String(n).padStart(2, "0");
}
export function formatClock(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
export function formatWhen(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  if (diff < 172800000) return "昨天";
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
export function formatCalDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function resClass(status) {
  if (status === 12) return "ok";
  if ([2, 3, 4, 5, 6, 7, 8].includes(status)) return "bad";
  return "mid";
}
export function cardHead(title, iconName, extra) {
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
