/* 列表分页脚：页码按钮、页码快速跳转与「第 x / y 页」提示。 */
import { el } from "./utils.js";
  export function renderFoot(ctx, state) {
    const foot = state.dom.foot;
    if (!foot) return;
    foot.textContent = "";
    if (!state.page || !state.total) return;
    const refreshingExisting = state.loading && state.items.length > 0;

    const perPage = state.perPage || state.items.length;
    if (!perPage) return;
    const knownPages = Math.max(1, Math.ceil(state.total / perPage));
    // 记录列表的 count 偶发不可用：hasMore 为真时至少保留下一页入口。
    const totalPages = state.hasMore ? Math.max(state.page + 1, knownPages) : knownPages;
    if (totalPages <= 1) return;

    /* 翻页与页码跳转共用的入口：先过 loading 与同页去重，再交给列表加载器。 */
    const load = (state, page) => ctx.api.load(ctx, state, page);

    const nav = el("nav", "lib-pages");
    nav.setAttribute("aria-label", "列表分页");

    const addButton = (label, page, options = {}) => {
      const btn = el("button", "lib-page" + (options.edge ? " edge" : ""), label);
      btn.type = "button";
      if (options.current) {
        btn.classList.add("current");
        btn.setAttribute("aria-current", "page");
        btn.setAttribute("aria-label", `第 ${page} 页，当前页`);
      } else {
        btn.setAttribute("aria-label", typeof page === "number" ? `第 ${page} 页` : label);
      }
      if (options.disabled) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
      } else {
        btn.addEventListener("click", () => {
          if (!state.loading && page !== state.page) load(state, page);
        });
      }
      nav.appendChild(btn);
    };

    addButton("上一页", Math.max(1, state.page - 1), { edge: true, disabled: state.page <= 1 });

    const wanted = new Set([1, totalPages, state.page - 2, state.page - 1, state.page, state.page + 1, state.page + 2]);
    const pages = [...wanted].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) {
        nav.appendChild(el("span", "lib-page-gap", "…"));
      }
      addButton(String(page), page, { current: page === state.page });
      previous = page;
    }

    addButton("下一页", Math.min(totalPages, state.page + 1), {
      edge: true,
      disabled: state.page >= totalPages,
    });
    foot.appendChild(nav);
    const jump = el("form", "lib-jump");
    jump.setAttribute("aria-label", "快速跳转页码");
    jump.appendChild(el("label", "lib-jump-label", "跳至"));
    const input = el("input", "lib-jump-input");
    input.type = "number";
    input.min = "1";
    input.max = String(totalPages);
    input.step = "1";
    input.value = String(state.page);
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("aria-label", `页码，范围 1 到 ${totalPages}`);
    const submit = el("button", "lib-page lib-jump-go", "GO");
    submit.type = "submit";
    submit.setAttribute("aria-label", "跳转到输入页码");
    jump.addEventListener("submit", (event) => {
      event.preventDefault();
      const page = Math.trunc(Number(input.value));
      if (!Number.isFinite(page) || page < 1 || page > totalPages) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      if (!state.loading && page !== state.page) load(state, page);
    });
    input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
    jump.append(input, submit);
    foot.appendChild(jump);
    foot.appendChild(el("span", "lib-page-total", `第 ${state.page} / ${totalPages} 页`));
    if (refreshingExisting) foot.appendChild(el("span", "lib-loading", "更新中…"));
  }
