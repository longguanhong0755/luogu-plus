/* 设置窗口 preload：外观/通用/通知/账号四组能力。 */
const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("lgSettings", {
  getState: () => ipcRenderer.invoke("app:getState"),
  setAppearance: (patch) => ipcRenderer.invoke("app:setAppearance", patch),
  setRail: (patch) => ipcRenderer.invoke("app:setRail", patch),
  resetRail: () => ipcRenderer.invoke("app:resetRail"),
  setGeneral: (patch) => ipcRenderer.invoke("app:setGeneral", patch),
  setNotify: (patch) => ipcRenderer.invoke("app:setNotify", patch),
  pickWallpaper: () => ipcRenderer.invoke("app:pickWallpaper"),
  pickWallpaperDir: () => ipcRenderer.invoke("app:pickWallpaperDir"),
  pickWeRoot: () => ipcRenderer.invoke("app:pickWeRoot"),
  scanWe: (root) => ipcRenderer.invoke("app:scanWe", root),
  nextWallpaper: () => ipcRenderer.invoke("app:nextWallpaper"),
  nav: (target) => ipcRenderer.invoke("app:nav", target),
  logout: () => ipcRenderer.invoke("app:logout"),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  onState: (callback) => on("app:state", callback),
});
