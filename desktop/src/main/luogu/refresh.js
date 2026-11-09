/* 洛谷数据服务 · 主页主刷新（拆分自 src/main/luogu.js）。 */
const { quoteFor } = require("./util");

const refreshMethods = {
  /* ---------- 主刷新 ---------- */

  async refresh(force = false) {
    if (this.refreshing) {
      await new Promise((resolve) => this.refreshWaiters.push(resolve));
      return this.state();
    }
    if (!force && Date.now() - this.lastRefresh < 20000) return this.state();
    // 离线时保留现有/缓存数据不动，不要用一轮失败的抓取把好数据清掉
    if (!this.online) {
      if (this.ctx.emitState) this.ctx.emitState();
      return this.state();
    }
    this.refreshing = true;
    const prev = this.home;
    let networkFailed = false;
    let stage = "login";
    const slowTimer = setTimeout(() => {
      console.warn("[luogu] refresh slow at " + stage);
    }, 15000);
    try {
      const login = await this.loginState();
      this.user = { loggedIn: login.loggedIn, uid: login.uid, name: "", avatar: "" };
      const next = {
        quote: quoteFor(new Date()),
        heat: [],
        acProgress: [],
        acRecentTotal: 0,
        contest: null,
        contests: [],
        official: null,
        recent: [],
        punched: null,
        streak: 0,
        updatedAt: Date.now(),
        error: "",
      };

      // 比赛列表是公开数据：未登录也抓，主页不至于空着
      stage = "contests";
      try {
        const contestContext = await this.fetchContext("/contest/list");
        const all = this.parseContests(contestContext);
        next.contest = this.pickContest(all);
        next.contests = this.buildContests(all);
      } catch (err) {
        console.error("[luogu] contest fetch threw", err && err.message);
      }

      // 0.7.2 官方主页融合块：比赛倒计时/欢迎/运势（旧版首页 DOM，游客可见倒计时）
      stage = "official-home";
      try {
        next.official = await this.fetchOfficialHome();
      } catch (err) {
        console.error("[luogu] official home scrape failed:", err && err.message);
      }

      if (login.loggedIn) {
        stage = "profile";
        let profileContext = null;
        if (login.uid) profileContext = await this.fetchContext("/user/" + login.uid);
        const profile = this.parseUser(profileContext, login.uid);
        if (profile) {
          this.user.name = String(profile.name || "");
          this.user.avatar = String(profile.avatar || "");
          this.user.submittedProblemCount =
            profile.submittedProblemCount == null ? null : Math.max(0, Number(profile.submittedProblemCount) || 0);
          this.user.passedProblemCount =
            profile.passedProblemCount == null ? null : Math.max(0, Number(profile.passedProblemCount) || 0);
          this.user.ranking = profile.ranking == null ? null : Math.max(0, Number(profile.ranking) || 0);
        }

        let records = [];
        // 最近提交只需要第一页；热力图直接消费个人中心 dailyCounts。
        // 不再为自绘半年图翻 12 页记录，既保持官网口径又显著降低内存/请求量。
        stage = "records";
        const recordContext = await this.fetchContext(
          `/record/list?user=${encodeURIComponent(login.uid)}&page=1`
        );
        // cookie 还在但服务端会话已过期时，记录页会返回 needLogin 错误页
        if (recordContext && recordContext.data && recordContext.data.errorCode) {
          this.user.loggedIn = false;
          next.error = "登录已过期，请重新登录";
        } else if (!recordContext) {
          networkFailed = true;
        } else {
          records = this.parseRecords(recordContext);
        }
        const dailyCounts = this.parseDailyCounts(profileContext);
        stage = "assemble";
        next.heat = this.buildHeat(records, dailyCounts);
        const progress = this.buildProgress(records);
        next.acProgress = progress.points;
        next.acRecentTotal = progress.total;
        next.recent = this.buildRecent(records);

        const punch = await this.readPunchState();
        next.punched = punch.punched;
        next.streak = punch.streak;
        if (!this.user.name) this.user.name = "洛谷用户";
      }

      // 抓取中途断网：保留上一次的打卡/热力/最近提交，只更新拿到的部分
      if (networkFailed) {
        if (!next.contest && prev.contest) next.contest = prev.contest;
        if (!next.contests.length && prev.contests && prev.contests.length) next.contests = prev.contests;
        if (!next.official && prev.official) next.official = prev.official;
        if (!next.heat.length && prev.heat && prev.heat.length) next.heat = prev.heat;
        if (!next.acProgress.length && prev.acProgress && prev.acProgress.length) {
          next.acProgress = prev.acProgress;
          next.acRecentTotal = prev.acRecentTotal || 0;
        }
        if (!next.recent.length && prev.recent && prev.recent.length) next.recent = prev.recent;
        if (next.punched === null && prev.punched !== null) {
          next.punched = prev.punched;
          next.streak = prev.streak;
        }
        next.updatedAt = prev.updatedAt || next.updatedAt;
      }

      this.home = next;
      this.lastRefresh = Date.now();
      stage = "persist";
      this.persistSnapshot();
    } catch (err) {
      const message = String((err && err.message) || "主页同步失败").slice(0, 240);
      const hasUsableSnapshot = !!(
        prev &&
        (prev.updatedAt ||
          (prev.heat || []).some((item) => Number(item.count) > 0) ||
          (prev.acProgress || []).length ||
          (prev.recent || []).length ||
          (prev.contests || []).length ||
          prev.official)
      );
      // 一次临时脚本/网络失败不能把已有主页推成「数据同步失败」大卡片；
      // 保留上一份可用快照，下一轮静默重试即可。
      this.home = hasUsableSnapshot
        ? Object.assign({}, prev, { error: "" })
        : Object.assign({}, prev || this.home, { error: message });
      console.error("[luogu] refresh(" + stage + "):", message);
    } finally {
      clearTimeout(slowTimer);
      this.refreshing = false;
      const waiters = this.refreshWaiters.splice(0);
      for (const resolve of waiters) resolve();
      if (this.ctx.emitState) this.ctx.emitState();
    }
    return this.state();
  }
};

module.exports = { refreshMethods };
