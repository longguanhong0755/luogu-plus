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
  /* 壁纸数据：R41 起视频走 lg-wall:video（流式 URL，lg-media:// 直放，零拷贝）；
     wallVideoBlob 是直放失败时的字节兜底通道。静态图仍走字节自建 blob。 */
  wallVideo: () => ipcRenderer.invoke("lg-wall:video"),
  wallVideoBlob: () => ipcRenderer.invoke("lg-wall:video-blob"),
  wallImage: () => ipcRenderer.invoke("lg-wall:image"),
  /* 手动换一张壁纸（双击外壳空白区的交互） */
  wallNext: () => ipcRenderer.invoke("lg-wall:next"),
  /* 壁纸视差：页面层的鼠标位置（已节流）经主进程转发到这里，两层同步动 */
  onParallax: (cb) => ipcRenderer.on("chrome:parallax", (_e, p) => cb(p)),
  // 弹出层（下拉菜单 / 命令面板）：外壳层永远渲染在网页视图之下，自己画的下拉
  // 会被网页盖住，所以统一交给覆盖层显示。这里只做"送 HTML / 收点击键"。
  popupShow: (p) => ipcRenderer.invoke("popup:show", p),
  /* 请求主进程把键盘焦点交回外壳（Ctrl+L / 命令面板“聚焦地址栏”）：
     只做 DOM focus() 在页面持有焦点时输入仍会进旧页。 */
  focusShell: () => ipcRenderer.invoke("lg-app:focus-shell"),
  /* 探针只读快照：几何/焦点以主进程为准（隐藏窗口里页面 innerWidth 不跟 setBounds） */
  probeUx: (req) => ipcRenderer.invoke("lg-probe:ux", req),
  popupHide: () => ipcRenderer.invoke("popup:hide"),
  /* 拖拽期间挂住浮层：光标拖出窄条/面板时主进程的光标裁判先别收回 */
  holdPopup: (on) => ipcRenderer.send("popup:hold", !!on),
  /* 载荷是 { k, v }：k 为点击键，v 是可选回传值（验证码输入框的内容） */
  onPopupPicked: (cb) => ipcRenderer.on("chrome:popup-picked", (_e, p) => cb(p && typeof p === "object" ? p : { k: p })),
  /* 覆盖层自己关掉了自己（点菜单外的空白 / Esc）。外壳要跟着清掉"当前菜单"，
     否则它还以为菜单开着，下一次点按钮会被当成"关闭菜单"而空转 ——
     表现就是同一个按钮要点两下才开得出来。 */
  onPopupHidden: (cb) => ipcRenderer.on("chrome:popup-hidden", () => cb()),
  /* 关路径握手回执（R36）：外壳把窄条/常驻侧栏画回来之后再回这一声，主进程
     才真把弹层视图隐掉——否则中间一帧"面板没了、窄条还隐着"（收回闪一下） */
  popupHiddenAck: () => ipcRenderer.send("popup:hidden-ack"),
  /* 坞（R36：独立覆盖视图）：外壳渲染坞的 HTML + 整套主题变量推给主进程转发；
     坞视图只负责量尺寸上报与点击回传 */
  dockSync: (p) => ipcRenderer.send("dock:sync", p),
  dockSize: (w, h) => ipcRenderer.send("dock:size", { w, h }),
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
  /* 标签悬停预览缩略图（Edge 标签预览卡片）：主进程抓页面缩略图并带 20 秒缓存 */
  tabThumb: (id) => ipcRenderer.invoke("lg-tab:thumb", Number(id)),
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
  /* 地址栏 Alt+Enter：把输入内容新标签打开（锁定语义跟着目标走，R40） */
  openTab: (url) => ipcRenderer.invoke("tab:open", url),
  back: () => ipcRenderer.invoke("tab:back"),
  forward: () => ipcRenderer.invoke("tab:fwd"),
  /* 长按后退/前进弹出的访问历史栈（倒序：最近在前，active 标记当前所在位置） */
  navHistory: (id) => ipcRenderer.invoke("tab:nav-history", Number(id)),
  reload: () => ipcRenderer.invoke("tab:reload"),
  stop: () => ipcRenderer.invoke("tab:stop"),
  /* 地址栏联想：历史 + 映射词（打开的标签与搜索行在外壳本地合并） */
  navSuggest: (q) => ipcRenderer.invoke("lg-nav:suggest", String(q || "")),
  /* 联想选中态：方向键/悬停只发改类名的信号（不重建弹层 DOM）；悬停索引由
     弹层回传（popup:sug-hover → chrome:sug-hover），回车执行鼠标指着的那行 */
  sugSel: (i) => ipcRenderer.send("chrome:sug-sel", Number(i)),
  onSugHover: (cb) => ipcRenderer.on("chrome:sug-hover", (_e, i) => cb(i)),
  toggleIde: () => ipcRenderer.invoke("tab:toggle-ide"),
  /* 分屏编辑器（题目右侧并排 IDE 的抽屉）：题目页工具条已删（R36），
     改从命令面板进 */
  toggleDrawer: () => ipcRenderer.invoke("tab:toggle-drawer"),
  toggleVtab: () => ipcRenderer.invoke("tab:toggle-vtab"),
  /* 拖侧栏右缘改宽度（160~400 夹取，主进程落盘并重算页面 inset） */
  setVtabWidth: (w) => ipcRenderer.invoke("vtab:set-width", w),
  /* 整理标签页：sort-domain 按站点排序（保分组）/ close-duplicates 关闭重复 /
     group-by-domain 按域名自动建组；organizeUndo 撤销上一次整理；
     onOrganizeDone 收主进程侧发起（快捷键/原生菜单）的整理结果，好弹 toast */
  organizeTabs: (action) => ipcRenderer.invoke("tab:organize", action),
  organizeUndo: () => ipcRenderer.invoke("tab:organize-undo"),
  onOrganizeDone: (cb) => ipcRenderer.on("chrome:organize-done", (_e, r) => cb(r)),
  /* 分屏（R39 起只做左右两格，对齐 Chromium 开源 split tab）：并排 / 退出 /
     拖比例（colRatio，null 复位均分）/ 关闭左格 / 关闭右格 / 反转左右；
     几何由 onSplit 推下来（{ bars:[...] }，只有一条竖条） */
  splitTab: (id) => ipcRenderer.invoke("tab:split", id),
  unsplitTab: (id) => ipcRenderer.invoke("tab:unsplit", id),
  splitRatio: (id, ratio, field) => ipcRenderer.invoke("tab:split-ratio", { id, ratio, field }),
  splitCloseSide: (id, side) => ipcRenderer.invoke("tab:split-close-side", { id, side }),
  splitReverse: (id) => ipcRenderer.invoke("tab:split-reverse", id),
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
  /* 分组拖动落点（Edge 语义）：拖到某个标签上 = 与它新建分组（它没组）或并入
     它所在的组（它已有组）；拖到组头/组牌上 = 加入该组；before 表示落在目标前。
     整组排序走 groupMove（groupId + beforeGid，null = 放到最后）。 */
  groupDrop: (m) => ipcRenderer.invoke("tab:group-drop", m),
  groupMove: (groupId, anchorId, before) => ipcRenderer.invoke("tab:group-move", {
    groupId: Number(groupId),
    anchorId: anchorId == null ? null : Number(anchorId),
    before: !!before,
  }),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openSettings: (section) => ipcRenderer.invoke("lg-app:open-settings", section),
  openHome: () => ipcRenderer.invoke("lg-app:open-home"),
  switchAccount: (id, opts) => ipcRenderer.invoke("lg-account:switch", id, opts),
  accountState: () => ipcRenderer.invoke("lg-account:list"),
  accountAnswer: (code) => ipcRenderer.invoke("lg-account:answer", code),
  accountCancel: () => ipcRenderer.invoke("lg-account:cancel"),
  setConfig: (patch) => ipcRenderer.invoke("lg-config:set", patch),
  tabContextMenu: (id, sel) => ipcRenderer.invoke("tab:context-menu", { id, sel: Array.isArray(sel) ? sel : [] }),
  /* 主进程侧动作的提示（多选建组这类原生菜单里的操作） */
  onToast: (cb) => ipcRenderer.on("chrome:toast", (_e, m) => cb(m)),
  /* 催一下主进程刷新用户态（头像/昵称）。主进程那边 ipcMain.on("user:nudge")
     一直存在、注释也写着"账号菜单打开时即时抓"，但**从来没有任何地方发
     它** —— 结果是头像只在定时兜底时更新。菜单打开时主动催一次。 */
  userNudge: () => ipcRenderer.send("user:nudge"),
  downloadReveal: (id) => ipcRenderer.invoke("lg-download:reveal", id),
  downloadClear: () => ipcRenderer.invoke("lg-download:clear"),
  /* 取下载列表：移除/暂停/取消之后要拿回最新列表刷新面板。
     这一条之前**漏了**（主进程 lg-download:list 一直有，preload 却没暴露），
     chrome.js 里 window.lgChrome.downloadList() 直接 TypeError，表现为
     "移除记录后列表不刷新" + 控制台报错。由契约静态检查抓出来。 */
  downloadList: () => ipcRenderer.invoke("lg-download:list"),
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
