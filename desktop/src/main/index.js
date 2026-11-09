/* 主进程入口：生命周期、单实例、窗口/视图/托盘/通知的装配。
   业务能力在各自模块里，这里只做连线；实现按域拆在 ./boot/ 目录。
   模块地图：constants.js 常量 / cache.js Web 缓存维护 / startup.js ready 前开关与单实例锁 /
   context.js 上下文与全局兜底 / core.js 配置·store·主题·壁纸 / session.js 洛谷分区会话与下载 /
   offline.js 离线快照协议 / shell.js 窗口·视图·托盘·通知·IPC 装配 /
   messaging.js 状态广播·toast·窗口命令 / appearance.js 外观刷新与壁纸轮换 /
   commands.js 命令分发与首页刷新 / window-events.js 窗口事件与后台释放 /
   tasks.js 缓存维护与启动收尾 / lifecycle.js 退出与二次实例 / crash.js 崩溃落盘。 */
const { app, protocol } = require("electron");

const startup = require("./boot/startup");
const { createContext, installWebContentsDefaults } = require("./boot/context");
const { initCore } = require("./boot/core");
const { setupSession } = require("./boot/session");
const { registerOfflineProtocol } = require("./boot/offline");
const { mountShell } = require("./boot/shell");
const { installMessaging } = require("./boot/messaging");
const { installAppearance } = require("./boot/appearance");
const { installCommands } = require("./boot/commands");
const { installWindowEvents } = require("./boot/window-events");
const { finishReady } = require("./boot/tasks");
const { installLifecycle } = require("./boot/lifecycle");

startup.configure(app, protocol);

const gotLock = startup.acquireSingleInstanceLock(app);
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  const ctx = createContext();

  /* 全局兜底：任何 webContents（含未来新增宿主）默认拒绝 window.open 与
     webview 挂载；具体宿主后续自行 set 的 handler 会覆盖这里的最严默认。 */
  installWebContentsDefaults(app);

  app.whenReady().then(async () => {
    await initCore(ctx);
    setupSession(ctx);
    // lgoff 离线协议要同时挂在默认 session 和洛谷分区 session 上（页面视图用后者）
    registerOfflineProtocol(ctx);
    mountShell(ctx);
    installMessaging(ctx);
    installAppearance(ctx);
    installCommands(ctx);
    installWindowEvents(ctx);
    finishReady(ctx);
  });

  installLifecycle(app, ctx);
}
