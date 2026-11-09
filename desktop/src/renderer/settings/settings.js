/* 设置窗口：改动即时生效（无保存按钮），所有状态以主进程广播为准。
   实现按域拆到同目录 settings/，入口只负责启动与错误兜底。 */
import { fatal } from "../shared/fatal.js";
import { boot } from "./settings/boot.js";

boot().catch((err) => {
  console.error(err);
  fatal("设置初始化失败", err.message);
});
