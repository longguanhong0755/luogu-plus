/* 页面视图管理的纯函数与容量常量：不依赖 electron，供各实现文件共用。 */
const { canonicalPid } = require("../sections");

const MAX_PROBLEMS = 2;
const MAX_DETAILS = 3;
const MAX_TOTAL_ENTRIES = 4;
const IDE_VERTICAL_BREAKPOINT = 720;
const IDLE_VIEW_MS = Math.max(5000, Number(process.env.LG_VIEW_IDLE_MS) || 90000);

function acceleratorMatches(input, accelerator) {
  const parts = String(accelerator || "").split("+");
  const key = String(parts.pop() || "").toLowerCase();
  const has = (name) => parts.some((part) => part.toLowerCase() === name);
  const ctrl = !!(input.control || input.meta);
  return (
    key === String(input.key || "").toLowerCase() &&
    ctrl === has("ctrl") &&
    !!input.alt === has("alt") &&
    !!input.shift === has("shift")
  );
}

function isLuoguHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "luogu.com.cn" || host.endsWith(".luogu.com.cn") || host === "luogu.org" || host.endsWith(".luogu.org");
}

function isLuoguUrl(raw) {
  try {
    return isLuoguHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function isOfflineUrl(raw) {
  return String(raw || "").startsWith("lgoff://");
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s*-\s*洛谷\s*$/, "")
    .trim();
}

function pidFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "lgoff:") {
      const m = url.pathname.match(/^\/(?:problem\/)?([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)\/?$/);
      return m ? canonicalPid(m[1]) : "";
    }
    const m = url.pathname.match(/^\/problem\/([A-Za-z]{1,4}[A-Za-z0-9_]*\d[A-Za-z0-9_]*)/);
    return m ? canonicalPid(m[1]) : "";
  } catch {
    return "";
  }
}

function sectionOfUrl(raw) {
  try {
    const pathname = new URL(raw).pathname;
    if (pathname.startsWith("/problem/list") || pathname.startsWith("/problem/")) return "problems";
    if (pathname.startsWith("/training")) return "training";
    if (pathname.startsWith("/contest")) return "contest";
    if (pathname.startsWith("/record")) return "record";
    if (pathname.startsWith("/discuss")) return "discuss";
    if (pathname.startsWith("/article")) return "article";
    return "";
  } catch {
    return "";
  }
}
module.exports = {
  MAX_PROBLEMS,
  MAX_DETAILS,
  MAX_TOTAL_ENTRIES,
  IDE_VERTICAL_BREAKPOINT,
  IDLE_VIEW_MS,
  acceleratorMatches,
  isLuoguHost,
  isLuoguUrl,
  isOfflineUrl,
  cleanTitle,
  pidFromUrl,
  sectionOfUrl,
};
