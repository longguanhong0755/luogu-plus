/* 页面视图管理：薄入口，只做装配与再导出（实现按域拆在 ./views/ 目录）。
   - 原生列表（题库/训练/比赛/记录/讨论/文章）不创建 WebContentsView，由渲染层直接画；
   - 网页页面（聊天/通知、题面、文章详情等）各自一个 WebContentsView；
   - 题目多开、详情页与总条目都有 LRU 上限，空闲页面休眠释放。
   模块地图：util.js 纯函数与容量常量 / manager.js 类骨架 / rail.js 侧栏宽度与
   工作区几何 / navigation.js 入口导航 / submit.js 提交辅助 / capture.js 题面快照 /
   overlay.js 覆盖层冻结帧 / info.js 打开列表与当前页状态 / entry.js 条目创建 /
   wire.js 事件接线 / input.js 页内快捷键 / context.js 右键菜单与外开策略 /
   lifecycle.js 显示休眠唤醒 / evict.js LRU 与最近关闭栈 / skin.js 皮肤注入 /
   adblock.js 广告拦截标记。
   两条跨模块契约（各自只在唯一位置实现）：
   - 侧栏宽度是单一状态源，全仓只有 views/rail.js 通过侧栏通道推送一次宽度；
     外壳与页面 View 都听同一条通道，别处不要再自己发。
   - 站外链接唯一出口是 external 模块，views/navigation.js 与 views/context.js
     都从那里取 safeOpenExternal，全仓不许直接调用 Electron 的外开接口。
*/
const { ViewManager } = require("./views/manager");
const { NAV, LIBRARY_IDS } = require("./sections");
const { isLuoguUrl, pidFromUrl, cleanTitle, sectionOfUrl } = require("./views/util");

Object.assign(
  ViewManager.prototype,
  require("./views/rail"),
  require("./views/navigation"),
  require("./views/submit"),
  require("./views/capture"),
  require("./views/overlay"),
  require("./views/info"),
  require("./views/entry"),
  require("./views/wire"),
  require("./views/input"),
  require("./views/context"),
  require("./views/lifecycle"),
  require("./views/evict"),
  require("./views/skin"),
  require("./views/adblock")
);

module.exports = {
  ViewManager,
  NAV,
  LIBRARY_IDS,
  isLuoguUrl,
  pidFromUrl,
  cleanTitle,
  sectionOfUrl,
};
