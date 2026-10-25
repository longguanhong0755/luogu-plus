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
let bootPainted = false;

function paintBoot() {
  if (bootPainted || !bootBg) return;
  bootPainted = true;
  try {
    const style = document.createElement("style");
    style.id = "lg-boot";
    style.textContent = `html,body{background:${bootBg} !important;}`;
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

/* ---------- 壁纸运动相位 ---------- */
let frame = 0;
function tickMotion() {
  frame++;
  if (frame % 2 === 0) {
    const style = document.documentElement.style;
    const t = Date.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (motionOn && !reduced) {
      style.setProperty("--lg-pan-x", (Math.sin(t / 11000) * 6).toFixed(2) + "px");
      style.setProperty("--lg-pan-y", (Math.cos(t / 15000) * 4).toFixed(2) + "px");
    } else {
      style.setProperty("--lg-pan-x", "0px");
      style.setProperty("--lg-pan-y", "0px");
    }
    style.setProperty("--lg-zoom", zoomOn && !reduced ? (1.055 + Math.sin(t / 19000) * 0.012).toFixed(4) : "1");
  }
  requestAnimationFrame(tickMotion);
}
requestAnimationFrame(tickMotion);

ipcRenderer.on("lg:motion", (_event, payload) => {
  motionOn = !!(payload && payload.motion);
  zoomOn = !!(payload && payload.zoom);
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
    const match = url.pathname.match(/^\/problem\/([A-Za-z]{1,4}\d+[A-Za-z0-9]*)\/?$/);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send("page:open-problem", match[1].toUpperCase());
  },
  true
);
