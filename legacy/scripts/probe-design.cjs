#!/usr/bin/env node
/* ============================================================
   Luogu++ — 设计令牌运行时探针
   用法: node scripts/probe-design.cjs <port> [输出json]

   为什么静态 lint 不够：lint 只能看"源码写了什么"，看不出"渲染出来是不是
   统一的"。真实踩过：.nav-item 里 `border-radius: var(--lg-radius)`（8px）
   被同规则后面的 `border-radius: var(--lg-radius-sm)`（4px）静默覆盖，
   静态检查两个值都"合法"，只有量到实际渲染值才发现不对。

   断言：
     1 按钮高度只有规范档（28/32/40；色块类 26 放行）
     2 主要按钮类（.btn / .nav-item）圆角统一 8px
     3 分段控件内层圆角 = 外层 − 2px（嵌套圆角公式）
     4 页面上没有非整数字号（半像素在 1x 屏会被对齐、2x 屏发糊）
     5 本地页资源走 lgasset://（绕开 file:// 的顽固缓存）
   ============================================================ */
const http = require("http");
const fs = require("fs");
const PORT = Number(process.argv[2] || 9309);
const OUT = process.argv[3] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 6000 }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
function connect(u) { return new Promise((r) => { const ws = new WebSocket(u); ws.onopen = () => r(ws); ws.onerror = () => r(null); }); }
function mk(ws) {
  let id = 0; const p = new Map();
  ws.addEventListener("message", (e) => {
    const j = JSON.parse(e.data);
    if (j.id && p.has(j.id)) { const c = p.get(j.id); p.delete(j.id); j.error ? c.no(new Error(j.error.message)) : c.ok(j.result); }
  });
  return (m, pr = {}) => new Promise((ok, no) => {
    const i = ++id; p.set(i, { ok, no });
    ws.send(JSON.stringify({ id: i, method: m, params: pr }));
    setTimeout(() => { if (p.has(i)) { p.delete(i); no(new Error("timeout " + m)); } }, 20000);
  });
}
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail == null ? "" : String(detail) });
  console.log((pass ? "  PASS  " : "  FAIL  ") + name + (detail != null ? "   " + detail : ""));
}

(async () => {
  const chromeT = (await targets()).find((t) => t.type === "page" && /chrome\.html/.test(t.url));
  if (!chromeT) throw new Error("找不到 chrome 视图");
  const cw = await connect(chromeT.webSocketDebuggerUrl);
  const cs = mk(cw);
  await cs("Runtime.evaluate", { expression: "window.lgChrome.openSettings()" });
  await sleep(3500);
  const setT = (await targets()).find((t) => t.type === "page" && /settings\.html/.test(t.url));
  if (!setT) throw new Error("设置页没打开");
  const sw = await connect(setT.webSocketDebuggerUrl);
  const ss = mk(sw);

  const expr = `(()=>{
    const hist=(a)=>{const m={};for(const v of a)m[v]=(m[v]||0)+1;return m;};
    const vis=[...document.querySelectorAll("*")].filter(e=>e.offsetParent!==null);
    const btns=vis.filter(e=>e.tagName==="BUTTON");
    const out={};
    out.heights=hist(btns.map(b=>Math.round(b.getBoundingClientRect().height)));
    out.radii=hist(btns.map(b=>getComputedStyle(b).borderRadius));
    out.fontSizes=hist(vis.filter(e=>e.children.length===0).map(e=>getComputedStyle(e).fontSize));
    out.mainBtnRadii=btns.filter(b=>/\\b(btn|nav-item)\\b/.test(b.className))
      .map(b=>getComputedStyle(b).borderRadius);
    out.segOuter=(()=>{const s=document.querySelector(".seg");return s?getComputedStyle(s).borderRadius:"-";})();
    out.segInner=(()=>{const s=document.querySelector(".seg button");return s?getComputedStyle(s).borderRadius:"-";})();
    out.links=[...document.querySelectorAll("link[rel=stylesheet]")].map(l=>l.getAttribute("href"));
    out.scripts=[...document.querySelectorAll("script[src]")].map(s=>s.getAttribute("src"));
    return JSON.stringify(out);
  })()`;
  const r = await ss("Runtime.evaluate", { expression: expr, returnByValue: true });
  const d = JSON.parse(r.result.value);

  /* 1 按钮高度：只允许 28/32/40（26 是色块 sw 的小尺寸，单独放行） */
  const hKeys = Object.keys(d.heights).map(Number);
  const badH = hKeys.filter((h) => ![26, 28, 32, 40].includes(h));
  check("按钮高度落在规范档（28/32/40）", badH.length === 0,
    `分布 ${JSON.stringify(d.heights)}` + (badH.length ? ` 越界: ${badH.join(",")}` : ""));

  /* 2 主要按钮类圆角统一 8px */
  const badR = d.mainBtnRadii.filter((x) => x !== "8px");
  check("主要按钮类（.btn/.nav-item）圆角统一 8px", badR.length === 0,
    `${d.mainBtnRadii.length} 个按钮，圆角 ${JSON.stringify(d.radii)}` + (badR.length ? ` 越界: ${[...new Set(badR)].join(",")}` : ""));

  /* 3 分段控件嵌套圆角公式：内层 = 外层 − 2px */
  const outer = parseFloat(d.segOuter) || 0, inner = parseFloat(d.segInner) || 0;
  check("分段控件嵌套圆角（内层 = 外层 − 2px）", outer > 0 && Math.abs(outer - inner - 2) < 0.51,
    `外层 ${d.segOuter} / 内层 ${d.segInner}`);

  /* 4 没有非整数字号 */
  const fsVals = Object.keys(d.fontSizes);
  const nonInt = fsVals.filter((v) => /\d+\.\d+px/.test(v));
  check("页面上没有非整数字号", nonInt.length === 0,
    `字号分布 ${JSON.stringify(d.fontSizes)}` + (nonInt.length ? ` 非整数: ${nonInt.join(",")}` : ""));

  /* 5 本地页资源走 lgasset://（绕开 file:// 缓存） */
  const allRes = d.links.concat(d.scripts);
  const allLgasset = allRes.length > 0 && allRes.every((u) => u && u.startsWith("lgasset://"));
  check("本地页资源走 lgasset://（应用更新后样式必刷新）", allLgasset,
    allRes.join(" "));

  const failed = results.filter((x) => !x.pass);
  console.log(`\n探针结果：${results.length - failed.length}/${results.length} 通过`);
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results, measured: d }, null, 2)); console.log("已写入 " + OUT); }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("探针失败: " + e.message); process.exit(2); });
