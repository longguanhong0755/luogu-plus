/* 覆盖层：Ctrl+K 全局直达 + Ctrl+Tab 页面切换器。
   打开时由主进程把页面视图隐藏，覆盖层画在内容区之上。 */

/* 实现按域拆在同目录 overlays/，入口只做再导出。 */
export { initOverlays } from "./overlays/init.js";
