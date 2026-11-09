/* 账号域 IPC：签到、首页刷新与退出登录。 */
const { ipcMain } = require("electron");
const { broadcastState, state } = require("./state");

function register(ctx) {
  ipcMain.handle("app:checkin", async () => {
    const result = await ctx.luogu.checkin();
    if (result.ok) ctx.toast("签到", result.already ? "今天已经签过了。" : "签到成功。");
    else if (result.uncertain) ctx.toast("签到状态待确认", result.message || "请刷新主页确认今日签到状态。");
    else ctx.toast("签到没有成功", result.message || "没找到签到入口，稍后再试一次。");
    return result;
  });

  ipcMain.handle("app:refreshHome", async () => {
    const data = await ctx.luogu.refresh(true);
    broadcastState(ctx);
    return data;
  });

  ipcMain.handle("app:logout", async () => {
    await ctx.luogu.logout();
    ctx.views.showHome();
    return state(ctx);
  });
}

module.exports = { register };
