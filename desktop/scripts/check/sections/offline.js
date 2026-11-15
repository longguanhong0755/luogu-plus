/* 断网可用契约与 store.js 行为单测（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function offline(ctx) {
  const { ok, fail, read, ROOT, fs, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { ipcSource } = store;
/* ---------- 断网可用契约 ---------- */

const storeSrc = read("src/main/store.js");
if (/renameSync/.test(storeSrc) && /MAX_VALUE_BYTES/.test(storeSrc) && /evict\(/.test(storeSrc)) {
  ok("store.js 原子写 + 体积上限 + 前缀淘汰");
} else {
  fail("store.js 缺少原子写/体积上限/淘汰");
}

const luoguSrc = read("src/main/luogu.js");
for (const [name, needle] of [
  ["在线状态跟踪", /setOnline\(online\)/],
  ["在线轮询", /startOnlineWatch/],
  ["主页快照回填", /hydrate\(\)/],
  ["快照落盘", /persistSnapshot/],
  ["离线列表缓存", /cachedLib/],
  ["离线列表落盘", /saveLib/],
  ["离线提交队列", /enqueueSubmit/],
  ["队列重放", /flushQueue/],
  ["队列状态", /queueState/],
  ["题目快照存取", /problemSnapshotUrl/],
  ["题面 DOM 快照", /saveProblemSnapshot/],
  ["页面 fetch 超时", /AbortSignal\.timeout/],
]) {
  if (needle.test(luoguSrc)) ok("luogu.js " + name);
  else fail("luogu.js 缺少" + name);
}
if (/["']\/lg4\/captcha/.test(luoguSrc)) fail("luogu.js 残留错误的 /lg4/captcha 端点（提交验证码应走 /api/verify/captcha）");
else ok("提交验证码端点唯一且正确");

const viewsSrc = read("src/main/views.js");
for (const [name, needle] of [
  ["离线 URL 识别", /isOfflineUrl/],
  ["快照捕获调度", /scheduleProblemCapture/],
  ["快照抓取", /captureProblem/],
  ["题目加载失败回退快照", /回退离线快照/],
  ["水合前不存裸 markdown", /raw-markdown/],
  ["快照要求正文类已出现", /no-marked/],
  ["lgoff 导航放行", /isOfflineUrl\(url\)\) return/],
  ["离线页不注皮肤", /离线快照页有自己的排版/],
]) {
  if (needle.test(viewsSrc)) ok("views.js " + name);
  else fail("views.js 缺少" + name);
}

const indexSrc = read("src/main/index.js");
if (/registerSchemesAsPrivileged/.test(indexSrc) && /protocol\.handle\("lgoff"/.test(indexSrc)) {
  ok("index.js 注册 lgoff 离线协议");
} else {
  fail("index.js 缺少 lgoff 协议注册");
}
if (/store = new Store/.test(indexSrc) && /flushAll/.test(indexSrc)) ok("index.js 装配 store 并在退出时落盘");
else fail("index.js 缺少 store 装配/退出落盘");
if (/离线快照/.test(indexSrc) && /charset=utf-8/.test(indexSrc)) ok("离线页外壳带主题与编码声明");
else fail("离线页外壳缺少主题或编码声明");

/* R61 命令面板与比赛提醒 */
if (/id: "reopen", label: "恢复关闭的页面"/.test(ipcSource) && /type: "page", key: page\.key/.test(ipcSource)) ok("命令面板含恢复关闭 + 已打开页面切换");
else fail("命令面板缺项");
if (/palette\(query, ctx\)/.test(ipcSource)) ok("palette 接入打开页面列表（ctx 透传）");
else fail("palette 未接入 ctx");
if (/item\.type === "page" && item\.key/.test(read("src/renderer/shell/shell.js")) && /reopen: "reopen"/.test(read("src/renderer/shell/overlays.js"))) ok("外壳可执行切换/恢复两项面板动作");
else fail("外壳缺面板动作分支");
const notifySource = read("src/main/notify.js");
if (/startContestWatch/.test(notifySource) && /contestLeadMin/.test(notifySource) && /lastNotifiedContestId/.test(notifySource)) ok("比赛提醒有真实调度（提前量生效，每场只提醒一次）");
else fail("比赛提醒仍是假开关");

/* R62 性能与稳定 */
if (/refreshIndex/.test(storeSrc) && /mtimeMs/.test(storeSrc)) ok("store 淘汰路径走 mtime 索引（不再每次全量解析）");
else fail("store 仍全量解析目录");
if (!/heatWindowStart/.test(luoguSrc) && /record\/list\?user=.*page=1/.test(luoguSrc)) ok("主页只取最近提交首屏，热度直接消费个人中心 dailyCounts");
else fail("主页仍在为自绘热度图批量拉取历史提交");
if (/will-download/.test(indexSrc)) ok("页面下载自动落「下载」文件夹并 toast");
else fail("缺少下载处理");

/* R58 反馈可见性 */
if (/pageWc/.test(indexSrc) && /app:toast/.test(indexSrc)) ok("toast 同步发给当前页面视图（不被页面盖住）");
else fail("页面在场时 toast 仍会被盖住");
if (/lg-page-toast/.test(read("src/preload/page.js"))) ok("页面 preload 有顶层 toast 渲染器");
else fail("page.js 缺少页面内 toast");

const ipcSrc = read("src/main/ipc.js");
for (const [name, needle] of [
  ["状态含在线状态", /online: ctx\.luogu\.online/],
  ["状态含队列", /queue: ctx\.luogu\.queueState/],
  ["断网入队", /enqueueSubmit\(pid, code, lang, "当前离线", o2\)/],
  ["网络失败入队", /enqueueSubmit\(pid, code, lang, "网络未就绪", o2\)/],
]) {
  if (needle.test(ipcSrc)) ok("ipc.js " + name);
  else fail("ipc.js 缺少" + name);
}

const checkinBlock = ipcSrc.split("app:checkin")[1] || "";
if (/签到没有成功/.test(checkinBlock)) ok("签到失败会 toast 具体原因");
else fail("签到失败仍被吞掉");
if (/hasCard/.test(luoguSrc) && /result\.hasCard && result\.hasButton/.test(luoguSrc) && /避免把“今日已完成”误报成失败/.test(luoguSrc)) {
  ok("签到状态先判重，已签到时不会误报找不到入口");
} else {
  fail("签到缺少已签/入口缺失的幂等判定");
}
if (/签到失败/.test(read("src/renderer/shell/home.js")) && /签到失败/.test(read("src/renderer/shell/home.js"))) ok("签到失败在顶部按钮上留字");
else fail("主页签到按钮无失败反馈");

const editorSrc = read("src/renderer/shell/editor.js");
if (/loadDraft/.test(editorSrc) && /saveDraft/.test(editorSrc) && /已恢复本题草稿/.test(editorSrc)) {
  ok("编辑器草稿恢复与防抖保存（按题提示）");
} else {
  fail("编辑器缺少草稿持久化");
}
if (/setProblem/.test(editorSrc) && /currentPid/.test(editorSrc) && /draft:" \+ pid/.test(ipcSrc)) ok("草稿按题目隔离（draft:<pid>），切题即换草稿");
else fail("草稿仍是全局单份，存在跨题泄漏");
if (/editorPrefs/.test(ipcSrc)) ok("语言/O2 记为全局偏好（本题无草稿时沿用）");
else fail("语言偏好未持久化");

const homeSrc = read("src/renderer/shell/home.js");
if (/offline-note/.test(homeSrc) && /queue-card/.test(homeSrc) && /buildQueue/.test(homeSrc)) {
  ok("主页离线徽标与队列卡片");
} else {
  fail("主页缺少离线徽标或队列卡片");
}
if (/lib-stale/.test(read("src/renderer/shell/library.js"))) ok("列表离线/缓存标注");
else fail("列表缺少离线数据标注");

/* store.js 行为单测（不依赖 electron） */
try {
  const os = require("node:os");
  const { Store } = require(path.join(ROOT, "src", "main", "store.js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-test-"));
  const store = new Store(dir).init();
  store.set("home", { quote: "x", updatedAt: 1 }, 0);
  store.flush("home");
  const back = new Store(dir).init().get("home");
  if (back && back.quote === "x") ok("store 落盘后新实例可读回");
  else fail("store 落盘读回失败", JSON.stringify(back));
  store.set("problem:P1", { key: "problem:P1", savedAt: 2, html: "<p>ok</p>" }, 0);
  store.set("problem:P2", { key: "problem:P2", savedAt: 3, html: "<p>ok</p>" }, 0);
  store.flushAll();
  const entries = store.entries("problem:");
  if (entries.length === 2 && entries.some((item) => item.key === "problem:P1")) ok("store 前缀枚举含磁盘条目");
  else fail("store 前缀枚举失败", JSON.stringify(entries.map((item) => item.key)));
  store.evict("problem:", 1);
  if (store.entries("problem:").length === 1) ok("store 按时间淘汰旧快照");
  else fail("store 淘汰失败");
  const bigDir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-test-"));
  const big = new Store(bigDir).init();
  big.set("huge", { blob: "x".repeat(2 * 1024 * 1024) }, 0);
  big.flush("huge");
  big.flushAll();
  if (!fs.existsSync(path.join(bigDir, big.fileOf("huge")))) ok("store 拒收超过体积上限的快照");
  else fail("store 未拒收超大快照");
  /* R62：mtime 索引 —— mem 为空的新实例也能靠索引枚举磁盘条目（淘汰路径不再全量解析） */
  const idxDir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-store-idx-"));
  const idxStore = new Store(idxDir).init();
  idxStore.set("problem:A", { key: "problem:A", savedAt: 10, html: "<p>x</p>" }, 0);
  idxStore.flushAll();
  const freshStore = new Store(idxDir).init();
  const found = freshStore.entries("problem:");
  if (found.length === 1 && found[0].key === "problem:A" && found[0].at === 10) ok("store mtime 索引：新实例免解析枚举磁盘条目");
  else fail("store 索引枚举失败", JSON.stringify(found.map((item) => item.key)));
  for (let i = 0; i < 140; i++) idxStore.set("tiny:" + i, { key: "tiny:" + i, at: i, value: "x" }, 600000);
  const stats = idxStore.stats();
  if (stats.memoryEntries <= stats.limits.memoryEntries && stats.memoryBytes <= stats.limits.memoryBytes) ok("store 内存缓存遵守条目与字节 LRU 上限");
  else fail("store 内存缓存未遵守预算", JSON.stringify(stats));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bigDir, { recursive: true, force: true });
  fs.rmSync(idxDir, { recursive: true, force: true });
} catch (err) {
  fail("store 单测异常", String((err && err.stack) || err).slice(0, 200));
}

  /* 后续段落复用的中间变量 */
  Object.assign(store, { indexSrc });
};
