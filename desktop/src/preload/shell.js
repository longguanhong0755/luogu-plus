/* 外壳 preload：只暴露白名单 API，不把 ipcRenderer 交给页面。 */
const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// 网络状态由外壳的 online/offline 事件主动上报，主进程不再每 10 秒执行页面脚本轮询。
const reportOnline = () => {
  try {
    ipcRenderer.send("app:online", navigator.onLine !== false);
  } catch {
    /* ignore */
  }
};
window.addEventListener("online", reportOnline);
window.addEventListener("offline", reportOnline);
queueMicrotask(reportOnline);

contextBridge.exposeInMainWorld("lg", {
  getState: () => ipcRenderer.invoke("app:getState"),
  setAppearance: (patch) => ipcRenderer.invoke("app:setAppearance", patch),
  setRail: (patch) => ipcRenderer.invoke("app:setRail", patch),
  setRailPinned: (pinned) => ipcRenderer.invoke("app:railPin", pinned),
  toggleRailPinned: () => ipcRenderer.invoke("app:railPin"),
  setGeneral: (patch) => ipcRenderer.invoke("app:setGeneral", patch),
  setFeatures: (patch) => ipcRenderer.invoke("app:setFeatures", patch),
  setNotify: (patch) => ipcRenderer.invoke("app:setNotify", patch),
  pickWallpaper: () => ipcRenderer.invoke("app:pickWallpaper"),
  pickWallpaperDir: () => ipcRenderer.invoke("app:pickWallpaperDir"),
  pickWeRoot: () => ipcRenderer.invoke("app:pickWeRoot"),
  scanWe: (root) => ipcRenderer.invoke("app:scanWe", root),
  nextWallpaper: () => ipcRenderer.invoke("app:nextWallpaper"),
  nav: (target) => ipcRenderer.invoke("app:nav", target),
  library: (payload) => ipcRenderer.invoke("app:library", payload),
  libraryTags: () => ipcRenderer.invoke("app:libraryTags"),
  openDetail: (payload) => ipcRenderer.invoke("app:openDetail", payload),
  openCustom: (payload) => ipcRenderer.invoke("app:openCustom", payload),
  openWebFallback: (kind) => ipcRenderer.invoke("app:openWebFallback", kind),
  openProblem: (pid) => ipcRenderer.invoke("app:openProblem", pid),
  openUser: (uid) => ipcRenderer.invoke("app:openUser", uid),
  randomProblem: (payload) => ipcRenderer.invoke("app:randomProblem", payload),
  searchUsers: (keyword) => ipcRenderer.invoke("app:searchUsers", keyword),
  viewAction: (action) => ipcRenderer.invoke("app:viewAction", action),
  problemAction: (payload) => ipcRenderer.invoke("app:problemAction", payload),
  setIde: (on2) => ipcRenderer.invoke("app:setIde", on2),
  setIdeSplit: (ratio) => ipcRenderer.invoke("app:setIdeSplit", ratio),
  overlay: (open) => ipcRenderer.invoke("app:overlay", open),
  submit: (payload) => ipcRenderer.invoke("app:submit", payload),
  queueAction: (payload) => ipcRenderer.invoke("app:queueAction", payload),
  saveDraft: (payload) => ipcRenderer.invoke("app:saveDraft", payload),
  getDraft: (payload) => ipcRenderer.invoke("app:getDraft", payload),
  checkin: () => ipcRenderer.invoke("app:checkin"),
  refreshHome: () => ipcRenderer.invoke("app:refreshHome"),
  logout: () => ipcRenderer.invoke("app:logout"),
  palette: (query) => ipcRenderer.invoke("app:palette", query),
  switcher: () => ipcRenderer.invoke("app:switcher"),
  switchTo: (key) => ipcRenderer.invoke("app:switchTo", key),
  openSettings: () => ipcRenderer.invoke("app:openSettings"),
  command: (name) => ipcRenderer.invoke("app:command", name),
  onState: (callback) => on("app:state", callback),
  onCommand: (callback) => on("app:command", callback),
  onRailLayout: (callback) => on("rail:layout", callback),
  onPageFreeze: (callback) => on("page:freeze", callback),
  onToast: (callback) => on("app:toast", callback),
  onWindowFocus: (callback) => on("app:window-focus", callback),
});
