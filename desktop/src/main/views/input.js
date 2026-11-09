/* 页内快捷键：以页面视图为焦点时保持与外壳一致的浏览器键位。 */
const { acceleratorMatches } = require("./util");

module.exports = {
  wireInput(entry) {
    const wc = entry.view.webContents;

    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      const key = input.key.toLowerCase();
      let command = "";
      if (ctrl && !input.shift && key === "k") command = "palette";
      else if (ctrl && !input.shift && key === "l") command = "jump";
      else if (ctrl && !input.shift && key === "b") command = "railPin";
      else if (ctrl && !input.shift && key === "u" && this.ctx.cfg.get().features.userSearch) command = "userSearch";
      else if (ctrl && input.key === "Tab") command = "switcher";
      else if (ctrl && input.shift && key === "t") command = "reopen";
      else if (ctrl && (input.key === "," || input.key === "，")) command = "settings";
      else if (input.key === "F11") command = "fullscreen";
      else if (input.key === "F12") command = "devtools";
      else if (input.key === "F6") command = input.shift ? "focusPage" : "focusRail";
      // 浏览器基本键：刷新 / 后退 / 前进 / 关页面（与浏览器同键位）
      else if (input.key === "F5" || (ctrl && !input.shift && key === "r")) command = "reload";
      else if (input.alt && input.key === "ArrowLeft") command = "back";
      else if (input.alt && input.key === "ArrowRight") command = "forward";
      else if (this.ctx.cfg.get().features.shortcuts && acceleratorMatches(input, this.ctx.cfg.get().general.shortcutOpenProblems)) command = "problems";
      else if (ctrl && !input.shift && key === "w") command = "closepage";
      else if (ctrl && !input.shift && key === "f") command = "find";
      else if (ctrl && !input.shift && (input.key === "=" || input.key === "+")) command = "zoomin";
      else if (ctrl && !input.shift && input.key === "-") command = "zoomout";
      else if (ctrl && !input.shift && input.key === "0") command = "zoomreset";
      if (!command) return;
      if (command === "railPin" && input.isAutoRepeat) return;
      event.preventDefault();
      // 查找/缩放是页面级能力，直接操作当前页面视图，不走全局命令路由
      if (command === "find") {
        const entry = this.currentEntry();
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          entry.view.webContents.send("app:find-open");
        }
        return;
      }
      if (command === "zoomin" || command === "zoomout" || command === "zoomreset") {
        const entry = this.currentEntry();
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          const wc = entry.view.webContents;
          entry.zoom =
            command === "zoomreset" ? 0 : Math.max(-3.5, Math.min(3, (entry.zoom || 0) + (command === "zoomin" ? 0.2 : -0.2)));
          wc.setZoomLevel(entry.zoom);
          const pct = Math.round(Math.pow(1.2, entry.zoom) * 100);
          wc.send("app:zoom-hud", pct + "%");
        }
        return;
      }
      this.ctx.command && this.ctx.command(command);
    });
  },
};
