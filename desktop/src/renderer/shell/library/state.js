/* 列表状态：每类列表一份 state 缓存，负责首次加载、回访后台刷新与滚动位置恢复。 */
import { getTagCatalog } from "./catalog.js";
import { META } from "./constants.js";
  export function ensure(ctx, kind) {
    if (ctx.store.has(kind)) return ctx.store.get(kind);
    const meta = META[kind] || { title: kind, empty: "暂无内容" };
    const state = {
      kind,
      items: [],
      total: 0,
      perPage: 0,
      page: 0,
      keyword: "",
      difficulty: "",
      difficultyMin: 0,
      difficultyMax: 0,
      type: "luogu",
      tags: [],
      tagDraft: new Set(),
      tagType: 2,
      tagQuery: "",
      content: false,
      showTags: localStorage.getItem("lg.lib.showTags") !== "0",
      catalog: getTagCatalog(),
      catalogLoading: false,
      filter: "all",
      loading: false,
      loadingVisible: false,
      error: "",
      needLogin: false,
      hasMore: false,
      loadedAt: 0,
      categories: [],
      token: 0,
      scroll: 0,
      activeIndex: 0,
      built: false,
      dom: {},
      lastUser: null,
      meta,
    };
    ctx.store.set(kind, state);
    return state;
  }
  export function show(ctx, kind, appState) {
    const state = ensure(ctx, kind);
    if (ctx.currentKind !== kind) {
      if (ctx.current) ctx.current.scroll = ctx.root.scrollTop;
      ctx.currentKind = kind;
      ctx.current = state;
      ctx.api.buildShell(ctx, state);
    }
    if (!state.built) ctx.api.buildShell(ctx, state);
    state.meta = META[kind] || state.meta;
    if (appState) {
      const logged = !!(appState.user && appState.user.loggedIn);
      if (state.lastUser !== null && state.lastUser !== logged && kind === "record") {
        state.token++;
        state.items = [];
        state.total = 0;
        state.page = 0;
        state.error = "";
        state.needLogin = false;
        ctx.api.load(ctx, state, 1, { force: true });
      }
      state.lastUser = logged;
    }
    if (!state.items.length && !state.loading && !state.error && !state.needLogin) {
      ctx.api.load(ctx, state, 1);
    } else if (
      state.loadedAt &&
      !state.loading &&
      (!appState || appState.online !== false) &&
      Date.now() - state.loadedAt > 180000
    ) {
      // 回访后台刷新：先照旧显示旧数据，超过 3 分钟才拉新（不打断滚动位置）
      ctx.api.load(ctx, state, 1, { quiet: true });
    } else {
      ctx.api.renderRows(ctx, state);
    }
    requestAnimationFrame(() => {
      if (ctx.currentKind === kind) ctx.root.scrollTop = state.scroll || 0;
    });
  }

  export function update(ctx, appState) {
    const page = appState && appState.page;
    if (!page || !page.library) {
      ctx.lastSignature = "";
      return;
    }
    const logged = !!(appState.user && appState.user.loggedIn);
    const signature = [page.library, logged].join("|");
    const kindChanged = ctx.currentKind !== page.library;
    if (signature === ctx.lastSignature && !kindChanged) return;
    ctx.lastSignature = signature;
    show(ctx, page.library, appState);
  }
