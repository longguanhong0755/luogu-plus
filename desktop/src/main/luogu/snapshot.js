/* 洛谷数据服务 · 主页快照落盘与题面 DOM 快照（拆分自 src/main/luogu.js）。 */
const snapshotMethods = {
  /* 主页/身份快照落盘：断网启动时 hydrate() 回填的就是这里写的。 */
  persistSnapshot() {
    const store = this.ctx.store;
    if (!store) return;
    store.set("home", this.home, 800);
    store.set("user", this.user, 800);
  },

  /* ---------- 题目快照（离线阅读） ---------- */

  problemSnapshotUrl(pid) {
    const store = this.ctx.store;
    if (!store) return "";
    const snap = store.get("problem:" + String(pid || "").toUpperCase(), null);
    return snap && snap.html ? "lgoff://problem/" + encodeURIComponent(String(pid).toUpperCase()) : "";
  },

  hasProblemSnapshot(pid) {
    return !!this.problemSnapshotUrl(pid);
  },

  /* views.js 在题目页渲染稳定后调用：把已渲染的题面 DOM 存下来。
     存 DOM 而不是 markdown 源文本——洛谷自己渲染的 KaTeX/代码高亮直接保留，
     离线页零渲染成本；换来的代价是快照比源文本大，靠数量上限约束。 */
  saveProblemSnapshot(pid, title, html) {
    const store = this.ctx.store;
    if (!store || !html || html.length < 200) return false;
    const key = "problem:" + String(pid || "").toUpperCase();
    store.set(
      key,
      {
        key,
        pid: String(pid).toUpperCase(),
        title: String(title || pid || "").slice(0, 120),
        html: String(html).slice(0, 600000),
        url: "https://www.luogu.com.cn/problem/" + String(pid).toUpperCase(),
        savedAt: Date.now(),
      },
      600
    );
    store.evict("problem:", 40);
    return true;
  },

  problemSnapshot(pid) {
    const store = this.ctx.store;
    if (!store) return null;
    return store.get("problem:" + String(pid || "").toUpperCase(), null);
  }
};

module.exports = { snapshotMethods };
