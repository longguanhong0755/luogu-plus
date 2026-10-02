/* LuoguLab — 站点页预加载桥（洛谷/站外页面）
   注入脚本要"开一个题目标签"这类动作时，不能靠 window.open（异步回调里会被
   当弹窗拦掉）也不能靠 location.href = "luogu-glass://…"（该 scheme 没注册成
   privileged，Chromium 会直接掐掉导航，连 will-navigate 都不发）。
   这里给页面主世界暴露一个最小 API，走标准 IPC。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lgApp", {
  /* 打开题号（P1001 / CF1920A / AT_abc300_a …），外壳负责开新标签 */
  openProblem: (pid) => ipcRenderer.invoke("lg-app:open-problem", String(pid || "")),
  /* 打开任意洛谷内页路径，例如 "/problem/list?keyword=x" */
  openPath: (p) => ipcRenderer.invoke("lg-app:open-path", String(p || "")),
  /* 应用动作：drawer/toggle、ide、problem/P1001 …（与 luogu-glass:// 同一分发器） */
  command: (c) => ipcRenderer.invoke("lg-app:command", String(c || "")),
  /* 壁纸数据：视频吃不了 lg-media://（媒体加载器只认标准协议），静态图会被
     洛谷的 CSP 拦（白名单里没有 lg-media:）。两者都改由页面拿到字节自己
     createObjectURL —— blob: 在白名单里。 */
  wallVideo: () => ipcRenderer.invoke("lg-wall:video"),
  wallImage: () => ipcRenderer.invoke("lg-wall:image"),
  /* 壁纸视差：页面层鼠标位置（已节流）经主进程转发给外壳层，两层同步动 */
  parallax: (x, y) => ipcRenderer.send("lg-wall:parallax", { x, y }),
  /* Ctrl+滚轮缩放：注入层拦截 wheel 后转到这里，按事件所属标签步进 */
  zoomBy: (dir) => ipcRenderer.invoke("lg-app:zoom", dir > 0 ? 1 : -1),
  /* Glance 链接速览（Zen 式）：Alt+点击链接 → 居中卡片预览，不离开当前页 */
  glance: (url) => ipcRenderer.invoke("lg-app:glance", String(url || "")),
  /* 翻译：页面侧 fetch 会被 CORS 拦，统一由主进程出网（划词与整页翻译共用）。
     传数组走批量；返回 {ok, texts, target} 或 {ok:false, message}。 */
  translate: (texts) => ipcRenderer.invoke("lg-app:translate", { texts: Array.isArray(texts) ? texts : [texts] }),
  /* 外壳版本号：注入脚本可用它做能力探测 */
  version: "5",
});
