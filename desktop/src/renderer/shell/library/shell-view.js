/* 列表外壳：标题行（搜索/刷新/网页版）、题库筛选条、可键盘导航的列表容器与分页脚。 */
import { icon } from "../icons.js";
import { getTagCatalog } from "./catalog.js";
import { el } from "./utils.js";

/* 搜索输入去抖计时器：同一时刻只有一个列表在等搜索，模块级共享即可。 */
let searchTimer = null;
  export function buildShell(ctx, state) {
    ctx.api.closeOpenDiffMenu(ctx);
    ctx.root.textContent = "";
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
          ctx.api.load(ctx, state, 1, { force: true });
        }, 320);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        input.value = "";
        search.classList.remove("has-value");
        state.keyword = "";
        ctx.api.load(ctx, state, 1, { force: true });
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
        ctx.api.load(ctx, state, 1, { force: true });
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
    refresh.addEventListener("click", () => ctx.api.load(ctx, state, 1, { force: true }));
    titleRow.appendChild(refresh);

    const web = el("button", "lib-web", "网页版");
    web.type = "button";
    web.title = "在完整网页中打开";
    web.addEventListener("click", () => ctx.actions.webFallback(state.kind));
    titleRow.appendChild(web);

    let problemPanel = null;
    const filters = el("div", "lib-filters");
    head.appendChild(titleRow);
    if (state.kind === "problems") {
      problemPanel = ctx.api.buildProblemBar(ctx, state);
      head.appendChild(problemPanel.bar);
      head.appendChild(problemPanel.selected);
    }
    head.appendChild(filters);

    const list = el("div", "lib-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", state.meta.title + "列表");
    list.tabIndex = 0;
    list.addEventListener("keydown", (event) => {
      const items = ctx.api.visibleItems(state);
      if (!items.length) return;
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        list.classList.add("keyboard");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        ctx.api.setActive(ctx, state, state.activeIndex + 1, true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        ctx.api.setActive(ctx, state, state.activeIndex - 1, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        ctx.api.setActive(ctx, state, 0, true);
      } else if (event.key === "End") {
        event.preventDefault();
        ctx.api.setActive(ctx, state, items.length - 1, true);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (items[state.activeIndex]) ctx.api.open(ctx, items[state.activeIndex]);
      }
    });

    list.addEventListener("blur", () => list.classList.remove("keyboard"));

    const foot = el("div", "lib-foot");

    wrap.appendChild(head);
    wrap.appendChild(list);
    wrap.appendChild(foot);
    ctx.root.appendChild(wrap);
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
      ctx.api.renderProblemFilters(ctx, state);
      if (!getTagCatalog()) ctx.api.loadTagCatalog(ctx, state);
    }
    ctx.api.renderFilters(ctx, state);
  }
