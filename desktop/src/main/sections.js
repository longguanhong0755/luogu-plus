/* 应用内置页面与左侧栏定义（主进程与渲染层共用同一份语义）。
   kind:
   - home     应用主页（原生）
   - library  原生列表（题库/训练/比赛/记录/讨论/文章）
   - web      洛谷网页页面（课程/聊天/通知）
   - action   打开设置等动作 */
const NAV = {
  home: { label: "主页", icon: "home", kind: "home" },
  problems: { label: "题库", icon: "library", kind: "library", url: "/problem/list" },
  class: { label: "课程", icon: "class", kind: "web", url: "https://class.luogu.com.cn/" },
  training: { label: "训练", icon: "training", kind: "library", url: "/training/list" },
  contest: { label: "比赛", icon: "contest", kind: "library", url: "/contest/list" },
  record: { label: "记录", icon: "record", kind: "library", url: "/record/list" },
  discuss: { label: "讨论", icon: "discuss", kind: "library", url: "/discuss" },
  article: { label: "文章", icon: "article", kind: "library", url: "/article" },
  chat: { label: "聊天", icon: "chat", kind: "web", url: "/chat" },
  notification: { label: "通知", icon: "bell", kind: "web", url: "/user/notification" },
  settings: { label: "设置", icon: "settings", kind: "action" },
};

const LIBRARY_IDS = new Set(["problems", "training", "contest", "record", "discuss", "article"]);

const WEB_URLS = {
  class: "https://class.luogu.com.cn/",
  chat: "https://www.luogu.com.cn/chat",
  notification: "https://www.luogu.com.cn/user/notification",
};

const FALLBACK_URLS = {
  problems: "https://www.luogu.com.cn/problem/list",
  training: "https://www.luogu.com.cn/training/list",
  contest: "https://www.luogu.com.cn/contest/list",
  record: "https://www.luogu.com.cn/record/list",
  discuss: "https://www.luogu.com.cn/discuss",
  article: "https://www.luogu.com.cn/article",
};

function resolveRail(cfg) {
  const hidden = new Set(cfg.rail.hidden || []);
  const top = [];
  for (const id of cfg.rail.order) {
    const def = NAV[id];
    if (!def || hidden.has(id)) continue;
    top.push({ id, label: def.label, icon: def.icon, kind: def.kind });
  }
  for (const item of cfg.rail.custom || []) {
    top.push({ id: item.id, label: item.label, icon: "link", kind: "custom", url: item.url });
  }
  const bottom = [];
  for (const id of ["chat", "notification", "settings"]) {
    if (hidden.has(id)) continue;
    const def = NAV[id];
    bottom.push({ id, label: def.label, icon: def.icon, kind: def.kind });
  }
  return {
    top,
    bottom,
    order: cfg.rail.order.slice(),
    hidden: cfg.rail.hidden.slice(),
    custom: cfg.rail.custom.map((item) => Object.assign({}, item)),
    all: Object.keys(NAV).map((id) => ({ id, label: NAV[id].label, icon: NAV[id].icon, kind: NAV[id].kind })),
  };
}

module.exports = { NAV, LIBRARY_IDS, WEB_URLS, FALLBACK_URLS, resolveRail };
