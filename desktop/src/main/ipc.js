/* 所有 IPC 的登记处（主进程 handler + preload 暴露 + 本文件三处同步维护）。
   按域拆在 ./ipc/ 下，本文件只保留守卫安装、注册顺序与对外导出：
   guard 冒烟守卫 / state 状态快照与广播 / palette 命令面板候选 /
   app 状态·缓存·版本 / appearance 外观与壁纸 / settings 侧栏·通用·增强·通知 /
   nav 导航·命令面板·切换器 / library 题库 / page 页面与视图动作 / submit 提交与草稿 /
   account 签到与登录态。 */
const { installGuard } = require("./ipc/guard");
const { state, broadcastState } = require("./ipc/state");
const appDomain = require("./ipc/app");
const appearanceDomain = require("./ipc/appearance");
const settingsDomain = require("./ipc/settings");
const navDomain = require("./ipc/nav");
const libraryDomain = require("./ipc/library");
const pageDomain = require("./ipc/page");
const submitDomain = require("./ipc/submit");
const accountDomain = require("./ipc/account");

installGuard();

function registerIpc(ctx) {
  appDomain.register(ctx);
  appearanceDomain.register(ctx);
  settingsDomain.register(ctx);
  navDomain.register(ctx);
  libraryDomain.register(ctx);
  pageDomain.register(ctx);
  submitDomain.register(ctx);
  accountDomain.register(ctx);

  ctx.broadcastState = () => broadcastState(ctx);
}

module.exports = { registerIpc, broadcastState, state };
