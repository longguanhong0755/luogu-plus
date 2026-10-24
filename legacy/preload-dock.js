/* LuoguLab — 坞覆盖层预加载桥（R36） */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lgDock", {
  /* 外壳渲染好的坞 HTML + 整套主题变量（主进程转发） */
  onSync: (cb) => ipcRenderer.on("dock:sync", (_e, p) => cb(p || {})),
  /* 主进程落位后回报视图在窗口里的坐标：假壁纸几何要用 */
  onRect: (cb) => ipcRenderer.on("dock:rect", (_e, p) => cb(p || {})),
  /* 量到的胶囊尺寸（主进程据此把视图落到胶囊矩形） */
  size: (w, h) => ipcRenderer.send("dock:size", { w, h }),
  /* 坞项点击：href 原样回传，映射与导航全在主进程。
     opts.newTab = Ctrl/⌘+点或中键（书签语义：默认换当前页，R40） */
  cmd: (href, opts) =>
    ipcRenderer.send("dock:cmd", String(href || ""), { newTab: !!(opts && opts.newTab) }),
});
