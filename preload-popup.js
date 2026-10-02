/* LuoguLab — 弹出层覆盖视图的预加载桥
   外壳层（窗口自己的 webContents）永远渲染在所有站点视图之下，所以外壳里
   画的下拉菜单会被网页盖住。弹出层单独挂一个覆盖视图：全窗模式铺满窗口
   （命令面板/速览壳/现有下拉菜单），矩形模式（fit:"rect"）只盖住面板本身，
   面板之外的点击落到网页/外壳上。这里只暴露：收菜单、回报点击、请求关闭、
   回报尺寸（矩形模式）、标签行的右键/中键（原生菜单走主进程）。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lgPopup", {
  onShow: (cb) => ipcRenderer.on("popup:show", (_e, p) => cb(p)),
  /* 窗口尺寸（假壁纸几何）：随 popup:show 的 payload.win 来一份，窗口缩放时
     主进程再补发一份——rect 弹层的视图只是面板那块，壁纸必须按整个窗口铺 */
  onWin: (cb) => ipcRenderer.on("popup:win", (_e, s) => cb(s)),
  /* 浮层面板画好了回报一声（外壳收到才收窄条：交接零闪烁） */
  flyoutShown: () => ipcRenderer.send("popup:flyout-shown"),
  /* v 是可选的回传值（验证码输入框这类）：data-pop-value 标记的项
     会把输入内容一起带回给外壳 */
  pick: (k, v) => ipcRenderer.invoke("popup:pick", { k: String(k || ""), v }),
  /* 不回隐的 pick（分组面板改色这类点了还要留在面板里的操作）：
     覆盖层按 data-pop-stay 标记走这条 */
  pickStay: (k, v) => ipcRenderer.invoke("popup:pick-stay", { k: String(k || ""), v }),
  close: () => ipcRenderer.invoke("popup:hide"),
  /* 矩形模式回报内容尺寸：主进程据此把弹层视图缩到面板大小并把
     原点/上限回传（面板外的点击不再被弹层吃掉的关键） */
  fit: (d) => ipcRenderer.invoke("popup:fit", d),
  /* 浮层行右键 = 原生标签菜单；中键 = 关标签（都走主进程） */
  tabContext: (id) => ipcRenderer.invoke("popup:tab-context", Number(id)),
  tabAux: (id, action) => ipcRenderer.invoke("popup:tab-aux", { id: Number(id), action: String(action || "") }),
  /* 浮层里拖动排序：与外壳同一套"移动语义"（只报放到谁前面 + 落点区） */
  tabReorder: (id, beforeId, zone) => ipcRenderer.invoke("popup:tab-reorder", { id: Number(id), beforeId: beforeId == null ? null : Number(beforeId), zone: zone === "pinned" || zone === "normal" ? zone : null }),
  /* 拖拽期间挂住浮层：光标拖出面板时主进程先别收回（否则拖到一半面板没了） */
  hold: (on) => ipcRenderer.send("popup:hold", !!on),
  /* 悬停卡片（与外壳侧同一套）：在浮层的标签行上停住 → 浮出标题 + 网址 */
  tabTip: (p) => ipcRenderer.invoke("tabtip:show", p),
  tabTipHide: () => ipcRenderer.send("tabtip:hide"),
  onClear: (cb) => ipcRenderer.on("popup:clear", () => cb()),
  version: "6",
});
