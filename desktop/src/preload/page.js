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
