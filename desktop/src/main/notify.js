/* 通知与任务栏角标。通知只在窗口不在前台时弹，避免打扰正在做题的人。 */
const fs = require("node:fs");
const path = require("node:path");
const { Notification } = require("electron");
const { ASSETS } = require("./paths");

function createNotifier(ctx) {
  let trayHintShown = false;
  /* 比赛提醒：home.contest 是「下一场比赛」，start 前 leadMin 分钟弹系统通知。
     每场比赛只提醒一次（按 id 记账）；开关关闭时循环空转，开销可忽略。 */
  let contestTimer = null;
  let lastNotifiedContestId = null;

  function startContestWatch() {
    if (contestTimer) return;
    contestTimer = setInterval(() => {
      try {
        const cfg = ctx.cfg.get();
        if (!cfg.notify || !cfg.notify.contest) return;
        const lead = Math.max(1, Number(cfg.notify.contestLeadMin) || 10) * 60000;
        const contest = ctx.luogu && ctx.luogu.home && ctx.luogu.home.contest;
        if (!contest || !contest.id || contest.live || !contest.start) return;
        if (lastNotifiedContestId === contest.id) return;
        const remain = contest.start - Date.now();
        if (remain <= 0 || remain > lead) return;
        lastNotifiedContestId = contest.id;
        const minutes = Math.max(1, Math.round(remain / 60000));
        toast(
          "比赛快开始了",
          `${contest.name} 将在约 ${minutes} 分钟后开始。`
        );
      } catch {
        /* 循环内的任何异常都不该打断下一次检查 */
      }
    }, 30000);
  }

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

  startContestWatch();

  return { toast, hiddenToTray, judgeDone };
}

module.exports = { createNotifier };
