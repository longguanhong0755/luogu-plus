/* 主进程上下文与全局 webContents 兜底策略。 */
const config = require("../config");

function createContext() {
  return {
    cfg: config,
    smoke: process.argv.includes("--smoke"),
    theme: null,
    wallpaper: { kind: "builtin", url: "" },
    store: null,
  };
}

function installWebContentsDefaults(app) {
  /* 全局兜底：任何 webContents（含未来新增宿主）默认拒绝 window.open 与
     webview 挂载；具体宿主后续自行 set 的 handler 会覆盖这里的最严默认。 */
  app.on("web-contents-created", (_event, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
  });
}

module.exports = { createContext, installWebContentsDefaults };
