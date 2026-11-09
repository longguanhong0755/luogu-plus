/* 页面事件接线：标题、导航代次、dom-ready、加载失败、崩溃恢复与窗口打开。 */
const { injectIntoCurrentDocument: injectPasskeyGuard } = require("../passkey-guard");
const { cleanTitle, isOfflineUrl, pidFromUrl, sectionOfUrl } = require("./util");

module.exports = {
  wire(entry) {
    const wc = entry.view.webContents;

    wc.on("page-title-updated", (_event, title) => {
      if (!title || title === "about:blank") return;
      const cleaned = cleanTitle(title);
      if (cleaned) entry.title = cleaned;
      this.emit();
    });

    const onNavigate = (_event, url) => {
      if (!url || url === "about:blank") return;
      const pid = pidFromUrl(url);
      if (pid && entry.kind === "problem") entry.pid = pid;
      if (pid) entry.title = pid;
      const section = sectionOfUrl(url);
      if (section) entry.section = section;
      this.emit();
      this.ctx.onNavigate && this.ctx.onNavigate(url);
      if (entry.kind === "problem") this.scheduleProblemCapture(entry, url);
    };
    wc.on("did-navigate", onNavigate);
    wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      onNavigate(_event, url);
      if (isMainFrame !== false) entry.readiness.didNavigate(url);
    });
    wc.on("did-start-navigation", (details, deprecatedUrl, deprecatedInPlace, deprecatedMainFrame) => {
      // Electron 39 把导航信息放在第一个 details 参数里；旧签名仍保留，
      // 两种形式都要兼容，否则所有导航都会漏掉 readiness.begin。
      const target = (details && details.url) || (typeof deprecatedUrl === "string" ? deprecatedUrl : "");
      const sameDocument = details && details.isSameDocument !== undefined
        ? !!details.isSameDocument
        : !!deprecatedInPlace;
      const mainFrame = details && details.isMainFrame !== undefined
        ? details.isMainFrame !== false
        : deprecatedMainFrame !== false;
      if (!mainFrame || !target || target === "about:blank") return;
      entry.readiness.begin(target, sameDocument ? "in-page" : "document");
    });

    wc.on("dom-ready", () => {
      const current = wc.getURL();
      if (current === "about:blank") return;
      // 插入的 CSS 随文档销毁；新文档必须重新注入静态规则
      entry.skinKey = null;
      entry.varsKey = null;
      entry.varsSig = "";
      entry.varsPending = false;
      entry.skinMtime = 0;
      entry.skinPending = false;
      if (!entry.guardPreDoc && !entry.guardRetry) {
        // Page 域只能在文档提交之后启用；首个文档到达时补装一次，成功后同一视图
        // 之后的所有导航（含站点自己跳登录页）都在文档脚本执行前就带守卫。
        entry.guardRetry = true;
        this.attachGuard(wc).then((guarded) => {
          entry.guardPreDoc = !!guarded;
        }).catch(() => {});
      } else if (!wc.debugger.isAttached()) {
        this.attachGuard(wc).catch(() => {});
      }
      if (!isOfflineUrl(current)) this.injectSkin(entry);
      // CDP 预注入在某些首次 renderer 上会超时；当前文档必须在主世界再兜底一次，
      // 否则隔离世界 preload 无法覆盖站点自己的 navigator.credentials。
      injectPasskeyGuard(wc).then((injected) => {
        entry.passkeyFallback = injected;
      }).catch(() => {});
      entry.view.setBackgroundColor("#00000000");
      entry.readiness.markDomReady(current);
    });

    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url === "about:blank") return;
      // 线上题目页加载失败（断网/网络抖动）：有本地快照就切过去，别给用户一个错误页
      const pid = pidFromUrl(url) || entry.pid;
      if (entry.kind === "problem" && pid && !isOfflineUrl(url)) {
        const offlineUrl = this.ctx.luogu ? this.ctx.luogu.problemSnapshotUrl(pid) : "";
        if (offlineUrl) {
          console.log("[views] 题目加载失败，回退离线快照 " + pid);
          entry.readiness.begin(offlineUrl, "offline-fallback");
          wc.loadURL(offlineUrl).catch(() => {});
          return;
        }
      }
      // 题单详情是站点 SPA，偶发首包/路由数据都成功但正文未渲染。
      // 对训练详情做一次静默重载，不把用户留在空白的 l-card 里。
      if (entry.section === "training" && entry.requestedUrl && (entry.blankRetries || 0) < 1) {
        entry.blankRetries = (entry.blankRetries || 0) + 1;
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.loadURL(entry.requestedUrl).catch(() => {});
        }, 450);
        return;
      }
      entry.readiness.fail(`${description}（${code}）`, "did-fail-load");
      this.ctx.toast && this.ctx.toast("页面加载失败", `${description}（${code}）`);
      console.error("[views] did-fail-load", url, code, description);
    });

    wc.on("found-in-page", (_event, result) => {
      try {
        wc.send("app:find-result", { matches: result.matches, active: result.activeMatchOrdinal });
      } catch {
        /* ignore */
      }
    });

    // 加载成功即清零崩溃重载计数（「连续 3 次」语义）
    wc.on("did-finish-load", () => {
      wc.__lgReloadCount = 0;
      entry.readiness.markDomReady(wc.getURL());
      if (entry.section !== "training" || !entry.requestedUrl) return;
      setTimeout(async () => {
        if (wc.isDestroyed() || wc.getURL() !== entry.requestedUrl) return;
        let probe = null;
        try {
          probe = await wc.executeJavaScript(`(() => {
            const app = document.querySelector("#app");
            const text = String((app && app.innerText) || "").replace(/\s+/g, " ").trim();
            return { ok: !!app && !!app.firstElementChild && text.length >= 20, length: text.length };
          })()`);
        } catch {
          return;
        }
        if (probe && probe.ok) {
          entry.blankRetries = 0;
          return;
        }
        if ((entry.blankRetries || 0) < 1) {
          entry.blankRetries = (entry.blankRetries || 0) + 1;
          wc.reload();
          return;
        }
        this.ctx.toast && this.ctx.toast("题单加载失败", "页面没有返回正文，请检查登录状态后重试。");
      }, 700);
    });

    wc.on("did-stop-loading", () => {
      entry.readiness.markDomReady(wc.getURL());
    });

    wc.on("render-process-gone", () => {
      entry.readiness.fail("页面渲染进程已退出", "render-process-gone");
      // 重载上限：确定性崩溃页不能无限循环；连续 3 次后停止并提示
      wc.__lgReloadCount = (wc.__lgReloadCount || 0) + 1;
      if (wc.__lgReloadCount > 3) {
        this.ctx.toast && this.ctx.toast("页面崩溃", "该页面连续崩溃，已停止自动恢复。");
        return;
      }
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload();
      }, 600);
    });
    // 快捷键与右键菜单拆在 input.js / context.js，仍在同一个视图上接线
    this.wireInput(entry);
    this.wirePageMenus(entry);
  },
};
