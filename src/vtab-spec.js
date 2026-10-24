/* ============================================================
   垂直标签栏几何唯一来源（Edge 149 实测，CSS px @100%）
   主进程（main.js）与外壳（chrome.js）都读这一份；chrome.css 只吃变量，
   不再各写一套 212/46/34。实测证据见 dev/edge-vtab-spec.md。
   ============================================================ */
(function (root, factory) {
  const spec = factory();
  if (typeof module === "object" && module.exports) module.exports = spec;
  if (root) (/** @type {any} */ (root)).LG_VTAB_SPEC = spec;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    /* 面板与窄条 */
    paneW: 248,        // 展开态总宽（含右缘 1px 发丝线）
    railW: 41,         // 窄条总宽（40 内容 + 1px 线）
    edgeW: 4,          // 紧凑模式左缘热区
    minW: 160,         // 拖宽下限
    maxW: 400,         // 拖宽上限
    /* 顶栏 */
    topBarH: 80,       // 标题行 40 + 工具行 40
    titleH: 40,
    navH: 40,
    /* 面板头部：4 内边距 + 32 按钮 + 4 */
    headerH: 40,
    headerBtn: 32,
    headerPad: 4,
    /* 标签列表 / 行 */
    listTop: 40,       // = headerH
    tabH: 32,
    tabInsetX: 4,
    tabW: 240,         // paneW - tabInsetX * 2
    closeSize: 16,
    closeTop: 8,
    closeRight: 8,
    newTabGap: 9,
    resizeW: 4,
    radius: 4,
    font: 12,
  };
});
