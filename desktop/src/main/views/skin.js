/* 统一皮肤：静态 CSS 文本、变量表与注入（页面视图不复制壁纸）。 */
const fs = require("node:fs");
const path = require("node:path");
const { SKIN_DIR } = require("../paths");
const { isOfflineUrl } = require("./util");

module.exports = {
  scheduleSkin(entry) {
    if (this.skinTimer) clearTimeout(this.skinTimer);
    this.skinTimer = setTimeout(() => {
      if (this.currentEntry() === entry) this.injectSkin(entry);
    }, 140);
  },

  updateTheme() {
    if (!this.win || this.win.isDestroyed()) return;
    for (const entry of this.entries.values()) {
      entry.view.setBackgroundColor("#00000000");
      this.injectSkin(entry);
    }
    this.layout();
  },

  /* ---------- 统一皮肤 + 壁纸复刻 ---------- */

  /* 静态皮肤文本 = 主文件 + 同目录 luogu-skin/ 下按文件名排序的 *.css 分片。
     这份文本由主进程读成字符串注入远端页面，不能用 @import 串联；
     缓存按合并后的 mtime 失效（任一文件变更即重读）。 */
  skinStatic() {
    const mainFile = path.join(SKIN_DIR, "luogu-skin.css");
    const partsDir = path.join(SKIN_DIR, "luogu-skin");
    let mtime = 0;
    const files = [];
    try {
      mtime = fs.statSync(mainFile).mtimeMs;
      files.push(mainFile);
    } catch {
      this.skinSource = "";
      this.skinMtime = 0;
      return this.skinSource;
    }
    try {
      const names = fs.readdirSync(partsDir).filter((name) => name.toLowerCase().endsWith(".css")).sort();
      for (const name of names) {
        const part = path.join(partsDir, name);
        try {
          const stat = fs.statSync(part);
          if (!stat.isFile()) continue;
          if (stat.mtimeMs > mtime) mtime = stat.mtimeMs;
          files.push(part);
        } catch {
          /* 单个分片读不到时跳过，不影响其余分片 */
        }
      }
    } catch {
      /* 分片目录不存在时只用主文件 */
    }
    if (!this.skinSource || mtime !== this.skinMtime) {
      try {
        this.skinSource = files.map((part) => fs.readFileSync(part, "utf8")).join("\n");
        this.skinMtime = mtime;
      } catch {
        this.skinSource = "";
      }
    }
    return this.skinSource;
  },

  skinVars(entry) {
    const t = this.ctx.theme;
    const c = t.colors;
    const perf = !!(this.ctx.cfg && this.ctx.cfg.get().general.performanceMode);
    const vars = [
      `--lg-bg:${c.bg}`,
      `--lg-rail:${c.rail}`,
      `--lg-title:${c.title}`,
      `--lg-surface:${c.surface}`,
      `--lg-surface-2:${c.surface2}`,
      `--lg-border:${c.border}`,
      `--lg-border-strong:${c.borderStrong}`,
      `--lg-divider:${c.divider}`,
      `--lg-text:${c.text}`,
      `--lg-text-2:${c.text2}`,
      `--lg-text-3:${c.text3}`,
      `--lg-accent:${c.accent}`,
      `--lg-glass-tint:${c.glassTint || c.accent}`,
      `--lg-glass-tint-soft:${c.glassTintSoft || c.accentSoft}`,
      `--lg-accent-text:${c.accentText}`,
      `--lg-accent-soft:${c.accentSoft}`,
      `--lg-accent-fill:${c.accentFill}`,
      `--lg-accent-hover:${c.accentHover}`,
      `--lg-accent-line:${c.accentLine}`,
      `--lg-on-accent:${c.onAccent}`,
      `--lg-hover:${c.hover}`,
      `--lg-pressed:${c.pressed}`,
      `--lg-shadow:${c.shadow}`,
      `--lg-highlight:${c.highlight}`,
      `--lg-green:${c.green}`,
      `--lg-red:${c.red}`,
      `--lg-orange:${c.orange}`,
      `--lg-material:${t.material}`,
      `--lg-panel-alpha:${t.panelAlpha}%`,
      `--lg-raise:${t.raiseAlpha}%`,
      `--lg-code-alpha:${t.codeAlpha}%`,
      `--lg-overlay-alpha:${t.overlayAlpha}%`,
      `--lg-scrim:${t.pageScrim}%`,
      `--lg-text-shadow:none`,
      `--lg-blur:${perf ? 0 : t.blurPx}px`,
      `--lg-font-mono:"Cascadia Mono","Cascadia Code",Consolas,monospace`,
      `--lg-radius-sm:6px`,
      `--lg-radius-md:8px`,
      `--lg-radius-lg:12px`,
      `--lg-fs-xs:12px`,
      `--lg-fs-sm:13px`,
      `--lg-fs-md:14px`,
      `--lg-fs-lg:16px`,
      `--lg-fs-xl:20px`,
      `--lg-dur:120ms`,
      `--lg-ease:cubic-bezier(.2,0,0,1)`,
      /* 曾被消费却从未定义、永远走 fallback 的变量补上定义 */
      `--lg-gutter-top:20px`,
      `--lg-focus-w:2px`,
      `--lg-scrollbar-w:10px`,
      `--lg-wall-image:none`,
      `--lg-color-scheme:${t.isDark ? "dark" : "light"}`,
      `--lg-motion:0`,
      `--lg-zoom-on:0`,
      `--lg-perf:${perf ? 1 : 0}`,
    ].join(";");
    return `:root{${vars}}`;
  },

  injectSkin(entry) {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    // 离线快照页有自己的排版与主题，不套洛谷皮肤变量
    if (isOfflineUrl(wc.getURL())) return;
    let vars = "";
    try {
      vars = this.skinVars(entry);
    } catch {
      return;
    }
    if (!vars.trim()) return;
    let source = "";
    try {
      source = this.skinStatic();
    } catch {
      source = "";
    }
    try {
      // 静态规则只在首次或文件变更时注入；主题/材质变化只替换变量表。
      if (source.trim() && !entry.skinPending && (!entry.skinKey || entry.skinMtime !== this.skinMtime)) {
        entry.skinPending = true;
        const oldKey = entry.skinKey;
        entry.skinKey = null;
        if (oldKey) wc.removeInsertedCSS(oldKey).catch(() => {});
        wc.insertCSS(source)
          .then((key) => {
            entry.skinPending = false;
            entry.skinKey = key;
            entry.skinMtime = this.skinMtime;
          })
          .catch(() => {
            entry.skinPending = false;
          });
      }
      if (entry.varsPending) {
        // 保留最后一次主题值；当前 insertCSS 完成后补注入，避免连续拖滑杆
        // 时页面停在旧透明度而后台窗口已经更新。
        entry.varsDirty = true;
        if (process.env.LG_SKIN_DEBUG) console.log("[skin] varsPending blocked, url=" + wc.getURL());
        return;
      }
      if (entry.varsKey && entry.varsSig === vars) return;
      const seq = ++this.skinSeq;
      entry.varsPending = true;
      entry.varsDirty = false;
      const oldVars = entry.varsKey;
      entry.varsKey = null;
      if (oldVars) wc.removeInsertedCSS(oldVars).catch(() => {});
      // 皮肤里的主题条件规则(代码高亮等)挂在 html[data-lg-mode] 上,
      // 变量换套时同步刷新;新文档由 page preload 按 --lg-boot-mode 在 document-start 置位。
      wc.executeJavaScript(
        `document.documentElement.dataset.lgMode=${JSON.stringify(this.ctx.theme.isDark ? "dark" : "light")};`,
        true
      ).catch(() => {});
      if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars start #" + seq + " url=" + wc.getURL());
      wc.insertCSS(vars)
        .then((key) => {
          entry.varsKey = key;
          entry.varsSig = vars;
          if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars ok #" + seq + " url=" + wc.getURL());
        })
        .catch((err) => {
          if (process.env.LG_SKIN_DEBUG) console.log("[skin] vars REJECT #" + seq + " " + err.message);
        })
        .finally(() => {
          entry.varsPending = false;
          if (entry.varsDirty && !wc.isDestroyed()) {
            entry.varsDirty = false;
            queueMicrotask(() => this.injectSkin(entry));
          }
        });
    } catch {
      /* 页面还在加载中，dom-ready 会再试 */
    }
  },
};
