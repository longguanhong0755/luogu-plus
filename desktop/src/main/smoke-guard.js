/* 冒烟裁决守卫（纯函数，可被 check.js 无 Electron 单测）：
   仅在 LG_SMOKE=1 时把 ipcMain 的 handle/on 包一层——handler 抛错即打
   SMOKE_FAIL ipc:<频道>（Electron 内部日志不带标记，启动器扫不到的假 PASS
   根因），然后 rethrow 保语义。生产模式零改动。 */
function guardIpcMain(ipcMain, enabled) {
  if (!enabled) return ipcMain;
  const wrap = (channel, fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error("SMOKE_FAIL ipc:" + channel + " " + String((err && err.message) || err).slice(0, 140));
      throw err;
    }
  };
  const origHandle = ipcMain.handle.bind(ipcMain);
  const origOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, fn) => origHandle(channel, wrap(channel, fn));
  ipcMain.on = (channel, fn) => origOn(channel, wrap(channel, fn));
  return ipcMain;
}

module.exports = { guardIpcMain };
