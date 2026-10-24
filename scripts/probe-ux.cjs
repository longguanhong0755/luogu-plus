#!/usr/bin/env node
/* ============================================================
   Luogu++ — UX 手感回归探针（外部 CDP 版）
   用法: node scripts/probe-ux.cjs <port> [输出json路径]
   前提: 已有一个实例在跑并开着 CDP 端口（scripts/run-all-probes.sh 起）。

   覆盖 v3.16.6 的核心手感路径（都是"网页标签盖住外壳"时代的真断点）：
     1  命令面板实体在覆盖层：可输入、可过滤、↑↓+Enter 真执行
     2  Esc 关闭并归还焦点（主进程焦点路由意图 = tab）
     3  Ctrl+L 同一实现：收起弹层 → 聚焦外壳 → 地址栏拿到焦点
     4  查找条 rect 模式：视图只盖查找栏、查询有计数、Esc 关闭
     5  验证码输入：同一 payload 连发两次，值/光标/焦点都保持
     6  下载按钮真的能打开面板（此前只有渲染、没有绑定）
     7  失败提示带动作按钮（写盘失败 → 诊断）
     8  登录过期芯片文案（已过期 · 重新登录）
     9  uiScale 几何：120% 时页面 bounds 与 inset 一致、弹层锚点同步换算
    10  映射编辑器：连打不丢焦点，完整行才入库
    11  历史页头与设置页同构；设置页首帧卡片不可见
   ============================================================ */
const http = require("http");
const fs = require("fs");

const PORT = Number(process.argv[2] || 9321);
const OUT = process.argv[3] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listTargets() {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 6000 }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
async function findTarget(sub, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const t = (await listTargets()).find((x) => x.url.includes(sub));
    if (t) return t;
    await sleep(250);
  }
  return null;
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws connect failed")); });
    const c = new CDP(ws);
    ws.addEventListener("message", (e) => {
      const j = JSON.parse(e.data);
      if (j.id && c.pend.has(j.id)) {
        const p = c.pend.get(j.id);
        c.pend.delete(j.id);
        j.error ? p.no(new Error(j.error.message || "cdp error")) : p.ok(j.result);
      }
    });
    return c;
  }
  send(method, params = {}) {
    const i = ++this.id;
    return new Promise((ok, no) => {
      this.pend.set(i, { ok, no });
      this.ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (this.pend.has(i)) { this.pend.delete(i); no(new Error("timeout " + method)); } }, 15000);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception || {};
      throw new Error("page exception: " + (ex.description || r.exceptionDetails.text || "unknown"));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function targetClient(sub, tries = 30) {
  const t = await findTarget(sub, tries);
  if (!t) throw new Error("target not found: " + sub);
  const c = await CDP.open(t.webSocketDebuggerUrl);
  await c.send("Runtime.enable").catch(() => {});
  return c;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
  console.log((pass ? "  PASS " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
}

(async () => {
  const chrome = await targetClient("/chrome/chrome.html");
  /** @type {any} */
  let popup = null;
  const getPopup = async () => {
    if (popup) { try { popup.close(); } catch (e) {} }
    popup = await targetClient("/popup/popup.html");
    return popup;
  };
  const probe = async (req) => JSON.parse(await chrome.eval(`window.lgChrome.probeUx(${JSON.stringify(req || null)}).then(r=>JSON.stringify(r))`));
  const closePopup = async () => { await chrome.eval(`window.lgChrome.popupHide(), "ok"`); await sleep(180); };

  // ---------- 基线：打开设置页 + 固定 uiScale=1 ----------
  await chrome.eval(`window.lgChrome.openSettings(), "ok"`);
  let settings = await targetClient("/settings/settings.html");
  await settings.eval(`window.lgConfig.set({ uiScale: 1 })`);
  await sleep(700);
  const base = await probe();
  const activeId = JSON.parse(await chrome.eval(`JSON.stringify(tabsState.activeId)`));
  const activeBase = base.tabs.find((t) => t.id === activeId);
  check("基线：页面视图从 inset 起排", !!activeBase && !!activeBase.bounds &&
    activeBase.bounds.x === base.inset.x && activeBase.bounds.y === base.inset.y,
    `inset=${JSON.stringify(base.inset)} bounds=${JSON.stringify(activeBase && activeBase.bounds)}`);

  // ---------- 1/2 命令面板：过滤 + Enter 执行 + Esc 归还焦点 ----------
  await chrome.eval(`openPalette(), "ok"`);
  await sleep(350);
  await getPopup();
  const p1 = JSON.parse(await popup.eval(`(() => {
    const box = document.getElementById("palette");
    const inp = document.getElementById("pal-input");
    return JSON.stringify({
      box: !!box, visible: !!box && getComputedStyle(box).display !== "none",
      rows: document.querySelectorAll("#pal-list .pal-item").length,
      focused: document.activeElement && document.activeElement.id,
      hasFocus: document.hasFocus()
    });
  })()`));
  check("命令面板在覆盖层且输入框聚焦", p1.box && p1.visible && p1.rows > 5 && p1.focused === "pal-input" && p1.hasFocus,
    JSON.stringify(p1));

  const p2 = JSON.parse(await popup.eval(`(() => {
    const inp = document.getElementById("pal-input");
    window.__uxInp = inp;
    inp.value = "浏览历史";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    const vis = [...document.querySelectorAll("#pal-list .pal-item")].filter((r) => !r.hidden);
    return JSON.stringify({
      visible: vis.length, total: document.querySelectorAll("#pal-list .pal-item").length,
      sameNode: window.__uxInp === document.getElementById("pal-input"),
      first: vis[0] ? vis[0].textContent.trim().slice(0, 30) : ""
    });
  })()`));
  check("输入即本地过滤且输入框不重建", p2.visible > 0 && p2.visible < p2.total && p2.sameNode,
    JSON.stringify(p2));
  await popup.eval(`document.getElementById("pal-input").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })), "ok"`);
  await popup.eval(`document.getElementById("pal-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })), "ok"`);
  await sleep(900);
  const afterPick = JSON.parse(await chrome.eval(`JSON.stringify({ closed: !paletteOpen(), picked: document.body.dataset.lgPicked || "", hist: tabsState.tabs.some((t) => t.kind === "history") })`));
  check("↓+Enter 执行命令（打开历史）并关闭面板", afterPick.closed && !!afterPick.picked && afterPick.hist, JSON.stringify(afterPick));
  const hist = await targetClient("/history/history.html", 20);
  check("历史页真实打开", !!hist, "history target");
  hist.close();

  await chrome.eval(`openPalette(), "ok"`);
  await sleep(300);
  await getPopup();
  await popup.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), "ok"`);
  await sleep(500);
  const esc = await probe();
  check("Esc 关闭并按意图归还焦点", esc.popup === null && esc.focus.last === "tab", JSON.stringify(esc.focus));

  // ---------- 3 Ctrl+L 同一条实现 ----------
  await chrome.eval(`window.lgChrome.probeUx({ act: "focus-omni" }).then(() => "ok")`);
  await sleep(350);
  const omni = JSON.parse(await chrome.eval(`JSON.stringify({ active: document.activeElement && document.activeElement.id, sel: (() => { const i = document.getElementById("omni-input"); return i ? [i.selectionStart, i.selectionEnd] : null; })() })`));
  const focusSnap = await probe();
  check("Ctrl+L 路径：外壳地址栏拿到焦点", omni.active === "omni-input" && focusSnap.focus.last === "shell",
    JSON.stringify({ omni, last: focusSnap.focus.last }));

  // ---------- 4 查找条（rect 模式） ----------
  await chrome.eval(`openFindbar(), "ok"`);
  await sleep(450);
  await getPopup();
  const f1 = JSON.parse(await popup.eval(`JSON.stringify({ bar: !!document.getElementById("findbar"), focused: document.activeElement && document.activeElement.id })`));
  const fGeo = await probe();
  const fFit = fGeo.popup && fGeo.popup.fit;
  const arExpect = Math.round(170 * fGeo.uiScale);
  check("查找条只盖自己（rect）且输入框聚焦", !!f1.bar && f1.focused === "find-input" && !!fFit && fFit.ar === arExpect,
    JSON.stringify({ bar: f1.bar, focused: f1.focused, fit: fFit && { ar: fFit.ar, originX: fFit.originX, contentW: fFit.contentW } }));
  await popup.eval(`(() => { const i = document.getElementById("find-input"); i.value = "浏览历史"; i.dispatchEvent(new Event("input", { bubbles: true })); return "ok"; })()`);
  /* 查找是异步 CDP findInPage：固定 800ms 在慢机上会读到空计数（假红）。 */
  let f2 = { count: "", value: "" };
  for (let i = 0; i < 16; i++) {
    await sleep(250);
    f2 = JSON.parse(await popup.eval(`JSON.stringify({ count: (document.getElementById("find-count") || {}).textContent || "", value: document.getElementById("find-input").value })`));
    if (/\d/.test(f2.count)) break;
  }
  check("查找有命中计数", /\d/.test(f2.count) && f2.value === "浏览历史", JSON.stringify(f2));
  await popup.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), "ok"`);
  await sleep(450);
  const f3 = await probe();
  check("查找条 Esc 关闭并清场", f3.popup === null && (await popup.eval(`document.getElementById("pop-root").children.length`)) === 0,
    JSON.stringify({ popup: f3.popup }));

  // ---------- 5 验证码输入：同 payload 连发，值/光标/焦点保持 ----------
  const capHtml = '<div id="cap-test"><input class="cap-in" type="text" maxlength="6"></div>';
  await chrome.eval(`window.lgChrome.popupShow(${JSON.stringify({ html: capHtml, focus: "input" })}), "ok"`);
  await sleep(350);
  await getPopup();
  await popup.eval(`(() => { const i = document.querySelector(".cap-in"); i.value = "ab7k9"; i.setSelectionRange(1, 3); i.focus(); return "ok"; })()`);
  await chrome.eval(`window.lgChrome.popupShow(${JSON.stringify({ html: capHtml, focus: "input" })}), "ok"`);
  await sleep(350);
  await getPopup();
  const cap = JSON.parse(await popup.eval(`(() => { const i = document.querySelector(".cap-in"); return JSON.stringify({ value: i.value, sel: [i.selectionStart, i.selectionEnd], focused: document.activeElement === i, hasFocus: document.hasFocus() }); })()`));
  check("验证码重绘后值/光标/焦点保持", cap.value === "ab7k9" && cap.sel[0] === 1 && cap.sel[1] === 3 && cap.focused,
    JSON.stringify(cap));
  await closePopup();

  // ---------- 6 下载按钮 ----------
  await chrome.eval(`(document.getElementById("btn-downloads").click(), "ok")`);
  await sleep(450);
  await getPopup();
  const dl = await popup.eval(`!!document.getElementById("download-menu") && document.querySelectorAll("#download-menu").length`);
  check("下载按钮能打开下载面板", dl === 1, "download-menu=" + dl);
  await chrome.eval(`hideAllMenus(), "ok"`);
  await sleep(200);

  // ---------- 7 失败提示带动作 ----------
  await chrome.eval(`showToast("磁盘空间不足，config.json 没能保存", { action: "diagnostics", sticky: true }), "ok"`);
  await sleep(400);
  await getPopup();
  const toast = JSON.parse(await popup.eval(`(() => { const b = document.querySelector("#lg-toast .tst-btn"); return JSON.stringify({ msg: (document.querySelector("#lg-toast .tst-msg") || {}).textContent || "", btn: b ? b.textContent : "" }); })()`));
  check("写盘失败提示带「诊断」入口", toast.btn === "诊断" && /磁盘空间不足/.test(toast.msg), JSON.stringify(toast));
  await closePopup();

  // ---------- 8 登录过期芯片 ----------
  const chip = JSON.parse(await chrome.eval(`(() => {
    const old = userState;
    userState = { uid: "2286752", name: "tester", avatar: "", expired: true };
    renderUser();
    const txt = document.getElementById("user-chip").textContent;
    const cls = document.getElementById("user-chip").className;
    userState = old;
    renderUser();
    return JSON.stringify({ txt, cls });
  })()`));
  check("登录过期芯片显示重新登录", /已过期/.test(chip.txt) && /expired/.test(chip.cls), JSON.stringify(chip));

  // ---------- 9 uiScale 120%：几何 + 弹层锚点 ----------
  const s0 = await probe();
  await settings.eval(`window.lgConfig.set({ uiScale: 1.2 })`);
  await sleep(900);
  const s12 = await probe();
  const activeB = s12.tabs.find((t) => t.bounds && t.bounds.x === s12.inset.x && t.bounds.y === s12.inset.y) || null;
  const geomOk = s12.inset.x === Math.round(s0.inset.x * 1.2) &&
    s12.inset.y === Math.round(s0.inset.y * 1.2) &&
    !!activeB &&
    activeB.bounds.width === s12.win[0] - s12.inset.x - (s12.inset.right || 0) &&
    activeB.bounds.height === s12.win[1] - s12.inset.y - (s12.inset.footer || 0);
  check("120%：页面 bounds 与缩放后的 inset 一致", geomOk, JSON.stringify({ base: s0.inset, now: s12.inset, bounds: activeB && activeB.bounds, win: s12.win }));
  const cssW = await chrome.eval(`innerWidth`);
  check("120%：外壳按缩放因子布局", Math.abs(cssW - s12.win[0] / 1.2) <= 1, `innerWidth=${cssW} win=${s12.win[0]}`);

  await chrome.eval(`openFindbar(), "ok"`);
  await sleep(450);
  const f12 = await probe();
  const fit12 = f12.popup && f12.popup.fit;
  const expectAr = Math.round(170 * 1.2);
  const expectX = f12.win[0] - (fit12 ? fit12.contentW : 0) - expectAr;
  check("120%：查找条锚点按 DIP 换算", !!fit12 && fit12.ar === expectAr && Math.abs(fit12.originX - expectX) <= 2,
    JSON.stringify(fit12 && { ar: fit12.ar, originX: fit12.originX, expectX }));
  const p12 = await targetClient("/popup/popup.html", 10);
  await p12.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), "ok"`);
  p12.close();
  await sleep(300);
  await settings.eval(`window.lgConfig.set({ uiScale: 1 })`);
  await sleep(800);
  const sBack = await probe();
  check("恢复 100% 后几何还原", sBack.inset.x === s0.inset.x && sBack.inset.y === s0.inset.y, JSON.stringify(sBack.inset));

  // ---------- 10 映射编辑器：连打不丢焦点 ----------
  const mapBefore = JSON.parse(await settings.eval(`window.lgConfig.get().then(c=>JSON.stringify(c.mappings || {}))`));
  await settings.eval(`showSection("账号/地址栏映射"); document.getElementById("btn-map-add").click()`);
  const typing = JSON.parse(await settings.eval(`(() => {
    const rows = [...document.querySelectorAll("#map-list .map-row")];
    const row = rows[rows.length - 1];
    const [k, u] = row.querySelectorAll("input");
    k.focus();
    k.value = "u"; k.dispatchEvent(new Event("input", { bubbles: true }));
    k.value = "ux"; k.dispatchEvent(new Event("input", { bubbles: true }));
    k.value = "uxprobe"; k.dispatchEvent(new Event("input", { bubbles: true }));
    u.value = "https://example.com/ux"; u.dispatchEvent(new Event("input", { bubbles: true }));
    u.focus();
    window.__uxRow = row;
    return JSON.stringify({ focused: document.activeElement === u, k: k.value, u: u.value });
  })()`));
  const stillFocused = await settings.eval(`document.activeElement === document.querySelector("#map-list .map-row:last-child input:last-of-type")`);
  /* 配置保存是 300ms 防抖 + IPC：轮询到映射真正落库，别用固定 sleep。 */
  let saved = {};
  for (let i = 0; i < 16; i++) {
    await sleep(250);
    saved = JSON.parse(await settings.eval(`window.lgConfig.get().then(c=>JSON.stringify(c.mappings || {}))`));
    if (saved.uxprobe) break;
  }
  check("映射连打不丢焦点且完整行入库", typing.focused && stillFocused && saved.uxprobe === "https://example.com/ux",
    JSON.stringify({ typing, stillFocused, saved: saved.uxprobe }));
  // 清掉探针写入的行，避免污染隔离 profile
  await settings.eval(`(() => { const rows=[...document.querySelectorAll("#map-list .map-row")]; const row=rows[rows.length-1]; const d=row.querySelector(".btn-del"); if(d)d.click(); return "ok"; })()`);
  await sleep(600);
  const cleaned = JSON.parse(await settings.eval(`window.lgConfig.get().then(c=>JSON.stringify(c.mappings || {}))`));
  check("删除映射后条目清除", !("uxprobe" in cleaned) && Object.keys(cleaned).length === Object.keys(mapBefore).length,
    JSON.stringify({ before: Object.keys(mapBefore), after: Object.keys(cleaned) }));

  // ---------- 11 历史页头 + 设置页首帧 ----------
  const head = JSON.parse(await (async () => {
    const h = await targetClient("/history/history.html", 20);
    const v = await h.eval(`(() => {
      const hd = document.querySelector("header.pane-head");
      const h1 = hd && hd.querySelector("h1");
      const cs = h1 ? getComputedStyle(h1) : null;
      const wrap = document.querySelector(".wrap");
      return JSON.stringify({
        head: !!hd, size: cs ? cs.fontSize : "", weight: cs ? cs.fontWeight : "",
        pad: wrap ? getComputedStyle(wrap).paddingLeft : ""
      });
    })()`);
    h.close();
    return v;
  })());
  check("历史页头与设置页同构", head.head && head.size === "20px" && head.weight === "700" && head.pad !== "0px",
    JSON.stringify(head));

  const ready = JSON.parse(await settings.eval(`(() => {
    const card = document.querySelector("#pane .card:not([hidden])");
    if (!card) return JSON.stringify({ pre: document.body.classList.contains("pre-ready"), missing: true });
    document.body.classList.add("pre-ready");
    const hiddenWhenPre = getComputedStyle(card).visibility;
    document.body.classList.remove("pre-ready");
    const visible = getComputedStyle(card).visibility;
    return JSON.stringify({ pre: document.body.classList.contains("pre-ready"), hiddenWhenPre, visible });
  })()`));
  check("设置页首帧卡片先隐藏、ready 后可见", !ready.pre && ready.hiddenWhenPre === "hidden" && ready.visible === "visible",
    JSON.stringify(ready));

  // ---------- 12 R51：切换按钮 / F11 / 焦点环 / 遮挡 / 参数 / 复制 ----------
  try {
    const icon = JSON.parse(await chrome.eval(`(()=>{const h=document.getElementById("btn-vtoggle-h");const v=document.getElementById("btn-vtoggle-v");return JSON.stringify({h:h?h.innerHTML:"",v:v?v.innerHTML:""})})()`));
    check("垂直/水平切换按钮有专用图标", /M9 4v16/.test(icon.h) && /M9 4v16/.test(icon.v),
      JSON.stringify({ h: icon.h.slice(0, 46), v: icon.v.slice(0, 46) }));

    await chrome.eval(`window.lgChrome.setConfig({verticalTabs:false, vtabCollapsed:false, vtabCompact:false}), "ok"`);
    await sleep(900);
    await chrome.eval(`window.lgChrome.toggleFullscreen(), "ok"`);
    await sleep(900);
    const fs1 = await probe();
    const fsActiveId = JSON.parse(await chrome.eval(`JSON.stringify(tabsState.activeId)`));
    const fsTab = fs1.tabs.find((t) => t.id === fsActiveId);
    check("F11：窗口全屏，页面铺满整窗",
      !!(fs1.fullscreen && fs1.fullscreen.on && fsTab && fsTab.bounds.x === 0 && fsTab.bounds.y === 0 &&
        fsTab.bounds.width === fs1.win[0] && fsTab.bounds.height === fs1.win[1] && !(fs1.dock && fs1.dock.visible)),
      JSON.stringify({ fs: fs1.fullscreen, bounds: fsTab && fsTab.bounds, win: fs1.win, dock: fs1.dock }));
    await chrome.eval(`window.lgChrome.toggleFullscreen(), "ok"`);
    await sleep(900);
    const fs2 = await probe();
    const fsTab2 = fs2.tabs.find((t) => t.id === fsActiveId);
    check("F11 退出后恢复 inset", !!(fs2.fullscreen && !fs2.fullscreen.on && fsTab2 && fsTab2.bounds.x === fs2.inset.x),
      JSON.stringify({ fs: fs2.fullscreen, inset: fs2.inset, bounds: fsTab2 && fsTab2.bounds }));

    await chrome.eval(`openPalette(), "ok"`); await sleep(350); await getPopup();
    const palRing = JSON.parse(await popup.eval(`(()=>{const b=getComputedStyle(document.querySelector(".pal-box"));const i=getComputedStyle(document.getElementById("pal-input"));return JSON.stringify({box:b.outlineStyle+" "+b.outlineWidth,input:i.outlineStyle+" "+i.outlineWidth})})()`));
    check("命令面板不再有黑色焦点框", palRing.box.startsWith("none") && palRing.input.startsWith("none"), JSON.stringify(palRing));
    await chrome.eval(`closePalette(), "ok"`); await sleep(250);

    const badge = await chrome.eval(`(()=>{const d=document.createElement("div");d.className="tab pinned";d.innerHTML='<span class="t-badge">x</span>';document.body.appendChild(d);const v=getComputedStyle(d.querySelector(".t-badge")).display;d.remove();return v})()`);
    const zh = JSON.parse(await chrome.eval(`(()=>{const z=document.getElementById("zoomhud");return JSON.stringify({parent:z?z.parentElement.id:"",pos:z?getComputedStyle(z).position:""})})()`));
    check("钉住标签徽标隐藏 + 缩放提示在 nav 行内", badge === "none" && zh.parent === "actions" && zh.pos !== "absolute",
      JSON.stringify({ badge, zh }));

    const line1 = await chrome.eval(`getComputedStyle(document.documentElement).getPropertyValue("--lg-glass-line").trim()`);
    await settings.eval(`window.lgConfig.set({radius:20,borderStrength:2})`); await sleep(900);
    const rb = JSON.parse(await chrome.eval(`(()=>{const cs=getComputedStyle(document.documentElement);return JSON.stringify({radius:cs.getPropertyValue("--lg-radius").trim(),line:cs.getPropertyValue("--lg-glass-line").trim()})})()`));
    check("圆角 R 与边框强度参数生效", rb.radius === "20px" && rb.line !== line1, JSON.stringify({ before: line1, after: rb }));
    await settings.eval(`window.lgConfig.set({radius:8,borderStrength:1})`); await sleep(700);

    const n0 = JSON.parse(await chrome.eval(`JSON.stringify(tabsState.tabs.length)`));
    const dup = JSON.parse(await chrome.eval(`window.lgChrome.duplicateTab(tabsState.activeId).then(r=>JSON.stringify(r))`));
    const n1 = JSON.parse(await chrome.eval(`JSON.stringify(tabsState.tabs.length)`));
    check("复制标签页（保留位置/身份）", dup.ok === true && n1 === n0 + 1, JSON.stringify({ dup, n0, n1 }));
    if (dup.ok) { await chrome.eval(`window.lgChrome.closeTab(${dup.id}), "ok"`); await sleep(450); }

  } catch (e) { check("R51 交互回归段未抛错", false, String((e && e.message) || e)); }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n探针结果：${results.length - failed.length}/${results.length} 通过`);
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    console.log("已写入 " + OUT);
  }
  chrome.close();
  if (popup) popup.close();
  settings.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(2);
});
