/* 打开页面列表与当前页状态（工具条/侧栏/命令面板消费）。 */
const { NAV } = require("../sections");
const { TITLE_H, TOOLBAR_H } = require("../window");
const { pidFromUrl, sectionOfUrl } = require("./util");

module.exports = {
  switchTo(key) {
    if (key.startsWith("library:")) {
      this.showLibrary(key.slice("library:".length));
      return;
    }
    const entry = this.entries.get(key);
    if (!entry) return;
    this.ideOn = false;
    this.showEntry(entry);
  },

  listOpen() {
    const out = [];
    if (this.library) {
      out.push({
        key: "library:" + this.library,
        kind: "library",
        title: (NAV[this.library] || {}).label || this.library,
      });
    }
    const sections = [...this.entries.values()]
      .filter((entry) => entry.kind === "web")
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of sections) out.push({ key: entry.key, kind: "section", title: entry.title });
    const others = [...this.entries.values()]
      .filter((entry) => entry.kind === "problem" || entry.kind === "profile" || entry.kind === "detail")
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of others) {
      out.push({
        key: entry.key,
        kind: entry.kind === "detail" ? "section" : entry.kind,
        title: entry.title,
        pid: entry.pid,
      });
    }
    return out;
  },

  currentInfo() {
    const canReopen = this.closedStack.length > 0;
    if (this.library) {
      return {
        home: false,
        library: this.library,
        section: this.library,
        railId: this.library,
        key: "library:" + this.library,
        kind: "library",
        title: (NAV[this.library] || {}).label || this.library,
        url: "",
        canBack: false,
        canForward: false,
        canReopen,
        isProblem: false,
        pid: "",
        ide: false,
        loading: null,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
      };
    }
    const entry = this.currentEntry();
    if (!entry) {
      return {
        home: true,
        library: null,
        section: "home",
        railId: "home",
        key: null,
        kind: "home",
        title: "主页",
        url: "",
        canBack: false,
        canForward: false,
        canReopen,
        isProblem: false,
        pid: "",
        ide: false,
        loading: null,
        layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
      };
    }
    const wc = entry.view.webContents;
    const pageUrl = entry.sleeping ? entry.resumeUrl || entry.requestedUrl || "" : wc.getURL();
    let canBack = false;
    let canForward = false;
    try {
      canBack = wc.navigationHistory.canGoBack();
      canForward = wc.navigationHistory.canGoForward();
    } catch {
      /* ignore */
    }
    const liveSection = sectionOfUrl(pageUrl) || entry.section || "";
    const railId = entry.railId !== undefined ? entry.railId : NAV[liveSection] ? liveSection : "";
    return {
      home: false,
      library: null,
      section: liveSection,
      railId,
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      url: pageUrl,
      canBack: canBack || !!this.returnLib,
      canForward,
      canReopen,
      isProblem: entry.kind === "problem",
      pid: entry.pid || pidFromUrl(pageUrl),
      ide: this.ideOn,
      loading: entry.readiness ? entry.readiness.state : null,
      layout: { titleH: TITLE_H, railW: this.railWidth(), toolbarH: TOOLBAR_H },
    };
  },
};
