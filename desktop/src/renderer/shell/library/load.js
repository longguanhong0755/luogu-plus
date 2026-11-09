/* 列表数据请求：分页/筛选参数打包、骨架屏延时、过期响应丢弃与回访静默刷新。 */
import { selectedTagGroups } from "./catalog.js";
import { encodeDifficulty } from "./utils.js";
  export async function load(ctx, state, page, options = {}) {
    const token = ++state.token;
    state.loading = true;
    state.loadingVisible = false;
    state.error = "";
    ctx.api.renderRows(ctx, state);
    const skeletonTimer = setTimeout(() => {
      if (token !== state.token || !state.loading || state.items.length) return;
      state.loadingVisible = true;
      ctx.api.renderRows(ctx, state);
    }, 150);
    const payload = {
      kind: state.kind,
      page,
      keyword: state.keyword,
      difficulty:
        state.kind === "problems" ? encodeDifficulty(state.difficultyMin, state.difficultyMax) : state.difficulty,
      type: state.kind === "problems" ? state.type : "",
      tags: state.kind === "problems" ? selectedTagGroups(state.tags) : [],
      content: state.kind === "problems" ? state.content : false,
      force: !!options.force,
    };
    let res;
    try {
      res = await ctx.actions.library(payload);
    } catch (err) {
      res = { error: err.message || "加载失败" };
    }
    clearTimeout(skeletonTimer);
    if (token !== state.token) return;
    state.loading = false;
    state.loadingVisible = false;
    if (!res) res = { error: "加载失败" };
    state.stale = !!res.stale;
    state.offlineNote = !!res.offline;
    state.hasMore = !!res.hasMore;
    if (res.needLogin) {
      state.needLogin = true;
      state.items = [];
      state.total = 0;
      state.page = 0;
    } else if (res.error) {
      state.error = res.error;
    } else {
      state.needLogin = false;
      state.error = "";
      state.page = page;
      state.perPage = res.perPage || 0;
      state.total = res.total || 0;
      state.categories = res.categories || [];
      state.items = res.items || [];
      state.loadedAt = Date.now();
    }
    ctx.api.renderRows(ctx, state);
    if (!options.append && ctx.currentKind === state.kind && !options.quiet) ctx.root.scrollTop = 0;
  }
