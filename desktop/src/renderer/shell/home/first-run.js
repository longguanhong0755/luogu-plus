/* 首启引导卡：仅首次启动显示（general.firstRunSeen=false）。 */
import { icon } from "../icons.js";
import { cardHead, el } from "./utils.js";
/* 首启引导卡：仅首次启动显示（general.firstRunSeen=false），
   交代托盘退出/快捷键/离线三件事，关闭即置位不再出现。 */
export function buildFirstRun(actions) {
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
