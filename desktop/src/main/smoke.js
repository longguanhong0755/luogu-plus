/* 仅测试用：不可见冒烟启动、截图、皮肤/深色审计；以及演示数据。
   生产路径不会加载这里的逻辑（只有 --smoke / LG_DEMO 时调用）。
   实现按功能拆在 smoke/ 目录，入口只保留 runSmoke / seedDemo 两个导出。 */
const { runSmoke } = require("./smoke/run-smoke");
const { seedDemo } = require("./smoke/seed");

module.exports = { runSmoke, seedDemo };
