/* 洛谷页面 preload：
   1) 首帧底色（防白闪）；
   2) 通行密钥（WebAuthn）只有用户真实点击后才允许调用，避免登录页一打开就弹
      Windows 安全窗口；
   3) 壁纸运动相位：与外壳用同一个 Date.now 公式，页面里的壁纸复刻层和窗口壁纸
      始终同步；
   4) 把题目链接的点击交给主进程开「题目视图」。 */
const { ipcRenderer } = require("electron");

function argValue(prefix) {
  const hit = (process.argv || []).find((arg) => arg.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
}

const bootBg = argValue("--lg-boot-bg=");
const adBlockOn = argValue("--lg-adblock=") === "1";
const bootMode = argValue("--lg-boot-mode=");
const bootAccent = argValue("--lg-boot-accent=");
let bootPainted = false;

/* 广告拦截的页面级兜底：CSS 规则挂在 html[data-lg-adblock="1"] 上，
   必须在 document-start 置位，避免推广卡先画出来再消失。
   皮肤的主题条件规则（代码高亮）同理挂在 html[data-lg-mode] 上。 */
try {
  document.documentElement.dataset.lgAdblock = adBlockOn ? "1" : "0";
  if (bootMode === "dark" || bootMode === "light") document.documentElement.dataset.lgMode = bootMode;
} catch {
  /* ignore */
}

function paintBoot() {
  if (bootPainted || !bootBg) return;
  bootPainted = true;
  try {
    // 页面视图是透明的，壁纸与唯一一层可调纱层由外壳绘制；
    // 这里只负责阻止 Chromium 默认白底，不能再盖一层不透明主题色。
    let bootCss = `html,body{background:transparent !important;color-scheme:${bootMode === "light" ? "light" : "dark"};}`;
    if (bootAccent.includes(",")) {
      const [accentText, accent] = bootAccent.split(",");
      bootCss += `:root{--lg-accent-text:${accentText};--lg-accent:${accent};}`;
    }
    const style = document.createElement("style");
    style.id = "lg-boot";
    style.textContent = bootCss;
    (document.head || document.documentElement).appendChild(style);
  } catch {
    /* ignore */
  }
}

paintBoot();
document.addEventListener("DOMContentLoaded", paintBoot, { once: true });

/* ---------- 页面加载占位 ----------
   占位层由主进程的 PageReadinessController 驱动：
   - 首次文档由 preload 立即挂载，阻止 Chromium 白底；
   - SPA 导航通过 page:load-state 重新显示；
   - 只有主进程确认路由根节点稳定后才移除；
   - 失败时保留可重试界面，不会在固定秒数后直接消失。 */
(function installPageLoadingSurface() {
  const dark = bootMode !== "light";
  const bootSurface = argValue("--lg-boot-surface=") || (dark ? "#16181d" : "#f5f6f8");
  const accentParts = String(bootAccent || "").split(",");
  const accent = accentParts.length > 1 ? accentParts[1] : (dark ? "#7aa2ff" : "#2f6fed");
  let host = null;
  let shadow = null;
  let wrap = null;
  let errorTitle = null;
  let errorMessage = null;
  let removeTimer = null;
  // 主进程每次导航都会递增 requestId。旧导航迟到的 ready/error 不能覆盖新导航。
  let latestRequestId = 0;

  const make = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  };

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement("div");
    host.id = "lg-boot-skeleton";
    host.setAttribute("aria-busy", "true");
    host.setAttribute("aria-label", "页面加载中");
    host.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483646",
      "pointer-events:none",
      "opacity:0",
      "transition:opacity 160ms ease",
      "background:color-mix(in srgb,var(--lg-load-surface) 74%,transparent)",
      "padding:26px 30px",
      "font:13px/1.5 'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif",
      "--lg-load-surface:" + bootSurface,
      "--lg-load-accent:" + accent,
    ].join(";");
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = [
      "*{box-sizing:border-box}",
      ".wrap{display:grid;gap:14px;max-width:980px;margin:0 auto;color:color-mix(in srgb,var(--lg-load-surface) 22%, #8b93a3)}",
      ".wrap[data-kind='chat'] .summary,.wrap[data-kind='chat'] .side{display:none}",
      ".wrap[data-kind='chat'] .blocks{grid-template-columns:1fr}",
      ".wrap[data-kind='notification'] .side{display:none}",
      ".wrap[data-kind='notification'] .blocks{grid-template-columns:1fr}",
      ".wrap[data-kind='profile'] .side{display:block}",
      ".bar,.line,.block,.msg{position:relative;overflow:hidden;background:color-mix(in srgb,var(--lg-load-surface) 18%, transparent);border-radius:7px}",
      ".bar:after,.line:after,.block:after,.msg:after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--lg-load-accent) 16%,transparent),transparent);animation:shimmer 1.25s ease-in-out infinite}",
      ".head{display:flex;align-items:center;justify-content:space-between;gap:20px}",
      ".title{width:210px;height:22px}.action{width:92px;height:32px;border-radius:7px;background:color-mix(in srgb,var(--lg-load-accent) 16%,transparent)}",
      ".card{display:grid;gap:12px;padding:20px;border:1px solid color-mix(in srgb,var(--lg-load-surface) 18%,transparent);border-radius:12px;background:color-mix(in srgb,var(--lg-load-surface) 10%,transparent)}",
      ".line{height:12px}.l1{width:32%}.l2{width:68%}.l3{width:48%}.l4{width:82%}",
      ".blocks{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(220px,.8fr);gap:14px}",
      ".block{height:150px;border-radius:12px}.tall{height:250px}",
      ".messages{display:grid;gap:10px}.msg{height:44px;border-radius:10px}.msg:nth-child(2){width:72%;margin-left:auto}",
      ".hint{margin-top:2px;font-size:12px;color:color-mix(in srgb,var(--lg-load-surface) 28%, #8b93a3)}",
      ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}",
      ".error{display:none;min-height:100%;place-items:center;padding:24px}.wrap[data-mode='error']{min-height:calc(100vh - 52px)}.wrap[data-mode='error'] .skeleton-view{display:none}.wrap[data-mode='error'] .error{display:grid}",
      ".error-card{width:min(420px,100%);padding:24px;border:1px solid color-mix(in srgb,var(--lg-load-surface) 22%,transparent);border-radius:14px;background:color-mix(in srgb,var(--lg-load-surface) 80%,transparent);box-shadow:0 16px 44px rgba(0,0,0,.12);text-align:center}",
      ".error-title{font-size:16px;font-weight:700;color:color-mix(in srgb,var(--lg-load-surface) 12%, #e9edf5)}.error-message{margin-top:8px;font-size:13px;line-height:1.6;color:color-mix(in srgb,var(--lg-load-surface) 32%, #8b93a3)}",
      ".retry{margin-top:16px;height:32px;padding:0 16px;border:1px solid color-mix(in srgb,var(--lg-load-accent) 46%,transparent);border-radius:8px;background:color-mix(in srgb,var(--lg-load-accent) 18%,transparent);color:inherit;font:inherit;cursor:pointer}",
      ".retry:hover{background:color-mix(in srgb,var(--lg-load-accent) 28%,transparent)}",
      "@keyframes shimmer{to{transform:translateX(100%)}}",
      "@media (prefers-reduced-motion:reduce){.bar:after,.line:after,.block:after,.msg:after{animation:none}}",
      "@media (max-width:820px){.blocks{grid-template-columns:1fr}.side{display:none}}",
    ].join("\n");
    shadow.appendChild(style);
    wrap = make("div", "wrap", shadow);
    wrap.dataset.kind = "generic";
    wrap.dataset.mode = "loading";
    wrap.setAttribute("role", "status");
    make("span", "sr", wrap).textContent = "页面正在加载，请稍候";
    const skeleton = make("div", "skeleton-view", wrap);
    const head = make("div", "head", skeleton);
    make("div", "bar title", head);
    make("div", "bar action", head);
    const summary = make("div", "card summary", skeleton);
    make("div", "line l2", summary);
    make("div", "line l1", summary);
    const blocks = make("div", "blocks", skeleton);
    const main = make("div", "card", blocks);
    const messages = make("div", "messages", main);
    for (let i = 0; i < 3; i++) make("div", "msg", messages);
    make("div", "line l4", main);
    make("div", "line l2", main);
    const side = make("div", "card side", blocks);
    make("div", "line l1", side);
    make("div", "block tall", side);
    const footer = make("div", "card", skeleton);
    make("div", "line l3", footer);
    make("div", "line l4", footer);
    make("div", "line l2", footer);
    make("div", "hint", skeleton).textContent = "正在载入洛谷页面…";
    const error = make("div", "error", wrap);
    const errorCard = make("div", "error-card", error);
    errorTitle = make("div", "error-title", errorCard);
    errorMessage = make("div", "error-message", errorCard);
    const retry = make("button", "retry", errorCard);
    retry.type = "button";
    retry.textContent = "重新加载";
    retry.addEventListener("click", () => location.reload());

    let mounted = false;
    function mount() {
      const root = document.documentElement || document.body;
      if (!root) {
        setTimeout(mount, 0);
        return;
      }
      if (!mounted) {
        root.appendChild(host);
        mounted = true;
      }
      requestAnimationFrame(() => {
        if (host && host.isConnected) host.style.opacity = "1";
      });
    }
    mount();
    return host;
  }

  function show(kind, title) {
    clearTimeout(removeTimer);
    ensureHost();
    wrap.dataset.mode = "loading";
    wrap.dataset.kind = kind || "generic";
    wrap.setAttribute("aria-busy", "true");
    if (title) wrap.setAttribute("aria-label", title + "加载中");
    // 导航期间吞掉落在旧内容上的点击，避免用户把点击丢进即将销毁的页面。
    host.setAttribute("aria-busy", "true");
    host.setAttribute("aria-label", title ? title + "加载中" : "页面加载中");
    host.setAttribute("aria-hidden", "false");
    host.style.pointerEvents = "auto";
    host.style.opacity = "1";
    const hint = shadow.querySelector(".hint");
    if (hint) hint.textContent = title ? "正在载入" + title + "…" : "正在载入洛谷页面…";
  }

  function hide() {
    if (!host) return;
    host.setAttribute("aria-busy", "false");
    host.setAttribute("aria-hidden", "true");
    host.style.pointerEvents = "none";
    host.style.opacity = "0";
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => {
      if (!host) return;
      if (host.isConnected) host.remove();
      host = null;
      shadow = null;
      wrap = null;
    }, 180);
  }

  function fail(message) {
    clearTimeout(removeTimer);
    ensureHost();
    wrap.dataset.mode = "error";
    wrap.setAttribute("aria-busy", "false");
    host.setAttribute("aria-busy", "false");
    host.setAttribute("aria-hidden", "false");
    host.style.pointerEvents = "auto";
    host.style.opacity = "1";
    errorTitle.textContent = "页面没有加载完成";
    errorMessage.textContent = message || "请检查网络或登录状态后重试。";
  }

  ipcRenderer.on("page:load-state", (_event, payload) => {
    if (!payload) return;
    const requestId = Number(payload.requestId) || 0;
    if (requestId && requestId < latestRequestId) return;
    if (requestId) latestRequestId = requestId;
    const phase = String(payload.phase || "");
    if (phase === "ready") {
      hide();
      return;
    }
    if (phase === "error") {
      fail(payload.message);
      return;
    }
    show(payload.skeleton, payload.title);
  });

  // 首次文档在 preload 阶段立刻显示，避免主进程事件抵达前出现 Chromium 白底。
  show("generic", "页面");
})();

/* ---------- 通行密钥守卫 ----------
   页面主世界由 CDP 更早拦截；这里作为隔离世界兜底。桌面版不弹出
   Windows Hello / 安全密钥窗口，密码和 Cookie 登录保持正常。 */
try {
  const blocked = () => new Promise(() => {});
  const credentials = navigator.credentials;
  if (credentials && typeof credentials.get === "function") {
    const siteGet = credentials.get.bind(credentials);
    const siteCreate = typeof credentials.create === "function" ? credentials.create.bind(credentials) : null;
    const isWebAuthn = (options) => !!(options && options.publicKey);
    Object.defineProperty(credentials, "get", {
      configurable: true,
      value: (options) => (isWebAuthn(options) ? blocked() : siteGet(options)),
    });
    if (siteCreate) {
      Object.defineProperty(credentials, "create", {
        configurable: true,
        value: (options) => (isWebAuthn(options) ? blocked() : siteCreate(options)),
      });
    }
  }
} catch {
  /* 某些页面会冻结 navigator，失败时仍由主世界 CDP 守卫兜底 */
}

/* ---------- 应用轻提示 ----------
   页面视图盖在外壳之上，外壳的 toast 会被挡住；主进程把同一份 toast
   也发给当前页面，这里画在页面顶层（颜色跟随皮肤变量，缺失时用深色兜底）。 */
let pageToastTimer = 0;
ipcRenderer.on("app:toast", (_event, payload) => {
  if (!payload || (!payload.title && !payload.body)) return;
  const hostId = "lg-page-toast";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    host.style.cssText = [
      "position:fixed",
      "top:14px",
      "right:18px",
      "z-index:2147483647",
      "max-width:min(360px, calc(100vw - 40px))",
      "padding:10px 14px",
      "border-radius:10px",
      "border:1px solid var(--lg-border-strong, rgba(255,255,255,0.18))",
      "background:var(--lg-surface, #1d2027)",
      "color:var(--lg-text, #f2f3f6)",
      "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
      "font:13px/1.5 'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif",
      "cursor:pointer",
      "transition:opacity 160ms ease, transform 160ms ease",
    ].join(";");
    host.addEventListener("click", () => dismissPageToast());
    (document.body || document.documentElement).appendChild(host);
  }
  host.textContent = "";
  const title = document.createElement("b");
  title.textContent = String(payload.title || "");
  title.style.cssText = "display:block;font-weight:600";
  host.appendChild(title);
  if (payload.body) {
    const body = document.createElement("span");
    body.textContent = String(payload.body);
    host.appendChild(body);
  }
  host.style.opacity = "1";
  host.style.transform = "translateY(0)";
  if (pageToastTimer) clearTimeout(pageToastTimer);
  pageToastTimer = setTimeout(dismissPageToast, 5000);
});

function dismissPageToast() {
  if (pageToastTimer) clearTimeout(pageToastTimer);
  pageToastTimer = 0;
  const host = document.getElementById("lg-page-toast");
  if (!host) return;
  host.style.opacity = "0";
  host.style.transform = "translateY(-6px)";
  setTimeout(() => host && host.remove(), 200);
}

/* ---------- 页内查找条（Ctrl+F）与缩放提示（Ctrl +/- / 0） ----------
   页面视图盖在外壳之上，查找条画在页面 preload 顶层；主进程驱动
   findInPage，found-in-page 回传匹配数。Esc 关闭并清除高亮。 */
let lgFind = null;
function lgFindShow() {
  const doc = document;
  if (!lgFind || !lgFind.isConnected) {
    lgFind = doc.createElement("div");
    lgFind.id = "lg-find-bar";
    lgFind.style.cssText = [
      "position:fixed",
      "top:10px",
      "right:18px",
      "z-index:2147483647",
      "display:none",
      "align-items:center",
      "gap:6px",
      "padding:6px 10px",
      "border-radius:8px",
      "border:1px solid rgba(255,255,255,0.18)",
      "background:#20242d",
      "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
      "font:13px/1.4 'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif",
      "color:#e8eaef",
    ].join(";");
    const input = doc.createElement("input");
    input.type = "text";
    input.placeholder = "在页面中查找";
    input.spellcheck = false;
    input.style.cssText =
      "width:180px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);" +
      "background:rgba(255,255,255,0.08);color:#e8eaef;outline:none;font:inherit";
    const count = doc.createElement("span");
    count.style.cssText = "min-width:44px;text-align:center;font-size:12px;opacity:0.8";
    const mk = (label, title, fn) => {
      const btn = doc.createElement("button");
      btn.textContent = label;
      btn.title = title;
      btn.style.cssText =
        "width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);" +
        "background:rgba(255,255,255,0.08);color:#e8eaef;cursor:pointer;font:inherit;padding:0";
      btn.addEventListener("click", fn);
      return btn;
    };
    const send = (action) => {
      const q = input.value;
      if (!q) {
        ipcRenderer.invoke("app:find", { action: "close" });
        return;
      }
      ipcRenderer.invoke("app:find", { action, query: q });
    };
    input.addEventListener("input", () => {
      clearTimeout(lgFind.__t);
      lgFind.__t = setTimeout(() => send("start"), 260);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send(e.shiftKey ? "prev" : "next");
      } else if (e.key === "Escape") {
        e.preventDefault();
        ipcRenderer.invoke("app:find", { action: "close" });
        lgFind.style.display = "none";
      }
    });
    lgFind.appendChild(input);
    lgFind.appendChild(count);
    lgFind.appendChild(mk("↑", "上一个（Shift+Enter）", () => send("prev")));
    lgFind.appendChild(mk("↓", "下一个（Enter）", () => send("next")));
    lgFind.appendChild(mk("×", "关闭（Esc）", () => {
      ipcRenderer.invoke("app:find", { action: "close" });
      lgFind.style.display = "none";
    }));
    (doc.body || doc.documentElement).appendChild(lgFind);
    lgFind.__count = count;
  }
  lgFind.style.display = "flex";
  const box = lgFind.querySelector("input");
  if (box) box.focus();
}

ipcRenderer.on("app:find-open", () => lgFindShow());
ipcRenderer.on("app:find-result", (_event, r) => {
  if (lgFind && lgFind.__count && r) {
    lgFind.__count.textContent = (r.active || 0) + "/" + (r.matches || 0);
  }
});

/* Esc 全局兜底：查找条可见时按 Esc 即关闭并清高亮（焦点在哪都行） */
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || !lgFind || lgFind.style.display === "none") return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke("app:find", { action: "close" });
    lgFind.style.display = "none";
  },
  true
);

/* ---------- 缩放提示 HUD ---------- */
let lgZoomTimer = 0;
ipcRenderer.on("app:zoom-hud", (_event, text) => {
  let hud = document.getElementById("lg-zoom-hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "lg-zoom-hud";
    hud.style.cssText = [
      "position:fixed",
      "top:14px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "pointer-events:none",
      "padding:6px 16px",
      "border-radius:999px",
      "background:rgba(0,0,0,0.72)",
      "color:#f2f3f6",
      "font:13px/1.4 'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif",
      "transition:opacity 180ms ease",
    ].join(";");
    (document.body || document.documentElement).appendChild(hud);
  }
  hud.textContent = String(text || "");
  hud.style.opacity = "1";
  if (lgZoomTimer) clearTimeout(lgZoomTimer);
  lgZoomTimer = setTimeout(() => {
    hud.style.opacity = "0";
    setTimeout(() => hud && hud.remove(), 220);
  }, 900);
});

/* ---------- 题目链接交给应用 ---------- */
document.addEventListener(
  "click",
  (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    const target = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!target) return;
    let url;
    try {
      url = new URL(target.href, location.href);
    } catch {
      return;
    }
    if (url.hostname !== "www.luogu.com.cn" && url.hostname !== "luogu.com.cn") return;
    const match = url.pathname.match(/^\/problem\/([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)\/?$/);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send("page:open-problem", match[1]); // 主进程 canonicalPid 规范化
  },
  true
);

/* ---------- Luogu Plus 兼容增强 ----------
   功能均使用安全的 DOM API；远程用户介绍只用 textContent，不拼 innerHTML。 */
let features = {};
try {
  features = JSON.parse(argValue("--lg-features=") || "{}");
} catch {
  features = {};
}

const LGD = {
  detect: null,
  detectTimer: 0,
  selectionTimer: 0,
  introUid: "",
  colorNodes: new Set(),
  observer: null,
  observeTimer: 0,
};

function featureOn(name) {
  return !!features[name];
}

function readLentille() {
  try {
    const node = document.getElementById("lentille-context");
    return node ? JSON.parse(node.textContent || "{}") : null;
  } catch {
    return null;
  }
}

function problemIdsInText(text) {
  const words = String(text || "").split(/\s+|[,.;?!()[\]{}，。；：！？、]+/);
  const ids = [];
  for (const word of words) {
    const value = word.replace(/^\W+|\W+$/g, "").toUpperCase();
    if (
      /^(?:AT_?[A-Z0-9_]+|CF\d{1,4}[A-Z]\d?|SP\d{1,5}|UVA\d{1,5}|[PBU]\d{1,6})$/.test(value) &&
      !ids.includes(value)
    ) {
      ids.push(value);
    }
  }
  return ids.slice(0, 8);
}

function closeProblemDetect() {
  if (LGD.detectTimer) clearTimeout(LGD.detectTimer);
  LGD.detectTimer = 0;
  if (LGD.detect) LGD.detect.remove();
  LGD.detect = null;
}

function showProblemDetect(ids) {
  closeProblemDetect();
  const box = document.createElement("div");
  box.id = "lg-problem-detect";
  box.className = "lg-problem-detect";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "识别到题目编号");

  const head = document.createElement("div");
  head.className = "lg-problem-detect-head";
  const title = document.createElement("span");
  title.textContent = "识别到 " + ids.length + " 个题目";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "×";
  close.addEventListener("click", closeProblemDetect);
  head.appendChild(title);
  head.appendChild(close);
  box.appendChild(head);

  const list = document.createElement("div");
  list.className = "lg-problem-detect-list";
  for (const pid of ids) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = pid;
    button.title = "打开 " + pid;
    button.addEventListener("click", () => {
      closeProblemDetect();
      ipcRenderer.send("page:open-problem", pid);
    });
    list.appendChild(button);
  }
  box.appendChild(list);
  box.addEventListener("mouseenter", () => clearTimeout(LGD.detectTimer));
  box.addEventListener("mouseleave", () => {
    LGD.detectTimer = setTimeout(closeProblemDetect, 3000);
  });
  (document.body || document.documentElement).appendChild(box);
  LGD.detect = box;
  LGD.detectTimer = setTimeout(closeProblemDetect, 6000);
}

function handleSelection() {
  if (!featureOn("problemDetect")) return;
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : "";
  if (!text) return;
  const ids = problemIdsInText(text);
  if (ids.length) showProblemDetect(ids);
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function appendIntroInline(parent, raw) {
  const text = String(raw || "");
  const token = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\$[^$]+\$)/g;
  let last = 0;
  let match;
  while ((match = token.exec(text))) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const value = match[0];
    if (value.startsWith("![")) {
      const imageMatch = value.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const src = safeLink(imageMatch && imageMatch[2]);
      if (src) {
        const image = document.createElement("img");
        image.src = src;
        image.alt = imageMatch[1] || "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        parent.appendChild(image);
      } else {
        parent.appendChild(document.createTextNode(value));
      }
    } else if (value.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = value.slice(2, -2);
      parent.appendChild(strong);
    } else if (value.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = value.slice(1, -1);
      parent.appendChild(code);
    } else if (value.startsWith("[")) {
      const linkMatch = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = safeLink(linkMatch && linkMatch[2]);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = linkMatch[1];
        parent.appendChild(link);
      } else {
        parent.appendChild(document.createTextNode(value));
      }
    } else {
      const math = document.createElement("span");
      math.className = "lg-katex-inline";
      math.textContent = value.slice(1, -1);
      parent.appendChild(math);
    }
    last = match.index + value.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function introVideoBvid(line) {
  const match = String(line || "").match(/(?:bilibili\s*:|bilibili\.com\/video\/)(BV[a-zA-Z0-9]+)/i);
  return match ? match[1] : "";
}

function renderIntroMarkdown(body, intro) {
  body.textContent = "";
  const lines = String(intro || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendIntroInline(p, paragraph.join(" "));
    body.appendChild(p);
    paragraph = [];
  };
  const flushList = () => {
    list = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      const codeLines = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++]);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      body.appendChild(pre);
      continue;
    }
    const bvid = introVideoBvid(line.trim());
    if (bvid) {
      flushParagraph();
      flushList();
      const frame = document.createElement("iframe");
      frame.className = "lg-intro-video";
      frame.src = "https://player.bilibili.com/player.html?bvid=" + encodeURIComponent(bvid) + "&page=1";
      frame.title = "Bilibili 视频 " + bvid;
      frame.loading = "lazy";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "no-referrer";
      body.appendChild(frame);
      continue;
    }
    const container = line.match(/^:::(info|warning|success|error|details|align|cute-table)(?:\{([^}]*)\})?\s*(.*)$/);
    if (container) {
      flushParagraph();
      flushList();
      const inner = [];
      index++;
      while (index < lines.length && !/^:::\s*$/.test(lines[index])) inner.push(lines[index++]);
      const box = document.createElement(container[1] === "details" ? "details" : "div");
      box.className = "lg-md-container lg-md-" + container[1];
      if (container[1] === "details") {
        const summary = document.createElement("summary");
        summary.textContent = container[3] || "展开内容";
        box.appendChild(summary);
      } else if (container[3]) {
        const title = document.createElement("div");
        title.className = "lg-md-container-title";
        title.textContent = container[3];
        box.appendChild(title);
      }
      const innerWrap = document.createElement("div");
      renderIntroMarkdown(innerWrap, inner.join("\n"));
      box.appendChild(innerWrap);
      body.appendChild(box);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cellText of headers) {
        const th = document.createElement("th");
        appendIntroInline(th, cellText);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      index += 2;
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const cells = lines[index].split("|").slice(1, -1);
        const row = document.createElement("tr");
        for (const cellText of cells) {
          const td = document.createElement("td");
          appendIntroInline(td, cellText.trim());
          row.appendChild(td);
        }
        tbody.appendChild(row);
        index++;
      }
      index--;
      table.appendChild(tbody);
      body.appendChild(table);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const h = document.createElement("h" + Math.min(4, heading[1].length + 1));
      appendIntroInline(h, heading[2]);
      body.appendChild(h);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      const quote = document.createElement("blockquote");
      appendIntroInline(quote, line.replace(/^\s*>\s?/, ""));
      body.appendChild(quote);
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (item) {
      flushParagraph();
      if (!list) {
        list = document.createElement("ul");
        body.appendChild(list);
      }
      const li = document.createElement("li");
      appendIntroInline(li, item[1]);
      list.appendChild(li);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  if (!body.childElementCount) body.textContent = "该用户尚未填写个人介绍。";
}

function currentUid() {
  const match = location.pathname.match(/^\/user\/(\d+)\/?$/);
  return match ? match[1] : "";
}

function insertUserIntro() {
  if (!featureOn("showUserIntro")) {
    for (const node of document.querySelectorAll("[data-lgplus-user-intro]")) node.remove();
    return;
  }
  const uid = currentUid();
  const existing = document.querySelector("[data-lgplus-user-intro]");
  if (!uid) {
    if (existing) existing.remove();
    return;
  }
  const context = readLentille();
  const user =
    (context && context.data && context.data.user) ||
    (context && context.currentData && context.currentData.user) ||
    (context && context.user) ||
    null;
  if (!user || String(user.uid || "") !== uid) {
    if (existing && existing.dataset.lgPlusUid !== uid) existing.remove();
    return;
  }
  const intro = String(user.introduction || "").trim();
  let card = existing;
  if (card && card.dataset.lgPlusUid === uid) {
    const body = card.querySelector(".lg-plus-intro-body");
    if (body && body.dataset.lgIntroSource !== intro) {
      body.dataset.lgIntroSource = intro;
      renderIntroMarkdown(body, intro);
    }
    return;
  }
  if (existing) existing.remove();
  const headings = Array.from(document.querySelectorAll(".l-card .header h3.lfe-h3"));
  const targetHeading = headings.find((node) => /等级分趋势图/.test(node.textContent || "")) || headings[0] || null;
  const targetCard = targetHeading ? targetHeading.closest(".l-card") : null;
  if (!targetCard || !targetCard.parentNode) return;
  const body = document.createElement("div");
  body.className = "lfe-marked-wrap introduction lg-plus-intro-body";
  body.dataset.lgIntroSource = intro;
  const marked = document.createElement("div");
  marked.className = "lfe-marked";
  renderIntroMarkdown(marked, intro);
  body.appendChild(marked);
  card = targetCard.cloneNode(false);
  card.classList.add("lg-plus-intro-card");
  card.setAttribute("data-lgplus-user-intro", "1");
  card.dataset.lgPlusUid = uid;
  const originalHeader = targetCard.querySelector(".header");
  const header = originalHeader ? originalHeader.cloneNode(true) : document.createElement("div");
  header.className = "header";
  const h = header.querySelector("h3") || document.createElement("h3");
  h.className = "lfe-h3";
  h.textContent = "个人介绍";
  const tag = document.createElement("span");
  tag.className = "lg-plus-source";
  tag.textContent = "增强功能";
  h.appendChild(tag);
  if (!h.parentNode) header.appendChild(h);
  card.appendChild(header);
  card.appendChild(body);
  targetCard.parentNode.insertBefore(card, targetCard.nextSibling);
  LGD.introUid = uid;
}

function pidFromHref(href) {
  try {
    const match = new URL(href, location.href).pathname.match(/^\/problem\/([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)/);
    return match ? match[1].toUpperCase() : "";
  } catch {
    return "";
  }
}

function restoreDifficultyColors() {
  for (const node of LGD.colorNodes) {
    if (!node || !node.isConnected) continue;
    node.style.removeProperty("color");
    node.style.removeProperty("font-weight");
    node.removeAttribute("data-lgplus-difficulty");
  }
  LGD.colorNodes.clear();
}

function applyDifficultyColors() {
  if (!featureOn("problemDifficultyColor") || !/^\/user\/\d+\/practice\/?$/.test(location.pathname)) {
    restoreDifficultyColors();
    return;
  }
  const context = readLentille();
  const submitted =
    (context && context.data && context.data.submitted) ||
    (context && context.currentData && context.currentData.submitted) ||
    [];
  const uid = (location.pathname.match(/^\/user\/(\d+)\/practice\/?$/) || [])[1] || "";
  const cacheKey = uid ? "lgplus:difficulty:" + uid : "";
  const colors = {
    1: "#fe4c61",
    2: "#f39c11",
    3: "#ffc116",
    4: "#52c41a",
    5: "#13c2c2",
    6: "#3498db",
    7: "#9d3dcf",
    8: "#0e1d69",
  };
  let cached = null;
  if (cacheKey) {
    try {
      const raw = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (raw && Date.now() - Number(raw.at || 0) < 24 * 60 * 60 * 1000 && raw.map && typeof raw.map === "object") cached = raw.map;
    } catch {}
  }
  const map = new Map(cached ? Object.entries(cached) : []);
  if (Array.isArray(submitted) && submitted.length) {
    map.clear();
    for (const item of submitted) {
      const pid = String((item && (item.pid || (item.problem && item.problem.pid))) || "").toUpperCase();
      const difficulty = Number(item && item.difficulty !== undefined ? item.difficulty : item && item.problem && item.problem.difficulty);
      if (!pid || !colors[difficulty]) continue;
      map.set(pid, difficulty);
      map.set(pid.replace(/_/g, ""), difficulty);
    }
    if (cacheKey) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), map: Object.fromEntries(map) }));
      } catch {}
    }
  }
  if (!map.size) return;
  for (const link of document.querySelectorAll('a[href*="/problem/"]')) {
    const pid = pidFromHref(link.href);
    const difficulty = map.get(pid) || map.get(pid.replace(/_/g, "")) || 0;
    if (!difficulty) continue;
    link.setAttribute("data-lgplus-difficulty", String(difficulty));
    LGD.colorNodes.add(link);
  }
}

function restoreFortune() {
  for (const node of document.querySelectorAll('[data-lgplus-fortune="1"]')) {
    if (node.dataset.lgOriginalText !== undefined) node.textContent = node.dataset.lgOriginalText;
    if (node.dataset.lgOriginalColor !== undefined) node.style.color = node.dataset.lgOriginalColor;
    delete node.dataset.lgOriginalText;
    delete node.dataset.lgOriginalColor;
    node.removeAttribute("data-lgplus-fortune");
  }
}

function applyFortune() {
  if (!featureOn("changeFortune")) {
    restoreFortune();
    return;
  }
  const result = document.querySelector(".lg-punch-result");
  if (!result) return;
  if (result.dataset.lgOriginalText === undefined) result.dataset.lgOriginalText = result.textContent;
  if (result.dataset.lgOriginalColor === undefined) result.dataset.lgOriginalColor = result.style.color || "";
  if (result.textContent !== "§ 大吉 §") result.textContent = "§ 大吉 §";
  result.style.setProperty("color", "#e74c3c", "important");
  result.setAttribute("data-lgplus-fortune", "1");
  const punch = result.closest(".lg-punch") || result.parentElement;
  const advice = punch ? [...punch.querySelectorAll(".am-u-sm-6")] : [];
  for (const node of advice) {
    if (node.dataset.lgOriginalText === undefined) node.dataset.lgOriginalText = node.textContent;
    if (node.textContent !== "万事皆宜") node.textContent = "万事皆宜";
    node.setAttribute("data-lgplus-fortune", "1");
  }
}

function runEnhancements() {
  insertUserIntro();
  applyDifficultyColors();
  applyFortune();
}

function syncObserver() {
  if (LGD.observer) LGD.observer.disconnect();
  LGD.observer = null;
  if (!featureOn("dynamicDetection")) return;
  LGD.observer = new MutationObserver(() => {
    clearTimeout(LGD.observeTimer);
    LGD.observeTimer = setTimeout(runEnhancements, 260);
  });
  LGD.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

function applyFeatures(next) {
  features = next && typeof next === "object" ? next : {};
  if (!featureOn("problemDetect")) closeProblemDetect();
  runEnhancements();
  syncObserver();
}

document.addEventListener("mouseup", (event) => {
  if (!featureOn("problemDetect")) return;
  if (event.target && event.target.closest && event.target.closest("#lg-problem-detect")) return;
  setTimeout(handleSelection, 180);
});
document.addEventListener("selectionchange", () => {
  if (!featureOn("problemDetect")) return;
  if (window.matchMedia("(pointer: coarse)").matches) setTimeout(handleSelection, 220);
});
window.addEventListener("popstate", runEnhancements);
window.addEventListener("hashchange", runEnhancements);
ipcRenderer.on("lg:features", (_event, next) => applyFeatures(next));

const startEnhancements = () => {
  runEnhancements();
  syncObserver();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startEnhancements, { once: true });
else startEnhancements();
