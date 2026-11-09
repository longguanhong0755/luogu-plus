/* 列表区装配：各实现模块共享一个上下文 ctx，跨模块调用统一走 ctx.api。
   这样实现文件之间不必互相 import，也就不会出现 ES module 循环引用。 */
import * as difficulty from "./difficulty.js";
import * as filters from "./filters.js";
import * as footer from "./footer.js";
import * as load from "./load.js";
import * as problemBar from "./problem-bar.js";
import * as rowView from "./row-view.js";
import * as rows from "./rows.js";
import * as shellView from "./shell-view.js";
import * as state from "./state.js";
import * as tagCatalogView from "./tag-catalog-view.js";
import * as tagModal from "./tag-modal.js";

export function initLibrary(actions) {
  const ctx = {
    actions,
    root: document.getElementById("library"),
    store: new Map(),
    currentKind: "",
    current: null,
    lastSignature: "",
    api: {},
  };
  Object.assign(
    ctx.api,
    difficulty,
    filters,
    footer,
    load,
    problemBar,
    rowView,
    rows,
    shellView,
    state,
    tagCatalogView,
    tagModal
  );

  document.addEventListener("click", (event) => ctx.api.resolveDiffOutsideClick(ctx, event));

  return {
    update: (appState) => state.update(ctx, appState),
    show: (kind, appState) => state.show(ctx, kind, appState),
  };
}
