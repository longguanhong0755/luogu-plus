/* LRU 淘汰与最近关闭栈：题目 2 个、详情 3 个、总条目 4 个。 */
const { isLuoguUrl, pidFromUrl } = require("./util");

module.exports = {
  evictKind(kind, max, keepKey) {
    const list = [...this.entries.values()].filter((entry) => entry.kind === kind);
    if (list.length <= max) return;
    list.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of list) {
      if (list.length <= max) break;
      if (entry.key === keepKey) continue;
      this.destroyEntry(entry);
      list.splice(list.indexOf(entry), 1);
    }
  },

  evictTotal(max, keepKey) {
    if (this.entries.size <= max) return;
    const list = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.entries.size > max && list.length) {
      const entry = list.shift();
      if (!entry || entry.key === keepKey) continue;
      this.destroyEntry(entry);
    }
  },
  destroyEntry(entry) {
    entry.lifecycleToken += 1;
    this.cancelSleep(entry);
    if (entry.captureTimer) {
      clearTimeout(entry.captureTimer);
      entry.captureTimer = null;
    }
    // 关闭前抓 URL 进「最近关闭」栈（LRU 挤掉的页面也能一键找回）
    let lastUrl = "";
    try {
      lastUrl = entry.view.webContents.getURL();
    } catch {
      /* ignore */
    }
    try {
      if (entry.attached) {
        this.win.contentView.removeChildView(entry.view);
        entry.attached = false;
      }
      entry.view.webContents.close();
    } catch {
      /* ignore */
    }
    this.entries.delete(entry.key);
    if (this.currentKey === entry.key) this.currentKey = null;
    if (
      entry.kind !== "login" &&
      (entry.pid || (/^https:\/\//i.test(lastUrl) && isLuoguUrl(lastUrl)))
    ) {
      this.closedStack.push({
        kind: entry.kind,
        pid: entry.pid || pidFromUrl(lastUrl) || "",
        section: entry.section || "",
        title: entry.title || "",
        url: lastUrl,
      });
      if (this.closedStack.length > 12) this.closedStack.shift();
    }
  },

  /* 恢复最近一次关闭的页面（Ctrl+Shift+T / 工具条按钮）。 */
  reopenClosed() {
    const item = this.closedStack.pop();
    if (!item) return null;
    if (item.kind === "problem" && item.pid) this.openProblem(item.pid);
    else if (item.kind === "profile") {
      const uid = Number((item.url.match(/\/user\/(\d+)/) || [])[1]);
      if (Number.isFinite(uid) && uid > 0) this.openProfile(uid);
      else this.openDetail(item.url, item.title);
    } else if (item.kind === "web" && item.section) this.openWeb(item.section);
    else this.openDetail(item.url, item.title);
    return item;
  },

  canReopen() {
    return this.closedStack.length > 0;
  },
};
