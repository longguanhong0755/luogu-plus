/* 每次主框架导航都有独立的加载代次。旧代次的 Promise、定时器和迟到事件
   不能修改新页面状态；这是避免“旧页面加载完成后关掉新页面骨架”的唯一入口。 */
const { pageSpecFor, readinessProbeSource } = require("./page-registry");

const PROBE_INTERVAL_MS = 160;
const STABLE_ROUTE_TICKS = 3;
const STABLE_GENERIC_TICKS = 5;

class PageReadinessController {
  constructor(webContents, getContext, onChange) {
    this.wc = webContents;
    this.getContext = typeof getContext === "function" ? getContext : () => ({});
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this.token = 0;
    this.stableRoute = 0;
    this.stableGeneric = 0;
    this.routeSignature = "";
    this.genericSignature = "";
    this.probeTimer = null;
    this.timeoutTimer = null;
    this.disposed = false;
    this.state = {
      phase: "idle", requestId: 0, url: "", skeleton: "generic",
      title: "", message: "", startedAt: 0,
    };
  }

  currentSpec(url) {
    const context = this.getContext() || {};
    return pageSpecFor(Object.assign({}, context, { url: url || context.url || "" }));
  }

  publish(phase, extra = {}) {
    if (this.disposed) return;
    const next = Object.assign({}, this.state, extra, {
      phase,
      requestId: this.token,
      startedAt: this.state.startedAt || Date.now(),
    });
    this.state = next;
    if (this.wc && !this.wc.isDestroyed()) {
      try {
        this.wc.send("page:load-state", next);
      } catch {
        /* 页面 preload 尚未建立时由它自己的首屏骨架兜底。 */
      }
    }
    this.onChange(next);
  }

  armTimeout(token, spec) {
    clearTimeout(this.timeoutTimer);
    const timeoutMs = Math.max(6000, Number(spec && spec.timeoutMs) || 15000);
    this.timeoutTimer = setTimeout(() => {
      if (token !== this.token) return;
      this.fail("页面加载超时", "timeout");
    }, timeoutMs);
  }

  begin(url, reason = "navigation") {
    if (this.disposed) return;
    const token = ++this.token;
    this.stableRoute = 0;
    this.stableGeneric = 0;
    this.routeSignature = "";
    this.genericSignature = "";
    clearTimeout(this.probeTimer);
    clearTimeout(this.timeoutTimer);
    const spec = this.currentSpec(url);
    this.state = {
      phase: "loading", requestId: token, url: String(url || ""),
      skeleton: spec.skeleton || "generic", title: spec.title || "",
      message: "", startedAt: Date.now(), reason,
    };
    this.publish("loading");
    this.armTimeout(token, spec);
  }

  markDomReady(url) {
    if (this.disposed) return;
    if (!url || url === "about:blank") return;
    // error 是当前代次的终态；只有新的导航事件（begin/didNavigate）能恢复，
    // 否则旧文档迟到的 dom-ready 会重新打开一个没有超时保护的探测循环。
    if (this.state.phase === "ready" || this.state.phase === "error") return;
    if (this.state.phase === "idle") this.begin(url, "dom-ready");
    if (this.state.phase !== "loading" && this.state.phase !== "hydrating") return;
    const currentUrl = String(url || this.state.url || "");
    if (this.state.phase !== "hydrating" || this.state.url !== currentUrl) {
      this.publish("hydrating", { url: currentUrl, message: "" });
    }
    this.scheduleProbe(60);
  }

  didNavigate(url) {
    if (this.disposed) return;
    if (this.state.phase === "idle" || this.state.phase === "ready" || this.state.phase === "error") {
      this.begin(url, "in-page");
    }
    this.markDomReady(url);
  }

  scheduleProbe(delay = PROBE_INTERVAL_MS) {
    if (this.disposed || this.state.phase === "error" || this.state.phase === "ready") return;
    clearTimeout(this.probeTimer);
    const token = this.token;
    this.probeTimer = setTimeout(() => this.probe(token), delay);
  }

  async probe(token) {
    if (this.disposed || token !== this.token) return;
    if (!this.wc || this.wc.isDestroyed()) return;
    let result = null;
    try {
      const spec = this.currentSpec(this.state.url);
      result = await this.wc.executeJavaScript(readinessProbeSource(spec), true);
    } catch {
      if (token === this.token) this.scheduleProbe();
      return;
    }
    if (this.disposed || token !== this.token || this.state.phase === "error" || this.state.phase === "ready") return;

    const routeSignal = result && result.routeReady ? String(result.signature || "") : "";
    const genericSignal = result && result.genericReady ? String(result.signature || "") : "";
    if (routeSignal && routeSignal === this.routeSignature) {
      this.stableRoute++;
    } else {
      this.routeSignature = routeSignal;
      this.stableRoute = routeSignal ? 1 : 0;
    }
    if (genericSignal && genericSignal === this.genericSignature) {
      this.stableGeneric++;
    } else {
      this.genericSignature = genericSignal;
      this.stableGeneric = genericSignal ? 1 : 0;
    }
    if (this.stableRoute >= STABLE_ROUTE_TICKS || this.stableGeneric >= STABLE_GENERIC_TICKS) {
      this.markReady(result);
      return;
    }
    this.scheduleProbe();
  }

  markReady(result) {
    if (this.disposed || this.state.phase === "error" || this.state.phase === "ready") return;
    clearTimeout(this.probeTimer);
    clearTimeout(this.timeoutTimer);
    this.probeTimer = null;
    this.timeoutTimer = null;
    this.publish("ready", {
      message: "", textLength: result ? Number(result.textLength) || 0 : 0,
      durationMs: Math.max(0, Date.now() - (this.state.startedAt || Date.now())),
    });
  }

  fail(message, reason = "load-failed") {
    if (this.disposed || this.state.phase === "error") return;
    this.token++;
    clearTimeout(this.probeTimer);
    clearTimeout(this.timeoutTimer);
    this.probeTimer = null;
    this.timeoutTimer = null;
    this.publish("error", { message: String(message || "页面加载失败"), reason });
  }

  replay() {
    if (this.disposed) return;
    if (this.state.phase === "idle") {
      const current = this.wc && !this.wc.isDestroyed() ? this.wc.getURL() : "";
      this.begin(current || this.state.url, "replay");
      return;
    }
    this.publish(this.state.phase);
  }

  dispose() {
    this.disposed = true;
    this.token++;
    clearTimeout(this.probeTimer);
    clearTimeout(this.timeoutTimer);
    this.probeTimer = null;
    this.timeoutTimer = null;
  }
}

module.exports = {
  PageReadinessController,
  PROBE_INTERVAL_MS,
  STABLE_ROUTE_TICKS,
  STABLE_GENERIC_TICKS,
};