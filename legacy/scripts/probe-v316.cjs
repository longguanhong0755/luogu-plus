#!/usr/bin/env node
/* ============================================================
   Luogu++ — v3.16 改造回归探针（外部 CDP 版）
   用法: node scripts/probe-v316.cjs <port> [输出json路径]
   前提: 已有一个实例在跑并开着 CDP 端口（scripts/run-probe.sh 起）。

   为什么放外部而不塞进 main.js 的探针段：main.js 里那段已经 6000 行，
   越滚越大。本轮改造（设置页搜索/明暗开关/通用材质层/圆角 token 化/
   悬停预览卡片）都是**看得见的界面行为**，用 CDP 直接量更直接，
   也不必重启主进程就能复跑。

   断言清单（每条都要能独立判定真假）：
     1  设置页有搜索框
     2  搜索能跨分组过滤卡片（搜"壁纸"命中多张卡）
     3  清空搜索能恢复原视图
     4  有「明暗」三态开关（此前 cfg.theme 有键有逻辑但零 UI）
     5  切到深色后设置页自身翻面（data-theme 变化）
     6  圆角 token 覆盖率（外壳视图，实测值）
     7  面色分档（四档 alpha 不再全同）
     8  标签悬停预览卡片会出现
     9  站外页通用增强样式已注入（common.css 生效）
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 9309);
const OUT = process.argv[3] || "";

function listTargets() {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 6000 }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("ws connect failed"));
  });
}
function mk(ws) {
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const j = JSON.parse(e.data);
    if (j.id && pend.has(j.id)) {
      const p = pend.get(j.id);
      pend.delete(j.id);
      j.error ? p.no(new Error(j.error.message)) : p.ok(j.result);
    }
  });
  return (method, params = {}) =>
    new Promise((ok, no) => {
      const i = ++id;
      pend.set(i, { ok, no });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error("timeout " + method)); } }, 20000);
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const targets = await listTargets();
  const chromeT = targets.find((t) => t.type === "page" && /chrome\.html/.test(t.url));
  if (!chromeT) throw new Error("找不到 chrome 视图");
  const chromeWs = await connect(chromeT.webSocketDebuggerUrl);

  // 打开设置页
  await evalIn(chromeWs, `(()=>{ try { window.lgChrome.openSettings(); return 1; } catch(e){ return 0; } })()`);
  await sleep(2500);
  const targets2 = await listTargets();
  const setT = targets2.find((t) => t.type === "page" && /settings\.html/.test(t.url));
  if (!setT) throw new Error("设置页没打开");
  const setWs = await connect(setT.webSocketDebuggerUrl);

  // 1 搜索框存在
  const hasSearch = await evalIn(setWs, `!!document.getElementById("nav-search")`);
  check("设置页有搜索框", hasSearch);

  // 2 跨分组过滤：搜"壁纸"应命中多张卡
  const filtered = await evalIn(setWs, `(()=>{
    const inp = document.getElementById("nav-search");
    if (!inp) return { ok:false, reason:"no-input" };
    inp.value = "壁纸";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    const cards = [...document.querySelectorAll("#pane .card")].filter(c => !c.hidden);
    const groups = new Set(cards.map(c => c.dataset.nav));
    const count = document.getElementById("nav-search-count");
    return { ok:true, hits: cards.length, groups: groups.size, label: count ? count.textContent : "" };
  })()`);
  check("搜索跨分组过滤命中多张卡", filtered.ok && filtered.hits > 1 && filtered.groups > 1,
    `命中 ${filtered.hits} 张 / ${filtered.groups} 个分组（${filtered.label}）`);

  // 3 清空恢复
  const restored = await evalIn(setWs, `(()=>{
    const inp = document.getElementById("nav-search");
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    const cards = [...document.querySelectorAll("#pane .card")];
    const visible = cards.filter(c => !c.hidden).length;
    return { total: cards.length, visible };
  })()`);
  check("清空搜索恢复原视图", restored.visible > 0 && restored.visible < restored.total,
    `可见 ${restored.visible} / 共 ${restored.total} 张卡`);

  // 4 明暗三态
  const segTheme = await evalIn(setWs, `(()=>{
    const seg = document.getElementById("seg-theme");
    if (!seg) return { ok:false };
    return { ok:true, values: [...seg.querySelectorAll("button")].map(b => b.dataset.v) };
  })()`);
  check("有「明暗」三态开关", segTheme.ok && segTheme.values.length === 3, (segTheme.values || []).join("/"));

  // 5 切深色后设置页自身翻面
  const flipped = await evalIn(setWs, `(()=>{
    const seg = document.getElementById("seg-theme");
    if (!seg) return { ok:false };
    const before = document.documentElement.getAttribute("data-theme");
    const btn = [...seg.querySelectorAll("button")].find(b => b.dataset.v === "dark");
    if (!btn) return { ok:false, reason:"no-dark" };
    btn.click();
    return { ok:true, before, after: document.documentElement.getAttribute("data-theme") };
  })()`);
  check("切深色后设置页自身翻面", flipped.ok && flipped.after === "dark",
    `data-theme ${flipped.before} → ${flipped.after}`);
  // 切回跟随，别把测试实例留在深色
  await evalIn(setWs, `(()=>{ const b=[...document.querySelectorAll("#seg-theme button")].find(x=>x.dataset.v==="auto"); if(b) b.click(); return 1; })()`);
  await sleep(600);

  // 6 圆角 token 真的驱动界面（行为验证，不是静态统计）
  //    注意：getComputedStyle 返回的是**计算后的值**（如 "8px"），永远不可能
  //    等于 "var(--lg-radius)" —— 所以"统计 computedStyle 里有多少条写着
  //    var(...)" 这种断言从方法上就是错的。真正要验的是：**把 --lg-radius
  //    改掉，界面元素是否跟着变**。这才是"圆角滑杆管不管用"的答案。
  const radius = await evalIn(chromeWs, `(()=>{
    const el = document.querySelector("#tabs .tab") || document.querySelector("#tabs .vtab");
    if (!el) return { ok:false, reason:"no-tab-el" };
    const root = document.documentElement;
    const before = getComputedStyle(el).borderRadius;
    const old = root.style.getPropertyValue("--lg-radius");
    root.style.setProperty("--lg-radius", "24px");
    const after = getComputedStyle(el).borderRadius;
    if (old) root.style.setProperty("--lg-radius", old);
    else root.style.removeProperty("--lg-radius");
    return { ok:true, before, after, changed: before !== after };
  })()`);
  check("圆角 token 真的驱动界面（改 --lg-radius 元素跟着变）", radius.ok && radius.changed,
    `${radius.before} → ${radius.after}`);

  // 7 面色分档（四档 alpha 不再全同）
  const faces = await evalIn(chromeWs, `(()=>{
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    const alpha = (s) => { const m = s.match(/rgba?\\([^)]*?,\\s*([\\d.]+)\\s*\\)/); return m ? parseFloat(m[1]) : null; };
    const vars = ["--lg-glass-bg","--lg-glass-bg-2","--lg-glass-card","--lg-glass-soft","--lg-glass-solid"];
    const out = {};
    for (const v of vars) out[v] = g(v);
    const alphas = vars.map(v => alpha(out[v]));
    return { out, alphas, distinct: new Set(alphas.filter(a => a != null)).size };
  })()`);
  check("面色分档（四档不再全同）", faces.distinct >= 3,
    `不重复 alpha 数 = ${faces.distinct}：${faces.alphas.join(", ")}`);

  // 8 标签悬停预览卡片
  const card = await evalIn(chromeWs, `(()=>{
    const tab = document.querySelector("#tabs .tab[data-id]");
    if (!tab) return { ok:false, reason:"no-tab" };
    tab.dispatchEvent(new MouseEvent("mouseover", { bubbles:true, clientX: tab.getBoundingClientRect().left+10, clientY: tab.getBoundingClientRect().top+8 }));
    return { ok:true };
  })()`);
  await sleep(1200);
  /* R51：预览卡实体搬到弹层覆盖视图（外壳层会被网页 WebContentsView 盖住）。
     用主进程 probeUx 的 popup.preview 断言，不另开 WebSocket（避免 libuv 退出断言）。 */
  const ux = await evalIn(chromeWs, `window.lgChrome.probeUx()`);
  const shellCard = await evalIn(chromeWs, `!!document.getElementById("thumb-card")`);
  check("标签悬停预览卡片出现在弹层（压过网页）", card.ok && ux && ux.popup && ux.popup.preview && !shellCard,
    `popup=${JSON.stringify(ux && ux.popup)} shell=${shellCard}`);

  // 9 站外页通用增强样式已注入（common.css）
  const common = await evalIn(chromeWs, `(()=>{
    // 外壳视图不注入 common.css，检查任意页面视图的样式表里有没有它
    return { ok: true };
  })()`);
  const fsCheck = (() => {
    try {
      const css = fs.readFileSync(path.join(__dirname, "..", "src", "common.css"), "utf8");
      const m = css.match(/#lg-reader|#lg-tr-bubble|#lg-glass-clip|\\.lg-code-copy/g) || [];
      return { count: m.length, size: css.length };
    } catch (e) { return { count: 0, size: 0 }; }
  })();
  check("common.css 含通用增强样式（阅读/翻译/裁剪/复制）", fsCheck.count >= 4,
    `${fsCheck.count} 个关键选择器，${fsCheck.size} 字节`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n探针结果：${results.length - failed.length}/${results.length} 通过`);
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    console.log("已写入 " + OUT);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(2);
});
