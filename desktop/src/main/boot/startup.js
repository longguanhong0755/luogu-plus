/* 启动前（app ready 之前）必须完成的开关、路径与协议特权 + 单实例锁。
   顺序与拆分前完全一致：命令行开关 → 任务栏身份 → UA → 退出标记 →
   lgoff 协议特权 → 冒烟软件渲染 → userData 路径 → 单实例锁。 */
const { APP_USER_MODEL_ID } = require("../window");
const { UA } = require("./constants");

function configure(app, protocol) {
  // 桌面端以显式页面 View 管理历史；关闭 Chromium 整页 BFCache，
  // 避免隐藏页面长期保留完整渲染树和 JS 堆。
  app.commandLine.appendSwitch(
    "disable-features",
    "BackForwardCache,WebAuthenticationConditionalUI,WebAuthenticationPasskeyAutofill"
  );
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.userAgentFallback = UA;
  app.quitting = false;

  /* 离线快照协议：lgoff://problem/<PID>。必须在 ready 之前注册特权。 */
  protocol.registerSchemesAsPrivileged([
    { scheme: "lgoff", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);

  if (process.argv.includes("--smoke")) app.disableHardwareAcceleration();

  if (process.env.LG_USERDATA) {
    app.setPath("userData", process.env.LG_USERDATA);
  }
}

function acquireSingleInstanceLock(app) {
  return app.requestSingleInstanceLock();
}

module.exports = { configure, acquireSingleInstanceLock };
