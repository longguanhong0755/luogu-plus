/* 难度范围下拉：单级/区间切换（与网页版一致，点区间内部从更近一端收缩）。 */
import { icon } from "../icons.js";
import { difficultyRangeText, el, encodeDifficulty } from "./utils.js";

/* 同一时刻最多只有一个列表的难度下拉是展开的，所以放在模块级共享。 */
let openDiffState = null;

  export function diffItem(ctx, state, level, label, color) {
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
      pickDifficulty(ctx, state, level);
      if (!level) closeDiffMenu(ctx, state);
    });
    return btn;
  }
  export function syncDiffBtn(ctx, state) {
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
  export function closeDiffMenu(ctx, state) {
    if (state && state.dom.problemDiffMenu) state.dom.problemDiffMenu.hidden = true;
    if (openDiffState === state) openDiffState = null;
    syncDiffBtn(ctx, state);
  }
  export function pickDifficulty(ctx, state, level) {
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
    ctx.api.renderProblemFilters(ctx, state);
    ctx.api.load(ctx, state, 1, { force: true });
  }
/* 展开/收起难度下拉：原来内联在 buildProblemBar 的点击处理里，openDiffState 归本模块管。 */
export function toggleDiffMenu(ctx, state) {
  const diffMenu = state.dom.problemDiffMenu;
  const willOpen = diffMenu.hidden;
  if (openDiffState && openDiffState !== state) closeDiffMenu(ctx, openDiffState);
  if (willOpen) {
    diffMenu.hidden = false;
    openDiffState = state;
    const current = diffMenu.querySelector(".lib-diff-item.on");
    if (current) current.focus();
  } else {
    closeDiffMenu(ctx, state);
  }
  syncDiffBtn(ctx, state);
}

/* 切列表页时把所有展开的难度下拉收起。 */
export function closeOpenDiffMenu(ctx) {
  if (openDiffState) closeDiffMenu(ctx, openDiffState);
}

/* 点在下拉之外时收起（全局 click 监听用）。 */
export function resolveDiffOutsideClick(ctx, event) {
  const state = openDiffState;
  if (!state) return;
  const wrap = state.dom.problemDiffWrap;
  if (wrap && wrap.contains(event.target)) return;
  closeDiffMenu(ctx, state);
}
