/* 页面路由注册表：把“这是什么页面”从 ViewManager 的事件分支里抽离出来。
   每个页面声明骨架形态、就绪选择器和超时，navigation/readiness 只消费这些元数据。
   注意：这里不是站点路由实现，而是桌面壳对洛谷页面和原生页面的稳定分类。 */

const PAGE_SPECS = Object.freeze({
  home: { id: "home", skeleton: "home", title: "主页", timeoutMs: 0, minText: 0, selectors: [] },
  problems: { id: "problems", skeleton: "list", title: "题库", timeoutMs: 15000, minText: 12, selectors: ["#app .problem-list", "#app .filter-section", "#app .main-container", "#app .l-card"] },
  training: { id: "training", skeleton: "training", title: "训练", timeoutMs: 18000, minText: 12, selectors: ["#app .training-card", "#app .training-list", "#app .main-container", "#app .l-card"] },
  contest: { id: "contest", skeleton: "list", title: "比赛", timeoutMs: 15000, minText: 12, selectors: ["#app .contest-list", "#app .main-container", "#app .l-card"] },
  record: { id: "record", skeleton: "list", title: "记录", timeoutMs: 15000, minText: 12, selectors: ["#app .record-list", "#app .main-container", "#app .l-card", "#app .cute-table"] },
  discuss: { id: "discuss", skeleton: "list", title: "讨论", timeoutMs: 15000, minText: 12, selectors: ["#app .discuss-list", "#app .main-container", "#app .l-card"] },
  article: { id: "article", skeleton: "article", title: "文章", timeoutMs: 15000, minText: 12, selectors: ["#app .article-content", "#app .main-container", "#app .l-card"] },
  problem: { id: "problem", skeleton: "problem", title: "题目", timeoutMs: 20000, minText: 16, selectors: [".problem-content", ".lfe-problem-content", ".problem-card", "#app .main-container", "#app .l-card"] },
  chat: { id: "chat", skeleton: "chat", title: "聊天", timeoutMs: 15000, minText: 8, selectors: ["#app [class*='chat']", "#app .message-list", "#app .main-container", "#app .l-container"] },
  notification: { id: "notification", skeleton: "notification", title: "通知", timeoutMs: 15000, minText: 8, selectors: ["#app .notification-list", "#app .message-list", "#app .main-container", "#app .l-card"] },
  profile: { id: "profile", skeleton: "profile", title: "个人主页", timeoutMs: 15000, minText: 12, selectors: ["#app .user-header-top", "#app .profile-header", "#app .user-header", "#app .main-container", "#app .l-card"] },
  login: { id: "login", skeleton: "form", title: "登录", timeoutMs: 15000, minText: 8, selectors: ["#app .login-form", "#app form", "#app .main-container", "#app .l-card"] },
  detail: { id: "detail", skeleton: "article", title: "页面", timeoutMs: 18000, minText: 12, selectors: ["#app .article-content", "#app .main-container", "#app .l-card", "#app .l-container"] },
  custom: { id: "custom", skeleton: "article", title: "自定义页面", timeoutMs: 18000, minText: 12, selectors: ["#app .main-container", "#app .l-card", "#app .article-content"] },
});

function routeIdFromPath(rawPath) {
  const path = String(rawPath || "/");
  if (path === "/" || path === "/home") return "home";
  if (path.startsWith("/problem/list")) return "problems";
  if (path.startsWith("/problem/")) return "problem";
  if (path.startsWith("/training")) return "training";
  if (path.startsWith("/contest")) return "contest";
  if (path.startsWith("/record")) return "record";
  if (path.startsWith("/discuss")) return "discuss";
  if (path.startsWith("/article")) return "article";
  if (path.startsWith("/chat")) return "chat";
  if (path.startsWith("/user/notification")) return "notification";
  if (/^\/user\/[^/]+/.test(path)) return "profile";
  if (path.startsWith("/auth/login") || path.startsWith("/login")) return "login";
  return "custom";
}

function routeIdFromUrl(raw) {
  try {
    const url = new URL(String(raw || ""), "https://www.luogu.com.cn");
    return routeIdFromPath(url.pathname || "/");
  } catch {
    return "";
  }
}

function pageSpecFor(input = {}) {
  const byUrl = routeIdFromUrl(input.url || input.requestedUrl || "");
  let id = byUrl;
  if (!id || id === "custom") {
    if (input.kind === "problem") id = "problem";
    else if (input.kind === "profile") id = "profile";
    else if (input.kind === "login") id = "login";
    else if (input.kind === "detail") id = "detail";
    else if (input.section && PAGE_SPECS[input.section]) id = input.section;
  }
  return PAGE_SPECS[id] || PAGE_SPECS.detail;
}

function readinessProbeSource(spec) {
  const selectors = Array.isArray(spec && spec.selectors) ? spec.selectors : [];
  const minText = Math.max(0, Number(spec && spec.minText) || 0);
  const targetRoute = String((spec && spec.id) || "custom");
  return `(() => {
    const app = document.querySelector("#app") || document.body;
    if (!app) return { routeReady: false, genericReady: false, textLength: 0, visible: 0, signature: "" };
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const routeOf = (rawPath) => {
      const path = String(rawPath || "/");
      if (path === "/" || path === "/home") return "home";
      if (path.startsWith("/problem/list")) return "problems";
      if (path.startsWith("/problem/")) return "problem";
      if (path.startsWith("/training")) return "training";
      if (path.startsWith("/contest")) return "contest";
      if (path.startsWith("/record")) return "record";
      if (path.startsWith("/discuss")) return "discuss";
      if (path.startsWith("/article")) return "article";
      if (path.startsWith("/chat")) return "chat";
      if (path.startsWith("/user/notification")) return "notification";
      if (/^\\/user\\/[^/]+/.test(path)) return "profile";
      if (path.startsWith("/auth/login") || path.startsWith("/login")) return "login";
      return "custom";
    };
    const roots = ${JSON.stringify(selectors)};
    const root = roots.map((selector) => { try { return document.querySelector(selector); } catch { return null; } }).find(visible);
    const text = String(app.innerText || "").replace(/\\s+/g, " ").trim();
    // 自己注入的加载骨架本身也带 aria-busy，必须排除，否则就绪探针永远看到“忙”。
    const busy = [...document.querySelectorAll(".am-loading, .loading-mask, [class*='loading-spinner'], [aria-busy='true']")]
      .find((node) => node.id !== "lg-boot-skeleton" && !node.closest("#lg-boot-skeleton") && visible(node));
    const pathRoute = routeOf(location.pathname);
    const routeMatches = ${JSON.stringify(targetRoute)} === "detail" ||
      ${JSON.stringify(targetRoute)} === "custom" ||
      location.protocol === "file:" ||
      pathRoute === ${JSON.stringify(targetRoute)};
    const textLength = text.length;
    const signature = [location.pathname, Math.floor(textLength / 64), app.childElementCount, root ? root.tagName : ""].join("|");
    return {
      routeReady: routeMatches && !!root && textLength >= ${minText} && !busy,
      genericReady: routeMatches && !!app.firstElementChild && textLength >= ${minText} && !busy,
      textLength,
      visible: root ? 1 : 0,
      path: location.pathname,
      signature,
    };
  })()`;
}

module.exports = { PAGE_SPECS, routeIdFromPath, routeIdFromUrl, pageSpecFor, readinessProbeSource };