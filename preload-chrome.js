/* LuoguLab — chrome 层预加载桥 */
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("lgChrome", {
  onTabs: (cb) => ipcRenderer.on("chrome:tabs", (_e, s) => cb(s)),
  onUser: (cb) => ipcRenderer.on("chrome:user", (_e, u) => cb(u)),
  onAccounts: (cb) => ipcRenderer.on("chrome:accounts", (_e, a) => cb(a)),
  onConfig: (cb) =>
    ipcRenderer.on("chrome:config", (_e, c) => {
      // 界面大小（仅作用于外壳层，页面内容不受影响）
      try {
        const z = Number(c && c.uiScale);
        webFrame.setZoomFactor(z > 0 ? z : 1);
      } catch (e) {}
      cb(c);
    }),
  onFocusOmni: (cb) => ipcRenderer.on("chrome:focus-omni", () => cb()),
  onPalette: (cb) => ipcRenderer.on("chrome:palette", () => cb()),
  /* 壁纸数据：外壳层的 <video> 也吃不了 lg-media://，静态图同样走 blob 更稳，
     拿到字节自己 createObjectURL */
  wallVideo: () => ipcRenderer.invoke("lg-wall:video"),
  wallImage: () => ipcRenderer.invoke("lg-wall:image"),
  /* 手动换一张壁纸（双击外壳空白区的交互） */
  wallNext: () => ipcRenderer.invoke("lg-wall:next"),
  /* 壁纸视差：页面层的鼠标位置（已节流）经主进程转发到这里，两层同步动 */
  onParallax: (cb) => ipcRenderer.on("chrome:parallax", (_e, p) => cb(p)),
  // 弹出层（下拉菜单 / 命令面板）：外壳层永远渲染在网页视图之下，自己画的下拉
  // 会被网页盖住，所以统一交给覆盖层显示。这里只做"送 HTML / 收点击键"。
  popupShow: (p) => ipcRenderer.invoke("popup:show", p),
  popupHide: () => ipcRenderer.invoke("popup:hide"),
  /* 拖拽期间挂住浮层：光标拖出窄条/面板时主进程的光标裁判先别收回 */
  holdPopup: (on) => ipcRenderer.send("popup:hold", !!on),
  /* 载荷是 { k, v }：k 为点击键，v 是可选回传值（验证码输入框的内容） */
  onPopupPicked: (cb) => ipcRenderer.on("chrome:popup-picked", (_e, p) => cb(p && typeof p === "object" ? p : { k: p })),
  /* 覆盖层自己关掉了自己（点菜单外的空白 / Esc）。外壳要跟着清掉"当前菜单"，
     否则它还以为菜单开着，下一次点按钮会被当成"关闭菜单"而空转 ——
     表现就是同一个按钮要点两下才开得出来。 */
  onPopupHidden: (cb) => ipcRenderer.on("chrome:popup-hidden", () => cb()),
  /* 悬停浮层画好了（主进程转发的 popup 信号）：外壳收到才把窄条隐去——
     那一刻浮层与窄条同像素，交接零闪烁 */
  onFlyoutShown: (cb) => ipcRenderer.on("chrome:flyout-shown", () => cb()),
  onWinState: (cb) => ipcRenderer.on("chrome:winstate", (_e, s) => cb(s)),
  winMinimize: () => ipcRenderer.invoke("win:minimize"),
  winToggleMax: () => ipcRenderer.invoke("win:toggle-max"),
  winClose: () => ipcRenderer.invoke("win:close"),
  onShortcuts: (cb) => ipcRenderer.on("chrome:shortcuts", () => cb()),
  /* 搜索标签页（Ctrl+Shift+A，Edge 同款） */
  onTabSearch: (cb) => ipcRenderer.on("chrome:tab-search", () => cb()),
  /* 最近关闭列表 / 按栈位恢复（标签页操作菜单「最近关闭」区段） */
  closedList: () => ipcRenderer.invoke("tab:closed-list"),
  closedOpen: (i) => ipcRenderer.invoke("tab:closed-open", i),
  onFindShortcut: (cb) => ipcRenderer.on("chrome:find", () => cb()),
  onFindResult: (cb) => ipcRenderer.on("chrome:find-result", (_e, r) => cb(r)),
  find: (text, opts) => ipcRenderer.invoke("lg-app:find", { text, ...(opts || {}) }),
  findStop: () => ipcRenderer.invoke("lg-app:find-stop"),
  muteAll: (v) => ipcRenderer.invoke("lg-app:mute-all", v),
  screenshot: () => ipcRenderer.invoke("lg-app:screenshot"),
  /* 完整网页截图（含滚动）/ 画中画 / 阅读模式 / 整页翻译 */
  fullshot: () => ipcRenderer.invoke("lg-app:fullshot"),
  pip: () => ipcRenderer.invoke("lg-app:pip"),
  reader: () => ipcRenderer.invoke("lg-app:reader"),
  translatePage: () => ipcRenderer.invoke("lg-app:translate-page"),
  findStart: () => ipcRenderer.invoke("lg-app:find-open"),
  toggleFullscreen: () => ipcRenderer.invoke("win:toggle-fullscreen"),
  reopenTab: () => ipcRenderer.invoke("tab:reopen"),
  copyText: (text) => ipcRenderer.invoke("app:copy-text", String(text || "")),
  onDownloads: (cb) => ipcRenderer.on("chrome:downloads", (_e, d) => cb(d)),
  newTab: () => ipcRenderer.invoke("tab:new"),
  closeTab: (id) => ipcRenderer.invoke("tab:close", id),
  activateTab: (id) => ipcRenderer.invoke("tab:activate", id),
  navigate: (url) => ipcRenderer.invoke("tab:navigate", url),
  /* 底部坞（垂直模式）：坞渲染在弹出层，外壳把项+主题变量推给主进程转发 */
  openExternalTab: (url) => ipcRenderer.invoke("tab:open-external", url),
  back: () => ipcRenderer.invoke("tab:back"),
  forward: () => ipcRenderer.invoke("tab:fwd"),
  reload: () => ipcRenderer.invoke("tab:reload"),
  stop: () => ipcRenderer.invoke("tab:stop"),
  /* 地址栏联想：历史 + 映射词（打开的标签与搜索行在外壳本地合并） */
  navSuggest: (q) => ipcRenderer.invoke("lg-nav:suggest", String(q || "")),
  toggleIde: () => ipcRenderer.invoke("tab:toggle-ide"),
  toggleVtab: () => ipcRenderer.invoke("tab:toggle-vtab"),
  /* 拖侧栏右缘改宽度（160~400 夹取，主进程落盘并重算页面 inset） */
  setVtabWidth: (w) => ipcRenderer.invoke("vtab:set-width", w),
  /* 整理标签页：sort-domain 按站点排序（保分组）/ close-duplicates 关闭重复 /
     group-by-domain 按域名自动建组；organizeUndo 撤销上一次整理；
     onOrganizeDone 收主进程侧发起（快捷键/原生菜单）的整理结果，好弹 toast */
  organizeTabs: (action) => ipcRenderer.invoke("tab:organize", action),
  organizeUndo: () => ipcRenderer.invoke("tab:organize-undo"),
  onOrganizeDone: (cb) => ipcRenderer.on("chrome:organize-done", (_e, r) => cb(r)),
  /* 分屏拼合：并排/加入组 / 退出 / 拖比例（field=colRatio|rowRatio|colRatio2|
     rowRatio2，ratio=null 复位布局均分）/ 切布局 / 循环布局 / 聚焦窗格；
     几何由 onSplit 推下来（{ bars:[...] }，条数随布局变） */
  splitTab: (id) => ipcRenderer.invoke("tab:split", id),
  unsplitTab: (id) => ipcRenderer.invoke("tab:unsplit", id),
  splitRatio: (id, ratio, field) => ipcRenderer.invoke("tab:split-ratio", { id, ratio, field }),
  splitLayout: (id, layout) => ipcRenderer.invoke("tab:split-layout", { id, layout }),
  splitLayoutNext: (id) => ipcRenderer.invoke("tab:split-layout-next", { id }),
  splitFocus: (id) => ipcRenderer.invoke("tab:split-focus", id),
  onSplit: (cb) => ipcRenderer.on("chrome:split", (_e, r) => cb(r)),
  /* Glance 链接速览：主进程推送打开/几何变化；外壳回报按钮点击 */
  onGlance: (cb) => ipcRenderer.on("chrome:glance", (_e, p) => cb(p)),
  onGlanceRect: (cb) => ipcRenderer.on("chrome:glance-rect", (_e, p) => cb(p)),
  glanceClose: () => ipcRenderer.invoke("tab:glance-close"),
  glancePromote: () => ipcRenderer.invoke("tab:glance-promote"),
  /* 标签休眠：睡当前/其它；唤醒 = 点回标签（setActiveTab 自动重挂） */
  sleepTab: (id) => ipcRenderer.invoke("tab:sleep", id),
  sleepOthers: () => ipcRenderer.invoke("tab:sleep-others"),
  /* 标签分组（Edge Tab Groups）：新建/加入/移出/改名改色折叠/取消/关闭/组中新建 */
  groupNew: (id) => ipcRenderer.invoke("tab:group-new", id),
  groupJoin: (id, groupId) => ipcRenderer.invoke("tab:group-join", { id, groupId }),
  groupLeave: (id) => ipcRenderer.invoke("tab:group-leave", id),
  groupUpdate: (groupId, patch) => ipcRenderer.invoke("tab:group-update", { groupId, patch }),
  groupUngroup: (groupId) => ipcRenderer.invoke("tab:group-ungroup", groupId),
  groupClose: (groupId) => ipcRenderer.invoke("tab:group-close", groupId),
  groupNewTab: (groupId) => ipcRenderer.invoke("tab:group-newtab", groupId),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openSettings: () => ipcRenderer.invoke("lg-app:open-settings"),
  openHome: () => ipcRenderer.invoke("lg-app:open-home"),
  switchAccount: (id) => ipcRenderer.invoke("lg-account:switch", id),
  accountState: () => ipcRenderer.invoke("lg-account:list"),
  accountAnswer: (code) => ipcRenderer.invoke("lg-account:answer", code),
  accountCancel: () => ipcRenderer.invoke("lg-account:cancel"),
  setConfig: (patch) => ipcRenderer.invoke("lg-config:set", patch),
  tabContextMenu: (id, sel) => ipcRenderer.invoke("tab:context-menu", { id, sel: Array.isArray(sel) ? sel : [] }),
  /* 悬停卡片（Edge 的 hover card）：鼠标在标签行上停住 → 侧栏旁边浮出
     完整标题 + 网址（独立小视图，网页之上、弹层之下） */
  tabTip: (p) => ipcRenderer.invoke("tabtip:show", p),
  tabTipHide: () => ipcRenderer.send("tabtip:hide"),
  /* 主进程侧动作的提示（多选建组这类原生菜单里的操作） */
  onToast: (cb) => ipcRenderer.on("chrome:toast", (_e, m) => cb(m)),
  downloadReveal: (id) => ipcRenderer.invoke("lg-download:reveal", id),
  downloadClear: () => ipcRenderer.invoke("lg-download:clear"),
  /* 下载增强：暂停 / 继续 / 取消 / 重试 / 另存为 / 单条移除 */
  downloadPause: (id) => ipcRenderer.invoke("lg-download:pause", id),
  downloadResume: (id) => ipcRenderer.invoke("lg-download:resume", id),
  downloadCancel: (id) => ipcRenderer.invoke("lg-download:cancel", id),
  downloadRetry: (id) => ipcRenderer.invoke("lg-download:retry", id),
  downloadSaveAs: (id) => ipcRenderer.invoke("lg-download:save-as", id),
  downloadRemove: (id) => ipcRenderer.invoke("lg-download:remove", id),
  openHistory: () => ipcRenderer.invoke("lg-app:open-history"),
  /* 拖拽排序（move 语义）：{ id, beforeId|null }——beforeId=null 表示放列表末尾；
     主进程在权威 tabOrder 上落位（外壳不需要掌握全量顺序） */
  reorderTabs: (m) => ipcRenderer.invoke("tab:reorder", m),
  zoom: (dir) => ipcRenderer.invoke("tab:zoom", dir),
});
