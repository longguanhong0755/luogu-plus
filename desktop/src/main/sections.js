/* 应用内置页面与左侧栏定义（主进程与渲染层共用同一份语义）。
   kind:
   - home     应用主页（原生）
   - library  原生列表（题库/训练/比赛/记录/讨论/文章）
   - web      洛谷网页页面（聊天/通知）
   - action   打开设置等动作 */
const GROUPS = {
  browse: "浏览",
  community: "社区",
  tools: "工具",
  custom: "自定义",
};

const NAV = {
  home: { label: "主页", icon: "home", kind: "home", group: "browse" },
  problems: { label: "题库", icon: "library", kind: "library", url: "/problem/list", group: "browse" },
  training: { label: "训练", icon: "training", kind: "library", url: "/training/list", group: "browse" },
  contest: { label: "比赛", icon: "contest", kind: "library", url: "/contest/list", group: "browse" },
  record: { label: "记录", icon: "record", kind: "library", url: "/record/list", group: "browse" },
  discuss: { label: "讨论", icon: "discuss", kind: "library", url: "/discuss", group: "community" },
  article: { label: "文章", icon: "article", kind: "library", url: "/article", group: "community" },
  chat: { label: "聊天", icon: "chat", kind: "web", url: "/chat", group: "tools" },
  notification: { label: "通知", icon: "bell", kind: "web", url: "/user/notification", group: "tools" },
  settings: { label: "设置", icon: "settings", kind: "action", group: "tools" },
};

const LIBRARY_IDS = new Set(["problems", "training", "contest", "record", "discuss", "article"]);

const WEB_URLS = {
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
    top.push({
      id,
      label: def.label,
      icon: def.icon,
      kind: def.kind,
      group: def.group || "browse",
      groupLabel: GROUPS[def.group] || "浏览",
    });
  }
  for (const item of cfg.rail.custom || []) {
    top.push({
      id: item.id,
      label: item.label,
      icon: "link",
      kind: "custom",
      url: item.url,
      group: "custom",
      groupLabel: GROUPS.custom,
    });
  }
  const bottom = [];
  for (const id of ["chat", "notification", "settings"]) {
    if (hidden.has(id)) continue;
    const def = NAV[id];
    bottom.push({
      id,
      label: def.label,
      icon: def.icon,
      kind: def.kind,
      group: def.group || "tools",
      groupLabel: GROUPS[def.group] || GROUPS.tools,
    });
  }
  return {
    top,
    bottom,
    order: cfg.rail.order.slice(),
    hidden: cfg.rail.hidden.slice(),
    custom: cfg.rail.custom.map((item) => Object.assign({}, item)),
    pinned: !!cfg.rail.pinned,
    all: Object.keys(NAV).map((id) => ({
      id,
      label: NAV[id].label,
      icon: NAV[id].icon,
      kind: NAV[id].kind,
      group: NAV[id].group,
      groupLabel: GROUPS[NAV[id].group] || "",
    })),
  };
}

/* 题号规范化（唯一源）：P/CF/UVA 等大写；AT_ 系保留「AT_ + 小写」的洛谷
   规范形（大小写敏感，误大写会 404）。空串 = 校验失败。
   渲染层（chrome.js/page.js）不做规范化，只做同款正则的准入判断后把原文
   交给主进程，规范化永远发生在主进程这一处。 */
function canonicalPid(raw) {
  const s = String(raw || "").trim();
  if (!/^[A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*$/.test(s)) return "";
  if (/^AT_/i.test(s)) {
    return "AT_" + s.slice(3).toLowerCase();
  }
  return s.toUpperCase();
}

module.exports = { NAV, LIBRARY_IDS, WEB_URLS, FALLBACK_URLS, resolveRail, canonicalPid };
