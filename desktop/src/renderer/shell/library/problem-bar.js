/* 题库筛选条：所属题库分段、难度下拉入口、标签/题面开关与已选条件回显。 */
import { icon } from "../icons.js";
import { catalogTag } from "./catalog.js";
import { DIFFICULTIES, PROBLEM_TYPES } from "./constants.js";
import { difficultyRangeText, el } from "./utils.js";
  export function buildProblemBar(ctx, state) {
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
        ctx.api.renderProblemFilters(ctx, state);
        ctx.api.load(ctx, state, 1, { force: true });
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
    diffMenu.appendChild(ctx.api.diffItem(ctx, state, 0, "不限难度", ""));
    for (const [level, label, color] of DIFFICULTIES) {
      diffMenu.appendChild(ctx.api.diffItem(ctx, state, level, label, color));
    }
    diffBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      ctx.api.toggleDiffMenu(ctx, state);
    });
    diffMenu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      ctx.api.closeDiffMenu(ctx, state);
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
    tagBtn.addEventListener("click", () => ctx.api.openTagModal(ctx, state));
    tools.appendChild(tagBtn);

    const contentBtn = el("button", "lib-toggle", "搜索题面");
    contentBtn.type = "button";
    contentBtn.title = "关键字同时匹配题面内容";
    contentBtn.setAttribute("aria-pressed", "false");
    contentBtn.addEventListener("click", () => {
      state.content = !state.content;
      state.activeIndex = 0;
      ctx.api.renderProblemFilters(ctx, state);
      ctx.api.load(ctx, state, 1, { force: true });
    });
    tools.appendChild(contentBtn);

    const showTagsBtn = el("button", "lib-toggle", "显示算法");
    showTagsBtn.type = "button";
    showTagsBtn.title = "在题目行内显示算法标签";
    showTagsBtn.setAttribute("aria-pressed", "false");
    showTagsBtn.addEventListener("click", () => {
      state.showTags = !state.showTags;
      localStorage.setItem("lg.lib.showTags", state.showTags ? "1" : "0");
      ctx.api.renderProblemFilters(ctx, state);
      ctx.api.renderRows(ctx, state);
    });
    tools.appendChild(showTagsBtn);

    diffRow.appendChild(diffWrap);
    diffRow.appendChild(tools);
    bar.appendChild(diffRow);

    const selected = el("div", "lib-selected");
    selected.hidden = true;
    bar.appendChild(selected);

    const modal = ctx.api.buildTagModal(ctx, state);
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
  export function clearProblemFilters(ctx, state) {
    if (!state.difficultyMin && !state.tags.length && !state.content) return;
    state.difficultyMin = 0;
    state.difficultyMax = 0;
    state.difficulty = "";
    state.tags = [];
    state.content = false;
    state.activeIndex = 0;
    ctx.api.renderProblemFilters(ctx, state);
    ctx.api.load(ctx, state, 1, { force: true });
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
  export function renderProblemSelected(ctx, state) {
    const box = state.dom.problemSelected;
    if (!box) return;
    box.textContent = "";
    const chips = [];
    if (state.difficultyMin && state.difficultyMax) {
      chips.push(
        selectedChip("难度 · " + difficultyRangeText(state.difficultyMin, state.difficultyMax), () => {
          ctx.api.pickDifficulty(ctx, state, 0);
        }, "清除难度筛选")
      );
    }
    for (const raw of state.tags) {
      const tag = catalogTag(raw);
      chips.push(
        selectedChip(tag ? tag.name : "#" + raw, () => {
          state.tags = state.tags.filter((id) => Number(id) !== Number(raw));
          state.activeIndex = 0;
          ctx.api.renderProblemFilters(ctx, state);
          ctx.api.load(ctx, state, 1, { force: true });
        }, "移除这个标签")
      );
    }
    if (state.content) {
      chips.push(
        selectedChip("搜索题面", () => {
          state.content = false;
          state.activeIndex = 0;
          ctx.api.renderProblemFilters(ctx, state);
          ctx.api.load(ctx, state, 1, { force: true });
        }, "不再搜索题面")
      );
    }
    box.hidden = !chips.length;
    if (!chips.length) return;
    box.appendChild(el("span", "lib-filter-caption", "已选"));
    for (const chip of chips) box.appendChild(chip);
    const clear = el("button", "lib-clear-filters", "清除筛选");
    clear.type = "button";
    clear.addEventListener("click", () => clearProblemFilters(ctx, state));
    box.appendChild(clear);
  }
  export function renderProblemFilters(ctx, state) {
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
    ctx.api.syncDiffBtn(ctx, state);
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
    renderProblemSelected(ctx, state);
  }
