/* 主页装配：先拼问候行，再按功能开关铺主栏与侧栏，最后处理空数据/失败兜底。 */
import { icon } from "../icons.js";
import { buildContest } from "./contest.js";
import { buildDailyHeader } from "./daily-header.js";
import { buildFirstRun } from "./first-run.js";
import { buildHeat } from "./heat.js";
import { buildProgress } from "./progress.js";
import { buildQuickJump } from "./quick-jump.js";
import { buildQueue } from "./queue.js";
import { buildRecent } from "./recent.js";
import { buildAnnouncement, buildCommunity, buildLinks, buildSupport, buildSyncNotice, buildTasks } from "./sections.js";
import { disposeHome } from "./timer.js";
import { buildTrend } from "./trend.js";
import { el, formatWhen } from "./utils.js";
export function renderHome(state, actions) {
  const root = document.getElementById("home");
  if (!root) return;
  disposeHome();
  const scrollTop = root.scrollTop;
  root.textContent = "";

  const wrap = el("div", "home-wrap");
  const home = state.home || {};
  const user = state.user || {};
  const offline = state.online === false;
  const features = state.features || {};
  root.classList.toggle("plain-home", features.beautifyUI === false);
  root.classList.toggle("smooth-home", features.smoothHome !== false);
  const sections = features.customSections === false
    ? {
        homeAnnouncement: true,
        homeTasks: true,
        homeLinks: true,
        homeCommunity: true,
        homeOfficial: true,
        homeCountdown: true,
        homeQuickJump: true,
        homeProgress: true,
        homeContest: true,
        homeHeat: true,
        homeRecent: true,
        homeFirstRun: true,
      }
    : features;

  const progressCard = user.loggedIn && sections.homeProgress !== false ? buildProgress(home, user) : null;
  wrap.appendChild(
    buildDailyHeader(
      home,
      user,
      features,
      actions,
      offline,
      sections.homeCountdown !== false,
      sections.homeOfficial !== false,
      state,
      progressCard
    )
  );

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

  const grid = el("div", "home-grid");
  const main = el("div", "home-main");
  const side = el("div", "home-side");

  if (user.loggedIn) {
    if (sections.homeHeat !== false) main.appendChild(buildHeat(home));
    if (sections.homeProgress !== false) main.appendChild(buildTrend(home, user));
    if (sections.homeRecent !== false) main.appendChild(buildRecent(home, actions, offline));
  } else {
    grid.classList.add("guest");
  }
  if (sections.homeAnnouncement !== false) {
    const announcementCard = buildAnnouncement(home, actions);
    if (announcementCard) main.appendChild(announcementCard);
  }
  if (sections.homeCommunity !== false) {
    const communityCard = buildCommunity(home, actions);
    if (communityCard) main.appendChild(communityCard);
  }

  if (sections.homeFirstRun !== false && state.general && state.general.firstRunSeen === false) {
    side.appendChild(buildFirstRun(actions));
  }
  if (sections.homeQuickJump !== false) side.appendChild(buildQuickJump(actions));
  if (sections.homeContest !== false) {
    const contestCard = buildContest(home, actions);
    if (contestCard) side.appendChild(contestCard);
  }
  if (sections.homeTasks !== false) {
    const tasksCard = buildTasks(home, actions);
    if (tasksCard) side.appendChild(tasksCard);
  }
  if (sections.homeLinks !== false) side.appendChild(buildLinks(home, actions));
  if (features.supportPrompt) side.appendChild(buildSupport(actions));
  const queueCard = buildQueue(state, actions);
  if (queueCard) side.appendChild(queueCard);

  if (main.childElementCount) grid.appendChild(main);
  if (side.childElementCount) grid.appendChild(side);
  if (grid.childElementCount === 1) grid.classList.add("single");
  if (grid.childElementCount) wrap.appendChild(grid);

  if (home.error && !hasHomeData) {
    const card = el("div", "card");
    const stateBox = el("div", "lib-state");
    stateBox.innerHTML = icon("alert");
    stateBox.appendChild(el("strong", "", "数据同步失败"));
    stateBox.appendChild(el("span", "", home.error));
    card.appendChild(stateBox);
    wrap.appendChild(card);
  }

  root.appendChild(wrap);
  root.scrollTop = scrollTop;
}
