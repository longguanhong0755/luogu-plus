/* 系统托盘：左键显隐主窗；右键菜单 打开/签到/设置/退出。 */
const path = require("node:path");
const { Tray, Menu, nativeImage, app } = require("electron");
const { ASSETS } = require("./paths");

function createTray(ctx) {
  const image = nativeImage.createFromPath(path.join(ASSETS, "tray.png"));
  const tray = new Tray(image);
  tray.setToolTip("洛谷桌面版");

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开洛谷",
        click: () => {
          ctx.showWindow();
          if (ctx.views) ctx.views.showHome();
        },
      },
      {
        label: "固定到任务栏",
        click: async () => {
          const result = ctx.pinTaskbar ? await ctx.pinTaskbar() : { ok: false, message: "任务栏固定尚未就绪。" };
          if (ctx.toast) ctx.toast("任务栏", result.message || (result.ok ? "已发送固定请求。" : "固定失败。"));
        },
      },
      {
        label: "题库",
        click: () => {
          ctx.showWindow();
          if (ctx.views) ctx.views.showLibrary("problems");
        },
      },
      {
        label: "今日签到",
        click: async () => {
          ctx.showWindow();
          const result = await ctx.luogu.checkin();
          if (result.ok) {
            ctx.toast("签到", result.already ? "今天已经签过了。" : "签到成功。");
          } else {
            ctx.toast("签到", result.message || "签到没有成功。");
          }
        },
      },
      {
        label: "换一张壁纸",
        click: () => {
          ctx.nextWallpaper().catch(() => {});
        },
      },
      { type: "separator" },
      { label: "设置", click: () => ctx.openSettings() },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.quitting = true;
          app.quit();
        },
      },
    ])
  );

  tray.on("click", () => {
    if (ctx.win && !ctx.win.isDestroyed() && ctx.win.isVisible() && ctx.win.isFocused()) {
      ctx.win.hide();
    } else {
      ctx.showWindow();
    }
  });

  return tray;
}

module.exports = { createTray };
