/* 通知与任务栏角标。通知只在窗口不在前台时弹，避免打扰正在做题的人。 */
const fs = require("node:fs");
const path = require("node:path");
const { Notification } = require("electron");
const { ASSETS } = require("./paths");

function createNotifier(ctx) {
  let trayHintShown = false;

  function toast(title, body) {
    if (!Notification.isSupported()) return;
    try {
      new Notification({ title: String(title), body: String(body || "") }).show();
    } catch (err) {
      console.error("[notify]", err.message);
    }
  }

  function hiddenToTray() {
    if (trayHintShown) return;
    trayHintShown = true;
    if (ctx.tray && typeof ctx.tray.displayBalloon === "function") {
      try {
        ctx.tray.displayBalloon({
          title: "洛谷桌面版还在运行",
          content: "窗口已收进托盘；右键托盘图标可以签到或退出。",
        });
      } catch {
        /* ignore */
      }
    }
  }

  function judgeDone(kind) {
    const win = ctx.win;
    if (!win || win.isDestroyed()) return;
    const file = path.join(ASSETS, kind === "ac" ? "overlay-ac.png" : "overlay-wa.png");
    try {
      if (fs.existsSync(file)) {
        win.setOverlayIcon(file, kind === "ac" ? "Accepted" : "未通过");
        setTimeout(() => {
          if (!win.isDestroyed()) win.setOverlayIcon(null, "");
        }, 8000);
      }
    } catch {
      /* ignore */
    }
  }

  return { toast, hiddenToTray, judgeDone };
}

module.exports = { createNotifier };
