/* 主页装配：官方老版首页的 8/4 欢迎行、190px 统计行、9/3 主侧栏，板块按设置独立显隐。 */
import { buildChartCard, disposeCharts } from "./charts.js";
import { buildContest } from "./contest.js";
import { buildHero } from "./hero.js";
import { buildQuickJump } from "./quick-jump.js";
import { buildQueue } from "./queue.js";
import { buildAnnouncement, buildDiscussions, buildFeed, buildLinks, buildSupport, buildSyncNotice, buildTasks } from "./sections.js";
import { disposeHome } from "./timer.js";
import { el, formatWhen } from "./utils.js";

function buildFooter(actions) {
  const footer = el("footer", "lg-footer");
  const links = el("p", "ft-links");
  const items = [
    ["关于洛谷", "https://www.luogu.com.cn/about"],
    ["帮助中心", "https://www.luogu.com.cn/help"],
    ["用户协议", "https://www.luogu.com.cn/about"],
    ["联系我们", "https://www.luogu.com.cn/about"],
    ["小黑屋", "https://www.luogu.com.cn/discuss"],
    ["图片服务", "https://www.luogu.com.cn/image-host"],
    ["社区规则", "https://www.luogu.com.cn/discuss"],
  ];
  items.forEach(([label, url], index) => {
    if (index) links.append(document.createTextNode(" · "));
    const link = el("a", "", label);
    link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      actions.openDetail({ url, title: label });
    });
    links.appendChild(link);
  });
  footer.appendChild(links);
  footer.appendChild(el("p", "", "在洛谷，享受 Coding 的欢乐 © 2013-2026 洛谷. All rights reserved."));
  footer.appendChild(el("p", "", "增值电信业务经营许可证 浙B2-20080127 · 浙ICP备18008332号"));
  return footer;
}

export function renderHome(state, actions) {
  const root = document.getElementById("home");
  if (!root) return;
  disposeHome();
  disposeCharts();
  const scrollTop = root.scrollTop;
  root.textContent = "";

  const wrap = el("div", "home-wrap lg-home");
  const home = state.home || {};
  const user = state.user || {};
  const offline = state.online === false;
  const features = state.features || {};
  const showAll = features.customSections === false;
  const on = (key) => showAll || features[key] !== false;

  root.classList.toggle("plain-home", features.beautifyUI === false);
  root.classList.toggle("smooth-home", features.smoothHome !== false);

  wrap.appendChild(buildHero(state, actions, { showFortune: on("homeOfficial") }));

  if (offline && home.updatedAt) {
    wrap.appendChild(el("div", "offline-note", "离线模式 · 以下为本地数据，更新于 " + formatWhen(home.updatedAt) + "。"));
  }
  const hasHomeData = !!(
    home.updatedAt ||
    (home.heat || []).length ||
    (home.acProgress || []).length ||
    (home.recent || []).length ||
    (home.contests || []).length ||
    home.official
  );
  if (home.error && hasHomeData) wrap.appendChild(buildSyncNotice(home, actions));

  const statRow = el("div", "home-stat-grid" + (on("homeQuickJump") ? "" : " single"));
  if (on("homeQuickJump")) {
    const jumpCol = el("div", "home-jump-col");
    jumpCol.appendChild(buildQuickJump(actions));
    statRow.appendChild(jumpCol);
  }
  const chartCol = el("div", "home-chart-col");
  chartCol.appendChild(buildChartCard(state));
  statRow.appendChild(chartCol);
  wrap.appendChild(statRow);

  const grid = el("div", "home-grid");
  const main = el("div", "home-main");
  const side = el("div", "home-side");

  if (on("homeContest")) main.appendChild(buildContest(home, actions));
  if (on("homeCommunity")) main.appendChild(buildDiscussions(home, actions));
  for (const card of buildFeed(state, actions, on)) main.appendChild(card);

  if (on("homeAnnouncement")) {
    const announcementCard = buildAnnouncement(home, actions);
    if (announcementCard) side.appendChild(announcementCard);
  }
  if (user.loggedIn && on("homeTasks")) side.appendChild(buildTasks(home, actions));
  if (on("homeLinks")) side.appendChild(buildLinks(home, actions));
  if (features.supportPrompt) side.appendChild(buildSupport(actions));
  const queueCard = buildQueue(state, actions);
  if (queueCard) side.appendChild(queueCard);

  if (main.childElementCount) grid.appendChild(main);
  if (side.childElementCount) grid.appendChild(side);
  if (grid.childElementCount === 1) grid.classList.add("single");
  if (grid.childElementCount) wrap.appendChild(grid);

  wrap.appendChild(buildFooter(actions));

  if (home.error && !hasHomeData) {
    const card = el("article", "lg-article home-error-card");
    const stateBox = el("div", "lib-state");
    stateBox.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/></svg>';
    stateBox.appendChild(el("strong", "", "数据同步失败"));
    stateBox.appendChild(el("span", "", home.error));
    card.appendChild(stateBox);
    wrap.appendChild(card);
  }

  root.appendChild(wrap);
  root.scrollTop = scrollTop;
}
