/* 离线快照协议：lgoff://problem/<PID>。
   快照是洛谷自己渲染的 DOM（公式/高亮已在 HTML 里），这里只包一层带主题色的
   外壳和「离线快照」提示条。协议同时挂在默认 session 与 persist:luogu 分区。 */
const { protocol } = require("electron");

/* 离线题目页：快照是洛谷自己渲染的 DOM（公式/高亮已在 HTML 里），
   这里只包一层带主题色的外壳和「离线快照」提示条。 */
function offlinePageHtml(snap, theme) {
  const c = theme.colors;
  const when = snap.savedAt ? new Date(snap.savedAt).toLocaleString("zh-CN", { hour12: false }) : "";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' data:; font-src https: data:; base-uri 'none'; form-action 'none'">
<title>${esc(snap.pid)} ${esc(snap.title || "")}</title>
<base href="https://www.luogu.com.cn/">
<style>
  :root {
    color-scheme: ${theme.isDark ? "dark" : "light"};
    --bg: ${c.bg}; --surface: ${c.surface}; --surface2: ${c.surface2};
    --border: ${c.border}; --border-strong: ${c.borderStrong}; --divider: ${c.divider};
    --text: ${c.text}; --text2: ${c.text2}; --text3: ${c.text3};
    --accent: ${c.accent}; --accent-text: ${c.accentText};
    --accent-soft: ${c.accentSoft}; --shadow: ${c.shadow}; --highlight: ${c.highlight};
  }
  html, body { margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px; line-height: 1.8; font-synthesis: none;
  }
  a { color: var(--accent-text); text-underline-offset: 2px; }
  .lg-off-bar {
    position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 10px;
    height: 40px; padding: 0 20px; background: ${c.title}; color: var(--text2);
    border-bottom: 1px solid var(--border); font-size: 12px; line-height: 18px;
  }
  .lg-off-bar b { color: var(--text); font-weight: 600; }
  .lg-off-dot { width: 7px; height: 7px; border-radius: 50%; background: ${c.orange}; flex: none; }
  .lg-off-fill { flex: 1; }
  .lg-off-main { max-width: 960px; margin: 0 auto; padding: 28px 32px 64px; }
  .lg-off-main img { max-width: 100%; height: auto; }
  .lg-off-main h1, .lg-off-main h2, .lg-off-main h3, .lg-off-main h4 {
    color: var(--text); font-weight: 600; letter-spacing: 0; line-height: 1.4;
  }
  .lg-off-main h1 { font-size: 24px; line-height: 32px; margin: 0 0 16px; }
  .lg-off-main h2 { font-size: 20px; line-height: 28px; margin: 28px 0 10px; }
  .lg-off-main h3 { font-size: 16px; line-height: 24px; margin: 22px 0 8px; }
  .lg-off-main p { max-width: 74ch; margin: 0 0 12px; }
  .lg-off-main :is(.l-card, .lfe-card, .card, .header-card, .lfe-panel, .lfe-comment, .comment) {
    background: color-mix(in srgb, var(--surface) 95%, transparent);
    border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 1px 2px var(--shadow), 0 8px 24px color-mix(in srgb, var(--shadow) 55%, transparent);
  }
  .lg-off-main table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .lg-off-main th {
    height: 38px; padding: 0 12px; text-align: left; font-size: 12px; font-weight: 600;
    color: var(--text2); background: color-mix(in srgb, var(--text) 5%, transparent);
    border-bottom: 1px solid var(--divider);
  }
  .lg-off-main td { height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--divider); }
  .lg-off-main pre {
    overflow: auto; background: color-mix(in srgb, var(--surface2) 82%, transparent);
    border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
    font-size: 13px; line-height: 1.7;
  }
  .lg-off-main code {
    font-family: "Cascadia Mono", "Cascadia Code", Consolas, monospace; font-size: 0.94em;
  }
  .lg-off-main :not(pre) > code {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: 4px; padding: 1px 5px;
  }
  .lg-off-main blockquote {
    margin: 0 0 12px; padding: 8px 14px; border-left: 2px solid var(--accent);
    border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text2);
  }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  ::selection { background: var(--accent-soft); }
  /* 离线时没有 KaTeX 样式：让结构元素按行内文本流式排布，公式仍可读 */
  .katex-display { display: block; text-align: center; margin: 10px 0; }
  .katex .base { display: inline; }
</style></head><body>
<div class="lg-off-bar"><span class="lg-off-dot"></span><b>${esc(snap.pid)}</b>
<span>离线快照${when ? " · 保存于 " + esc(when) : ""}</span><span class="lg-off-fill"></span>
<span>联网后重新打开本题即恢复在线版</span></div>
<div class="lg-off-main">${snap.html}</div>
</body></html>`;
}

function offlineMissingHtml(pid, theme) {
  const c = theme.colors;
  return `<!doctype html><html><head><meta charset="utf-8"><title>没有离线快照</title><style>
  :root { color-scheme: ${theme.isDark ? "dark" : "light"}; }
  html, body { margin: 0; }
  body {
    background: ${c.bg}; color: ${c.text};
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px; line-height: 1.8;
    display: flex; min-height: 100vh; align-items: center; justify-content: center;
  }
  .box {
    width: min(440px, calc(100vw - 48px)); padding: 32px; text-align: center;
    background: color-mix(in srgb, ${c.surface} 95%, transparent);
    border: 1px solid ${c.border}; border-radius: 12px;
    box-shadow: 0 1px 2px ${c.shadow}, 0 8px 24px color-mix(in srgb, ${c.shadow} 55%, transparent);
  }
  .ico {
    width: 40px; height: 40px; margin: 0 auto 14px; border-radius: 50%;
    display: grid; place-items: center; color: ${c.orange};
    background: color-mix(in srgb, ${c.orange} 14%, transparent);
  }
  h1 { font-size: 16px; line-height: 24px; margin: 0 0 6px; font-weight: 600; }
  p { color: ${c.text2}; margin: 0; font-size: 13px; line-height: 20px; }
</style></head><body><div class="box">
<div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 16 16"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M5 12a10 10 0 0 1 3.5-2.3"/><path d="M15.5 9.7A10 10 0 0 1 19 12"/></svg></div>
<h1>当前离线，这道题还没有快照</h1>
<p>${pid ? pid + " 只在联网时打开过才有离线缓存。" : "离线快照地址无效。"}联网打开一次题目后，题面会自动存到本地。</p>
</div></body></html>`;
}

function registerOfflineProtocol(ctx) {
  const serve = (request) => {
    const headers = { "content-type": "text/html; charset=utf-8" };
    try {
      const url = new URL(request.url);
      const pid = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/$/, "")).toUpperCase();
      const snap = pid && ctx.luogu ? ctx.luogu.problemSnapshot(pid) : null;
      if (!snap || !snap.html) {
        return new Response(offlineMissingHtml(pid, ctx.theme), { headers });
      }
      return new Response(offlinePageHtml(snap, ctx.theme), { headers });
    } catch (err) {
      console.error("[lgoff] serve failed:", err.message);
      return new Response(offlineMissingHtml("", ctx.theme), { headers });
    }
  };
  protocol.handle("lgoff", serve);
  // 页面视图全部跑在 persist:luogu 分区，自定义协议必须在那个 session 上也注册一份
  if (ctx.session && ctx.session.protocol) {
    try {
      ctx.session.protocol.handle("lgoff", serve);
    } catch (err) {
      console.error("[lgoff] session register failed:", err.message);
    }
  }
}

module.exports = { offlinePageHtml, offlineMissingHtml, registerOfflineProtocol };
