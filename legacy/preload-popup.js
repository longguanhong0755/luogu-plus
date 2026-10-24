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
  /* 页内查找：查找条实体在覆盖层，但查找逻辑在主进程（与 lg-app:find 同一段）。
     popup 只回传文本与方向，结果（命中数）直接拿返回值。 */
  find: (text, opts) => ipcRenderer.invoke("popup:find", { text, ...(opts || {}) }),
  findStop: () => ipcRenderer.invoke("popup:find-stop"),
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
  /* 浮层里的分组拖动：与外壳同一套落点语义（拖到标签上建组/并组、拖到组头加入、
     拖组头整组移动、邻接进出组推断） */
  groupDrop: (m) => ipcRenderer.invoke("popup:group-drop", m),
  groupJoin: (id, groupId) => ipcRenderer.invoke("tab:group-join", { id: Number(id), groupId: Number(groupId) }),
  groupLeave: (id) => ipcRenderer.invoke("tab:group-leave", Number(id)),
  groupMove: (groupId, anchorId, before) =>
    ipcRenderer.invoke("tab:group-move", {
      groupId: Number(groupId),
      anchorId: anchorId == null ? null : Number(anchorId),
      before: !!before,
    }),
  /* 联想列表：悬停行索引回传（回车执行鼠标指着的那行）+ 选中态本地更新
     （外壳按方向键/悬停只发改类名的信号，不重建 DOM——列表才"跟手"） */
  sugHover: (i) => ipcRenderer.send("popup:sug-hover", Number(i) || 0),
  onSugSel: (cb) => ipcRenderer.on("popup:sug-sel", (_e, i) => cb(i)),
  onClear: (cb) => ipcRenderer.on("popup:clear", () => cb()),
  /* 原来这里挂着一个写死的 version:"8"——**没有任何地方读它**
     （全仓 grep 无命中），而 R42 已经在 preload-page.js 里删过同样的东西：
     "应用已到 3.14.0，值早就烂了"。留着只会让人以为弹层有版本协商。 */
});
