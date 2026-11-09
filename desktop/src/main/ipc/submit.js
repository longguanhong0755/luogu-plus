/* 提交与草稿域 IPC：在线提交/断网入队、队列操作、草稿读写。 */
const { ipcMain, clipboard } = require("electron");
const { canonicalPid } = require("../sections");

function register(ctx) {
  ipcMain.handle("app:submit", async (_event, payload) => {
    const pid = canonicalPid((payload && payload.pid) || "");
    const code = String((payload && payload.code) || "");
    const lang = String((payload && payload.lang) || "C++14 (GCC 9)");
    const o2 = !!(payload && payload.o2);
    if (!pid || !code.trim()) {
      return { ok: false, message: "题目编号或代码为空。" };
    }
    // 断网提交：不碰网络，进本地队列，联网后自动重放
    if (ctx.luogu.online === false) {
      const queued = await ctx.luogu.enqueueSubmit(pid, code, lang, "当前离线", o2);
      ctx.toast("提交", queued.message);
      return queued;
    }
    const result = await ctx.luogu.submit(pid, code, lang, "", o2);
    if (result.ok) {
      ctx.toast("提交", `已提交 ${pid}，评测完成后会通知你。`);
    } else if (Number(result.status) === 0) {
      // 网络层失败（在线状态还没跟上）：排进队列稍后自动重试
      const queued = await ctx.luogu.enqueueSubmit(pid, code, lang, "网络未就绪", o2);
      ctx.toast("提交", queued.message);
      return queued;
    } else {
      // 原生提交没走通（登录过期 / 需要验证码 / 易盾交互式挑战）：
      // 打开题目页提交区并自动填入代码，用户在页面里完成验证后提交。
      clipboard.writeText(code);
      const filled = await ctx.views.openSubmitAssist(pid, code);
      ctx.toast(
        "提交",
        filled
          ? "已在题目页填入代码，请完成页面里的验证后点“提交评测”。"
          : "代码已复制，请在题目页内提交。"
      );
    }
    return result;
  });

  ipcMain.handle("app:queueAction", async (_event, payload) => {
    const op = String((payload && payload.op) || "");
    const id = payload ? String(payload.id || "") : "";
    if (!["retry", "clear", "remove"].includes(op)) return ctx.luogu.queueState();
    if (op === "remove" && !id) return ctx.luogu.queueState();
    return ctx.luogu.queueAction(op, id);
  });

  ipcMain.handle("app:saveDraft", (_event, payload) => {
    if (!ctx.store) return { ok: false };
    const pid = canonicalPid((payload && payload.pid) || "");
    const code = String((payload && payload.code) || "");
    const lang = String((payload && payload.lang) || "C++14 (GCC 9)");
    const o2 = !!(payload && payload.o2);
    // 语言/O2 是全局偏好：下一道题沿用上一次的选择
    ctx.store.set("editorPrefs", { lang, o2, savedAt: Date.now() }, 0);
    // 草稿按题目隔离：A 题的代码永远不会出现在 B 题的编辑器里
    if (pid) {
      const key = "draft:" + pid;
      ctx.store.set(key, { key, pid, code: code.slice(0, 200000), lang, o2, savedAt: Date.now() }, 800);
    }
    return { ok: true };
  });

  ipcMain.handle("app:getDraft", (_event, payload) => {
    if (!ctx.store) return null;
    const pid = canonicalPid((payload && payload.pid) || "");
    if (pid) {
      const draft = ctx.store.get("draft:" + pid);
      if (draft && typeof draft === "object") {
        return {
          pid,
          code: String(draft.code || ""),
          lang: String(draft.lang || "C++14 (GCC 9)"),
          o2: !!draft.o2,
          savedAt: Number(draft.savedAt) || 0,
        };
      }
    }
    // 本题还没有草稿：只带全局语言偏好，绝不带其他题的代码
    const prefs = ctx.store.get("editorPrefs");
    return {
      pid,
      code: "",
      lang: prefs && prefs.lang ? String(prefs.lang) : "C++14 (GCC 9)",
      o2: !!(prefs && prefs.o2),
      savedAt: 0,
    };
  });
}

module.exports = { register };
