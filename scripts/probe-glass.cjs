#!/usr/bin/env node
/* ============================================================
   Luogu++ — 站外页自动玻璃化探针
   用法: node scripts/probe-glass.cjs <port> <测试页URL> [输出json]
   前提: 有一个实例在跑（scripts/run-probe.sh 起），且测试页可达。

   测什么（每条都是"该发生/不该发生"的二元判定，不看主观观感）：
     1 页面被判定为"内容型站点"（data-lg-glassauto="1"）
     2 普通白卡片上了真毛玻璃（.lg-gx 且 backdrop-filter 非 none）
     3 内含 position:fixed 的卡片**只给半透明底、不给模糊**
       （.lg-gx-noblur 且 backdrop-filter 为 none）——这是 v3.4.2 那个
       "backdrop-filter 劫持 fixed 包含块"的防线
     4 彩色卡片不被碰（站点的配色语义不能被洗掉）
     5 透明容器不被碰（没自己的底色，玻璃化等于凭空加一层）
     6 表单区不被碰（输入区发虚、也让人家的下拉/校验浮层难看清）
     7 长文正文容器不被碰（正文承载面保持站点自己的底色才最好读）
     8 能力注册表接口可用，且同步幂等（重复调不改变已贴的面）
   测试页需要带 data-test="plain|hasfixed|colored|transparent|form|prose"
   六个标记的容器（见 dev/probe/audit/gxtest/index.html）。
   ============================================================ */
const http = require("http");
const fs = require("fs");

const PORT = Number(process.argv[2] || 9309);
const URL_ = process.argv[3] || "";
const OUT = process.argv[4] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function targets() {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 6000 }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
function connect(url) {
  return new Promise((res) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = () => res(null); });
}
function mk(ws) {
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (e) => {
    const j = JSON.parse(e.data);
    if (j.id && pend.has(j.id)) { const p = pend.get(j.id); pend.delete(j.id); j.error ? p.no(new Error(j.error.message)) : p.ok(j.result); }
  });
  return (method, params = {}) => new Promise((ok, no) => {
    const i = ++id; pend.set(i, { ok, no });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error("timeout " + method)); } }, 15000);
  });
}
async function evalIn(ws, expr) {
  const send = mk(ws);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval error");
  return r.result.value;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail == null ? "" : String(detail) });
  console.log((pass ? "  PASS  " : "  FAIL  ") + name + (detail != null ? "   " + detail : ""));
}

(async () => {
  if (!URL_) throw new Error("缺测试页 URL");
  // 1) 用外壳开这个标签
  const chromeT = (await targets()).find((t) => t.type === "page" && /chrome\.html/.test(t.url));
  if (!chromeT) throw new Error("找不到 chrome 视图");
  const chromeWs = await connect(chromeT.webSocketDebuggerUrl);
  if (!chromeWs) throw new Error("连不上 chrome 视图");
  await evalIn(chromeWs, `(()=>{ try{ window.lgChrome.openTab(${JSON.stringify(URL_)}); return 1; }catch(e){ return 0; } })()`);
  await sleep(6000);

  // 2) 找到该页并强制视口（后台标签的布局是 0，尺寸判定会全部落空）
  const t2 = (await targets()).find((t) => t.type === "page" && t.url.indexOf(URL_.split("?")[0]) >= 0);
  if (!t2) throw new Error("测试页没打开");
  const pageWs = await connect(t2.webSocketDebuggerUrl);
  if (!pageWs) throw new Error("连不上测试页");
  const send = mk(pageWs);
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  // 3) 等巡检补扫（glassTick % 6 ≈ 15s）——外部站内容异步渲染，首次 apply 时
  //    视口还是 0，玻璃要靠巡检补上
  await sleep(20000);

  const probe = `(()=>{
    const q=(k)=>document.querySelector('[data-test="'+k+'"]');
    const info=(el)=>{ if(!el) return null; const cs=getComputedStyle(el);
      return { gx: el.classList.contains('lg-gx'), nb: el.classList.contains('lg-gx-noblur'),
               bf: cs.backdropFilter || 'none', bg: cs.backgroundColor }; };
    return JSON.stringify({
      auto: document.documentElement.getAttribute('data-lg-glassauto'),
      skin: document.documentElement.getAttribute('data-lg-glass'),
      plain: info(q('plain')), hasfixed: info(q('hasfixed')), colored: info(q('colored')),
      transparent: info(q('transparent')), form: info(q('form')), prose: info(q('prose')),
      vp: innerWidth+'x'+innerHeight
    });
  })()`;
  const r = JSON.parse(await evalIn(pageWs, probe));

  check("判定为内容型站点（data-lg-glassauto=1）", r.auto === "1", "auto=" + r.auto + " 视口=" + r.vp);
  /* 玻璃分两种皮肤：**液态**才有毛玻璃，**素面**是纯色 + 细线
     （--lg-glass-blur 就是 none，这是素面的设计，不是失效）。所以这条按
     当前皮肤给期望，否则新装的实例（默认素面）永远判 FAIL。 */
  const isLiquid = r.skin === "liquid";
  check(
    isLiquid ? "普通白卡片上真毛玻璃（液态皮肤）" : "普通白卡片上素面（半透明底 + 细线，无模糊）",
    r.plain && r.plain.gx && (isLiquid ? r.plain.bf !== "none" : true),
    `皮肤=${r.skin} ` + (r.plain ? `blur=${r.plain.bf} bg=${r.plain.bg}` : "元素不存在")
  );
  check("含 fixed 的卡片只给半透明底、不给模糊", r.hasfixed && r.hasfixed.nb && r.hasfixed.bf === "none",
    r.hasfixed ? `blur=${r.hasfixed.bf} bg=${r.hasfixed.bg}` : "元素不存在");
  check("彩色卡片不被碰", r.colored && !r.colored.gx && !r.colored.nb, r.colored ? `bg=${r.colored.bg}` : "元素不存在");
  check("透明容器不被碰", r.transparent && !r.transparent.gx && !r.transparent.nb, r.transparent ? `bg=${r.transparent.bg}` : "元素不存在");
  check("表单区不被碰", r.form && !r.form.gx && !r.form.nb, r.form ? `bg=${r.form.bg}` : "元素不存在");
  check("长文正文容器不被碰", r.prose && !r.prose.gx && !r.prose.nb, r.prose ? `bg=${r.prose.bg}` : "元素不存在");

  // 8) 能力注册表：接口存在 + 同步幂等（"只在状态翻转时动手"是这次重构的
  //    核心承诺，巡检每 6 拍调一次，重复调必须无副作用）
  const reg = await evalIn(pageWs, `(()=>{ try{ return JSON.stringify({ has: typeof window.__lgGlassSweep === "function" }); }catch(e){ return JSON.stringify({ has:false }); } })()`);
  check("能力注册表接口可用（__lgGlassSweep）", JSON.parse(reg).has);
  const idem = await evalIn(pageWs, `(()=>{
    try{
      const sel = ".lg-gx,.lg-gx-noblur,.lg-glass,.lg-glass-soft,.lg-noveil";
      const before = document.querySelectorAll(sel).length;
      window.__lgGlassSweep();
      window.__lgGlassSweep();
      const after = document.querySelectorAll(sel).length;
      return JSON.stringify({ before: before, after: after, same: before === after });
    } catch (e) { return JSON.stringify({ same: false, err: String(e) }); }
  })()`);
  const im = JSON.parse(idem);
  check("注册表同步幂等（重复调不改变已贴的面）", im.same, im.err || `${im.before} → ${im.after}`);

  const failed = results.filter((x) => !x.pass);
  console.log(`\n探针结果：${results.length - failed.length}/${results.length} 通过`);
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), url: URL_, results }, null, 2)); console.log("已写入 " + OUT); }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("探针失败: " + e.message); process.exit(2); });
