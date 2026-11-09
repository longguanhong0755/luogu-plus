/* 洛谷数据服务。
   登录态用 cookie（__client_id / _uid）判断；页面数据在隐藏窗口的页面上下文里
   fetch 真实页面，解析 #lentille-context 的 JSON（洛谷新前端把服务端直出数据放在
   这个 script 里），不依赖易变的私有 API。
   签到用页面内点击（洛谷的打卡本身是前端行为），提交先尝试接口、失败则回退。 */
const { quoteFor } = require("./util");
const { STATUS_TEXT, QUOTES } = require("./consts");
const { windowMethods } = require("./window");
const { httpMethods } = require("./http");
const { accountMethods } = require("./account");
const { offlineMethods } = require("./offline");
const { parseMethods } = require("./parse");
const { libraryMethods } = require("./library");
const { randomMethods } = require("./random");
const { listMethods } = require("./lists");
const { homeMethods } = require("./home");
const { refreshMethods } = require("./refresh");
const { snapshotMethods } = require("./snapshot");
const { officialMethods } = require("./official");
const { punchMethods } = require("./punch");
const { submitMethods } = require("./submit");

class LuoguService {
  constructor(ctx) {
    this.ctx = ctx;
    this.win = null;
    this.loadPromise = null;
    this.winIdleTimer = null;
    this.user = {
      loggedIn: false,
      uid: null,
      name: "",
      avatar: "",
      submittedProblemCount: null,
      passedProblemCount: null,
      ranking: null,
    };
    this.home = {
      quote: quoteFor(new Date()),
      heat: [],
      acProgress: [],
      acRecentTotal: 0,
      contest: null,
      recent: [],
      punched: null,
      streak: 0,
      updatedAt: 0,
      error: "",
    };
    this.refreshing = false;
    this.refreshWaiters = [];
    this.lastRefresh = 0;
    this.libCache = new Map();
    this.tagsCache = null;
    this.tagsPromise = null;
    this.randomCounts = new Map();
    this.userSearchCache = new Map();
    /* 断网可用：在线状态由主窗口 navigator.onLine 轮询 + 页面 fetch 失败反馈共同维护。 */
    this.online = true;
    this.onlineTimer = null;
    this.flushing = false;
    this.queueTimer = null;
    this.contextStats = { direct: 0, browser: 0, last: '' };
  }

  init() {
    this.hydrate();
    this.refresh(true).catch((err) => console.error("[luogu] init refresh:", err.message));
    this.startOnlineWatch();
    // 上次退出时留在队列里的提交，趁启动联网时补交
    if (this.online) this.flushQueue().catch(() => {});
  }

  /* 启动即回填：上次成功刷新的主页/身份快照先上屏，再等网络刷新。
     断网启动时界面不是空的，而是「离线数据」。 */
  hydrate() {
    const store = this.ctx.store;
    if (!store) return;
    const home = store.get("home");
    if (home && typeof home === "object" && home.updatedAt) {
      this.home = Object.assign({}, this.home, home, { error: "" });
    }
    const user = store.get("user");
    if (user && typeof user === "object" && user.uid) {
      this.user = Object.assign({}, this.user, user);
    }
    const queue = store.get("queue");
    if (Array.isArray(queue) && queue.length) {
      console.log("[luogu] 启动时发现离线队列 " + queue.length + " 条");
      this.scheduleQueueRetry(4000);
    }
  }

  state() {
    return { user: this.user, home: this.home };
  }
}

/* 实现按域拆在 ./ 目录：这里只把各域方法挂回原型，公开 API 与拆分前一致。 */
Object.assign(
  LuoguService.prototype,
  windowMethods,
  httpMethods,
  accountMethods,
  offlineMethods,
  parseMethods,
  libraryMethods,
  randomMethods,
  listMethods,
  homeMethods,
  refreshMethods,
  snapshotMethods,
  officialMethods,
  punchMethods,
  submitMethods
);

module.exports = { LuoguService, STATUS_TEXT, QUOTES };
