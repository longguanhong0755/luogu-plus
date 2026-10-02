/* LuoguLab — 标签悬停卡片的预加载桥
   卡片是独立的小 WebContentsView（站点视图盖住外壳，外壳里画的卡片会被网页
   吃掉）。这里只暴露"收一份内容"，不持有任何状态。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lgTip", {
  onShow: (cb) => ipcRenderer.on("tabtip:show", (_e, p) => cb(p)),
  version: "1",
});
