/* 增强功能开关：id → 配置键映射与回填。 */
import { $ } from "./utils.js";

export const FEATURE_CONTROLS = {
  "feat-problem-detect": "problemDetect",
  "feat-user-intro": "showUserIntro",
  "feat-problem-color": "problemDifficultyColor",
  "feat-user-search": "userSearch",
  "feat-shortcuts": "shortcuts",
  "feat-dynamic": "dynamicDetection",
  "feat-fortune": "changeFortune",
  "feat-support": "supportPrompt",
  "feat-better-search": "betterSearch",
  "feat-beautify-home": "beautifyUI",
  "feat-smooth-home": "smoothHome",
  "feat-auto-refresh": "autoRefresh",
  "feat-custom-sections": "customSections",
  "feat-home-official": "homeOfficial",
  "feat-home-quick-jump": "homeQuickJump",
  "feat-home-contest": "homeContest",
  "feat-home-announcement": "homeAnnouncement",
  "feat-home-tasks": "homeTasks",
  "feat-home-links": "homeLinks",
  "feat-home-community": "homeCommunity",
  "feat-home-feed-compose": "homeFeedCompose",
  "feat-home-feed-empty": "homeFeedEmpty",
};

export function applyFeatures(state) {
  const features = state.features || {};
  for (const [id, key] of Object.entries(FEATURE_CONTROLS)) {
    const input = $(id);
    if (input) input.checked = !!features[key];
  }
}
