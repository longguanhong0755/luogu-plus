/* 标签选择弹窗：外壳结构、开合时机与标签目录加载。 */
import { icon } from "../icons.js";
import { catalogTag, getTagCatalog, prepareCatalog, setTagCatalog, setTagCatalogError } from "./catalog.js";
import { TAG_TYPES } from "./constants.js";
import { el } from "./utils.js";
  export function buildTagModal(ctx, state) {
    const modal = el("div", "lib-modal");
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "选择标签");

    const backdrop = el("div", "lib-modal-backdrop");
    backdrop.addEventListener("click", () => closeTagModal(ctx, state));
    modal.appendChild(backdrop);

    const card = el("div", "lib-modal-card");
    const head = el("div", "lib-modal-head");
    head.appendChild(el("h2", "lib-modal-title", "选择标签"));
    const close = el("button", "lib-icon");
    close.type = "button";
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭标签选择");
    close.innerHTML = icon("close");
    close.addEventListener("click", () => closeTagModal(ctx, state));
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
      ctx.api.renderTagCatalog(ctx, state);
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
      ctx.api.renderTagModal(ctx, state);
    });
    const cancel = el("button", "lib-modal-btn", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => closeTagModal(ctx, state));
    const confirm = el("button", "lib-modal-btn primary", "确定");
    confirm.type = "button";
    confirm.addEventListener("click", () => {
      state.tags = [...state.tagDraft].filter((id) => Number(id) > 0);
      state.activeIndex = 0;
      closeTagModal(ctx, state);
      ctx.api.renderProblemFilters(ctx, state);
      ctx.api.load(ctx, state, 1, { force: true });
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
        closeTagModal(ctx, state);
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
  export function openTagModal(ctx, state) {
    ctx.api.closeOpenDiffMenu(ctx);
    state.tagDraft = new Set(state.tags);
    const firstType = state.tags.map(catalogTag).find((tag) => tag && TAG_TYPES.some(([id]) => id === Number(tag.type)));
    state.tagType = firstType ? Number(firstType.type) : TAG_TYPES[0][0];
    state.tagQuery = "";
    if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
    if (state.dom.tagModal) state.dom.tagModal.hidden = false;
    ctx.api.renderTagModal(ctx, state);
    if (!getTagCatalog() && !state.catalogLoading) loadTagCatalog(ctx, state);
    requestAnimationFrame(() => {
      if (state.dom.tagSearchInput) state.dom.tagSearchInput.focus();
    });
  }
  export function closeTagModal(ctx, state) {
    if (state.dom.tagModal) state.dom.tagModal.hidden = true;
    state.tagQuery = "";
    if (state.dom.tagSearchInput) state.dom.tagSearchInput.value = "";
  }
  export function renderTagModal(ctx, state) {
    if (!state.dom.tagModal || state.dom.tagModal.hidden) return;
    ctx.api.renderTagTabs(ctx, state);
    ctx.api.renderTagCatalog(ctx, state);
    ctx.api.renderTagSelected(ctx, state);
    ctx.api.renderTagStatus(ctx, state);
  }
  export async function loadTagCatalog(ctx, state, force) {
    if (state.catalogLoading) return;
    if (!ctx.actions.libraryTags) {
      setTagCatalogError("当前版本不支持标签筛选");
      ctx.api.renderTagStatus(ctx, state);
      return;
    }
    const cached = getTagCatalog();
    if (cached && !force) {
      state.catalog = cached;
      ctx.api.renderProblemFilters(ctx, state);
      return;
    }
    state.catalogLoading = true;
    setTagCatalogError("");
    ctx.api.renderTagStatus(ctx, state);
    try {
      const payload = await ctx.actions.libraryTags();
      const prepared = prepareCatalog(payload);
      if (prepared) {
        setTagCatalog(prepared);
        state.catalog = prepared;
        setTagCatalogError("");
      } else {
        setTagCatalogError((payload && payload.error) || "标签目录加载失败");
      }
    } catch (err) {
      setTagCatalogError(err.message || "标签目录加载失败");
    }
    state.catalogLoading = false;
    if (state.kind === "problems") {
      ctx.api.renderProblemFilters(ctx, state);
      ctx.api.renderTagModal(ctx, state);
      ctx.api.renderRows(ctx, state);
    }
  }
