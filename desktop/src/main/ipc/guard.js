/* 冒烟裁决守卫（smoke-guard.js 纯模块）：handler 异常即打 SMOKE_FAIL，
   裁决洞 #1/#2 全闭合；生产模式零改动。 */
const { ipcMain } = require("electron");

/* 出包会剥离 smoke-guard.js，因此这里不能裸 require：缺失时按「无守卫」降级，
   否则整包启动即 Error 弹窗（v0.7.15 便携包曾因此无法启动）。 */
function installGuard() {
  let guardIpcMain = null;
  try {
    ({ guardIpcMain } = require("../smoke-guard"));
  } catch {
    guardIpcMain = null;
  }
  if (typeof guardIpcMain === "function") guardIpcMain(ipcMain, process.env.LG_SMOKE === "1");
}

module.exports = { installGuard };
