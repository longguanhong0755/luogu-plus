/* 近 30 天累计通过折线图：官方只公开总通过数，用总量倒推窗口起点。 */
import { cardHead, el, pad } from "./utils.js";
/* 近 30 天累计通过曲线。官方只公开总通过数，因此用总通过数倒推窗口起点，
   数据为空时仍保留 0 线、坐标和日期，不让卡片变成空白占位。 */
export function buildTrend(home, user) {
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
