/* 做题趋势热度图：26 周 × 7 天，与洛谷个人中心同结构。 */
import { cardHead, el, pad } from "./utils.js";
function heatColorLevel(count) {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  return 4;
}

/* 结构与颜色档位直接对应洛谷个人中心“做题趋势热度图”。
   即使账号没有提交，也绘制完整的 26 周网格；否则图表会消失，页面反而出现空洞。 */
export function buildHeat(home) {
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
