/* 列表区的纯工具：DOM 小工具、数字/时间格式化、难度与状态映射。 */
import { DIFFICULTIES, WEEK } from "./constants.js";
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

export function fmtNum(value) {
  const n = Number(value) || 0;
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + " 万";
  return String(n);
}

/* 通过人数/提交人数要求完整可读，不能走 1.2 万这样的缩写。 */
export function fmtExact(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - ms;
  if (diff >= 0 && diff < 60000) return "刚刚";
  if (diff >= 0 && diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff >= 0 && diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  if (diff >= 0 && diff < 172800000) return "昨天";
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${pad(d.getDate())}`;
}

export function fmtDateTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function difficultyName(level) {
  const hit = DIFFICULTIES.find(([id]) => id === Number(level));
  return hit ? hit[1] : "";
}

export function encodeDifficulty(min, max) {
  const low = Number(min) || 0;
  const high = Number(max) || 0;
  if (!low || !high) return "";
  return low === high ? String(low) : low + "|" + high;
}

export function difficultyRangeText(min, max) {
  if (!min || !max) return "";
  return min === max ? difficultyName(min) : `${difficultyName(min)} ~ ${difficultyName(max)}`;
}

export function contestState(item) {
  const now = Date.now();
  if (item.start && now < item.start) return "upcoming";
  if (item.end && now > item.end) return "ended";
  if (item.start && item.end && now >= item.start && now <= item.end) return "live";
  return "ended";
}

export function statusTone(status) {
  if (status === 12) return "ok";
  if (status === 0 || status === 1) return "mid";
  return "bad";
}
