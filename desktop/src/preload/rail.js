/* 悬停侧栏浮层的 preload：只暴露导航需要的白名单 API。
   浮层是独立 WebContentsView，不能复用外壳的 window.lg，所以单独一份。 */
const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("lgRail", {
  getState: () => ipcRenderer.invoke("app:getState"),
  nav: (target) => ipcRenderer.invoke("app:nav", target),
  openProblem: (pid) => ipcRenderer.invoke("app:openProblem", pid),
  openCustom: (payload) => ipcRenderer.invoke("app:openCustom", payload),
  openSettings: () => ipcRenderer.invoke("app:openSettings"),
  setRailPinned: (pinned) => ipcRenderer.invoke("app:railPin", pinned),
  railHover: (payload) => ipcRenderer.invoke("app:railHover", payload),
  onState: (callback) => on("app:state", callback),
  onFocus: (callback) => on("rail:focus", callback),
});
