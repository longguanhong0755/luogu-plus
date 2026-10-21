/* LuoguLab — 本地页（设置 / 首页 / 历史）预加载桥 */
const { contextBridge, ipcRenderer } = require("electron");

/* 本地页同样要吃壁纸玻璃：inject.js 的壁纸管线认 window.lgApp.wallImage /
   wallVideo（与站点页的 preload-page.js 同名同协议），这里给一份同款。 */
contextBridge.exposeInMainWorld("lgApp", {
  wallImage: () => ipcRenderer.invoke("lg-wall:image"),
  wallVideo: () => ipcRenderer.invoke("lg-wall:video"),
  zoomBy: (dir) => ipcRenderer.invoke("lg-app:zoom", dir > 0 ? 1 : -1),
  /* 壁纸视差：本地页鼠标位置（已节流）经主进程转发给外壳层 */
  parallax: (x, y) => ipcRenderer.send("lg-wall:parallax", { x, y }),
});

contextBridge.exposeInMainWorld("lgConfig", {
  get: () => ipcRenderer.invoke("lg-config:get"),
  set: (patch) => ipcRenderer.invoke("lg-config:set", patch),
  presets: () => ipcRenderer.invoke("lg-config:presets"),
  shortcuts: () => ipcRenderer.invoke("lg-config:shortcuts"),
  pickWallpaper: () => ipcRenderer.invoke("lg-config:pick-wallpaper"),
  clearWallpaper: () => ipcRenderer.invoke("lg-config:clear-wallpaper"),
  /* 壁纸集合：多选导入 / 选择 / 删除 / 模式与轮换 / 手动下一张 / 去重 */
  wallList: () => ipcRenderer.invoke("lg-wall:list"),
  wallImport: () => ipcRenderer.invoke("lg-wall:import"),
  wallSelect: (p) => ipcRenderer.invoke("lg-wall:select", p),
  wallRemove: (p) => ipcRenderer.invoke("lg-wall:remove", p),
  wallMode: (mode, rotateMin) => ipcRenderer.invoke("lg-wall:mode", { mode, rotateMin }),
  wallNext: () => ipcRenderer.invoke("lg-wall:next"),
  wallDedupe: () => ipcRenderer.invoke("lg-wall:dedupe"),
  reset: () => ipcRenderer.invoke("lg-config:reset"),
  relaunch: () => ipcRenderer.invoke("lg-app:relaunch"),
  /* 历史 / 下载 */
  historyList: (query) => ipcRenderer.invoke("lg-history:list", query),
  historyRemove: (p) => ipcRenderer.invoke("lg-history:remove", p),
  historyClear: () => ipcRenderer.invoke("lg-history:clear"),
  downloadList: () => ipcRenderer.invoke("lg-download:list"),
  downloadReveal: (id) => ipcRenderer.invoke("lg-download:reveal", id),
  downloadClear: () => ipcRenderer.invoke("lg-download:clear"),
  downloadPause: (id) => ipcRenderer.invoke("lg-download:pause", id),
  downloadResume: (id) => ipcRenderer.invoke("lg-download:resume", id),
  downloadCancel: (id) => ipcRenderer.invoke("lg-download:cancel", id),
  downloadRetry: (id) => ipcRenderer.invoke("lg-download:retry", id),
  downloadSaveAs: (id) => ipcRenderer.invoke("lg-download:save-as", id),
  downloadRemove: (id) => ipcRenderer.invoke("lg-download:remove", id),
  /* 清除浏览数据（缓存 / Cookie / 历史 / 下载记录） */
  clearData: (opts) => ipcRenderer.invoke("lg-app:clear-data", opts),
  openSettings: () => ipcRenderer.invoke("lg-app:open-settings"),
  openHome: () => ipcRenderer.invoke("lg-app:open-home"),
  openHistory: () => ipcRenderer.invoke("lg-app:open-history"),
  openUrl: (url) => ipcRenderer.invoke("lg-app:open-url", url),
  /* 诊断报告：给用户一个"把当前状态打包给维护者"的出口。
     此前出了问题只能靠描述复现，拿到的是猜测不是事实。 */
  diagnostics: () => ipcRenderer.invoke("lg-app:diagnostics"),
  diagnosticsSave: () => ipcRenderer.invoke("lg-app:diagnostics-save"),
  /* 首页快捷入口的 @ide 项：打开/切到 IDE 标签页（与 dock 同一动作） */
  ide: () => ipcRenderer.invoke("tab:toggle-ide"),
  /* 洛谷近期比赛（主进程定时抓取的缓存；抓到后主进程会推一次，
     首页不用等下一次刷新） */
  contests: () => ipcRenderer.invoke("lg-app:contests"),
  onContests: (cb) => {
    try {
      ipcRenderer.on("lg-contests", (_e, data) => { try { cb(data); } catch (err) {} });
    } catch (err) {}
  },
  /* 账号 */
  accountList: () => ipcRenderer.invoke("lg-account:list"),
  accountAdd: (email, password) => ipcRenderer.invoke("lg-account:add", { email, password }),
  accountAnswer: (code) => ipcRenderer.invoke("lg-account:answer", code),
  accountCancel: () => ipcRenderer.invoke("lg-account:cancel"),
  accountRemove: (id) => ipcRenderer.invoke("lg-account:remove", id),
  accountSwitch: (id) => ipcRenderer.invoke("lg-account:switch", id),
});
