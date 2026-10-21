#!/usr/bin/env node
/* 长按后退/前进的访问历史栈探针。
   用法: node scripts/probe-navhist.cjs <port> [输出json]
   流程：连实例 → 让活动标签连续访问几个 URL 造出历史栈 →
         在后退按钮上派发真实指针按住 700ms → 检查浮层与行数 →
         短按一次验证是"单步后退"而不是"什么都不发生"。 */
const http = require("http");
const fs = require("fs");
const PORT = Number(process.argv[2] || 9310);
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
  const list0 = await targets();
  const chromeT = list0.find((t) => t.type === "page" && /chrome\.html/.test(t.url));
  if (!chromeT) throw new Error("找不到 chrome 视图");
  const chromeWs = await connect(chromeT.webSocketDebuggerUrl);
  const cs = mk(chromeWs);

  // 1) 造历史栈：**在同一个标签内**连续导航几次。
  //    （曾经写成"开 4 个标签"——那是 4 段互不相干的历史，每个标签都只有
  //      一条，后退键本来就该是禁用的，测不出任何东西。历史栈是"这个标签
  //      依次去过哪几个页面"，必须在同一标签里累积。）
  await evalIn(chromeWs, `(()=>{ try{ window.lgChrome.openTab("http://127.0.0.1:8908/?n1"); return 1; }catch(e){ return 0; } })()`);
  await sleep(2500);
  for (const q of ["n2", "n3", "n4"]) {
    const l = await targets();
    const pg = l.find((t) => t.type === "page" && t.url.indexOf("127.0.0.1:8908") >= 0);
    if (!pg) break;
    const pw = await connect(pg.webSocketDebuggerUrl);
    if (pw) {
      try { await evalIn(pw, `(()=>{ try{ location.href = "http://127.0.0.1:8908/?${q}"; return 1; }catch(e){ return 0; } })()`); } catch (e) {}
    }
    await sleep(2200);
  }
  await sleep(1200);

  // 2) 当前页面 URL（tabsState 没暴露到 window，用 CDP 的 target URL 作观测口）
  const curUrl = async () => {
    const l = await targets();
    const p = l.filter((t) => t.type === "page" && t.url.indexOf("127.0.0.1:8908") >= 0);
    return p.length ? p[0].url : "";
  };
  const before = await curUrl();

  // 3) 在后退按钮上派发"按住"
  const box = await evalIn(chromeWs, `(()=>{ const b=document.getElementById("btn-back"); if(!b) return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), disabled: b.disabled, canBack: !!(window.__lgTabsState||{})}); })()`);
  const b = JSON.parse(box || "null");
  if (!b) throw new Error("找不到后退按钮");
  await cs("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(750);
  await cs("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(1200);

  // 4) 弹层里有没有历史浮层
  const list1 = await targets();
  const popT = list1.find((t) => t.type === "page" && /popup\.html/.test(t.url));
  let rows = -1, hasOn = false, firstTitle = "";
  if (popT) {
    const popWs = await connect(popT.webSocketDebuggerUrl);
    if (popWs) {
      const r = await evalIn(popWs, `(()=>{ const box=document.querySelector(".nav-hist"); if(!box) return JSON.stringify({rows:-1}); const rows=[...box.querySelectorAll(".nh-row")]; return JSON.stringify({ rows: rows.length, on: !!box.querySelector(".nh-row.on"), first: (box.querySelector(".nh-title")||{}).textContent||"" }); })()`);
      const d = JSON.parse(r || "{}");
      rows = d.rows; hasOn = d.on; firstTitle = d.first;
    }
  }
  check("长按后退弹出访问历史栈", rows >= 2, rows >= 0 ? `浮层 ${rows} 行` : "浮层未出现");
  check("当前所在条目有标记", hasOn, "on=" + hasOn);
  check("行内标题非空", !!firstTitle, firstTitle || "(空)");

  // 5) 短按仍是单步后退（不是被长按逻辑吃掉，也不是什么都不发生）
  await evalIn(chromeWs, `(()=>{ try{ window.lgChrome.popupHide(); }catch(e){} return 1; })()`);
  await sleep(800);
  const u1 = await curUrl();
  await cs("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(90);
  await cs("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(1800);
  const u2 = await curUrl();
  check("短按后退仍是单步跳转", !!u1 && !!u2 && u1 !== u2, `${u1 || "(空)"} → ${u2 || "(空)"}`);

  const failed = results.filter((x) => !x.pass);
  console.log(`\n探针结果：${results.length - failed.length}/${results.length} 通过`);
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2)); console.log("已写入 " + OUT); }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("探针失败: " + e.message); process.exit(2); });