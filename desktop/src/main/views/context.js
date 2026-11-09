/* 页面右键菜单、窗口打开策略与站外导航拦截。 */
const { Menu, clipboard } = require("electron");
const { safeOpenExternal } = require("../external");
const { isLuoguUrl, isOfflineUrl, pidFromUrl } = require("./util");

module.exports = {
  wirePageMenus(entry) {
    const wc = entry.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (isOfflineUrl(url)) {
        const pid = pidFromUrl(url);
        if (pid) this.openProblem(pid);
      } else if (isLuoguUrl(url)) {
        this.openDetail(url, "", "detail:" + url);
      } else {
        safeOpenExternal(url);
      }
      return { action: "deny" };
    });

    /* 页面右键菜单：链接/编辑/导航/外部打开/检查 */
    wc.on("context-menu", (_event, params) => {
      const items = [];
      if (params.linkURL) {
        items.push({ label: "打开链接", click: () => this.openDetail(params.linkURL, "") });
        items.push({ label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) });
        items.push({ type: "separator" });
      }
      if (params.selectionText && params.editFlags.canCopy) items.push({ role: "copy", label: "复制" });
      if (params.isEditable) {
        if (params.editFlags.canPaste) items.push({ role: "paste", label: "粘贴" });
        if (params.editFlags.canSelectAll) items.push({ role: "selectAll", label: "全选" });
      }
      if (items.length && items[items.length - 1].type !== "separator") items.push({ type: "separator" });
      try {
        items.push({ label: "后退", enabled: wc.navigationHistory.canGoBack(), click: () => this.back() });
        items.push({ label: "前进", enabled: wc.navigationHistory.canGoForward(), click: () => this.forward() });
      } catch {
        /* ignore */
      }
      items.push({ label: "刷新", click: () => wc.reload() });
      items.push({ type: "separator" });
      items.push({
        label: "在浏览器打开此页",
        click: () => {
          try {
            safeOpenExternal(wc.getURL());
          } catch {
            /* ignore */
          }
        },
      });
      items.push({ label: "检查", click: () => this.ctx.command && this.ctx.command("devtools") });
      try {
        Menu.buildFromTemplate(items).popup({ window: this.win });
      } catch {
        /* ignore */
      }
    });

    wc.on("will-navigate", (event, url) => {
      if (url.startsWith("devtools://") || url.startsWith("about:") || isOfflineUrl(url)) return;
      if (!isLuoguUrl(url)) {
        event.preventDefault();
        safeOpenExternal(url);
      }
    });
  },
};
