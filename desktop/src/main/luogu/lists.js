/* 洛谷数据服务 · 题库/记录/题单/比赛/讨论/文章列表拉取（拆分自 src/main/luogu.js）。 */
const { PROBLEM_TYPES, DIFFICULTY, STATUS_TEXT } = require("./consts");
const { normalizeTagGroups, tagQuery, toMillis, plainExcerpt, findObject, trimMap } = require("./util");

const listMethods = {
  async fetchLibrary(kind, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const keyword = String(options.keyword || "").trim();
    const difficulty = String(options.difficulty || "").trim();
    const type = kind === "problems" && PROBLEM_TYPES.has(String(options.type || ""))
      ? String(options.type)
      : "";
    const tagGroups = kind === "problems" ? normalizeTagGroups(options.tags) : [];
    const searchContent = kind === "problems" && !!options.content;
    const force = !!options.force;
    // 无筛选时保持原 key（problems|1||），旧缓存与冒烟打桩仍可直接命中
    const cacheKey = [kind, page, keyword, difficulty]
      .concat(
        type && type !== "luogu" ? ["t:" + type] : [],
        tagGroups.length ? ["g:" + tagQuery(tagGroups)] : [],
        searchContent ? ["c:1"] : []
      )
      .join("|");
    const cached = this.libCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < 45000) return cached.payload;

    const base = { kind, page, perPage: 0, total: 0, items: [], needLogin: false, categories: [], error: "" };
    let login = null;
    if (kind === "record") {
      login = await this.loginState();
      if (!login.loggedIn) {
        return Object.assign(base, { needLogin: true });
      }
    }
    // 离线时不再碰网络：有缓存出缓存（带 stale 标记），没缓存给离线提示
    if (!this.online) {
      const hit = this.cachedLib(cacheKey);
      if (hit) return Object.assign({}, hit.payload, { stale: true, offline: true });
      return Object.assign(base, { error: "当前离线，这份列表还没有缓存过。" });
    }
    if (kind === "record") {
      const context = await this.fetchContext(
        `/record/list?user=${encodeURIComponent(login.uid || "")}&page=${page}`
      );
      if (!context) {
        // 网络失败（含刚断网还没被轮询发现）：回退缓存而不是清空列表
        const hit = this.cachedLib(cacheKey);
        if (hit) return Object.assign({}, hit.payload, { stale: true, offline: !this.online });
        return Object.assign(base, { error: "记录加载失败" });
      }
      const records = this.parseRecords(context);
      // 记录列表的分页元数据：登录态下 data.records 是 { result, count, perPage }；
      // 拿不到 count 时用「整页（20 条）→ 可能还有下一页」的保守启发，别让翻页按钮消失
      const node = findObject(
        context,
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Array.isArray(item.result) &&
          typeof item.count === "number" &&
          typeof item.perPage === "number"
      );
      const countKnown = !!(node && Number(node.count) > 0);
      const perPage = node ? Number(node.perPage) || 0 : 0;
      const full = records.length >= (perPage || 20);
      const items = records.map((record) => {
        const problem = record.problem || {};
        const status = Number(record.status);
        return {
          type: "record",
          id: record.id || record.rid || "",
          pid: String(problem.pid || record.pid || ""),
          title: String(problem.title || record.title || ""),
          status: Number.isFinite(status) ? status : null,
          statusText: Number.isFinite(status) ? STATUS_TEXT[status] || String(status) : "",
          score: Number(record.score) || 0,
          time: toMillis(record.submitTime || record.time),
          memory: Number(record.memory) || 0,
          language: String(record.languageName || record.language || ""),
        };
      });
      const payload = Object.assign(base, {
        items,
        perPage: perPage || (full ? 20 : 0),
        // count 未知时不虚报总数；library 靠 hasMore 决定要不要出「加载更多」
        total: countKnown ? Number(node.count) : items.length,
        hasMore: !countKnown && full,
      });
      this.libCache.set(cacheKey, { at: Date.now(), payload });
      trimMap(this.libCache, 30);
      this.saveLib(cacheKey, payload);
      return payload;
    }

    const params = new URLSearchParams();
    params.set("page", String(page));
    if (keyword) params.set("keyword", keyword);
    if (kind === "problems") {
      if (type && type !== "luogu") params.set("type", type);
      if (difficulty) params.set("difficulty", difficulty);
      if (tagGroups.length) params.set("tag", tagQuery(tagGroups));
      if (searchContent) params.set("content", "1");
    } else if (difficulty) {
      params.set("difficulty", difficulty);
    }
    const paths = {
      problems: "/problem/list?" + params.toString(),
      training: "/training/list?" + params.toString(),
      contest: "/contest/list?" + params.toString(),
      discuss: "/discuss?" + params.toString(),
      article: "/article?" + params.toString(),
    };
    const pathname = paths[kind];
    if (!pathname) return Object.assign(base, { error: "未知列表" });
    const context = await this.fetchContext(pathname);
    if (!context) {
      const hit = this.cachedLib(cacheKey);
      if (hit) return Object.assign({}, hit.payload, { stale: true, offline: !this.online });
      return Object.assign(base, { error: "数据加载失败，请检查网络" });
    }
    const data = context.data || {};
    const node =
      kind === "problems"
        ? data.problems
        : kind === "training"
          ? data.trainings
          : kind === "contest"
            ? data.contests
            : kind === "discuss"
              ? data.posts
              : data.articles;
    const list = node && Array.isArray(node.result) ? node.result : [];
    const categories = Array.isArray(data.categories) ? data.categories : [];
    let items = [];
    if (kind === "problems") {
      items = list.map((item) => {
        const diff = DIFFICULTY[Number(item.difficulty)] || DIFFICULTY[0];
        return {
          type: "problem",
          pid: String(item.pid || ""),
          title: String(item.name || ""),
          difficulty: Number(item.difficulty) || 0,
          difficultyName: diff.name,
          difficultyColor: diff.color,
          submissions: Number(item.totalSubmit) || 0,
          accepted: Number(item.totalAccepted) || 0,
          provider: item.provider ? String(item.provider.name || "") : "",
          tags: Array.isArray(item.tags) ? item.tags.map((tag) => Number(tag) || 0).filter(Boolean) : [],
        };
      });
    } else if (kind === "training") {
      items = list.map((item) => ({
        type: "training",
        id: String(item.id || ""),
        title: String(item.name || ""),
        provider: item.provider ? String(item.provider.name || "") : "",
        createTime: toMillis(item.createTime),
        deadline: toMillis(item.deadline),
        problemCount: Number(item.problemCount) || 0,
        markCount: Number(item.markCount) || 0,
      }));
    } else if (kind === "contest") {
      items = list.map((item) => ({
        type: "contest",
        id: String(item.id || ""),
        title: String(item.name || ""),
        start: toMillis(item.startTime),
        end: toMillis(item.endTime),
        host: item.host ? String(item.host.name || "") : "",
        rated: Number(item.rated) || 0,
        problemCount: Number(item.problemCount) || 0,
      }));
    } else if (kind === "discuss") {
      items = list.map((item) => ({
        type: "discuss",
        id: String(item.id || ""),
        title: String(item.title || ""),
        author: item.author ? String(item.author.name || "") : "",
        avatar: item.author ? String(item.author.avatar || "") : "",
        time: toMillis(item.time),
        forum: item.forum ? String(item.forum.name || "") : "",
        replyCount: Number(item.replyCount) || 0,
        topped: !!item.topped,
        locked: !!item.locked,
      }));
    } else if (kind === "article") {
      items = list.map((item) => ({
        type: "article",
        id: String(item.lid || item.id || ""),
        title: String(item.title || ""),
        author: item.author ? String(item.author.name || "") : "",
        avatar: item.author ? String(item.author.avatar || "") : "",
        time: toMillis(item.time),
        upvote: Number(item.upvote) || 0,
        replyCount: Number(item.replyCount) || 0,
        favorCount: Number(item.favorCount) || 0,
        category: Number(item.category) || 0,
        excerpt: plainExcerpt(item.content),
      }));
    }
    const payload = Object.assign(base, {
      items,
      perPage: Number(node && node.perPage) || items.length,
      total: Number(node && node.count) || items.length,
      categories: categories.map((item) => ({ key: String(item.key || ""), name: String(item.name || "") })),
    });
    this.libCache.set(cacheKey, { at: Date.now(), payload });
    this.saveLib(cacheKey, payload);
    return payload;
  }
};

module.exports = { listMethods };
