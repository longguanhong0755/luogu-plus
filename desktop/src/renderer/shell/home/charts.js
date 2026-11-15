/* 官方主页双联曲线图：数据来自隐藏窗的 Highcharts，绘制沿用官方 393×180 的几何。 */
import { el } from "./utils.js";

const NS = "http://www.w3.org/2000/svg";
const W = 393;
const H = 180;
/* 与官方 Highcharts 完全一致的绘图区：左图让出 y 轴标题，右图让出右侧刻度。 */
const LAYOUT = {
  left: { plot: { left: 79, top: 10, w: 304, h: 132 }, barWidth: 13, titleX: 26, titleRotate: -90, labelX: 64, labelAnchor: "end", side: "left" },
  right: { plot: { left: 10, top: 10, w: 315, h: 132 }, barWidth: 6, titleX: 367, titleRotate: 90, labelX: 340, labelAnchor: "start", side: "right" },
};
const disposers = [];

export function disposeCharts() {
  while (disposers.length) {
    try {
      disposers.pop()();
    } catch {
      /* 页面卸载后 ResizeObserver 已失效也无妨 */
    }
  }
}

function svgNode(name, attrs, styles) {
  const node = document.createElementNS(NS, name);
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
  }
  if (styles) {
    for (const key of Object.keys(styles)) node.style[key] = styles[key];
  }
  return node;
}

function svgText(svg, content, x, y, options) {
  options = options || {};
  const attrs = { x, y, "text-anchor": options.anchor || "start" };
  if (options.baseline) attrs["dominant-baseline"] = options.baseline;
  const node = svgNode("text", attrs);
  node.style.fontSize = (options.size || 11) + "px";
  node.style.fontWeight = options.weight || "400";
  node.style.fill = options.fill || "var(--home-chart-label)";
  node.textContent = content;
  svg.appendChild(node);
  return node;
}

function fmtNum(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function seriesOf(chart, type) {
  const series = (chart && Array.isArray(chart.series) ? chart.series : []).find((item) => item && item.type === type);
  return series && Array.isArray(series.data) ? series.data : [];
}

function axisOf(chart, index, fallback) {
  const axes = chart && Array.isArray(chart.axes) ? chart.axes : [];
  const axis = axes[index] || {};
  const min = Number.isFinite(Number(axis.min)) ? Number(axis.min) : fallback.min;
  const max = Number.isFinite(Number(axis.max)) ? Number(axis.max) : fallback.max;
  return { min, max: max > min ? max : min + 1 };
}

function buildDef(chart, key) {
  if (!chart) return null;
  const layout = LAYOUT[key];
  const categories = (chart.categories || []).map(String);
  const line = seriesOf(chart, "area");
  const bars = seriesOf(chart, "column");
  const lineAxis = axisOf(chart, 0, { min: 0, max: 100 });
  const barAxis = axisOf(chart, 1, { min: 0, max: 10 });
  const lineName = ((chart.series || []).find((item) => item.type === "area") || {}).name || "累积通过数";
  const barName = ((chart.series || []).find((item) => item.type === "column") || {}).name || "通过数";
  return {
    key,
    layout,
    categories,
    count: categories.length,
    step: layout.plot.w / Math.max(1, categories.length),
    line,
    bars,
    lineAxis,
    barAxis,
    lineName,
    barName,
    barMax: Math.max(barAxis.max, 0.0001),
    barMin: barAxis.min,
  };
}

function renderChart(svg, tip, def) {
  if (!svg || !tip || !def) return;
  const width = svg.clientWidth || W;
  const height = svg.clientHeight || H;
  if (width < 80 || height < 80) return;
  const kx = width / W;
  const ky = height / H;
  const layout = def.layout;
  const plot = layout.plot;
  const plotLeft = plot.left * kx;
  const plotRight = (plot.left + plot.w) * kx;
  const plotTop = plot.top * ky;
  const plotBottom = (plot.top + plot.h) * ky;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);

  const xAt = (index) => (plot.left + def.step * (index + 0.5)) * kx;
  const yLine = (value) => plotBottom - ((value - def.lineAxis.min) / (def.lineAxis.max - def.lineAxis.min)) * plotHeight;
  const yBar = (value) => plotBottom - ((value - def.barMin) / (def.barMax - def.barMin)) * plotHeight;
  // 左图左侧刻度属于累积轴；右图右侧刻度属于柱形（新通过）轴，和官网一致。
  const labelAxis = def.key === "left" ? def.lineAxis : def.barAxis;
  const yTick = def.key === "left" ? yLine : yBar;
  const ticks = [labelAxis.min, (labelAxis.min + labelAxis.max) / 2, labelAxis.max];

  ticks.forEach((tick, index) => {
    if (index === 0) return;
    const y = yTick(tick);
    svg.appendChild(svgNode("line", { x1: plotLeft, y1: y, x2: plotRight, y2: y, "stroke-width": 1 }, { stroke: "var(--home-chart-grid)" }));
  });

  svg.appendChild(svgNode("line", { x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, "stroke-width": 1 }, { stroke: "var(--home-chart-axis)" }));
  const sideX = layout.side === "left" ? plotLeft : plotRight;
  svg.appendChild(svgNode("line", { x1: sideX, y1: plotTop, x2: sideX, y2: plotBottom, "stroke-width": 1 }, { stroke: "var(--home-chart-axis)" }));

  ticks.forEach((tick) => {
    const y = yTick(tick);
    const dir = layout.side === "left" ? -1 : 1;
    svg.appendChild(svgNode("line", { x1: sideX, y1: y, x2: sideX + dir * 5, y2: y, "stroke-width": 1 }, { stroke: "var(--home-chart-axis)" }));
    svgText(svg, String(Number(tick.toFixed(2))), layout.labelX * kx, y + 4, {
      anchor: layout.labelAnchor,
      size: 11,
      fill: "var(--home-chart-ylabel)",
    });
  });

  const titleY = plotTop + plotHeight / 2;
  const title = svgText(svg, def.key === "left" ? "累积通过" : "新通过", layout.titleX * kx, titleY, {
    anchor: "middle",
    baseline: "middle",
    size: 12,
    fill: "var(--home-chart-title)",
  });
  title.setAttribute("transform", "rotate(" + layout.titleRotate + " " + (layout.titleX * kx) + " " + titleY + ")");

  const points = [];
  def.line.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
    points.push({ x: xAt(index), y: yLine(Number(value)), value: Number(value) });
  });
  if (points.length > 1) {
    let area = "M " + points[0].x + " " + plotBottom;
    for (const point of points) area += " L " + point.x + " " + point.y;
    area += " L " + points[points.length - 1].x + " " + plotBottom + " Z";
    svg.appendChild(svgNode("path", { d: area }, { fill: "var(--home-chart-fill)", stroke: "none" }));
  }

  def.bars.forEach((value, index) => {
    if (!value) return;
    const barWidth = layout.barWidth * kx;
    const top = yBar(Number(value));
    svg.appendChild(
      svgNode(
        "rect",
        { x: xAt(index) - barWidth / 2, y: top, width: barWidth, height: Math.max(0.5, plotBottom - top), rx: 0.5, ry: 0.5, "stroke-width": 0 },
        { fill: "var(--home-chart-bar)" }
      )
    );
  });

  if (points.length > 1) {
    const line = points.map((point, index) => (index === 0 ? "M " : "L ") + point.x + " " + point.y).join(" ");
    svg.appendChild(
      svgNode("path", { d: line }, { fill: "none", stroke: "var(--home-chart-blue)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" })
    );
  }
  points.forEach((point) => {
    svg.appendChild(svgNode("circle", { cx: point.x, cy: point.y, r: 4, "stroke-width": 0 }, { fill: "var(--home-chart-blue)" }));
  });

  const labelStep = def.count > 20 ? 5 : 2;
  for (let index = 0; index < def.count; index += labelStep) {
    const x = xAt(index);
    svg.appendChild(svgNode("line", { x1: x, y1: plotBottom, x2: x, y2: plotBottom + 5, "stroke-width": 1 }, { stroke: "var(--home-chart-axis)" }));
    svgText(svg, def.categories[index] || "", x, 161 * ky, { anchor: "middle", size: 11, fill: "var(--home-chart-label)" });
  }

  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    if (x < plotLeft - 2 || x > plotRight + 2) {
      tip.hidden = true;
      return;
    }
    const raw = (x / kx - (plot.left + def.step / 2)) / def.step;
    const index = Math.round(raw);
    if (index < 0 || index >= def.count) {
      tip.hidden = true;
      return;
    }
    const lineValue = def.line[index];
    const barValue = def.bars[index];
    const hasLine = lineValue !== null && lineValue !== undefined && Number.isFinite(Number(lineValue));
    if (!hasLine && !Number.isFinite(Number(barValue))) {
      tip.hidden = true;
      return;
    }
    tip.textContent = "";
    tip.appendChild(el("div", "chart-tip-hd", def.categories[index] || ""));
    const rows = [];
    if (hasLine) rows.push({ color: "var(--home-chart-blue)", label: def.lineName, value: Number(lineValue) });
    if (barValue !== null && barValue !== undefined && Number.isFinite(Number(barValue))) {
      rows.push({ color: "var(--home-chart-bar)", label: def.barName, value: Number(barValue) });
    }
    for (const row of rows) {
      const line = el("div", "chart-tip-row");
      const dot = el("span", "chart-tip-dot");
      dot.style.background = row.color;
      line.append(dot, el("span", "chart-tip-label", row.label), el("span", "chart-tip-val", fmtNum(row.value)));
      tip.appendChild(line);
    }
    tip.hidden = false;

    const pointX = xAt(index);
    let pointY = hasLine ? yLine(Number(lineValue)) : plotBottom;
    if (Number.isFinite(Number(barValue))) pointY = Math.min(pointY, yBar(Number(barValue)));
    const pane = svg.parentNode;
    const paneRect = pane.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const offsetX = rect.left - paneRect.left;
    const offsetY = rect.top - paneRect.top;
    let left = offsetX + pointX * scaleX + 12;
    if (left + tip.offsetWidth > pane.clientWidth - 4) left = offsetX + pointX * scaleX - tip.offsetWidth - 12;
    let top = offsetY + pointY * scaleY - tip.offsetHeight / 2;
    top = Math.max(4, Math.min(top, pane.clientHeight - tip.offsetHeight - 4));
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  };
  svg.onmouseleave = () => {
    tip.hidden = true;
  };
}

function attachChart(svg, tip, def) {
  renderChart(svg, tip, def);
  if (typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(() => renderChart(svg, tip, def));
  observer.observe(svg.parentNode);
  disposers.push(() => observer.disconnect());
}

function buildSteps() {
  const wrap = el("div", "steps-pane");
  const steps = el("div", "steps");
  const data = [
    { no: "STEP.1", title: "注册账号", text: "在洛谷注册账号，创建你的个人主页。", icon: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19c0-3.1 2.7-5 6-5s6 1.9 6 5"/><path d="M18 8v6M15 11h6"/>' },
    { no: "STEP.2", title: "借题练习", text: "借助题库、试炼场与比赛，稳步提升能力。", icon: '<path d="M4.5 5.5h6A2.5 2.5 0 0 1 13 8v11a2 2 0 0 0-2-2H4.5z"/><path d="M19.5 5.5h-4A2.5 2.5 0 0 0 13 8v11a2 2 0 0 1 2-2h4.5z"/>' },
    { no: "STEP.3", title: "交流成长", text: "和全国的 OIer 一起讨论、互相帮助。", icon: '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8 10h8M8 13h5"/>' },
  ];
  for (const item of data) {
    const step = el("div", "step");
    const top = el("div", "step-top");
    const iconBox = el("span", "step-icon");
    iconBox.innerHTML = '<svg viewBox="0 0 24 24">' + item.icon + "</svg>";
    top.append(iconBox, el("span", "step-no", item.no));
    step.append(top, el("h3", "", item.title), el("p", "", item.text));
    steps.appendChild(step);
  }
  wrap.appendChild(steps);
  return wrap;
}

export function buildChartCard(state) {
  const home = state.home || {};
  const official = home.official || {};
  const charts = Array.isArray(official.charts) ? official.charts : [];
  const card = el("article", "lg-article chart-card home-chart-card");
  if (state.user && state.user.loggedIn) {
    const defs = charts.slice(0, 2).map((chart, index) => buildDef(chart, index === 0 ? "left" : "right")).filter(Boolean);
    if (!defs.length) {
      card.appendChild(el("div", "chart-empty", "通过曲线将在下次同步后显示。"));
      return card;
    }
    const wrap = el("div", "chart-wrap");
    for (const def of defs) {
      const pane = el("div", "chart-pane");
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "chart-svg");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", def.key === "left" ? "近十二个月累积通过曲线与每月通过数" : "本月每日通过情况与累积通过");
      const tip = el("div", "chart-tip");
      tip.hidden = true;
      pane.append(svg, tip);
      wrap.appendChild(pane);
      requestAnimationFrame(() => attachChart(svg, tip, def));
    }
    card.appendChild(wrap);
    return card;
  }
  card.appendChild(buildSteps());
  return card;
}
