/* 广告拦截标记：新文档由 page preload 置位，已打开页面在这里即时切换。 */
const { isOfflineUrl } = require("./util");

module.exports = {
  /* 广告开关：页面 CSS 由 data-lg-adblock 控制，新文档由 page preload 在
     document-start 置位；已打开的页面在这里即时切换，不需要重载。 */
  applyAdBlock() {
    const on = !!(this.ctx.cfg && this.ctx.cfg.get().general.adBlock);
    const value = on ? "1" : "0";
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      const url = wc.getURL();
      if (!url || url === "about:blank" || isOfflineUrl(url)) continue;
      wc.executeJavaScript(`document.documentElement.dataset.lgAdblock="${value}";`, true).catch(() => {});
    }
  },
};
