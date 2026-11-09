/* 洛谷数据服务 · 在线状态轮询与离线提交队列（拆分自 src/main/luogu.js）。 */
const { delay } = require("./util");

const offlineMethods = {
  /* ---------- 在线状态 ---------- */

  startOnlineWatch() {
    if (this.onlineTimer) return;
    this.onlineTimer = setInterval(async () => {
      try {
        const win = this.ctx.win;
        if (!win || win.isDestroyed()) return;
        const online = await win.webContents.executeJavaScript("navigator.onLine");
        this.setOnline(!!online);
      } catch {
        /* 主窗口未就绪时保持现状 */
      }
    }, 60000);
    if (this.onlineTimer.unref) this.onlineTimer.unref();
  },

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    console.log("[luogu] 网络状态 → " + (online ? "在线" : "离线"));
    if (this.ctx.emitState) this.ctx.emitState();
    if (!online) return;
    this.refresh(true).catch(() => {});
    this.flushQueue().catch(() => {});
  },

  /* ---------- 离线提交队列 ---------- */

  queueItems() {
    const store = this.ctx.store;
    const list = store ? store.get("queue") : null;
    return Array.isArray(list) ? list.filter((item) => item && item.pid && item.code) : [];
  },

  queueState() {
    const items = this.queueItems();
    return {
      count: items.filter((item) => item.status !== "done" && item.status !== "failed").length,
      items: items.map((item) => ({
        id: item.id,
        pid: item.pid,
        lang: item.lang,
        status: item.status || "pending",
        tries: item.tries || 0,
        queuedAt: item.queuedAt || 0,
        lastError: String(item.lastError || "").slice(0, 80),
      })),
    };
  },

  async enqueueSubmit(pid, code, lang, reason, o2 = false) {
    const store = this.ctx.store;
    if (!store) return { ok: false, message: "本地存储不可用，无法离线排队。" };
    const queue = this.queueItems();
    // 同题同码的重复入队直接合并，避免断网期间连点堆积
    if (queue.some((item) => item.pid === pid && item.code === code && item.status !== "done" && item.status !== "failed")) {
      return { ok: false, queued: true, message: `已排在离线队列里（${pid}），联网后自动提交。` };
    }
    queue.push({
      id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      pid,
      code,
      lang: lang || "C++14 (GCC 9)",
      o2: !!o2,
      status: "pending",
      tries: 0,
      nextTryAt: 0,
      queuedAt: Date.now(),
      lastError: String(reason || "").slice(0, 80),
    });
    if (queue.length > 20) queue.splice(0, queue.length - 20);
    store.set("queue", queue, 100);
    store.flush("queue");
    if (this.ctx.emitState) this.ctx.emitState();
    return { ok: false, queued: true, message: `${reason || "当前离线"}，已加入队列（${pid}），联网后自动提交。` };
  },

  async queueAction(op, id) {
    const store = this.ctx.store;
    if (!store) return this.queueState();
    const queue = this.queueItems();
    if (op === "clear") {
      store.set("queue", [], 0);
      store.flush("queue");
    } else if (op === "retry") {
      for (const item of queue) {
        if (id && item.id !== id) continue;
        if (item.status === "done") continue;
        item.status = "pending";
        item.nextTryAt = 0;
        item.lastError = "";
      }
      store.set("queue", queue, 0);
      store.flush("queue");
      this.flushQueue().catch(() => {});
    } else if (op === "remove" && id) {
      store.set(
        "queue",
        queue.filter((item) => item.id !== id),
        0
      );
      store.flush("queue");
    }
    if (this.ctx.emitState) this.ctx.emitState();
    return this.queueState();
  },

  scheduleQueueRetry(delayMs = 60000) {
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      if (this.online) this.flushQueue().catch(() => {});
      else this.scheduleQueueRetry();
    }, delayMs);
  },

  /* 逐条重放：走与手动提交完全相同的 submit 管线（含验证码自动识别与页面辅助语义）。
     结果分类：ok → 完成；验证码/交互式 → 标记 captcha 等用户处理；
     status 0（网络层失败）→ 保留待重试；服务器明确拒绝 → failed 停止重试。 */
  async flushQueue() {
    if (this.flushing || !this.online) return;
    const store = this.ctx.store;
    if (!store) return;
    this.flushing = true;
    let mutated = false;
    try {
      const queue = this.queueItems();
      const now = Date.now();
      for (const item of queue) {
        if (item.status === "done" || item.status === "failed") continue;
        if (item.status === "captcha") continue;
        if (item.nextTryAt && item.nextTryAt > now) continue;
        const result = await this.submit(item.pid, item.code, item.lang, "", item.o2);
        item.tries = (item.tries || 0) + 1;
        mutated = true;
        if (result.ok) {
          item.status = "done";
          item.rid = result.rid || "";
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 已自动提交，评测完成后通知。`);
        } else if (result.captchaRequired) {
          item.status = "captcha";
          item.lastError = "需要验证码，点击「去验证」在页面里完成提交。";
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 需要验证码，请在题目页完成提交。`);
        } else if (Number(result.status) === 0 || /网络|离线/.test(String(result.message || ""))) {
          item.status = "pending";
          item.lastError = "网络未就绪，稍后重试";
          item.nextTryAt = Date.now() + 90000;
        } else {
          item.status = "failed";
          item.lastError = String(result.message || result.detail || "提交被拒绝").slice(0, 120);
          this.ctx.toast && this.ctx.toast("离线队列", `${item.pid} 提交被拒：` + item.lastError);
        }
        await delay(1500);
      }
      const remaining = queue.filter((item) => item.status === "pending" || item.status === "retry");
      if (remaining.length) this.scheduleQueueRetry();
      const cleaned = queue.filter((item) => item.status !== "done").slice(-20);
      store.set("queue", cleaned, 100);
      store.flush("queue");
      if (this.ctx.emitState) this.ctx.emitState();
    } finally {
      this.flushing = false;
    }
    return mutated;
  }
};

module.exports = { offlineMethods };
