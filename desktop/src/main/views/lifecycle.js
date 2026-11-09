/* 视图生命周期：显示/隐藏、空闲休眠与唤醒、后台释放、内存统计。 */
const { IDLE_VIEW_MS, MAX_PROBLEMS, MAX_DETAILS, MAX_TOTAL_ENTRIES } = require("./util");

module.exports = {
  viewStats() {
    const entries = [...this.entries.values()];
    return {
      entries: entries.length,
      live: entries.filter((entry) => entry.view && !entry.sleeping).length,
      sleeping: entries.filter((entry) => entry.sleeping).length,
      idleMs: IDLE_VIEW_MS,
      limits: { problems: MAX_PROBLEMS, details: MAX_DETAILS, total: MAX_TOTAL_ENTRIES },
    };
  },

  cancelSleep(entry) {
    if (!entry) return;
    if (entry.sleepTimer) clearTimeout(entry.sleepTimer);
    entry.sleepTimer = null;
  },

  cancelAllSleep() {
    for (const entry of this.entries.values()) this.cancelSleep(entry);
  },

  scheduleSleep(entry) {
    if (!entry || this.disposed || entry.sleeping || entry.kind === "login" || entry.key === this.currentKey) return;
    this.cancelSleep(entry);
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    const delay = perf ? Math.min(IDLE_VIEW_MS, 30000) : IDLE_VIEW_MS;
    entry.sleepTimer = setTimeout(() => {
      entry.sleepTimer = null;
      if (entry.key === this.currentKey || entry.kind === "login") return;
      this.sleepEntry(entry).catch(() => {});
    }, delay);
  },

  async sleepEntry(entry, force = false) {
    if (!entry || entry.sleeping || entry.sleepPending || entry.kind === "login") return false;
    if (!force && entry.key === this.currentKey) return false;
    if (this.disposed) return false;
    const wc = entry.view && entry.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const url = wc.getURL();
    if (!url || url === "about:blank") return false;

    entry.sleepPending = true;
    entry.lastSleep = { at: Date.now(), state: "checking" };
    const token = entry.lifecycleToken;
    let checkpoint = { scroll: 0, dirty: false, timedOut: false };
    let probeTimer = null;
    try {
      checkpoint = await Promise.race([
        wc.executeJavaScript(`(() => {
          const fields = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
          const dirty = fields.some((node) => {
            if (!node || node.disabled || node.readOnly) return false;
            if (node.matches && node.matches('[contenteditable="true"]')) {
              return String(node.innerText || '').trim().length > 0;
            }
            return String(node.value || '').trim().length > 0;
          });
          return {
            scroll: Number(window.scrollY || document.documentElement.scrollTop || 0) || 0,
            dirty,
            timedOut: false,
          };
        })()`, true),
        new Promise((resolve) => {
          probeTimer = setTimeout(() => resolve({ scroll: 0, dirty: false, timedOut: true }), 1200);
        }),
      ]);
    } catch {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "probe-failed", loading: wc.isLoading() };
      if (wc.isLoading()) {
        this.scheduleSleep(entry);
        return false;
      }
    } finally {
      if (probeTimer) clearTimeout(probeTimer);
    }
    if (checkpoint.timedOut && wc.isLoading()) {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "probe-timeout-loading" };
      this.scheduleSleep(entry);
      return false;
    }
    if (token !== entry.lifecycleToken || (!force && entry.key === this.currentKey) || this.disposed) {
      entry.sleepPending = false;
      return false;
    }
    if (checkpoint.dirty) {
      entry.sleepPending = false;
      entry.lastSleep = { at: Date.now(), state: "dirty" };
      this.scheduleSleep(entry);
      return false;
    }

    entry.sleepPending = false;
    entry.sleeping = true;
    entry.lastSleep = { at: Date.now(), state: "sleeping", url };
    entry.resumeUrl = url;
    entry.resumeScroll = checkpoint.scroll || 0;
    entry.lastRect = "";
    if (entry.attached) {
      try {
        this.win.contentView.removeChildView(entry.view);
      } catch {
        /* ignore */
      }
      entry.attached = false;
    }
    entry.view.setVisible(false);
    wc.loadURL("about:blank").catch(() => {});
    return true;
  },

  wakeEntry(entry, targetUrl) {
    if (!entry || !entry.sleeping) return false;
    const wc = entry.view && entry.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    this.cancelSleep(entry);
    entry.lifecycleToken += 1;
    entry.sleepPending = false;
    entry.sleeping = false;
    const target = String(targetUrl || entry.resumeUrl || entry.requestedUrl || "").trim();
    if (!target || target === "about:blank") return false;
    entry.resumeUrl = target;
    const scroll = Number(entry.resumeScroll) || 0;
    const token = entry.lifecycleToken;
    wc.loadURL(target)
      .then(() => {
        if (token !== entry.lifecycleToken || wc.isDestroyed()) return;
        if (scroll > 0) wc.executeJavaScript(`window.scrollTo(0, ${Math.max(0, Math.round(scroll))});`, true).catch(() => {});
        try {
          const history = wc.navigationHistory;
          const active = history.getActiveIndex();
          for (let i = history.length() - 1; i >= 0; i--) {
            const item = history.getEntryAtIndex(i);
            if (i !== active && item && item.url === "about:blank") history.removeEntryAtIndex(i);
          }
        } catch {
          /* history is best-effort */
        }
      })
      .catch(() => {});
    return true;
  },

  async suspendBackground() {
    const tasks = [];
    for (const entry of this.entries.values()) {
      this.cancelSleep(entry);
      tasks.push(this.sleepEntry(entry, true).catch(() => false));
    }
    return Promise.all(tasks);
  },

  showEntry(entry) {
    if (!this.win || this.win.isDestroyed()) return;
    if (entry.sleeping) this.wakeEntry(entry, entry.resumeUrl || entry.requestedUrl);
    this.cancelSleep(entry);
    this.currentKey = entry.key;
    this.library = null;
    this.overlayOpen = false;
    for (const other of this.entries.values()) {
      if (other === entry) continue;
      other.view.setVisible(false);
      if (!other.view.webContents.isDestroyed()) {
        other.view.webContents.setAudioMuted(true);
        other.view.webContents.setBackgroundThrottling(true);
      }
      this.scheduleSleep(other);
    }
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    entry.lastUsed = ++this.clock;
    entry.lastUsedAt = Date.now();
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(false);
      entry.view.webContents.setBackgroundThrottling(true);
    }
    this.layout();
    this.injectSkin(entry);
    entry.readiness.replay();
    entry.view.webContents.focus();
    this.emit();
  },

  hideAll() {
    for (const entry of this.entries.values()) {
      entry.view.setVisible(false);
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.setAudioMuted(true);
        entry.view.webContents.setBackgroundThrottling(true);
      }
      this.scheduleSleep(entry);
    }
  },

  restoreCurrent() {
    if (this.library) {
      this.hideAll();
      return;
    }
    const entry = this.currentEntry();
    if (!entry || !this.win || this.win.isDestroyed()) return;
    if (entry.sleeping) this.wakeEntry(entry, entry.resumeUrl || entry.requestedUrl);
    this.cancelSleep(entry);
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setVisible(true);
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(false);
      entry.view.webContents.focus();
    }
    this.layout();
    this.injectSkin(entry);
    entry.readiness.replay();
  },

  currentEntry() {
    return this.currentKey ? this.entries.get(this.currentKey) || null : null;
  },

  currentWebContents() {
    const entry = this.currentEntry();
    return entry ? entry.view.webContents : null;
  },
};
