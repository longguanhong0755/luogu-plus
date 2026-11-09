/* 列表行容器：加载骨架、登录/失败/空态、缓存横幅、行装配与键盘选中滚动。 */
import { icon } from "../icons.js";
import { fmtNum, el } from "./utils.js";
  export function banner(kind, text) {
    const node = el("div", kind === "error" ? "lib-banner" : "lib-stale");
    node.innerHTML = icon(kind === "error" ? "alert" : "wifiOff");
    node.appendChild(el("span", "", text));
    return node;
  }
  export function skeletonRows() {
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
  export function setActive(ctx, state, index, scroll) {
    const items = ctx.api.visibleItems(state);
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
  export function renderRows(ctx, state) {
    const list = state.dom.list;
    if (!list) return;
    list.textContent = "";
    list.setAttribute("aria-busy", state.loading ? "true" : "false");

    if (state.loading && !state.items.length) {
      if (state.loadingVisible) list.appendChild(skeletonRows());
      ctx.api.renderFoot(ctx, state);
      return;
    }
    if (state.needLogin) {
      const box = el("div", "lib-login");
      box.appendChild(el("div", "lib-login-title", "登录后查看提交记录"));
      box.appendChild(el("div", "lib-login-text", "记录需要洛谷账号，登录一次即可长期保持。"));
      const btn = el("button", "sign-btn", "登录洛谷");
      btn.type = "button";
      btn.addEventListener("click", () => ctx.actions.login());
      box.appendChild(btn);
      list.appendChild(box);
      ctx.api.renderFoot(ctx, state);
      return;
    }
    if (state.error && !state.items.length) {
      const box = el("div", "lib-state");
      box.innerHTML = icon("alert");
      box.appendChild(el("strong", "", "加载失败"));
      box.appendChild(el("span", "", state.error));
      const btn = el("button", "lib-retry", "重试");
      btn.type = "button";
      btn.addEventListener("click", () => ctx.api.load(ctx, state, 1, { force: true }));
      box.appendChild(btn);
      list.appendChild(box);
      ctx.api.renderFoot(ctx, state);
      return;
    }

    const items = ctx.api.visibleItems(state);
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
      ctx.api.renderFoot(ctx, state);
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
      const row = ctx.api.rowFor(ctx, state, item);
      row.id = "lib-opt-" + state.kind + "-" + index;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === state.activeIndex ? "true" : "false");
      row.tabIndex = -1;
      // 鼠标左键直接打开（此前只有键盘 Enter 能开，行却有 pointer/hover 样式——纯误导）
      row.addEventListener("click", () => {
        setActive(ctx, state, index, false);
        open(ctx, item);
      });
      if (index === state.activeIndex) row.classList.add("active");
      list.appendChild(row);
    });
    ctx.api.renderFoot(ctx, state);

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
  export function open(ctx, item) {
    if (item.type === "problem") {
      ctx.actions.openProblem(item.pid);
    } else if (item.type === "training") {
      ctx.actions.openDetail({ url: `/training/${item.id}`, title: item.title });
    } else if (item.type === "contest") {
      ctx.actions.openDetail({ url: `/contest/${item.id}`, title: item.title });
    } else if (item.type === "discuss") {
      ctx.actions.openDetail({ url: `/discuss/${item.id}`, title: item.title });
    } else if (item.type === "article") {
      ctx.actions.openDetail({ url: `/article/${item.id}`, title: item.title });
    } else if (item.type === "record" && item.id) {
      ctx.actions.openDetail({ url: `/record/${item.id}`, title: `${item.pid} 提交记录` });
    }
  }
