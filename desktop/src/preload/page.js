/* 洛谷页面 preload：
   1) 首帧底色（防白闪）；
   2) 把题目链接的点击交给主进程开「题目视图」，而不是在板块页里当普通网页跳转。 */
const { ipcRenderer } = require("electron");

const bootArg = (process.argv || []).find((arg) => arg.startsWith("--lg-boot-bg="));
const bootBg = bootArg ? decodeURIComponent(bootArg.slice("--lg-boot-bg=".length)) : "";
let bootPainted = false;

function paintBoot() {
  if (bootPainted || !bootBg) return;
  bootPainted = true;
  try {
    const style = document.createElement("style");
    style.textContent = `html,body{background:${bootBg} !important;}`;
    (document.head || document.documentElement).appendChild(style);
  } catch {
    /* ignore */
  }
}

paintBoot();
document.addEventListener("DOMContentLoaded", paintBoot, { once: true });

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
