/* 原生列表：题库 / 训练 / 比赛 / 记录 / 讨论 / 文章。
   数据由主进程从洛谷页面上下文中解析，渲染层只负责筛选、排版与跳转。
   这是「客户端而不是套壳」的核心：列表滚动、搜索、筛选都不加载整页。 */
import { icon } from "./icons.js";

const META = {
  problems: {
    title: "题库",
    search: true,
    empty: "没有找到题目",
    filters: [
      ["", "全部"],
      ["1", "入门"],
      ["2", "普及−"],
      ["3", "普及/提高−"],
      ["4", "普及+/提高"],
      ["5", "提高+/省选−"],
      ["6", "省选/NOI−"],
      ["7", "NOI/NOI+"],
      ["8", "NOI+/CTSC"],
    ],
  },
  training: { title: "训练", empty: "暂无题单" },
  contest: {
    title: "比赛",
    empty: "暂无比赛",
    filters: [
      ["all", "全部"],
      ["live", "进行中"],
      ["upcoming", "即将开始"],
      ["ended", "已结束"],
    ],
  },
  record: {
    title: "记录",
    empty: "还没有提交记录",
    filters: [
      ["all", "全部"],
      ["ac", "AC"],
      ["nonac", "非 AC"],
    ],
  },
  discuss: { title: "讨论", empty: "暂无讨论" },
  article: { title: "文章", empty: "暂无文章" },
};

const WEEK = "日一二三四五六";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtNum(value) {
  const n = Number(value) || 0;
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + " 万";
  return String(n);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - ms;
  if (diff >= 0 && diff < 60000) return "刚刚";
  if (diff >= 0 && diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff >= 0 && diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  if (diff >= 0 && diff < 172800000) return "昨天";
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function contestState(item) {
  const now = Date.now();
  if (item.start && now < item.start) return "upcoming";
  if (item.end && now > item.end) return "ended";
  if (item.start && item.end && now >= item.start && now <= item.end) return "live";
  return "ended";
}

function statusTone(status) {
  if (status === 12) return "ok";
  if (status === 0 || status === 1) return "mid";
  return "bad";
}

export function initLibrary(actions) {
  const root = document.getElementById("library");
  const store = new Map();
  let currentKind = "";
  let current = null;
  let lastSignature = "";
  let searchTimer = null;

  function ensure(kind) {
    if (store.has(kind)) return store.get(kind);
    const meta = META[kind] || { title: kind, empty: "暂无内容" };
    const state = {
      kind,
      items: [],
      total: 0,
      perPage: 0,
      page: 0,
      keyword: "",
      difficulty: "",
      filter: "all",
      loading: false,
      error: "",
      needLogin: false,
      categories: [],
      token: 0,
      scroll: 0,
      built: false,
      dom: {},
      lastUser: null,
    };
    store.set(kind, state);
    if (meta) state.meta = meta;
    return state;
  }

  function buildShell(state) {
    root.textContent = "";
    const wrap = el("div", "lib-wrap");
    const head = el("div", "lib-top");
    const titleRow = el("div", "lib-title-row");
    const title = el("h1", "lib-title", state.meta.title);
    const count = el("span", "lib-count", "");
    const spacer = el("span", "lib-spacer");
    titleRow.appendChild(title);
    titleRow.appendChild(count);
    titleRow.appendChild(spacer);

    let search = null;
    if (state.meta.search) {
      search = el("label", "lib-search");
      search.innerHTML = icon("search");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "搜索题目";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = state.keyword;
      input.addEventListener("input", () => {
        if (searchTimer) clearTimeout(searchTimer);
        const value = input.value.trim();
        searchTimer = setTimeout(() => {
          state.keyword = value;
          load(state, 1, { force: true });
        }, 320);
      });
      search.appendChild(input);
      titleRow.appendChild(search);
    }

    const refresh = el("button", "lib-icon");
    refresh.type = "button";
    refresh.title = "刷新";
    refresh.setAttribute("aria-label", "刷新");
    refresh.innerHTML = icon("refresh");
    refresh.addEventListener("click", () => load(state, 1, { force: true }));
    titleRow.appendChild(refresh);

    const web = el("button", "lib-web", "网页版");
    web.type = "button";
    web.title = "在完整网页中打开";
    web.addEventListener("click", () => actions.webFallback(state.kind));
    titleRow.appendChild(web);

    const filters = el("div", "lib-filters");
    head.appendChild(titleRow);
    head.appendChild(filters);

    const list = el("div", "lib-list");
    list.setAttribute("role", "list");
    const foot = el("div", "lib-foot");

    wrap.appendChild(head);
    wrap.appendChild(list);
    wrap.appendChild(foot);
    root.appendChild(wrap);

    state.dom = { count, filters, list, foot, search, titleRow, refresh, web };
    state.built = true;
    renderFilters(state);
  }

  function renderFilters(state) {
    const filters = state.dom.filters;
    if (!filters) return;
    filters.textContent = "";
    const defs = state.meta.filters || [];
    if (!defs.length) {
      filters.hidden = true;
      return;
    }
    filters.hidden = false;
    for (const [value, label] of defs) {
      const chip = el("button", "lib-chip", label);
      chip.type = "button";
      const active = state.kind === "problems" ? state.difficulty === value : state.filter === value;
      if (active) chip.classList.add("on");
      chip.addEventListener("click", () => {
        if (state.kind === "problems") {
          if (state.difficulty === value) return;
          state.difficulty = value;
          load(state, 1, { force: true });
        } else {
          if (state.filter === value) return;
          state.filter = value;
          renderFilters(state);
          renderRows(state);
        }
      });
      filters.appendChild(chip);
    }
  }

  function visibleItems(state) {
    if (state.kind === "contest" && state.filter !== "all") {
      return state.items.filter((item) => contestState(item) === state.filter);
    }
    if (state.kind === "record" && state.filter !== "all") {
      return state.items.filter((item) => (state.filter === "ac" ? item.status === 12 : item.status !== 12));
    }
    return state.items;
  }

  function renderRows(state) {
    const list = state.dom.list;
    if (!list) return;
    list.textContent = "";
    if (state.loading && !state.items.length) {
      list.appendChild(el("div", "lib-state", "正在加载…"));
      renderFoot(state);
      return;
    }
    if (state.needLogin) {
      const box = el("div", "lib-login");
      box.appendChild(el("div", "lib-login-title", "登录后查看提交记录"));
      box.appendChild(el("div", "lib-login-text", "记录需要洛谷账号，登录一次即可长期保持。"));
      const btn = el("button", "sign-btn", "登录洛谷");
      btn.type = "button";
      btn.addEventListener("click", () => actions.login());
      box.appendChild(btn);
      list.appendChild(box);
      renderFoot(state);
      return;
    }
    if (state.error) {
      const box = el("div", "lib-state");
      box.appendChild(el("div", "", state.error));
      const btn = el("button", "lib-retry", "重试");
      btn.type = "button";
      btn.addEventListener("click", () => load(state, 1, { force: true }));
      box.appendChild(btn);
      list.appendChild(box);
      renderFoot(state);
      return;
    }
    const items = visibleItems(state);
    if (!items.length) {
      list.appendChild(el("div", "lib-state", state.items.length ? "当前筛选没有结果" : state.meta.empty));
      renderFoot(state);
      return;
    }
    if (state.stale) {
      list.appendChild(
        el("div", "lib-stale", state.offlineNote ? "离线数据 · 联网后自动更新" : "网络不稳 · 当前显示缓存数据")
      );
    }
    for (const item of items) list.appendChild(rowFor(state, item));
    renderFoot(state);
    const shown = state.dom.count;
    if (shown) {
      shown.textContent = state.items.length < state.total ? `${state.items.length} / ${fmtNum(state.total)}` : fmtNum(state.total);
    }
  }

  function renderFoot(state) {
    const foot = state.dom.foot;
    if (!foot) return;
    foot.textContent = "";
    if (state.loading && state.items.length) {
      foot.appendChild(el("span", "lib-loading", "加载中…"));
      return;
    }
    const hasMore = !state.error && !state.needLogin && state.items.length < state.total && state.page > 0;
    if (hasMore) {
      const btn = el("button", "lib-more", "加载更多");
      btn.type = "button";
      btn.addEventListener("click", () => load(state, state.page + 1, { append: true }));
      foot.appendChild(btn);
    }
  }

  function rowFor(state, item) {
    const row = el("div", "lib-row lib-" + item.type);
    row.tabIndex = 0;
    row.setAttribute("role", "link");
    const go = () => open(item);
    row.addEventListener("click", go);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });

    if (item.type === "problem") {
      row.appendChild(el("span", "lib-pid", item.pid));
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      const dot = el("span", "diff-dot");
      dot.style.background = item.difficultyColor;
      meta.appendChild(dot);
      meta.appendChild(el("span", "", item.difficultyName));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", item.provider || "洛谷"));
      main.appendChild(meta);
      row.appendChild(main);
      const stats = el("div", "lib-stats");
      const rate = item.submissions ? Math.round((item.accepted / item.submissions) * 100) : 0;
      stats.appendChild(el("span", "lib-stat-strong", rate + "%"));
      stats.appendChild(el("span", "lib-stat-weak", "通过率"));
      row.appendChild(stats);
      return row;
    }

    if (item.type === "training") {
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.provider || "洛谷"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${item.problemCount} 题`));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${fmtNum(item.markCount)} 人收藏`));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", fmtTime(item.createTime)));
      return row;
    }

    if (item.type === "contest") {
      const status = contestState(item);
      const chip = el(
        "span",
        "lib-status " + (status === "live" ? "ok" : status === "upcoming" ? "mid" : "quiet"),
        status === "live" ? "进行中" : status === "upcoming" ? "即将开始" : "已结束"
      );
      row.appendChild(chip);
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.host || "洛谷"));
      if (item.start) {
        meta.appendChild(el("span", "lib-sep", "·"));
        meta.appendChild(el("span", "", fmtDateTime(item.start)));
      }
      main.appendChild(meta);
      row.appendChild(main);
      const tail = el("div", "lib-tail-block");
      tail.appendChild(el("span", "lib-tail-strong", item.problemCount ? item.problemCount + " 题" : "—"));
      tail.appendChild(el("span", "lib-tail-weak", item.rated ? "rated" : "unrated"));
      row.appendChild(tail);
      return row;
    }

    if (item.type === "record") {
      const tone = statusTone(item.status);
      row.appendChild(el("span", "lib-status " + tone, item.statusText || "—"));
      row.appendChild(el("span", "lib-pid", item.pid));
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title || ""));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.language || "提交"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${item.score} 分`));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", fmtTime(item.time)));
      return row;
    }

    if (item.type === "discuss") {
      const main = el("div", "lib-main");
      const name = el("span", "lib-name");
      if (item.topped) name.appendChild(el("span", "lib-pin", "置顶"));
      name.appendChild(document.createTextNode(item.title));
      main.appendChild(name);
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.forum || "讨论"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", item.author || "匿名"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", fmtTime(item.time)));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", `${fmtNum(item.replyCount)} 回复`));
      return row;
    }

    // article
    const main = el("div", "lib-main");
    main.appendChild(el("span", "lib-name", item.title));
    if (item.excerpt) main.appendChild(el("span", "lib-excerpt", item.excerpt));
    const meta = el("span", "lib-meta");
    meta.appendChild(el("span", "", item.author || "洛谷用户"));
    meta.appendChild(el("span", "lib-sep", "·"));
    meta.appendChild(el("span", "", fmtTime(item.time)));
    main.appendChild(meta);
    row.appendChild(main);
    const stats = el("div", "lib-stats");
    stats.appendChild(el("span", "lib-stat-strong", fmtNum(item.upvote)));
    stats.appendChild(el("span", "lib-stat-weak", "赞"));
    row.appendChild(stats);
    return row;
  }

  function open(item) {
    if (item.type === "problem") {
      actions.openProblem(item.pid);
    } else if (item.type === "training") {
      actions.openDetail({ url: `/training/${item.id}`, title: item.title });
    } else if (item.type === "contest") {
      actions.openDetail({ url: `/contest/${item.id}`, title: item.title });
    } else if (item.type === "discuss") {
      actions.openDetail({ url: `/discuss/${item.id}`, title: item.title });
    } else if (item.type === "article") {
      actions.openDetail({ url: `/article/${item.id}`, title: item.title });
    } else if (item.type === "record" && item.id) {
      actions.openDetail({ url: `/record/${item.id}`, title: `${item.pid} 提交记录` });
    }
  }

  async function load(state, page, options = {}) {
    const token = ++state.token;
    state.loading = true;
    state.error = "";
    if (!options.append) {
      state.items = state.items.length ? state.items : [];
    }
    renderRows(state);
    const payload = {
      kind: state.kind,
      page,
      keyword: state.keyword,
      difficulty: state.difficulty,
      force: !!options.force,
    };
    let res;
    try {
      res = await actions.library(payload);
    } catch (err) {
      res = { error: err.message || "加载失败" };
    }
    if (token !== state.token) return;
    state.loading = false;
    if (!res) res = { error: "加载失败" };
    state.stale = !!res.stale;
    state.offlineNote = !!res.offline;
    if (res.needLogin) {
      state.needLogin = true;
      state.items = [];
      state.total = 0;
      state.page = 0;
    } else if (res.error) {
      state.error = res.error;
    } else {
      state.needLogin = false;
      state.page = page;
      state.perPage = res.perPage || 0;
      state.total = res.total || 0;
      state.categories = res.categories || [];
      state.items = options.append ? state.items.concat(res.items || []) : res.items || [];
    }
    renderRows(state);
    if (!options.append && currentKind === state.kind) root.scrollTop = 0;
  }

  function show(kind, appState) {
    const state = ensure(kind);
    if (currentKind !== kind) {
      if (current) current.scroll = root.scrollTop;
      currentKind = kind;
      current = state;
      buildShell(state);
    }
    if (!state.built) buildShell(state);
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
        load(state, 1, { force: true });
      }
      state.lastUser = logged;
    }
    if (!state.items.length && !state.loading && !state.error && !state.needLogin) {
      load(state, 1);
    } else {
      renderRows(state);
    }
    requestAnimationFrame(() => {
      if (currentKind === kind) root.scrollTop = state.scroll || 0;
    });
  }

  function update(appState) {
    const page = appState && appState.page;
    if (!page || !page.library) {
      lastSignature = "";
      return;
    }
    const logged = !!(appState.user && appState.user.loggedIn);
    const signature = [page.library, logged].join("|");
    const kindChanged = currentKind !== page.library;
    if (signature === lastSignature && !kindChanged) return;
    lastSignature = signature;
    show(page.library, appState);
  }

  return { update, show };
}
