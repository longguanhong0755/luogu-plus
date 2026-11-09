/* 题面快照：题目页导航停稳后延迟抓取已渲染 DOM，供离线阅读页复用。 */
const { isOfflineUrl, pidFromUrl } = require("./util");

module.exports = {
  /* 题面快照：题目页导航停稳后延迟抓取已渲染 DOM（洛谷自己渲染的公式/代码高亮原样保留）。
     SPA 水合慢于首次 paint，抓到空壳时再等一轮；#submit 提交区和离线页不抓。 */
  scheduleProblemCapture(entry, url) {
    if (process.env.LG_NO_SNAPSHOT === "1") return;
    if (!entry || entry.kind !== "problem") return;
    if (entry.captureTimer) clearTimeout(entry.captureTimer);
    if (!url || url.includes("#") || isOfflineUrl(url)) return;
    const luogu = this.ctx.luogu;
    if (!luogu || luogu.online === false) return;
    entry.captureTimer = setTimeout(() => {
      entry.captureTimer = null;
      this.captureProblem(entry, 0).catch(() => {});
    }, 4500);
  },

  async captureProblem(entry, round) {
    if (this.disposed || !entry || !this.win || this.win.isDestroyed()) return;
    const wc = entry.view.webContents;
    if (wc.isDestroyed() || round > 4) return;
    const url = wc.getURL();
    const pid = entry.pid || pidFromUrl(url);
    if (!pid || url.includes("#") || isOfflineUrl(url)) return;
    if (this.ctx.luogu && this.ctx.luogu.online === false) return;
    let probe = null;
    try {
      probe = await wc.executeJavaScript(`(() => {
       try {
        const pick =
          document.querySelector(".main-container") ||
          document.querySelector("main") ||
          document.querySelector("#app") ||
          document.body;
        if (!pick) return { ok: false, reason: "no-dom" };
        const text = (pick.textContent || "").replace(/\\s+/g, " ").trim();
        if (text.length < 200) return { ok: false, reason: "thin", len: text.length };
        // 站点 SPA 水合前会把 markdown 源文本直接放在 DOM 里；抓到这种状态就继续等，
        // 否则离线快照会显示满屏 ** 和 $。正文类不存在也说明还没水合。
        const marked = pick.querySelector(".lfe-marked");
        if (!marked) return { ok: false, reason: "no-marked" };
        const markedText = (marked.textContent || "").slice(0, 8000);
        if (markedText.replace(/\\s+/g, " ").trim().length < 120) {
          return { ok: false, reason: "thin-marked" };
        }
        if (/\\*\\*[^*\\n]{1,120}\\*\\*/.test(markedText) && !marked.querySelector("strong, em, .katex")) {
          return { ok: false, reason: "raw-markdown" };
        }
        const clone = pick.cloneNode(true);
        clone.querySelectorAll("script, noscript, iframe, #lg-boot").forEach((node) => node.remove());
        // 深度防御：剥 on* 事件属性、javascript: 等危险 URL 属性（离线页 CSP 之外的第二道闸）
        for (const node of [clone, ...clone.querySelectorAll("*")]) {
          for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const isUrlAttr = name === "href" || name === "src" || name === "formaction" || name === "action" || name === "xlink:href";
            const isSafeData = name === "src" && /^data:(image|font)\\//i.test(attr.value);
            if (name.startsWith("on") || (isUrlAttr && !isSafeData && /^\\s*(javascript|data|vbscript):/i.test(attr.value))) {
              node.removeAttribute(attr.name);
            }
          }
        }
        const html = clone.innerHTML;
        if (html.length < 200) return { ok: false, reason: "thin-html" };
        return {
          ok: true,
          title: (document.title || "").split(" - 洛谷")[0],
          html: html.length > 600000 ? html.slice(0, 600000) : html,
        };
       } catch (err) {
         // 抓取脚本自身的异常必须在页面内捕获并带回来，否则它会和
         // “文档已销毁/正在导航”的传输层拒绝共用同一句话术，日志无法区分。
         return { ok: false, reason: "script-throw", message: String((err && err.message) || err), stack: String((err && err.stack) || "") };
       }
      })()`);
    } catch (err) {
      const msg = String((err && err.message) || err || "");
      // 能走到这里只剩传输层拒绝：文档已销毁、正在导航、渲染上下文被替换。
      // 隐藏窗口在 smoke 快速切题/重载时必然命中，属于预期竞态，默认静默；
      // 排查时设 LG_DEBUG_CAPTURE=1 留一行现场。
      const ctxGone = /Script failed to execute|Render frame was disposed|WebContents was destroyed|Execution context was destroyed|Cannot find context|ERR_ABORTED/i.test(msg) ||
        wc.isDestroyed() ||
        this.disposed;
      if (process.env.LG_DEBUG_CAPTURE) {
        console.log("[views] 快照抓取竞态跳过 round=" + round + " " + msg.slice(0, 80));
      }
      if (!ctxGone) {
        console.log("[views] 快照抓取失败 " + msg.slice(0, 100) + " url=" + (wc.isDestroyed() ? "(destroyed)" : wc.getURL().slice(0, 90)));
      }
      // 导航竞态等瞬时错误也给一次机会（round 上限复用，防循环）
      setTimeout(() => this.captureProblem(entry, round + 1).catch(() => {}), 2500);
      return;
    }
    if (probe && probe.reason === "script-throw") {
      // 页内脚本真的抛错：这才是需要修的 bug，重试没有意义
      console.log("[views] 快照抓取脚本异常 " + String(probe.message || "").slice(0, 120));
      if (process.env.LG_DEBUG_CAPTURE && probe.stack) {
        console.log("[views] 快照抓取脚本异常栈 " + String(probe.stack).slice(0, 800));
      }
      return;
    }
    if (probe && probe.ok && this.ctx.luogu) {
      this.ctx.luogu.saveProblemSnapshot(pid, probe.title, probe.html);
      return;
    }
    // 页面还在水合：5 秒后重试
    if (
      probe &&
      (probe.reason === "thin" ||
        probe.reason === "thin-html" ||
        probe.reason === "no-dom" ||
        probe.reason === "no-marked" ||
        probe.reason === "thin-marked" ||
        probe.reason === "raw-markdown")
    ) {
      setTimeout(() => this.captureProblem(entry, round + 1).catch(() => {}), 5000);
    }
  },
};
