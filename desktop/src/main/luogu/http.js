/* 洛谷数据服务 · 页面上下文抓取（会话直连优先，隐藏窗仅作降级；拆分自 src/main/luogu.js）。 */
const { delay } = require("./util");

const httpMethods = {
  async fetchContextDirect(url) {
    if (!this.ctx.session || typeof this.ctx.session.fetch !== 'function') {
      return { ok: false, reason: 'no-session-fetch' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let timedOut = false;
    let timeoutTimer = null;
    try {
      const request = this.ctx.session.fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      }).then(async (response) => {
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, status: response.status, reason: 'http', len: text.length };
        }
        const match = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
        if (!match) {
          return { ok: false, status: response.status, reason: 'no-ctx', len: text.length };
        }
        try {
          return { ok: true, context: JSON.parse(match[1]), transport: 'session.fetch' };
        } catch (error) {
          return { ok: false, status: response.status, reason: 'parse', detail: String(error).slice(0, 120) };
        }
      }).catch((error) => ({ ok: false, reason: 'network', error: String(error).slice(0, 160) }));
      const watchdog = new Promise((resolve) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          resolve({ ok: false, reason: 'timeout' });
        }, 12000);
      });
      return await Promise.race([request, watchdog]);
    } catch (error) {
      return { ok: false, reason: timedOut ? 'timeout' : 'network', error: String(error).slice(0, 160) };
    } finally {
      clearTimeout(timer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  },

  async fetchContext(pathname) {
    const url = pathname.startsWith('http') ? pathname : 'https://www.luogu.com.cn' + pathname;
    // 离线时页面 fetch 立刻失败，重试只是白等——直接走调用方的缓存回退。
    if (!this.online) return null;

    // 常规读取只取 HTML 内的 lentille-context，不需要完整站点 renderer。
    // 这样主页刷新、题库/记录分页不会为了抓一段 JSON 常驻隐藏 BrowserWindow。
    const direct = await this.fetchContextDirect(url);
    if (direct.ok && direct.context) {
      this.contextStats.direct += 1;
      this.contextStats.last = 'session.fetch';
      return direct.context;
    }

    // 只有直连拿不到可解析上下文时才启用浏览器回退，兼容防爬页、验证码页
    // 或未来需要站点脚本生成 DOM 的页面。成功一次后仍保持隐藏窗空闲回收。
    this.contextStats.browser += 1;
    this.contextStats.last = 'browser';
    let lastFail = JSON.stringify(direct);
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.exec(
        `(async () => {
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', signal: AbortSignal.timeout(9000) });
            const text = await r.text();
            const m = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
            if (!m) return { ok: false, status: r.status, reason: 'no-ctx', len: text.length, online: navigator.onLine };
            try {
              return { ok: true, context: JSON.parse(m[1]), online: navigator.onLine };
            } catch (e) {
              return { ok: false, status: r.status, reason: 'parse', detail: String(e).slice(0, 120), online: navigator.onLine };
            }
          } catch (e) {
            return { ok: false, error: String(e).slice(0, 120), online: navigator.onLine };
          }
        })()`
      );
      if (result && typeof result.online === 'boolean') this.setOnline(result.online);
      if (result && result.ok && result.context) return result.context;
      if (result && result.online === false) return null;
      lastFail = JSON.stringify(result);
      await delay(600);
    }
    console.error('[luogu] fetchContext failed', pathname, lastFail);
    return null;
  },

  contextDiagnostics() {
    return Object.assign({ hiddenWindow: !!(this.win && !this.win.isDestroyed()) }, this.contextStats);
  }
};

module.exports = { httpMethods };
