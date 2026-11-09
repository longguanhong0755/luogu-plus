/* 页面内提交辅助：打开题目页提交区并把代码填进站点编辑器。 */

module.exports = {
  /* 页面内提交辅助：打开题目页提交区并把代码填进洛谷的 CodeMirror 编辑器，
     用户只需在页面里完成验证码（易盾滑块）后点“提交评测”。
     导航用页内 location.href/location.hash（loadURL 全量加载会丢 #submit 哈希，
     SPA 停在阅读模式渲染不出编辑器）。 */
  async openSubmitAssist(pid, code) {
    const pageUrl = `https://www.luogu.com.cn/problem/${encodeURIComponent(pid)}`;
    let entry = this.currentEntry();
    if (entry) {
      try {
        await entry.view.webContents.executeJavaScript(
          `(async () => { location.href = ${JSON.stringify(pageUrl + "#submit")}; })()`
        );
      } catch (e) {
        console.log("[luogu] 提交辅助导航失败 " + String(e).slice(0, 120));
        return false;
      }
    } else {
      this.openDetail(pageUrl, `${pid} 提交`);
      entry = this.currentEntry();
      if (!entry) return false;
    }
    const wc = entry.view.webContents;
    for (let i = 0; i < 30 && wc.isLoading(); i++) await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 600));
    try {
      await wc.executeJavaScript(`(() => { if (location.hash !== "#submit") location.hash = "submit"; return location.href.slice(0, 90); })()`);
    } catch {
      /* 页面还在加载也没关系，下面轮询会等 */
    }
    await new Promise((r) => setTimeout(r, 500));
    // 提交区是 SPA 懒渲染的，轮询等编辑器出现
    let lastProbe = null;
    for (let i = 0; i < 16; i++) {
      try {
        lastProbe = await wc.executeJavaScript(
          `(() => {
            const eds = [...document.querySelectorAll("[contenteditable=true]")];
            return { href: location.href.slice(0, 90), n: eds.length, vis: eds.filter((e) => e.offsetParent).length, ready: document.readyState };
          })()`
        );
        if (lastProbe.vis > 0) {
          await wc.executeJavaScript(
            `(() => {
              const ed = [...document.querySelectorAll("[contenteditable=true]")].find((t) => t.offsetParent);
              if (ed && !window.__lgAssistFilled) {
                ed.focus();
                document.execCommand("selectAll", false, null);
                document.execCommand("insertText", false, ${JSON.stringify(String(code || ""))});
                window.__lgAssistFilled = true;
              }
              return true;
            })()`
          );
          return true;
        }
      } catch (e) {
        console.log("[luogu] 提交辅助执行失败 " + String(e).slice(0, 120));
        return false;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("[luogu] 提交辅助未找到编辑器 " + JSON.stringify(lastProbe));
    return false;
  },
};
