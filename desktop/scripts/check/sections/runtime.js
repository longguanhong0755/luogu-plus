/* 页面注册表与加载代次、快照脚本可编译性、版本号（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function runtime(ctx) {
  const { ok, fail, read, ROOT, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { viewsSource } = store;
/* 页面注册表与加载代次：把白屏修复从“逐页补丁”收敛为可验证的统一状态机。 */
let pageRegistry = null;
let pageReadiness = null;
try {
  pageRegistry = require(path.join(ROOT, "src", "main", "page-registry.js"));
  pageReadiness = require(path.join(ROOT, "src", "main", "page-readiness.js"));
} catch (err) {
  fail("页面注册表或加载状态机无法加载", err.message);
}
if (pageRegistry) {
  const routes = {
    "https://www.luogu.com.cn/": "home",
    "https://www.luogu.com.cn/problem/list?page=2": "problems",
    "https://www.luogu.com.cn/problem/P1001": "problem",
    "https://www.luogu.com.cn/training/117": "training",
    "https://www.luogu.com.cn/contest/123": "contest",
    "https://www.luogu.com.cn/record/list": "record",
    "https://www.luogu.com.cn/discuss/123": "discuss",
    "https://www.luogu.com.cn/article/abc": "article",
    "https://www.luogu.com.cn/chat": "chat",
    "https://www.luogu.com.cn/user/notification": "notification",
    "https://www.luogu.com.cn/user/123456": "profile",
    "https://www.luogu.com.cn/auth/login": "login",
    "https://www.luogu.com.cn/some/custom/page": "custom",
  };
  const badRoutes = Object.entries(routes).filter(([url, id]) => pageRegistry.routeIdFromUrl(url) !== id);
  if (!badRoutes.length && pageRegistry.pageSpecFor({ url: "https://www.luogu.com.cn/training/117" }).id === "training") {
    ok("页面注册表覆盖首页、列表、题面、聊天、通知、个人页与自定义路由");
  } else {
    fail("页面注册表路由分类不完整", JSON.stringify(badRoutes));
  }
  const probeSource = pageRegistry.readinessProbeSource(pageRegistry.PAGE_SPECS.problem);
  if (/node\.id !== "lg-boot-skeleton"/.test(probeSource) && /routeMatches/.test(probeSource) && /signature/.test(probeSource) && /busy/.test(probeSource)) {
    ok("就绪探针排除自身骨架，并要求路由和内容连续稳定");
  } else {
    fail("就绪探针仍可能把加载骨架或旧路由误判为完成");
  }
}
const loadWaitSource = read("src/main/luogu.js");
const smokeRunnerSource = read("scripts/smoke.js");
const smokeMainSource = read("src/main/smoke.js");
if (
  /function waitForLoadStop\(webContents/.test(loadWaitSource) &&
  /removeListener\("did-stop-loading", done\)/.test(loadWaitSource) &&
  /removeListener\("did-fail-load", done\)/.test(loadWaitSource) &&
  /SMOKE_PAGE_LOAD_SUMMARY/.test(smokeMainSource) &&
  /runPageLoadingSmoke\(ctx, wait\)/.test(smokeMainSource) &&
  /pageLoadFailure/.test(smokeRunnerSource) &&
  /!pageLoadFailure/.test(smokeRunnerSource) &&
  /listenerWarnings/.test(smokeRunnerSource) &&
  /appDidStopLimit/.test(smokeMainSource) &&
  /internalDidStopLimit/.test(smokeMainSource) &&
  /setMaxListeners\(24\)/.test(viewsSource)
) {
  ok("页面加载探针纳入默认冒烟硬门禁，监听器数量受限且告警会让冒烟失败");
} else {
  fail("页面加载冒烟未形成硬门禁或 did-stop-loading 监听仍会累积");
}if (pageReadiness) {
  const sent = [];
  const changes = [];
  const fakeWc = {
    isDestroyed: () => false,
    getURL: () => "https://www.luogu.com.cn/chat",
    send: (channel, payload) => sent.push({ channel, payload }),
    executeJavaScript: async () => ({ routeReady: true, genericReady: true, textLength: 100, signature: "chat|1|1|DIV" }),
  };
  const controller = new pageReadiness.PageReadinessController(
    fakeWc,
    () => ({ kind: "chat" }),
    (state) => changes.push(state)
  );
  controller.begin("https://www.luogu.com.cn/chat", "test");
  const firstId = controller.state.requestId;
  controller.markDomReady("https://www.luogu.com.cn/chat");
  const hydrated = controller.state.phase === "hydrating";
  controller.begin("https://www.luogu.com.cn/problem/P1001", "test-navigation");
  const secondId = controller.state.requestId;
  controller.fail("test failure", "test");
  controller.markDomReady("https://www.luogu.com.cn/problem/P1001");
  const lateDomIgnored = controller.state.phase === "error";
  controller.didNavigate("https://www.luogu.com.cn/training/117");
  const recovered = controller.state.phase === "hydrating" && controller.state.requestId > secondId;
  controller.markReady({ textLength: 32 });
  const ready = controller.state.phase === "ready";
  controller.dispose();
  if (
    firstId !== secondId &&
    hydrated &&
    lateDomIgnored &&
    recovered &&
    ready &&
    sent.length >= 5 &&
    sent.every((item) => item.channel === "page:load-state") &&
    /loading: entry\.readiness/.test(viewsSource) &&
    /did-start-navigation/.test(viewsSource) &&
    /did-fail-load/.test(viewsSource) &&
    /render-process-gone/.test(viewsSource)
  ) {
    ok("加载状态机为每次导航使用独立代次，迟到事件不能覆盖新页面状态");
  } else {
    fail("加载状态机代次/错误恢复契约不完整");
  }
}
if (
  /entry\.readiness\.begin\(target, sameDocument \? "in-page" : "document"\)/.test(viewsSource) &&
  /entry\.readiness\.markDomReady\(current\)/.test(viewsSource) &&
  /entry\.readiness\.replay\(\)/.test(viewsSource) &&
  /loading: entry\.readiness \? entry\.readiness\.state : null/.test(viewsSource)
) {
  ok("页面状态向渲染层暴露 loading，并在显示/恢复时重放当前加载状态");
} else {
  fail("页面加载状态未完整贯通主进程与外壳");
}
/* R94：注入页面的快照脚本必须能在页面里真正编译执行。
   模板字面量里少写一层反斜杠（\\/ 写成 \/、\\s 写成 \s）会让整段脚本变成
   “ReferenceError: i is not defined” 或静默失效，此前题面快照因此一直抓不到。 */
const captureTemplate = (() => {
  const src = read("src/main/views.js");
  const at = src.indexOf("async captureProblem(entry, round)");
  if (at < 0) return "";
  const head = "wc.executeJavaScript(`";
  const s = src.indexOf(head, at);
  if (s < 0) return "";
  const e = src.indexOf("`);", s);
  if (e < 0) return "";
  return src.slice(s + head.length, e);
})();
let captureRuntime = "";
try {
  captureRuntime = new Function("return `" + captureTemplate + "`")();
} catch {
  captureRuntime = "";
}
let captureCompiles = false;
try {
  new Function(captureRuntime);
  captureCompiles = true;
} catch {
  captureCompiles = false;
}
if (
  captureCompiles &&
  captureRuntime.includes("\\s*(javascript|data|vbscript):") &&
  captureRuntime.includes("^data:(image|font)\\/")
) {
  ok("R94 题面快照脚本可在页面内编译，URL 消毒正则未被模板转义吃掉");
} else {
  fail("R94 题面快照脚本无法编译或 URL 消毒正则被模板转义破坏");
}
let pkgVersion = "";
try {
  pkgVersion = JSON.parse(read("package.json")).version || "";
} catch {
  /* 已在上面报错 */
}
const EXPECTED_VERSION = "0.7.16";
if (pkgVersion === EXPECTED_VERSION) ok("版本号 " + EXPECTED_VERSION);
else fail("package.json 版本号不是 " + EXPECTED_VERSION + "（当前 " + pkgVersion + "）");
};
