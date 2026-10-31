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
let motionOn = argValue("--lg-motion=") === "1";
let zoomOn = argValue("--lg-zoom=") === "1";
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
    let bootCss = `html,body{background:${bootBg} !important;}`;
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

/* ---------- 通行密钥守卫 ---------- */
try {
  const credentials = navigator.credentials;
  if (credentials && typeof credentials.get === "function") {
    const siteGet = credentials.get.bind(credentials);
    const siteCreate = typeof credentials.create === "function" ? credentials.create.bind(credentials) : null;
    const guard = (original, method) =>
      function (options) {
        const isWebAuthn = !!(options && (options.publicKey || options.mediation || method === "create"));
        const active = !!(navigator.userActivation && navigator.userActivation.isActive);
        if (isWebAuthn && !active) {
          return Promise.reject(
            new DOMException("Passkey requires a user gesture in Luogu Desktop", "NotAllowedError")
          );
        }
        return original(options);
      };
    Object.defineProperty(credentials, "get", {
      configurable: true,
      value: guard(siteGet, "get"),
    });
    if (siteCreate) {
      Object.defineProperty(credentials, "create", {
        configurable: true,
        value: guard(siteCreate, "create"),
      });
    }
  }
} catch {
  /* 某些页面会冻结 navigator，失败时退回 Chromium 默认行为 */
}

/* ---------- 壁纸运动相位 ----------
   只在确实需要动画时跑 rAF；滚动/隐藏/失焦时冻结，
   性能模式（lg:motion 全 false）直接停表，不再每帧写 CSS 变量。 */
let frameRaf = 0;
let frameLast = 0;
let scrolling = false;
let scrollTimer = null;

function stopMotion(reset) {
  if (frameRaf) cancelAnimationFrame(frameRaf);
  frameRaf = 0;
  if (!reset) return;
  const style = document.documentElement.style;
  style.setProperty("--lg-pan-x", "0px");
  style.setProperty("--lg-pan-y", "0px");
  style.setProperty("--lg-zoom", "1");
}

function tickMotion(now) {
  frameRaf = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ((!motionOn && !zoomOn) || reduced || document.hidden || scrolling) {
    stopMotion((!motionOn && !zoomOn) || reduced);
    return;
  }
  if (now && frameLast && now - frameLast < 33) {
    frameRaf = requestAnimationFrame(tickMotion);
    return;
  }
  frameLast = now || 0;
  const style = document.documentElement.style;
  const t = Date.now();
  if (motionOn) {
    style.setProperty("--lg-pan-x", (Math.sin(t / 11000) * 6).toFixed(2) + "px");
    style.setProperty("--lg-pan-y", (Math.cos(t / 15000) * 4).toFixed(2) + "px");
  } else {
    style.setProperty("--lg-pan-x", "0px");
    style.setProperty("--lg-pan-y", "0px");
  }
  style.setProperty("--lg-zoom", zoomOn ? (1.055 + Math.sin(t / 19000) * 0.012).toFixed(4) : "1");
  frameRaf = requestAnimationFrame(tickMotion);
}

function syncMotion() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ((motionOn || zoomOn) && !reduced && !document.hidden && !scrolling) {
    if (!frameRaf) {
      frameLast = 0;
      frameRaf = requestAnimationFrame(tickMotion);
    }
  } else {
    stopMotion((!motionOn && !zoomOn) || reduced);
  }
}

document.addEventListener(
  "scroll",
  () => {
    scrolling = true;
    syncMotion();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      syncMotion();
    }, 140);
  },
  true
);
document.addEventListener("visibilitychange", syncMotion);
requestAnimationFrame(() => syncMotion());

ipcRenderer.on("lg:motion", (_event, payload) => {
  motionOn = !!(payload && payload.motion);
  zoomOn = !!(payload && payload.zoom);
  syncMotion();
});

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
