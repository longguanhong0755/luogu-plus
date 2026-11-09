/* 非题库列表的筛选胶囊（比赛/记录）与「当前应显示哪些行」的过滤口径。 */
import { contestState, el } from "./utils.js";
  export function renderFilters(ctx, state) {
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
          ctx.api.load(ctx, state, 1, { force: true });
        } else {
          if (state.filter === value) return;
          state.filter = value;
          state.activeIndex = 0;
          renderFilters(ctx, state);
          ctx.api.renderRows(ctx, state);
        }
      });
      filters.appendChild(chip);
    }
  }
  export function visibleItems(state) {
    if (state.kind === "contest" && state.filter !== "all") {
      return state.items.filter((item) => contestState(item) === state.filter);
    }
    if (state.kind === "record" && state.filter !== "all") {
      return state.items.filter((item) => (state.filter === "ac" ? item.status === 12 : item.status !== 12));
    }
    return state.items;
  }
