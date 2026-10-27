/* 原生列表：题库 / 训练 / 比赛 / 记录 / 讨论 / 文章。
   数据由主进程从洛谷页面上下文中解析，渲染层只负责筛选、排版与跳转。
   这是「客户端而不是套壳」的核心：列表滚动、搜索、筛选都不加载整页。 */
import { icon } from "./icons.js";

/* 题库分区与网页版一致：luogu = 洛谷（主题库 + 入门与面试） */
const PROBLEM_TYPES = [
  ["luogu", "洛谷"],
  ["P", "主题库"],
  ["B", "入门与面试"],
  ["CF", "Codeforces"],
  ["SP", "SPOJ"],
  ["AT", "AtCoder"],
  ["UVA", "UVa"],
];

const DIFFICULTIES = [
  [1, "入门", "#fe4c61"],
  [2, "普及−", "#f39c11"],
  [3, "普及", "#ffc116"],
  [4, "普及+/提高−", "#52c41a"],
  [5, "提高", "#13c2c2"],
  [6, "提高+/省选−", "#3498db"],
  [7, "省选/NOI−", "#9d3dcf"],
  [8, "NOI/NOI+/CTS", "#0e1d69"],
];

const TAG_TYPES = [
  [2, "算法"],
  [3, "来源"],
  [4, "时间"],
  [1, "区域"],
  [5, "特殊题目"],
];

let tagCatalog = null;
let tagCatalogError = "";
let openDiffState = null;

const META = {
  problems: {
    title: "题库",
    search: true,
    empty: "没有找到题目",
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
  return `${d.getFullYear()}-${d.getMonth() + 1}-${pad(d.getDate())}`;
}

function fmtDateTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function difficultyName(level) {
  const hit = DIFFICULTIES.find(([id]) => id === Number(level));
  return hit ? hit[1] : "";
}

function encodeDifficulty(min, max) {
  const low = Number(min) || 0;
  const high = Number(max) || 0;
  if (!low || !high) return "";
  return low === high ? String(low) : low + "|" + high;
}

function difficultyRangeText(min, max) {
  if (!min || !max) return "";
  return min === max ? difficultyName(min) : `${difficultyName(min)} ~ ${difficultyName(max)}`;
}

function catalogTag(id) {
  if (!tagCatalog || !tagCatalog.byId) return null;
  return tagCatalog.byId.get(Number(id)) || null;
}

function selectedTagGroups(ids) {
  const groups = new Map();
  for (const raw of ids || []) {
    const id = Number(raw) || 0;
    if (!id) continue;
    const tag = catalogTag(id);
    const type = tag ? Number(tag.type) || 0 : 0;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(id);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => [...new Set(group)].sort((a, b) => a - b));
}

function prepareCatalog(payload) {
  if (!payload || !Array.isArray(payload.tags) || !payload.tags.length) return null;
  const byId = new Map();
  for (const tag of payload.tags) byId.set(Number(tag.id), tag);
  return Object.assign({}, payload, { byId });
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

  document.addEventListener("click", (event) => {
    if (!openDiffState) return;
    const wrap = openDiffState.dom.problemDiffWrap;
    if (wrap && wrap.contains(event.target)) return;
    closeDiffMenu(openDiffState);
  });

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
      difficultyMin: 0,
      difficultyMax: 0,
      type: "luogu",
      tags: [],
      tagDraft: new Set(),
      tagType: 2,
      tagQuery: "",
      content: false,
      showTags: localStorage.getItem("lg.lib.showTags") !== "0",
      catalog: tagCatalog,
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
    store.set(kind, state);
    return state;
  }

  function buildShell(state) {
    if (openDiffState) closeDiffMenu(openDiffState);
    root.textContent = "";
    const wrap = el("div", "lib-wrap");
    const head = el("div", "lib-top");
    const titleRow = el("div", "lib-title-row");
    const title = el("h1", "lib-title", state.meta.title);
    const count = el("span", "lib-count", "");
    count.setAttribute("aria-live", "polite");
    const spacer = el("span", "lib-spacer");
    titleRow.appendChild(title);
    titleRow.appendChild(count);
    titleRow.appendChild(spacer);

    let search = null;
    let clear = null;
    if (state.meta.search) {
      search = el("div", "lib-search");
      search.innerHTML = icon("search");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "搜索题目";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = state.keyword;
      input.setAttribute("aria-label", "搜索题目");
      input.addEventListener("input", () => {
        search.classList.toggle("has-value", !!input.value);
        if (searchTimer) clearTimeout(searchTimer);
        const value = input.value.trim();
        searchTimer = setTimeout(() => {
          state.keyword = value;
          load(state, 1, { force: true });
        }, 320);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        input.value = "";
        search.classList.remove("has-value");
        state.keyword = "";
        load(state, 1, { force: true });
      });
      clear = el("button", "lib-search-clear");
      clear.type = "button";
      clear.title = "清除搜索";
      clear.setAttribute("aria-label", "清除搜索");
      clear.innerHTML = icon("close");
      clear.addEventListener("click", () => {
        input.value = "";
        search.classList.remove("has-value");
        state.keyword = "";
        load(state, 1, { force: true });
        input.focus();
      });
      search.appendChild(input);
      search.appendChild(clear);
      search.classList.toggle("has-value", !!state.keyword);
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

    let problemPanel = null;
    const filters = el("div", "lib-filters");
    head.appendChild(titleRow);
    if (state.kind === "problems") {
      problemPanel = buildProblemBar(state);
      head.appendChild(problemPanel.bar);
      head.appendChild(problemPanel.selected);
    }
    head.appendChild(filters);

    const list = el("div", "lib-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", state.meta.title + "列表");
    list.tabIndex = 0;
    list.addEventListener("keydown", (event) => {
      const items = visibleItems(state);
      if (!items.length) return;
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        list.classList.add("keyboard");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(state, state.activeIndex + 1, true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(state, state.activeIndex - 1, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(state, 0, true);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(state, items.length - 1, true);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (items[state.activeIndex]) open(items[state.activeIndex]);
      }
    });

    list.addEventListener("blur", () => list.classList.remove("keyboard"));

    const foot = el("div", "lib-foot");

    wrap.appendChild(head);
    wrap.appendChild(list);
    wrap.appendChild(foot);
    root.appendChild(wrap);
    if (problemPanel) {
      wrap.appendChild(problemPanel.modal);
    }

    state.dom = {
      count,
      filters,
      list,
      foot,
      search,
      clear,
      titleRow,
      refresh,
      web,
      problemBar: problemPanel ? problemPanel.bar : null,
      problemSelected: problemPanel ? problemPanel.selected : null,
      problemTypes: problemPanel ? problemPanel.types : null,
      problemDiffBtn: problemPanel ? problemPanel.diffBtn : null,
      problemDiffText: problemPanel ? problemPanel.diffText : null,
      problemDiffMenu: problemPanel ? problemPanel.diffMenu : null,
      problemDiffWrap: problemPanel ? problemPanel.diffWrap : null,
      problemTagBtn: problemPanel ? problemPanel.tagBtn : null,
      problemClear: problemPanel ? problemPanel.clearBtn : null,
      problemTagCount: problemPanel ? problemPanel.tagCount : null,
      contentBtn: problemPanel ? problemPanel.contentBtn : null,
      showTagsBtn: problemPanel ? problemPanel.showTagsBtn : null,
      tagModal: problemPanel ? problemPanel.modal : null,
      tagTabs: problemPanel ? problemPanel.tagTabs : null,
      tagSearch: problemPanel ? problemPanel.tagSearch : null,
      tagSearchInput: problemPanel ? problemPanel.tagSearchInput : null,
      tagCatalogBox: problemPanel ? problemPanel.tagCatalogBox : null,
      tagSelected: problemPanel ? problemPanel.tagSelected : null,
      tagConfirm: problemPanel ? problemPanel.tagConfirm : null,
      tagClear: problemPanel ? problemPanel.tagClear : null,
      tagStatus: problemPanel ? problemPanel.tagStatus : null,
    };
    state.built = true;
    if (state.kind === "problems") {
      renderProblemFilters(state);
      if (!tagCatalog) loadTagCatalog(state);
    }
    renderFilters(state);
  }

  function buildProblemBar(state) {
    const bar = el("div", "lib-problem-bar");

    const typeRow = el("div", "lib-filter-row");
    typeRow.appendChild(el("span", "lib-filter-caption", "所属题库"));
    const types = el("div", "lib-type-tabs");
    types.setAttribute("role", "tablist");
    types.setAttribute("aria-label", "选择题库");
    for (const [value, label] of PROBLEM_TYPES) {
      const btn = el("button", "lib-type", label);
      btn.type = "button";
      btn.dataset.type = value;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        if (state.type === value) return;
        state.type = value;
        state.activeIndex = 0;
        renderProblemFilters(state);
        load(state, 1, { force: true });
      });
      types.appendChild(btn);
    }
    typeRow.appendChild(types);
    bar.appendChild(typeRow);

    const diffRow = el("div", "lib-filter-row");
    diffRow.appendChild(el("span", "lib-filter-caption", "筛选条件"));
    const diffWrap = el("div", "lib-diff-wrap");
    const diffBtn = el("button", "lib-diff-btn empty");
    diffBtn.type = "button";
    diffBtn.title = "题目难度范围";
    diffBtn.setAttribute("aria-haspopup", "listbox");
    diffBtn.setAttribute("aria-expanded", "false");
    const diffText = el("span", "lib-diff-btn-text", "题目难度范围");
    diffBtn.appendChild(diffText);
    const caret = el("span", "lib-diff-caret");
    caret.innerHTML = icon("chevronDown");
    diffBtn.appendChild(caret);

    const diffMenu = el("div", "lib-diff-menu");
    diffMenu.hidden = true;
    diffMenu.setAttribute("role", "listbox");
    diffMenu.setAttribute("aria-label", "题目难度范围");
    diffMenu.setAttribute("aria-multiselectable", "true");
    diffMenu.appendChild(diffItem(state, 0, "不限难度", ""));
    for (const [level, label, color] of DIFFICULTIES) {
      diffMenu.appendChild(diffItem(state, level, label, color));
    }
    diffBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = diffMenu.hidden;
      if (openDiffState && openDiffState !== state) closeDiffMenu(openDiffState);
      if (willOpen) {
        diffMenu.hidden = false;
        openDiffState = state;
        const current = diffMenu.querySelector(".lib-diff-item.on");
        if (current) current.focus();
      } else {
        closeDiffMenu(state);
      }
      syncDiffBtn(state);
    });
    diffMenu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeDiffMenu(state);
      diffBtn.focus();
    });
    diffWrap.appendChild(diffBtn);
    diffWrap.appendChild(diffMenu);

    const tools = el("div", "lib-filter-tools");
    const tagBtn = el("button", "lib-tag-btn");
    tagBtn.type = "button";
    tagBtn.innerHTML = icon("tag");
    tagBtn.appendChild(el("span", "", "标签"));
    const tagCount = el("span", "lib-tag-count", "");
    tagBtn.appendChild(tagCount);
    tagBtn.addEventListener("click", () => openTagModal(state));
    tools.appendChild(tagBtn);

    const contentBtn = el("button", "lib-toggle", "搜索题面");
    contentBtn.type = "button";
    contentBtn.title = "关键字同时匹配题面内容";
    contentBtn.setAttribute("aria-pressed", "false");
    contentBtn.addEventListener("click", () => {
      state.content = !state.content;
      state.activeIndex = 0;
      renderProblemFilters(state);
      load(state, 1, { force: true });
    });
    tools.appendChild(contentBtn);

    const showTagsBtn = el("button", "lib-toggle", "显示算法");
    showTagsBtn.type = "button";
    showTagsBtn.title = "在题目行内显示算法标签";
    showTagsBtn.setAttribute("aria-pressed", "false");
    showTagsBtn.addEventListener("click", () => {
      state.showTags = !state.showTags;
      localStorage.setItem("lg.lib.showTags", state.showTags ? "1" : "0");
      renderProblemFilters(state);
      renderRows(state);
    });
    tools.appendChild(showTagsBtn);

    diffRow.appendChild(diffWrap);
    diffRow.appendChild(tools);
    bar.appendChild(diffRow);

    const selected = el("div", "lib-selected");
    selected.hidden = true;
    bar.appendChild(selected);

    const modal = buildTagModal(state);
    return {
      bar,
      selected,
      types,
      diffBtn,
      diffText,
      diffMenu,
      diffWrap,
      tagBtn,
      tagCount,
      contentBtn,
      showTagsBtn,
      modal,
      ...modal.parts,
    };
  }

  function diffItem(state, level, label, color) {
    const btn = el("button", "lib-diff-item");
    btn.type = "button";
    btn.dataset.level = String(level);
    btn.setAttribute("role", "option");
    const dot = el("span", "lib-diff-dot" + (color ? "" : " any"));
    if (color) dot.style.background = color;
    btn.appendChild(dot);
    btn.appendChild(el("span", "lib-diff-item-name", label));
    const check = el("span", "lib-diff-check");
    check.innerHTML = icon("check");
    btn.appendChild(check);
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      pickDifficulty(state, level);
      if (!level) closeDiffMenu(state);
    });
    return btn;
  }

  function syncDiffBtn(state) {
    const btn = state.dom.problemDiffBtn;
    const text = state.dom.problemDiffText;
    if (!btn || !text) return;
    const label = difficultyRangeText(state.difficultyMin, state.difficultyMax);
    text.textContent = label || "题目难度范围";
    btn.classList.toggle("on", !!label);
    btn.classList.toggle("empty", !label);
    const open = !!(state.dom.problemDiffMenu && !state.dom.problemDiffMenu.hidden);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeDiffMenu(state) {
    if (state && state.dom.problemDiffMenu) state.dom.problemDiffMenu.hidden = true;
    if (openDiffState === state) openDiffState = null;
    syncDiffBtn(state);
  }

  function buildTagModal(state) {
    const modal = el("div", "lib-modal");
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "选择标签");

    const backdrop = el("div", "lib-modal-backdrop");
    backdrop.addEventListener("click", () => closeTagModal(state));
    modal.appendChild(backdrop);

    const card = el("div", "lib-modal-card");
    const head = el("div", "lib-modal-head");
    head.appendChild(el("h2", "lib-modal-title", "选择标签"));
    const close = el("button", "lib-icon");
    close.type = "button";
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭标签选择");
    close.innerHTML = icon("close");
    close.addEventListener("click", () => closeTagModal(state));
    head.appendChild(close);
    card.appendChild(head);

    const search = el("label", "lib-modal-search");
    search.innerHTML = icon("search");
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "搜索全部标签";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.setAttribute("aria-label", "搜索全部标签");
    searchInput.addEventListener("input", () => {
      state.tagQuery = searchInput.value.trim();
      renderTagCatalog(state);
    });
    search.appendChild(searchInput);
    card.appendChild(search);

    const tabs = el("div", "lib-tag-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "标签分类");
    card.appendChild(tabs);

    const status = el("div", "lib-tag-status");
    card.appendChild(status);

    const main = el("div", "lib-tag-main");
    const catalogBox = el("div", "lib-tag-catalog");
    const selected = el("div", "lib-tag-selected");
    main.appendChild(catalogBox);
    main.appendChild(selected);
    card.appendChild(main);

    const foot = el("div", "lib-modal-foot");
    const hint = el("span", "lib-tag-hint", "同类标签满足任一，不同类标签需同时满足");
    const clear = el("button", "lib-modal-btn quiet", "清空");
    clear.type = "button";
    clear.addEventListener("click", () => {
      state.tagDraft.clear();
      renderTagModal(state);
    });
    const cancel = el("button", "lib-modal-btn", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => closeTagModal(state));
    const confirm = el("button", "lib-modal-btn primary", "确定");
    confirm.type = "button";
    confirm.addEventListener("click", () => {
      state.tags = [...state.tagDraft].filter((id) => Number(id) > 0);
      state.activeIndex = 0;
      closeTagModal(state);
      renderProblemFilters(state);
      load(state, 1, { force: true });
    });
    foot.appendChild(hint);
    foot.appendChild(clear);
    foot.appendChild(cancel);
    foot.appendChild(confirm);
    card.appendChild(foot);

    modal.appendChild(card);
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeTagModal(state);
      }
    });
    modal.parts = {
      tagTabs: tabs,
      tagSearch: search,
      tagSearchInput: searchInput,
      tagCatalogBox: catalogBox,
      tagSelected: selected,
      tagConfirm: confirm,
      tagClear: clear,
      tagStatus: status,
    };
    return modal;
  }

  function openTagModal(state) {
    if (openDiffState) closeDiffMenu(openDiffState);
    state.tagDraft = new Set(state.tags);
    const firstType = state.tags.map(catalogTag).find((tag) => tag && TAG_TYPES.some(([id]) => id === Number(tag.type)));
    state.tagType = firstType ? Number(firstType.type) : TAG_TYPES[0][0];
    state.tagQuery = "";
    if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
    if (state.dom.tagModal) state.dom.tagModal.hidden = false;
    renderTagModal(state);
    if (!tagCatalog && !state.catalogLoading) loadTagCatalog(state);
    requestAnimationFrame(() => {
      if (state.dom.tagSearchInput) state.dom.tagSearchInput.focus();
    });
  }

  function closeTagModal(state) {
    if (state.dom.tagModal) state.dom.tagModal.hidden = true;
    state.tagQuery = "";
    if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
  }

  function renderTagModal(state) {
    if (!state.dom.tagModal || state.dom.tagModal.hidden) return;
    renderTagTabs(state);
    renderTagCatalog(state);
    renderTagSelected(state);
    renderTagStatus(state);
  }

  function renderTagTabs(state) {
    const tabs = state.dom.tagTabs;
    if (!tabs) return;
    tabs.textContent = "";
    for (const [id, label] of TAG_TYPES) {
      const count = [...state.tagDraft].filter((tagId) => {
        const tag = catalogTag(tagId);
        return tag && Number(tag.type) === id;
      }).length;
      const btn = el("button", "lib-tag-tab");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.appendChild(el("span", "", label));
      if (count) btn.appendChild(el("span", "lib-tag-tab-count", String(count)));
      const on = state.tagType === id;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.addEventListener("click", () => {
        if (state.tagType === id) return;
        state.tagType = id;
        state.tagQuery = "";
        if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
        renderTagModal(state);
      });
      tabs.appendChild(btn);
    }
  }

  function tagChip(state, tag) {
    const chip = el("button", "lib-tag-chip", tag.name);
    chip.type = "button";
    chip.dataset.id = String(tag.id);
    const on = state.tagDraft.has(Number(tag.id));
    chip.classList.toggle("on", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    chip.addEventListener("click", () => {
      const id = Number(tag.id);
      if (state.tagDraft.has(id)) state.tagDraft.delete(id);
      else state.tagDraft.add(id);
      renderTagModal(state);
    });
    return chip;
  }

  function renderTagCatalog(state) {
    const box = state.dom.tagCatalogBox;
    if (!box) return;
    box.textContent = "";
    const catalog = state.catalog;
    if (!catalog) return;

    const typeTags = catalog.tags.filter((tag) => Number(tag.type) === state.tagType);
    const query = state.tagQuery.trim().toLowerCase();
    if (query) {
      const hits = catalog.tags.filter(
        (tag) => Number(tag.id) > 0 && String(tag.name || "").toLowerCase().includes(query)
      );
      const section = el("div", "lib-tag-section");
      section.appendChild(el("div", "lib-tag-section-title", hits.length ? `搜索结果 · ${hits.length}` : "没有匹配的标签"));
      const wrap = el("div", "lib-tag-cloud");
      for (const tag of hits.slice(0, 200)) wrap.appendChild(tagChip(state, tag));
      section.appendChild(wrap);
      box.appendChild(section);
      return;
    }

    const roots = typeTags.filter((tag) => !Number(tag.parent));
    for (const root of roots) {
      const children = typeTags.filter((tag) => Number(tag.parent) === Number(root.id) && Number(tag.id) > 0);
      if (!children.length) {
        if (Number(root.id) <= 0) continue;
        const lone = el("div", "lib-tag-section lone");
        const wrap = el("div", "lib-tag-cloud");
        wrap.appendChild(tagChip(state, root));
        lone.appendChild(wrap);
        box.appendChild(lone);
        continue;
      }
      const section = el("div", "lib-tag-section");
      section.appendChild(el("div", "lib-tag-section-title", root.name));
      const wrap = el("div", "lib-tag-cloud");
      for (const tag of children) wrap.appendChild(tagChip(state, tag));
      section.appendChild(wrap);
      box.appendChild(section);
    }
    if (!box.childElementCount) box.appendChild(el("div", "lib-tag-empty", "这个分类暂时没有可选标签"));
  }

  function renderTagSelected(state) {
    const box = state.dom.tagSelected;
    if (!box) return;
    box.textContent = "";
    box.appendChild(el("div", "lib-tag-selected-title", `已选标签（${state.tagDraft.size}）`));
    if (!state.tagDraft.size) {
      box.appendChild(el("div", "lib-tag-empty", "还没有选择标签"));
      return;
    }
    const wrap = el("div", "lib-tag-selected-list");
    for (const id of state.tagDraft) {
      const tag = catalogTag(id);
      const chip = el("button", "lib-sel-chip");
      chip.type = "button";
      chip.appendChild(document.createTextNode(tag ? tag.name : "#" + id));
      const x = el("span", "lib-sel-x");
      x.innerHTML = icon("close");
      chip.appendChild(x);
      chip.title = "移除";
      chip.addEventListener("click", () => {
        state.tagDraft.delete(Number(id));
        renderTagModal(state);
      });
      wrap.appendChild(chip);
    }
    box.appendChild(wrap);
  }

  function renderTagStatus(state) {
    const status = state.dom.tagStatus;
    if (!status) return;
    status.textContent = "";
    if (state.catalogLoading) {
      status.textContent = "正在加载标签目录…";
      status.hidden = false;
      return;
    }
    if (!state.catalog && tagCatalogError) {
      status.hidden = false;
      status.appendChild(el("span", "", tagCatalogError));
      const retry = el("button", "lib-tag-retry", "重试");
      retry.type = "button";
      retry.addEventListener("click", () => loadTagCatalog(state, true));
      status.appendChild(retry);
      return;
    }
    status.hidden = true;
  }

  async function loadTagCatalog(state, force) {
    if (state.catalogLoading) return;
    if (!actions.libraryTags) {
      tagCatalogError = "当前版本不支持标签筛选";
      renderTagStatus(state);
      return;
    }
    if (tagCatalog && !force) {
      state.catalog = tagCatalog;
      renderProblemFilters(state);
      return;
    }
    state.catalogLoading = true;
    tagCatalogError = "";
    renderTagStatus(state);
    try {
      const payload = await actions.libraryTags();
      const prepared = prepareCatalog(payload);
      if (prepared) {
        tagCatalog = prepared;
        state.catalog = prepared;
        tagCatalogError = "";
      } else {
        tagCatalogError = (payload && payload.error) || "标签目录加载失败";
      }
    } catch (err) {
      tagCatalogError = err.message || "标签目录加载失败";
    }
    state.catalogLoading = false;
    if (state.kind === "problems") {
      renderProblemFilters(state);
      renderTagModal(state);
      renderRows(state);
    }
  }

  function pickDifficulty(state, level) {
    const min = state.difficultyMin;
    const max = state.difficultyMax;
    let nextMin = 0;
    let nextMax = 0;
    if (!level) {
      nextMin = 0;
      nextMax = 0;
    } else if (!min) {
      nextMin = level;
      nextMax = level;
    } else if (level < min) {
      nextMin = level;
      nextMax = max;
    } else if (level > max) {
      nextMin = min;
      nextMax = level;
    } else if (min === max) {
      nextMin = 0;
      nextMax = 0;
    } else if (level === min || level === max) {
      // 点区间端点收成单级，再点一次取消
      nextMin = level;
      nextMax = level;
    } else {
      // 点区间内部：从更近的一端收缩；等距时收高端（与网页版一致）
      const left = level - min;
      const right = max - level;
      if (right <= left) {
        nextMin = min;
        nextMax = level;
      } else {
        nextMin = level;
        nextMax = max;
      }
    }
    state.difficultyMin = nextMin;
    state.difficultyMax = nextMax;
    state.difficulty = encodeDifficulty(nextMin, nextMax);
    state.activeIndex = 0;
    renderProblemFilters(state);
    load(state, 1, { force: true });
  }

  function clearProblemFilters(state) {
    if (!state.difficultyMin && !state.tags.length && !state.content) return;
    state.difficultyMin = 0;
    state.difficultyMax = 0;
    state.difficulty = "";
    state.tags = [];
    state.content = false;
    state.activeIndex = 0;
    renderProblemFilters(state);
    load(state, 1, { force: true });
  }

  function selectedChip(label, onRemove, title) {
    const chip = el("button", "lib-sel-chip");
    chip.type = "button";
    chip.title = title || "移除筛选";
    chip.appendChild(document.createTextNode(label));
    const x = el("span", "lib-sel-x");
    x.innerHTML = icon("close");
    chip.appendChild(x);
    chip.addEventListener("click", onRemove);
    return chip;
  }

  function renderProblemSelected(state) {
    const box = state.dom.problemSelected;
    if (!box) return;
    box.textContent = "";
    const chips = [];
    if (state.difficultyMin && state.difficultyMax) {
      chips.push(
        selectedChip("难度 · " + difficultyRangeText(state.difficultyMin, state.difficultyMax), () => {
          pickDifficulty(state, 0);
        }, "清除难度筛选")
      );
    }
    for (const raw of state.tags) {
      const tag = catalogTag(raw);
      chips.push(
        selectedChip(tag ? tag.name : "#" + raw, () => {
          state.tags = state.tags.filter((id) => Number(id) !== Number(raw));
          state.activeIndex = 0;
          renderProblemFilters(state);
          load(state, 1, { force: true });
        }, "移除这个标签")
      );
    }
    if (state.content) {
      chips.push(
        selectedChip("搜索题面", () => {
          state.content = false;
          state.activeIndex = 0;
          renderProblemFilters(state);
          load(state, 1, { force: true });
        }, "不再搜索题面")
      );
    }
    box.hidden = !chips.length;
    if (!chips.length) return;
    box.appendChild(el("span", "lib-filter-caption", "已选"));
    for (const chip of chips) box.appendChild(chip);
    const clear = el("button", "lib-clear-filters", "清除筛选");
    clear.type = "button";
    clear.addEventListener("click", () => clearProblemFilters(state));
    box.appendChild(clear);
  }

  function renderProblemFilters(state) {
    const dom = state.dom;
    if (!dom.problemBar) return;
    if (dom.problemTypes) {
      for (const btn of dom.problemTypes.querySelectorAll(".lib-type")) {
        const on = btn.dataset.type === state.type;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      }
    }
    syncDiffBtn(state);
    if (dom.problemDiffMenu) {
      for (const btn of dom.problemDiffMenu.querySelectorAll(".lib-diff-item")) {
        const level = Number(btn.dataset.level) || 0;
        const on = level
          ? !!state.difficultyMin && level >= state.difficultyMin && level <= state.difficultyMax
          : !state.difficultyMin;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      }
    }
    if (dom.problemTagCount) dom.problemTagCount.textContent = state.tags.length ? String(state.tags.length) : "";
    if (dom.contentBtn) {
      dom.contentBtn.classList.toggle("on", state.content);
      dom.contentBtn.setAttribute("aria-pressed", state.content ? "true" : "false");
    }
    if (dom.showTagsBtn) {
      dom.showTagsBtn.classList.toggle("on", state.showTags);
      dom.showTagsBtn.setAttribute("aria-pressed", state.showTags ? "true" : "false");
    }
    renderProblemSelected(state);
  }

  function renderFilters(state) {
    const filters = state.dom.filters;
    if (!filters) return;
    filters.textContent = "";
    if (state.kind === "problems") {
      filters.hidden = true;
      return;
    }
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
      chip.setAttribute("aria-pressed", active ? "true" : "false");
      chip.addEventListener("click", () => {
        if (state.kind === "problems") {
          if (state.difficulty === value) return;
          state.difficulty = value;
          load(state, 1, { force: true });
        } else {
          if (state.filter === value) return;
          state.filter = value;
          state.activeIndex = 0;
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

  function banner(kind, text) {
    const node = el("div", kind === "error" ? "lib-banner" : "lib-stale");
    node.innerHTML = icon(kind === "error" ? "alert" : "wifiOff");
    node.appendChild(el("span", "", text));
    return node;
  }

  function skeletonRows() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 8; i++) {
      const row = el("div", "lib-row skeleton-row");
      row.appendChild(el("span", "skeleton sk-pid"));
      const main = el("div", "sk-main");
      main.appendChild(el("span", "skeleton sk-title"));
      main.appendChild(el("span", "skeleton sk-meta"));
      row.appendChild(main);
      row.appendChild(el("span", "skeleton sk-tail"));
      frag.appendChild(row);
    }
    return frag;
  }

  function setActive(state, index, scroll) {
    const items = visibleItems(state);
    if (!items.length) {
      state.activeIndex = 0;
      return;
    }
    state.activeIndex = Math.max(0, Math.min(items.length - 1, index));
    const rows = state.dom.list ? [...state.dom.list.querySelectorAll(".lib-row:not(.skeleton-row)")] : [];
    rows.forEach((row, i) => {
      const on = i === state.activeIndex;
      row.classList.toggle("active", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = rows[state.activeIndex];
    if (!active) return;
    state.dom.list.setAttribute("aria-activedescendant", active.id);
    if (scroll) active.scrollIntoView({ block: "nearest" });
  }

  function renderRows(state) {
    const list = state.dom.list;
    if (!list) return;
    list.textContent = "";
    list.setAttribute("aria-busy", state.loading ? "true" : "false");

    if (state.loading && !state.items.length) {
      if (state.loadingVisible) list.appendChild(skeletonRows());
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
    if (state.error && !state.items.length) {
      const box = el("div", "lib-state");
      box.innerHTML = icon("alert");
      box.appendChild(el("strong", "", "加载失败"));
      box.appendChild(el("span", "", state.error));
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
      const box = el("div", "lib-state");
      box.innerHTML = icon("inbox");
      box.appendChild(el("strong", "", state.items.length ? "当前筛选没有结果" : state.meta.empty));
      const emptyHint = state.items.length
        ? "换一个筛选条件试试。"
        : state.offlineNote
          ? "当前离线，联网后会自动更新。"
          : "有新内容时会出现在这里。";
      box.appendChild(el("span", "", emptyHint));
      list.appendChild(box);
      renderFoot(state);
      return;
    }

    if (state.stale) {
      list.appendChild(
        banner("stale", state.offlineNote ? "离线数据 · 联网后自动更新" : "网络不稳 · 当前显示缓存数据")
      );
    }
    if (state.error) list.appendChild(banner("error", state.error));

    if (state.activeIndex >= items.length) state.activeIndex = 0;
    items.forEach((item, index) => {
      const row = rowFor(state, item);
      row.id = "lib-opt-" + state.kind + "-" + index;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === state.activeIndex ? "true" : "false");
      row.tabIndex = -1;
      // 鼠标左键直接打开（此前只有键盘 Enter 能开，行却有 pointer/hover 样式——纯误导）
      row.addEventListener("click", () => {
        setActive(state, index, false);
        open(item);
      });
      if (index === state.activeIndex) row.classList.add("active");
      list.appendChild(row);
    });
    renderFoot(state);

    const visible = items.length;
    const filtered = (state.kind === "contest" || state.kind === "record") && state.filter !== "all";
    const shown = state.dom.count;
    if (shown) {
      if (state.hasMore) shown.textContent = `${state.items.length}+`;
      else if (filtered) shown.textContent = `${visible} / ${fmtNum(state.total)}`;
      else if (state.items.length < state.total) shown.textContent = `${state.items.length} / ${fmtNum(state.total)}`;
      else shown.textContent = fmtNum(state.total);
    }
    const active = list.querySelector(".lib-row.active");
    if (active) list.setAttribute("aria-activedescendant", active.id);
  }

  function renderFoot(state) {
    const foot = state.dom.foot;
    if (!foot) return;
    foot.textContent = "";
    if (state.loading && state.items.length) {
      foot.appendChild(el("span", "lib-loading", "加载中…"));
      return;
    }
    const hasMore =
      !state.error && !state.needLogin && (state.hasMore || state.items.length < state.total) && state.page > 0;
    if (hasMore) {
      const btn = el("button", "lib-more", "加载更多");
      btn.type = "button";
      btn.addEventListener("click", () => load(state, state.page + 1, { append: true }));
      foot.appendChild(btn);
    }
  }

  function rowFor(state, item) {
    const row = el("div", "lib-row lib-" + item.type);

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
      if (state.showTags && Array.isArray(item.tags) && item.tags.length) {
        const named = item.tags
          .map((id) => catalogTag(id))
          .filter((tag) => tag && Number(tag.id) > 0 && (Number(tag.type) === 2 || Number(tag.type) === 5));
        if (named.length) {
          const tags = el("span", "lib-tags");
          for (const tag of named.slice(0, 4)) {
            const chip = el("span", "lib-tag", tag.name);
            chip.title = tag.name;
            tags.appendChild(chip);
          }
          if (named.length > 4) tags.appendChild(el("span", "lib-tag more", "+" + (named.length - 4)));
          main.appendChild(tags);
        }
      }
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
    state.loadingVisible = false;
    state.error = "";
    renderRows(state);
    const skeletonTimer = setTimeout(() => {
      if (token !== state.token || !state.loading || state.items.length) return;
      state.loadingVisible = true;
      renderRows(state);
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
      res = await actions.library(payload);
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
      state.items = options.append ? state.items.concat(res.items || []) : res.items || [];
      state.loadedAt = Date.now();
    }
    renderRows(state);
    if (!options.append && currentKind === state.kind && !options.quiet) root.scrollTop = 0;
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
    } else if (
      state.loadedAt &&
      !state.loading &&
      (!appState || appState.online !== false) &&
      Date.now() - state.loadedAt > 180000
    ) {
      // 回访后台刷新：先照旧显示旧数据，超过 3 分钟才拉新（不打断滚动位置）
      load(state, 1, { quiet: true });
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
