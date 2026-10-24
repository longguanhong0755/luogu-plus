/* LuoguLab — 站点页预加载桥（洛谷/站外页面）
   注入脚本要"开一个题目标签"这类动作时，不能靠 window.open（异步回调里会被
   当弹窗拦掉）也不能靠 location.href = "luogu-glass://…"（该 scheme 没注册成
   privileged，Chromium 会直接掐掉导航，连 will-navigate 都不发）。
   这里给页面主世界暴露一个最小 API，走标准 IPC。 */
const { contextBridge, ipcRenderer } = require("electron");
/* R51：document-start 首帧主题底色（严格防白屏）。sandboxed preload 不能
   require 本地文件，这段必须在两个 preload 里各留一份。
   注意：preload 阶段 <html> 已经存在、<head>/<body> 可能还没解析出来；
   直接往 documentElement 塞 <style> 会被解析器丢掉。所以先给 <html> 设
   inline !important 背景（元素本身不会被替换），<body>/<head> 出现后再补；
   inject.js 接管后移除这些 inline 属性，页面自己的背景恢复。 */
(function bootTheme() {
  const arg = (prefix) => {
    const hit = (process.argv || []).find((s) => String(s).startsWith(prefix));
    return hit ? String(hit).slice(prefix.length) : "";
  };
  const bg = arg("--lg-boot-bg=");
  if (!bg) return;
  const theme = arg("--lg-boot-theme=") || "light";
  let style = null;
  let bodyPatched = false;
  const install = () => {
    const root = document.documentElement;
    if (!root) return false;
    try {
      if (!root.hasAttribute("data-lg-boot-bg")) root.setAttribute("data-lg-boot-bg", root.style.getPropertyValue("background") || "");
      root.style.setProperty("background", bg, "important");
      root.style.setProperty("color-scheme", theme, "important");
    } catch (e) {}
    if (document.body && !bodyPatched) {
      try {
        if (!document.body.hasAttribute("data-lg-boot-bg")) document.body.setAttribute("data-lg-boot-bg", document.body.style.getPropertyValue("background") || "");
        document.body.style.setProperty("background", bg, "important");
        bodyPatched = true;
      } catch (e) {}
    }
    if (document.head && !style) {
      try {
        style = document.createElement("style");
        style.id = "lg-boot";
        style.textContent = "html,body{background:" + bg + " !important;color-scheme:" + theme + " !important}";
        document.head.appendChild(style);
      } catch (e) {}
    }
    return bodyPatched;
  };
  if (!install()) {
    try {
      const mo = new MutationObserver(() => {
        if (install()) mo.disconnect();
      });
      mo.observe(document, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 4000);
    } catch (e) {}
  }
})();


contextBridge.exposeInMainWorld("lgApp", {
  /* 打开题号（P1001 / CF1920A / AT_abc300_a …），外壳负责开新标签 */
  openProblem: (pid) => ipcRenderer.invoke("lg-app:open-problem", String(pid || "")),
  /* 打开任意洛谷内页路径，例如 "/problem/list?keyword=x" */
  openPath: (p) => ipcRenderer.invoke("lg-app:open-path", String(p || "")),
  /* 应用动作：drawer/toggle、ide、problem/P1001 …（与 luogu-glass:// 同一分发器） */
  command: (c) => ipcRenderer.invoke("lg-app:command", String(c || "")),
  /* 壁纸数据：R41 起视频走 lg-wall:video（流式 URL，lg-media:// 直放，零拷贝）；
     wallVideoBlob 是直放失败时的字节兜底通道（主进程按需读整份字节）。
     静态图仍走字节（洛谷 CSP 白名单里 blob: 可用、lg-media: 不在）。 */
  wallVideo: () => ipcRenderer.invoke("lg-wall:video"),
  wallVideoBlob: () => ipcRenderer.invoke("lg-wall:video-blob"),
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
  /* 题目页/洛谷自带 IDE 不再自动全屏（R51 用户要求）：页面保持普通状态，
     IDE 也按玻璃主题渲染。原 lg-app:ide-mode 上报通道已删除。 */
  /* R42：这里原本挂着一个写死的 version:"6"（应用已到 3.14.0，值早就烂了，
     而且全库没有任何地方读它）。手抄的版本号一定会过期，且会让"能力探测"
     得到一个静默错误答案——宁愿没有这个字段。真需要时由主进程从
     package.json 取真实版本走 IPC，不要在 preload 里写常数。 */
});
