/* 仅测试用：不可见冒烟启动、截图、皮肤/深色审计；以及演示数据。
   生产路径不会加载这里的逻辑（只有 --smoke / LG_DEMO 时调用）。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const ocr = require("./ocr");
const adblock = require("./adblock");
const { STATUS_TEXT } = require("./luogu");

/* ---------- 真实账号登录测试（LG_SMOKE_LOGIN=<账号文件>）---------- */

function firstAccount(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const idx = line.indexOf("----");
    if (idx <= 0) continue;
    const user = line.slice(0, idx).trim();
    const pass = line.slice(idx + 4).trim();
    if (user && pass) return { user, pass };
  }
  return null;
}

async function pollLoginState(ctx, wait, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await ctx.luogu.loginState();
    if (state.loggedIn) return state;
    await wait(1000);
  }
  return null;
}

function findRecord(root, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findRecord(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    if ("status" in root && "score" in root) return root;
    for (const key of Object.keys(root)) {
      const hit = findRecord(root[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/* 仅测试用：一次试多种提交 payload 形状，打印每种的服务器原始反应，
   定位 invalid_language_type 到底卡在类型还是 id。 */
async function shapeProbe(ctx, wait) {
  const shapes = [
    { tag: "str5-boolO2", lang: "5", o2: false },
    { tag: "num5-intO2", lang: 5, o2: 0 },
    { tag: "num28-intO2", lang: 28, o2: 0 },
    { tag: "num3-intO2", lang: 3, o2: 0 },
    { tag: "num34-intO2", lang: 34, o2: 0 },
  ];
  for (const s of shapes) {
    const r = await ctx.luogu.exec(
      `(async () => {
        const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
        const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest", "x-csrf-token": csrf };
        const r = await fetch("/fe/api/problem/submit/P1001", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ code: "#include <iostream>\\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;return 0;}", lang: ${JSON.stringify(s.lang)}, enableO2: ${JSON.stringify(s.o2)} }),
        });
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch {}
        let short = text;
        try {
          const err = j && (j.errorType || (j.data && j.data.errorType));
          short = (err || "") + " | " + String((j && (j.errorMessage || (j.data && j.data.errorMessage))) || text.slice(0, 80));
          if (j && (j.rid || (j.data && j.data.rid))) short = "RID=" + (j.rid || j.data.rid);
        } catch {}
        return { status: r.status, resp: String(short).slice(0, 200) };
      })()`
    );
    console.log("LGSHAPE " + s.tag + " " + JSON.stringify(r));
    await wait(1200);
  }
}

/* 仅测试用：从 Vue 组件内部抓语言下拉每项的 value 绑定 + pinia 语言表。 */
async function langVueProbe(ctx, wait) {
  await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001#submit"; })()`);
  await wait(6000);
  await ctx.luogu.exec(`(() => {
    const el = [...document.querySelectorAll("button, [role=combobox], [class*=select], [class*=dropdown], [class*=picker]")].find((b) => /C\+\+/.test(b.textContent || "") && (b.textContent || "").length < 40);
    if (el) el.click();
    return "ok";
  })()`);
  await wait(1500);
  const opts = await ctx.luogu.exec(`(() => {
    const read = (el) => {
      try {
        const c = el.__vueParentComponent;
        if (!c) return null;
        const p = c.props || {};
        const out = {};
        for (const k of Object.keys(p)) {
          const v = p[k];
          out[k] = typeof v === "object" && v !== null ? "[obj]" : String(v).slice(0, 40);
        }
        return out;
      } catch (e) { return { err: String(e).slice(0, 60) }; }
    };
    return [...document.querySelectorAll('[role=option], li, [class*=option], [class*=item]')]
      .map((o) => {
        const t = (o.textContent || "").trim();
        if (!t || t.length > 30 || !/Pascal|C|Python|Java|Rust|Go|Haskell|PHP|Kotlin|OCaml/.test(t)) return null;
        return { t: t.slice(0, 30), props: read(o), dataset: JSON.stringify(o.dataset).slice(0, 80) };
      })
      .filter(Boolean)
      .slice(0, 40);
  })()`);
  console.log("LGPROBE-VUE " + JSON.stringify(opts).slice(0, 5000));
  const pinia = await ctx.luogu.exec(`(() => {
    try {
      const app = document.querySelector("#app").__vue_app__;
      const pinia = app && app.config.globalProperties.$pinia;
      if (!pinia) return "no-pinia";
      const out = {};
      for (const [k, v] of Object.entries(pinia.state.value)) {
        const s = JSON.stringify(v);
        if (s && /C\\+\\+|Pascal/.test(s)) out[k] = s.slice(0, 3000);
      }
      return out;
    } catch (e) { return "err:" + String(e).slice(0, 80); }
  })()`);
  console.log("LGPROBE-PINIA " + JSON.stringify(pinia).slice(0, 5000));
}

/* 仅测试用：抓提交 403 响应里的完整 errorData 与交互式验证码弹窗 DOM。 */
async function interactiveProbe(ctx, wait) {
  await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001#submit"; })()`);
  await wait(6000);
  await ctx.luogu.exec(`(() => {
    window.__lgLog = [];
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__lgUrl = String(u).slice(0, 200);
      return oo.apply(this, arguments);
    };
    const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        window.__lgLog.push({ k: "xhr", url: this.__lgUrl, body: String(body || "").slice(0, 400) });
      } catch {}
      this.addEventListener("load", () => {
        try {
          window.__lgLog.push({ k: "xhr-res", url: this.__lgUrl, status: this.status, body: String(this.responseText || "").slice(0, 5000) });
        } catch {}
      });
      return os.apply(this, arguments);
    };
    const code = "#include <iostream>\\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
    const ed = [...document.querySelectorAll("[contenteditable=true]")].find((t) => t.offsetParent);
    if (ed) {
      ed.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, code);
    }
    return "ok";
  })()`);
  await wait(500);
  await ctx.luogu.exec(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^提交(评测|代码)?$/.test((b.textContent || "").trim()) && b.offsetParent);
    if (btn) btn.click();
    return "ok";
  })()`);
  await wait(3500);
  const dlg = await ctx.luogu.exec(`(() => {
    const swal = document.querySelector(".swal2-popup");
    return {
      html: swal ? (swal.innerHTML || "").slice(0, 3000) : "",
      canvas: [...document.querySelectorAll(".swal2-popup canvas, .swal2-popup iframe, .swal2-popup embed")].map((c) => c.tagName).slice(0, 6),
    };
  })()`);
  console.log("LGINTERACTIVE dlg=" + JSON.stringify(dlg).slice(0, 3500));
  const log = await ctx.luogu.exec(`(() => (window.__lgLog || []).filter((e) => e.k === "xhr-res" && /submit|captcha|verify|challenge/.test(e.url)))()`);
  console.log("LGINTERACTIVE res=" + JSON.stringify(log).slice(0, 6000));
}

/* 仅测试用：驱动真实提交 UI（填代码→点提交→验证码弹窗→OCR→确认），
   全程 fetch/XHR 拦截记录，抓 fz 的真实请求与验证码 img 真实 src。 */
async function uiSubmitProbe(ctx, wait, outDir) {
  await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001#submit"; })()`);
  await wait(6000);
  const editors = await ctx.luogu.exec(`(() => {
    const out = { textarea: [], editable: [], cm: [], buttons: [] };
    for (const t of document.querySelectorAll("textarea")) out.textarea.push({ ph: t.placeholder, cls: String(t.className).slice(0, 60), visible: !!t.offsetParent });
    for (const t of document.querySelectorAll("[contenteditable=true]")) out.editable.push({ cls: String(t.className).slice(0, 60), visible: !!t.offsetParent });
    for (const t of document.querySelectorAll(".cm-content, .CodeMirror, [class*=editor]")) out.cm.push({ cls: String(t.className).slice(0, 60), tag: t.tagName });
    for (const b of document.querySelectorAll("button")) {
      const t = (b.textContent || "").trim();
      if (/^提交/.test(t) && t.length < 12) out.buttons.push({ t, cls: String(b.className).slice(0, 50) });
    }
    return out;
  })()`);
  console.log("LGUISUBMIT editors=" + JSON.stringify(editors).slice(0, 1200));
  await ctx.luogu.exec(`(() => {
    window.__lgLog = [];
    const of = window.fetch;
    window.fetch = function (...args) {
      let url = "";
      try { url = typeof args[0] === "string" ? args[0] : String(args[0] && args[0].url || ""); } catch {}
      let init = "";
      try { init = args[1] ? JSON.stringify({ m: args[1].method, h: args[1].headers }).slice(0, 260) : ""; } catch {}
      window.__lgLog.push({ k: "req", url: url.slice(0, 200), init });
      const p = of.apply(this, args);
      try {
        p.then((res) => {
          try {
            const clone = res.clone();
            clone.text().then((t) => window.__lgLog.push({ k: "res", url: url.slice(0, 200), status: res.status, body: t.slice(0, 260) })).catch(() => {});
          } catch {}
        }).catch(() => {});
      } catch {}
      return p;
    };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__lgUrl = String(u).slice(0, 200);
      this.__lgM = String(m);
      return oo.apply(this, arguments);
    };
    const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        window.__lgLog.push({ k: "xhr", url: this.__lgUrl, m: this.__lgM, body: String(body || "").slice(0, 300) });
      } catch {}
      this.addEventListener("load", () => {
        try {
          window.__lgLog.push({ k: "xhr-res", url: this.__lgUrl, status: this.status, body: String(this.responseText || "").slice(0, 300) });
        } catch {}
      });
      return os.apply(this, arguments);
    };
    return "patched";
  })()`);
  const filled = await ctx.luogu.exec(`(() => {
    const code = "#include <iostream>\\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
    const ta = [...document.querySelectorAll("textarea")].find((t) => t.offsetParent);
    if (ta) {
      const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      d.call(ta, code);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return "textarea";
    }
    const ed = [...document.querySelectorAll("[contenteditable=true]")].find((t) => t.offsetParent);
    if (ed) {
      ed.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, code);
      return "contenteditable";
    }
    return "no-editor";
  })()`);
  console.log("LGUISUBMIT fill=" + filled);
  await ctx.luogu.exec(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^提交(评测|代码)?$/.test((b.textContent || "").trim()) && b.offsetParent);
    if (btn) { btn.click(); return "clicked"; }
    return "no-btn";
  })()`);
  await wait(3000);
  const dlg = await ctx.luogu.exec(`(() => {
    const swal = document.querySelector(".swal2-popup, .swal2-container");
    const imgs = [...document.querySelectorAll("img")].map((i) => String(i.src).slice(0, 160)).filter((s) => /captcha|verify|sign/i.test(s));
    const inputs = [...document.querySelectorAll(".swal2-popup input, .swal2-container input")].map((i) => ({ ph: i.placeholder, cls: String(i.className).slice(0, 40) }));
    return { hasSwal: !!swal, swalText: swal ? (swal.innerText || "").slice(0, 200) : "", imgs, inputs };
  })()`);
  console.log("LGUISUBMIT dialog=" + JSON.stringify(dlg));
  const log1 = await ctx.luogu.exec(`(() => { const l = window.__lgLog || []; return l.filter((e) => /captcha|verify|submit/.test(e.url)); })()`);
  console.log("LGUISUBMIT log=" + JSON.stringify(log1).slice(0, 3000));
  if (dlg.imgs && dlg.imgs[0]) {
    const data = await ctx.luogu.exec(
      `(async () => {
        const img = [...document.querySelectorAll(".swal2-popup img, img")].find((i) => /captcha|verify|sign/i.test(i.src || ""));
        if (!img) return null;
        try {
          const r = await fetch(img.src, { credentials: "include" });
          const b = await r.blob();
          return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        } catch (e) { return null; }
      })()`
    );
    if (data) {
      const capFile = path.join(outDir, "ui-captcha.png");
      fs.writeFileSync(capFile, Buffer.from(String(data).split(",").pop(), "base64"));
      const got = await ocr.recognize(fs.readFileSync(capFile));
      console.log("LGUISUBMIT captcha saved " + capFile + " ocr=" + (got.ok ? got.text : got.reason));
      if (got.ok) {
        await ctx.luogu.exec(`(() => {
          const input = document.querySelector(".swal2-popup input, .swal2-container input");
          if (!input) return "no-input";
          const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          d.call(input, ${JSON.stringify(got.text)});
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const btn = [...document.querySelectorAll(".swal2-popup button, .swal2-container button")].find((b) => /提交|确认|确定/.test(b.textContent || ""));
          if (btn) btn.click();
          return "answered";
        })()`);
        await wait(3500);
        const log2 = await ctx.luogu.exec(`(() => { const l = window.__lgLog || []; return l.slice(-8); })()`);
        console.log("LGUISUBMIT after=" + JSON.stringify(log2).slice(0, 2600));
      }
    }
  }
}

/* 仅测试用：对比 /api/verify/captcha 与 /lg4/captcha 在不同请求头下的响应形态，
   找出真实弹窗（fz 取 widget HTML）与我们裸 GET 的差别。 */
async function captchaFetchProbe(ctx) {
  const variants = [
    { tag: "plain", url: "/api/verify/captcha", headers: {} },
    { tag: "content-only", url: "/api/verify/captcha", headers: { "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest" } },
    { tag: "t-param", url: "/api/verify/captcha?_t=123", headers: {} },
    { tag: "lg4", url: "/lg4/captcha?_t=123", headers: {} },
  ];
  for (const v of variants) {
    const r = await ctx.luogu.exec(
      `(async () => {
        try {
          const r = await fetch(${JSON.stringify(v.url)}, { credentials: "include", headers: ${JSON.stringify(v.headers)} });
          const ct = r.headers.get("content-type");
          const text = await r.text();
          return { status: r.status, ct, head: text.slice(0, 260), len: text.length };
        } catch (e) { return { error: String(e).slice(0, 120) }; }
      })()`
    );
    console.log("LGCAPFETCH " + v.tag + " " + JSON.stringify(r));
  }
}

/* 仅测试用：对候选语言 id 真实提交（OCR 验证码），从评测记录反查语言名，
   同时验证 提交→验证码→评测 全链路。 */
async function langSubmitProbe(ctx, wait, outDir) {
  const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
  const rawSubmit = (langId, captcha) =>
    ctx.luogu.exec(
      `(async () => {
        const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
        const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest", "x-csrf-token": csrf };
        const body = ${JSON.stringify(captcha)} ? { code: ${JSON.stringify(code)}, lang: ${langId}, enableO2: 0, captcha: ${JSON.stringify(captcha)} } : { code: ${JSON.stringify(code)}, lang: ${langId}, enableO2: 0 };
        const r = await fetch("/fe/api/problem/submit/P1001", { method: "POST", headers, credentials: "include", body: JSON.stringify(body) });
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch {}
        const rid = j && (j.rid || (j.data && j.data.rid) || (j.currentData && j.currentData.rid));
        return { status: r.status, rid: rid || null, captcha: /Captcha|验证码/.test(text), error: (j && (j.errorMessage || j.errorType)) || text.slice(0, 120) };
      })()`
    );
  const candidates = [28, 34, 33, 30, 3];
  for (const id of candidates) {
    let r = await rawSubmit(id, "");
    let rounds = 0;
    while (r.captcha && rounds < 3) {
      const png = await ctx.luogu.fetchCaptchaPng();
      if (!png) break;
      const got = await ocr.recognize(png);
      if (!got.ok) {
        console.log("LGPROBE-SUBMIT lang=" + id + " ocr 不可用 " + got.reason);
        break;
      }
      fs.writeFileSync(path.join(outDir, "probe-captcha.png"), png);
      r = await rawSubmit(id, got.text);
      console.log("LGPROBE-SUBMIT lang=" + id + " ocr=" + got.text + " → status=" + r.status + " captcha=" + r.captcha);
      rounds++;
    }
    console.log("LGPROBE-SUBMIT lang=" + id + " final=" + JSON.stringify(r).slice(0, 260));
    if (r.ok && r.rid) {
      await wait(2000);
      const recCtx = await ctx.luogu.fetchContext("/record/" + r.rid);
      const s = JSON.stringify(recCtx || {});
      const names = [...s.matchAll(/"(?:language|lang)"\s*:\s*("?)[A-Za-z0-9+# ()\/\.]{2,30}\1/g)].map((m) => m[0]);
      console.log("LGPROBE-SUBMIT lang=" + id + " rid=" + r.rid + " recLangHits=" + JSON.stringify(names).slice(0, 400));
      let status = null;
      for (let i = 0; i < 30; i++) {
        await wait(2000);
        const rc = await ctx.luogu.fetchContext("/record/" + r.rid);
        const rec = findRecord(rc);
        if (rec && Number(rec.status) > 1) {
          status = { status: Number(rec.status), text: STATUS_TEXT[Number(rec.status)] || String(rec.status), score: Number(rec.score) || 0 };
          break;
        }
      }
      console.log("LGPROBE-SUBMIT lang=" + id + " judge=" + JSON.stringify(status));
      if (status && status.score === 100) {
        console.log("LGPROBE-SUBMIT AC-CHAIN-OK id=" + id);
        return;
      }
    }
  }
}

/* 仅测试用：抓语言 id→名称映射（题目页 context、记录页 context、真实下拉 UI 三处）。 */
async function langProbe(ctx, wait) {
  const problemCtx = await ctx.luogu.fetchContext("/problem/P1001");
  if (problemCtx && problemCtx.data) {
    console.log("LGPROBE-CTX problem-keys=" + JSON.stringify(Object.keys(problemCtx.data.problem || {})));
    console.log("LGPROBE-CTX data-keys=" + JSON.stringify(Object.keys(problemCtx.data)));
    const dump = (v, depth, path) => {
      if (depth > 2 || !v || typeof v !== "object") return;
      for (const [k, val] of Object.entries(v)) {
        if (/lang/i.test(k)) console.log("LGPROBE-CTX " + path + "." + k + "=" + JSON.stringify(val).slice(0, 1200));
        else if (val && typeof val === "object" && !Array.isArray(val)) dump(val, depth + 1, path + "." + k);
      }
    };
    dump(problemCtx.data, 0, "data");
  }
  const recordCtx = await ctx.luogu.fetchContext("/record/list?user=2286010");
  if (recordCtx && recordCtx.data) {
    const dump = (v, depth, path) => {
      if (depth > 2 || !v || typeof v !== "object") return;
      for (const [k, val] of Object.entries(v)) {
        if (/lang/i.test(k)) console.log("LGPROBE-REC " + path + "." + k + "=" + JSON.stringify(val).slice(0, 1500));
        else if (val && typeof val === "object" && !Array.isArray(val)) dump(val, depth + 1, path + "." + k);
      }
    };
    dump(recordCtx.data, 0, "data");
  }
  await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001#submit"; })()`);
  await wait(6000);
  const info = await ctx.luogu.exec(`(() => {
    const out = { selects: [], comboboxes: [], text: [] };
    for (const s of document.querySelectorAll("select")) {
      out.selects.push([...s.options].slice(0, 40).map((o) => ({ v: o.value, t: (o.textContent || "").trim().slice(0, 30) })));
    }
    for (const b of document.querySelectorAll("button, [role=combobox], [class*=select], [class*=dropdown], [class*=picker]")) {
      const t = (b.textContent || "").trim().slice(0, 60);
      if (/C\+\+|语言|Python|Java|Pascal/.test(t)) out.comboboxes.push({ tag: b.tagName, cls: String(b.className).slice(0, 50), t });
    }
    out.text = (document.body.innerText || "").split("\n").filter((l) => /C\+\+|语言/.test(l)).slice(0, 10);
    return out;
  })()`);
  console.log("LGPROBE-UI1 " + JSON.stringify(info).slice(0, 3000));
  await ctx.luogu.exec(`(() => {
    const el = [...document.querySelectorAll("button, [role=combobox], [class*=select], [class*=dropdown], [class*=picker]")].find((b) => /C\+\+/.test(b.textContent || "") && (b.textContent || "").length < 40);
    if (el) el.click();
    return "ok";
  })()`);
  await wait(1500);
  const opts = await ctx.luogu.exec(`(() => {
    return [...document.querySelectorAll('[role=option], li, [class*=option], [class*=item]')]
      .map((o) => ({ v: (o.getAttribute && (o.getAttribute("value") || (o.dataset && o.dataset.value))) || "", t: (o.textContent || "").trim().slice(0, 30) }))
      .filter((o) => o.t && /C|Pascal|Python|Java|Rust|Go|Haskell|PHP|JS|Kotlin/.test(o.t) && o.t.length < 30)
      .slice(0, 60);
  })()`);
  console.log("LGPROBE-UI2 " + JSON.stringify(opts).slice(0, 3000));
}

/* 仅测试用：抓洛谷新前端 bundle，找提交接口的真实 payload 字段与验证码端点。 */
async function bundleProbe(ctx, wait) {
  await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001"; })()`);
  await wait(4500);
  const found = await ctx.luogu.exec(
    `(async () => {
      const out = { scripts: [], hits: [] };
      const html = await (await fetch(location.href, { credentials: "include" })).text();
      const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      out.scripts = srcs.slice(0, 24);
      const grab = (text, needle, tag) => {
        let idx = text.indexOf(needle);
        let n = 0;
        while (idx !== -1 && n < 6) {
          out.hits.push({ tag, around: text.slice(Math.max(0, idx - 350), idx + 450) });
          idx = text.indexOf(needle, idx + 1);
          n++;
        }
      };
      for (const src of srcs) {
        try {
          const url = src.startsWith("http") ? src : new URL(src, location.origin).href;
          const text = await (await fetch(url, { credentials: "include" })).text();
          grab(text, "problem/submit", url.slice(-50));
          grab(text, "verify/captcha", url.slice(-50));
          grab(text, "lg4/captcha", url.slice(-50));
        } catch (e) {
          out.hits.push({ tag: src.slice(-50), err: String(e).slice(0, 80) });
        }
      }
      return out;
    })()`
  );
  console.log("LGBUNDLE scripts=" + JSON.stringify(found.scripts));
  for (const hit of found.hits.slice(0, 14)) {
    console.log("LGBUNDLE-HIT " + JSON.stringify(hit).slice(0, 900));
  }
}

/* 仅测试用：提交验证码机制探针——绕过产品自动识别，人工读图写答案，
   打印服务器完整响应，用来区分“识别错误”和“提交机制错误”。 */
async function submitProbe(ctx, outDir, wait) {
  const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
  let result = await ctx.luogu.submitOnce("P1001", code, "C++14");
  console.log("LGPROBE first=" + JSON.stringify(result));
  if (!result.captchaRequired) {
    if (result.ok && result.rid) await pollProbeJudge(ctx, result.rid, wait);
    return;
  }
  const png = await ctx.luogu.fetchCaptchaPng();
  if (!png) {
    console.log("LGPROBE captcha=fetch-fail");
    return;
  }
  const capFile = path.join(outDir, "probe-captcha.png");
  fs.writeFileSync(capFile, png);
  const ocrRead = await ocr.recognize(png);
  console.log("LGPROBE_CAPTCHA " + capFile + " ocrRead=" + (ocrRead.ok ? ocrRead.text : "FAIL:" + ocrRead.reason));
  const answerFile = path.join(outDir, "probe-answer.txt");
  fs.rmSync(answerFile, { force: true });
  console.log("LGPROBE 等待人工答案：写入 " + answerFile);
  let answer = null;
  for (let i = 0; i < 240; i++) {
    if (fs.existsSync(answerFile)) {
      answer = fs.readFileSync(answerFile, "utf8").trim();
      break;
    }
    await wait(1000);
  }
  if (!answer) {
    console.log("LGPROBE 答案等待超时");
    return;
  }
  result = await ctx.luogu.submitOnce("P1001", code, "C++14", answer);
  console.log("LGPROBE verify=" + JSON.stringify(result));
  if (result.ok && result.rid) await pollProbeJudge(ctx, result.rid, wait);
}

async function pollProbeJudge(ctx, rid, wait) {
  for (let i = 0; i < 30; i++) {
    await wait(2000);
    const recordCtx = await ctx.luogu.fetchContext("/record/" + rid);
    const record = findRecord(recordCtx);
    if (!record) continue;
    const status = Number(record.status);
    if (status === 0 || status === 1) continue;
    console.log("LGPROBE judge=" + JSON.stringify({ status, statusText: STATUS_TEXT[status] || String(status), score: Number(record.score) || 0 }));
    return;
  }
  console.log("LGPROBE judge=timeout");
}

async function loginFlow(ctx, wait, outDir) {
  const file = process.env.LG_SMOKE_LOGIN;
  let accounts = [];
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;
      const parts = line.split("----");
      if (parts.length < 2) continue;
      const user = parts[0].trim();
      const pass = parts[1].trim(); // 第三段（如有）是其他字段，不是密码
      if (user && pass) accounts.push({ user, pass });
    }
  } catch (err) {
    console.log("LGTEST_FAIL 账号文件读取失败 " + err.message);
    return;
  }
  const maxAccounts = Number(process.env.LG_SMOKE_LOGIN_MAX || 5);
  accounts = accounts.slice(0, maxAccounts);
  if (!accounts.length) {
    console.log("LGTEST_FAIL 账号文件里没有可用行");
    return;
  }
  console.log("LGTEST 候选账号 " + accounts.length + " 个");

  // 测试期间不弹系统通知
  ctx.cfg.setNotify({ judge: false, contest: false });

  if (process.env.LG_SMOKE_FORCE_LOGIN === "1") {
    try {
      await ctx.luogu.logout();
      console.log("LGTEST 已清除旧会话");
    } catch {
      /* ignore */
    }
  }
  const existing = await ctx.luogu.loginState();
  if (existing.loggedIn) {
    console.log("LGTEST profile 已有登录态 uid=" + existing.uid);
  } else {
    const fillAndSubmit = (body) =>
      `(() => {
        const setVal = (el, v) => {
          const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          d.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        ${body}
      })()`;

    const captchaInfo = (wc) =>
      wc.executeJavaScript(
        `(() => {
          const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
          const input = [...document.querySelectorAll("input")].find((i) => /captcha|验证码/i.test(i.placeholder || ""));
          const iframe = [...document.querySelectorAll("iframe")].find((f) => /captcha|geetest|verify/i.test(f.src || ""));
          return { img: img ? String(img.src).slice(0, 140) : "", input: input ? input.placeholder : "", iframe: iframe ? String(iframe.src).slice(0, 140) : "" };
        })()`
      );

    const saveCaptcha = async (wc) => {
      const data = await wc.executeJavaScript(
        `(async () => {
          const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
          if (!img) return null;
          const src = img.src;
          if (src.startsWith("data:")) return src;
          try {
            const r = await fetch(src, { credentials: "include" });
            const b = await r.blob();
            return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
          } catch (e) { return null; }
        })()`
      );
      if (!data) return false;
      fs.writeFileSync(path.join(outDir, "login-captcha.png"), Buffer.from(String(data).split(",").pop(), "base64"));
      console.log("LGTEST_CAPTCHA " + path.join(outDir, "login-captcha.png"));
      return true;
    };

    const waitAnswer = async (seconds) => {
      const answerFile = path.join(outDir, "captcha-answer.txt");
      fs.rmSync(answerFile, { force: true });
      console.log("LGTEST 等待验证码答案：写入 " + answerFile);
      for (let i = 0; i < seconds; i++) {
        if (fs.existsSync(answerFile)) return fs.readFileSync(answerFile, "utf8").trim();
        await wait(1000);
      }
      return null;
    };

    const readError = (wc) =>
      wc.executeJavaScript(
        `(() => {
          const nodes = [...document.querySelectorAll(".swal2-toast, .swal2-container, [class*=error], [class*=alert], [class*=toast]")];
          return nodes.map((n) => (n.innerText || "")).join(" | ").replace(/\s+/g, " ").slice(0, 300);
        })()`
      );

    let loggedInState = null;
    let accountIndex = 0;
    const MAX_ATTEMPTS = 12;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !loggedInState; attempt++) {
      if (accountIndex >= accounts.length) break;
      const account = accounts[accountIndex];
      console.log("LGTEST account#" + (accountIndex + 1) + "=" + account.user.slice(0, 3) + "***");

      ctx.views.openLogin();
      const wc = ctx.views.currentWebContents();
      if (!wc) {
        console.log("LGTEST_FAIL 登录视图未创建");
        return;
      }
      await wc.loadURL("https://www.luogu.com.cn/auth/login").catch(() => {});
      for (let i = 0; i < 60 && wc.isLoading(); i++) await wait(500);
      await wait(1000);

      let step1 = null;
      for (let i = 0; i < 10; i++) {
        step1 = await wc.executeJavaScript(
          fillAndSubmit(`
          const inputs = [...document.querySelectorAll("input")].filter(
            (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && !i.disabled && i.offsetParent
          );
          const input = inputs[0];
          if (!input) return { ok: false, reason: "no-account-input" };
          setVal(input, ${JSON.stringify(account.user)});
          const btn = [...document.querySelectorAll("button")].find((b) => /下一步|登录/.test(b.textContent || ""));
          if (!btn) return { ok: false, reason: "no-next-btn" };
          btn.click();
          return { ok: true };`)
        );
        if (step1 && step1.ok) break;
        await wait(700);
      }
      if (!step1 || !step1.ok) {
        console.log("LGTEST_FAIL 找不到登录输入框/按钮");
        return;
      }

      let sawPassword = false;
      for (let i = 0; i < 24 && !sawPassword; i++) {
        sawPassword = await wc.executeJavaScript(
          `(() => { const el = document.querySelector("input[type=password]"); return !!(el && el.offsetParent); })()`
        );
        if (!sawPassword) await wait(500);
      }
      if (!sawPassword) {
        console.log("LGTEST_FAIL 没有出现密码输入框");
        return;
      }

      let captcha = null;
      for (let i = 0; i < 10 && !captcha; i++) {
        captcha = await captchaInfo(wc);
        if (captcha && (captcha.img || captcha.input || captcha.iframe)) break;
        captcha = null;
        await wait(500);
      }

      await wc.executeJavaScript(
        fillAndSubmit(`
        const input = document.querySelector("input[type=password]");
        if (!input) return { ok: false };
        setVal(input, ${JSON.stringify(account.pass)});
        return { ok: true };`)
      );

      if (captcha && (captcha.img || captcha.input)) {
        const saved = await saveCaptcha(wc);
        if (!saved) {
          console.log("LGTEST_FAIL 验证码图获取失败");
          return;
        }
        let answer = null;
        if (process.env.LG_SMOKE_CAPTCHA_MANUAL !== "1") {
          const got = await ocr.recognize(fs.readFileSync(path.join(outDir, "login-captcha.png")));
          if (got.ok) {
            answer = got.text;
            console.log("LGTEST captcha ocr=" + answer + " (attempt " + attempt + ")");
          } else {
            console.log("LGTEST captcha ocr 不可用 " + got.reason + "，转人工答题");
          }
        }
        if (!answer) {
          answer = await waitAnswer(240);
          if (!answer) {
            console.log("LGTEST_FAIL 等待验证码答案超时");
            return;
          }
          console.log("LGTEST captcha answered (attempt " + attempt + ")");
        }
        await wc.executeJavaScript(
          fillAndSubmit(`
          const inputs = [...document.querySelectorAll("input")].filter(
            (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && i.offsetParent
          );
          const input = inputs.find((i) => /captcha|验证码/i.test(i.placeholder || "")) || inputs[inputs.length - 1];
          if (!input) return { ok: false };
          setVal(input, ${JSON.stringify(answer)});
          return { ok: true };`)
        );
      }

      await wc.executeJavaScript(
        fillAndSubmit(`
        const btn = [...document.querySelectorAll("button")].find((b) => /^登录$/.test((b.textContent || "").trim())) ||
          [...document.querySelectorAll("button")].find((b) => /登录/.test(b.textContent || ""));
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true };`)
      );

      for (let i = 0; i < 10; i++) {
        await wait(1000);
        const st = await ctx.luogu.loginState();
        if (st.loggedIn) {
          loggedInState = st;
          break;
        }
      }
      if (loggedInState) break;

      const error = await readError(wc);
      console.log("LGTEST account#" + (accountIndex + 1) + " failed, error=" + JSON.stringify(error));
      if (/用户名或密码/.test(error)) {
        accountIndex++;
        continue;
      }
      if (/验证码/.test(error)) {
        continue; // 同一账号换一张验证码重试
      }
      if (/频繁|稍后|尝试/.test(error)) {
        await wait(30000);
        continue;
      }
      break;
    }

    if (!loggedInState) {
      console.log("LGTEST_FAIL 所有尝试均未登录成功");
      return;
    }
  }

  const state = await ctx.luogu.loginState();
  if (!state || !state.loggedIn) {
    console.log("LGTEST_FAIL 登录未完成");
    return;
  }
  console.log("LGTEST logged-in uid=" + state.uid);

  const diag = await ctx.luogu.exec(`(async () => {
    const out = {};
    const paths = ["/contest/list", "/user/${state.uid}", "/record/list?user=${state.uid}"];
    for (const p of paths) {
      try {
        const r = await fetch("https://www.luogu.com.cn" + p, { credentials: "include" });
        const t = await r.text();
        out[p] = {
          status: r.status,
          url: String(r.url).slice(0, 100),
          len: t.length,
          hasCtx: t.indexOf("lentille-context") !== -1,
          hasUid: t.indexOf("${state.uid}") !== -1,
          head: t.slice(0, 90)
        };
      } catch (e) {
        out[p] = { error: String(e).slice(0, 120) };
      }
    }
    out.pageHref = location.href.slice(0, 100);
    out.cookieHasUid = document.cookie.indexOf("_uid") !== -1;
    return out;
  })()`);
  console.log("LGTEST_DIAG " + JSON.stringify(diag));

  // 隐藏窗口在登录前加载过首页，刷新一次让打卡按钮出现
  try {
    ctx.luogu.reloadHidden();
  } catch {
    /* ignore */
  }
  await wait(2600);

  ctx.views.showHome();
  const refreshState = await ctx.luogu.refresh(true);
  const home = (refreshState && refreshState.home) || {};
  console.log(
    "LGTEST user=" +
      JSON.stringify({ uid: ctx.luogu.user.uid, name: ctx.luogu.user.name, avatar: !!ctx.luogu.user.avatar })
  );
  console.log(
    "LGTEST home=" +
      JSON.stringify({
        punched: home.punched,
        streak: home.streak,
        heatDays: (home.heat || []).filter((d) => d.count > 0).length,
        recent: (home.recent || []).length,
        contest: home.contest ? home.contest.name : null,
        error: home.error || "",
      })
  );

  const records = await ctx.luogu.fetchLibrary("record", { page: 1, force: true });
  console.log(
    "LGTEST records=" +
      JSON.stringify({
        items: (records.items || []).length,
        needLogin: records.needLogin,
        error: records.error || "",
        first: records.items && records.items[0] ? { pid: records.items[0].pid, status: records.items[0].statusText } : null,
      })
  );

  const punch = await ctx.luogu.checkin();
  console.log("LGTEST checkin=" + JSON.stringify({ ok: punch.ok, already: punch.already, message: punch.message || "" }));
  if (!punch.ok) {
    const pageDbg = await ctx.luogu.exec(`(() => ({
      title: document.title,
      href: location.href.slice(0, 100),
      buttons: document.querySelectorAll("button").length,
      anchors: document.querySelectorAll("a").length,
      punchTextCount: ((document.body.innerText || "").match(/打卡|签到/g) || []).length,
      punchEl: (() => {
        const el = [...document.querySelectorAll("*")].find((n) => n.childElementCount === 0 && /打卡|签到/.test(n.textContent || ""));
        return el ? el.tagName + "." + String(el.className).slice(0, 40) : "";
      })(),
      csrfMeta: (document.querySelector('meta[name="csrf-token"]') || {}).content || "",
      csrfGlobals: Object.keys(window).filter((k) => /csrf|token/i.test(k)).slice(0, 10),
      csrfWin: typeof window._FeCSRFToken !== "undefined" ? String(window._FeCSRFToken).slice(0, 8) : "",
      cookieNames: document.cookie.split(";").map((x) => x.trim().split("=")[0]).slice(0, 10)
    }))()`);
    console.log("LGTEST_PAGE " + JSON.stringify(pageDbg));
  }

  if (process.env.LG_SMOKE_SUBMIT !== "0") {
    if (process.env.LG_SMOKE_BUNDLE === "1") {
      await bundleProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "2") {
      await langProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "4") {
      await langVueProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "5") {
      await langSubmitProbe(ctx, wait, outDir);
    } else if (process.env.LG_SMOKE_BUNDLE === "6") {
      await captchaFetchProbe(ctx);
    } else if (process.env.LG_SMOKE_BUNDLE === "7") {
      await uiSubmitProbe(ctx, wait, outDir);
    } else if (process.env.LG_SMOKE_BUNDLE === "8") {
      await interactiveProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_BUNDLE === "3") {
      await shapeProbe(ctx, wait);
    } else if (process.env.LG_SMOKE_SUBMIT_PROBE === "1") {
      await submitProbe(ctx, outDir, wait);
    } else {
    // 打开真实提交弹窗，看验证码图的真实端点
    await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001"; })()`);
    await wait(4000);
    const dlgClick = await ctx.luogu.exec(`(() => {
      const btn = [...document.querySelectorAll("button, a")].find((b) => /提交代码/.test(b.textContent || ""));
      if (btn) { btn.click(); return "clicked"; }
      return "no-btn";
    })()`);
    await wait(2500);
    const dlgInfo = await ctx.luogu.exec(`(() => {
      const imgs = [...document.querySelectorAll("img")].map((i) => String(i.src).slice(0, 110)).filter((s) => /captcha|verify/i.test(s));
      const inputs = [...document.querySelectorAll("input")].map((i) => i.placeholder || i.type).slice(0, 14);
      const ta = !!document.querySelector("textarea");
      return { imgs, inputs, ta };
    })()`);
    console.log("LGTEST_DIALOG " + JSON.stringify({ dlgClick, dlgInfo }));
    const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
    let result = await ctx.luogu.submit("P1001", code, "C++14");
    if (result.captchaRequired && result.interactive) {
      // 洛谷对提交启用的是易盾交互式滑块（反自动化设计），不自动破解：
      // 验证“页面内提交辅助”链路（打开提交区 + 填代码）后跳过人工答题。
      console.log("LGTEST submit-captcha=interactive(" + result.interactive + ") 转页面内提交辅助");
      const assisted = await ctx.views.openSubmitAssist("P1001", code);
      console.log("LGTEST submit-assist=" + assisted + "（编辑器已填代码）");
    } else if (result.captchaRequired) {
      // 走到这里说明产品内自动识别没过（本机没装 ddddocr，或连错 3 次），转人工答题兜底
      const data = await ctx.luogu.exec(
        `(async () => {
          const r = await fetch("/lg4/captcha?_t=" + Date.now(), { credentials: "include" });
          const b = await r.blob();
          return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        })()`
      );
      if (data) {
        const capFile = path.join(outDir, "submit-captcha.png");
        fs.writeFileSync(capFile, Buffer.from(String(data).split(",").pop(), "base64"));
        console.log("LGTEST_SUBMIT_CAPTCHA " + capFile);
        const answerFile = path.join(outDir, "submit-captcha-answer.txt");
        fs.rmSync(answerFile, { force: true });
        let answer = null;
        for (let i = 0; i < 150; i++) {
          if (fs.existsSync(answerFile)) {
            answer = fs.readFileSync(answerFile, "utf8").trim();
            break;
          }
          await wait(1000);
        }
        if (answer) {
          console.log("LGTEST submit captcha answered");
          result = await ctx.luogu.submit("P1001", code, "C++14", answer);
        }
      }
    }
    console.log(
      "LGTEST submit=" +
        JSON.stringify({
          ok: result.ok,
          rid: result.rid,
          fallback: result.fallback,
          message: result.message || "",
          status: result.status || 0,
          detail: String(result.detail || "").slice(0, 200),
        })
    );
    if (result.ok && result.rid) {
      let finalRecord = null;
      for (let i = 0; i < 40; i++) {
        await wait(2000);
        const recordCtx = await ctx.luogu.fetchContext("/record/" + result.rid);
        const record = findRecord(recordCtx);
        if (!record) continue;
        const status = Number(record.status);
        if (status === 0 || status === 1) continue;
        finalRecord = { status, statusText: STATUS_TEXT[status] || String(status), score: Number(record.score) || 0 };
        break;
      }
      console.log("LGTEST judge=" + JSON.stringify(finalRecord));
    }
    }
  }

  // 结构探针：登录态下的比赛列表与题目页语言表
  const contestCtx = await ctx.luogu.fetchContext("/contest/list");
  console.log(
    "LGTEST_CONTEST " +
      JSON.stringify(
        contestCtx
          ? {
              dataKeys: Object.keys(contestCtx.data || {}),
              first: contestCtx.data && contestCtx.data.contests && contestCtx.data.contests.result
                ? JSON.stringify(contestCtx.data.contests.result[0]).slice(0, 240)
                : null,
            }
          : null
      )
  );
  const parsedContests = ctx.luogu.parseContests(contestCtx);
  console.log(
    "LGTEST_PICK " +
      JSON.stringify({ parsedLen: parsedContests.length, picked: ctx.luogu.pickContest(parsedContests) })
  );
  const problemCtx = await ctx.luogu.fetchContext("/problem/P1001");
  console.log(
    "LGTEST_LANGS " +
      JSON.stringify(
        problemCtx
          ? {
              lastLanguage: problemCtx.data ? problemCtx.data.lastLanguage : null,
              lastCodeLen: problemCtx.data && problemCtx.data.lastCode ? String(problemCtx.data.lastCode).length : 0,
              acceptLanguages: problemCtx.data && problemCtx.data.problem ? problemCtx.data.problem.acceptLanguages : null,
            }
          : null
      )
  );

  const refreshState2 = await ctx.luogu.refresh(true);
  const home2 = (refreshState2 && refreshState2.home) || {};
  console.log(
    "LGTEST home2=" +
      JSON.stringify({
        heatDays: (home2.heat || []).filter((d) => d.count > 0).length,
        recent: (home2.recent || []).length,
        contest: home2.contest ? home2.contest.name : null,
        error: home2.error || "",
      })
  );

  // 头像打开独立个人主页，且侧栏任何项目都不高亮
  try {
    await ctx.win.webContents.executeJavaScript(`document.getElementById("tb-avatar").click()`);
    await wait(1800);
    const entry = ctx.views.currentEntry();
    const railState = await ctx.win.webContents.executeJavaScript(`(() => ({
      active: document.querySelectorAll('#rail .active, #rail [aria-current="page"]').length,
      navPressed: [...document.querySelectorAll("#rail .rail-btn")].filter((b) => b.getAttribute("aria-pressed") === "true").length,
    }))()`);
    console.log(
      "LGTEST_PROFILE " +
        JSON.stringify({
          key: entry ? entry.key : null,
          url: entry ? entry.view.webContents.getURL() : null,
          active: railState.active,
          navPressed: railState.navPressed,
        })
    );
  } catch (err) {
    console.log("SMOKE_FAIL profile probe: " + err.message);
  }
}

async function runSmoke(ctx) {
  const out = process.env.LG_SMOKE_OUT || path.join(app.getPath("userData"), "smoke.png");
  const outDir = path.dirname(out);
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name, target) => {
    const win = target || ctx.win;
    let image = await win.capturePage(undefined, { stayHidden: true });
    for (let attempt = 0; attempt < 3 && image.isEmpty(); attempt++) {
      await wait(700);
      image = await win.capturePage(undefined, { stayHidden: true });
    }
    const file = path.join(outDir, `smoke-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log("SMOKE_SHOT " + name + " " + file);
    return file;
  };

  const capture = async () => {
    try {
      if (process.env.LG_SMOKE_LOGIN) {
        await loginFlow(ctx, wait, outDir);
      }
      if (process.env.LG_SMOKE_THEME === "light" || process.env.LG_SMOKE_THEME === "dark") {
        ctx.cfg.setAppearance({ mode: process.env.LG_SMOKE_THEME });
        await ctx.refreshAppearance();
        await wait(700);
      }
      if (process.env.LG_SMOKE_FOLDER) {
        ctx.cfg.setAppearance({
          wallpaper: "folder",
          wallpaperDir: process.env.LG_SMOKE_FOLDER,
          wallpaperInterval: 15,
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(500);
        console.log("SMOKE_WALL_FOLDER " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
        await ctx.nextWallpaper();
        console.log("SMOKE_WALL_NEXT " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
      }
      if (process.env.LG_SMOKE_WE) {
        const items = ctx.scanWe(process.env.LG_SMOKE_WE);
        const first = process.env.LG_SMOKE_WE_ID
          ? items.find((item) => item.id === process.env.LG_SMOKE_WE_ID) || items[0]
          : items.find((item) => item.playable) || items[0];
        ctx.cfg.setAppearance({
          wallpaper: "we",
          weRoot: process.env.LG_SMOKE_WE,
          weId: first ? first.id : "",
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(600);
        console.log("SMOKE_WALL_WE " + JSON.stringify({ count: items.length, items: items.slice(0, 3), label: ctx.wallpaper.label, video: ctx.wallpaper.video }));
      }
      ctx.win.setOpacity(0);
      ctx.win.showInactive();
      if (process.env.LG_SMOKE_SIZE) {
        const [width, height] = String(process.env.LG_SMOKE_SIZE).split("x").map((value) => Number(value));
        if (width && height) {
          ctx.win.setContentSize(width, height);
          await wait(600);
        }
      }
      // 登录/提交流程可能把页面停在题目页；首页截图前先回到原生主页
      ctx.views.showHome();
      await wait(process.env.LG_SMOKE_NET === "1" ? 9000 : 1400);
      const homeShot = await shot("home");
      console.log("SMOKE_OK " + homeShot);

      if (process.env.LG_SMOKE_PERF === "1") {
        ctx.cfg.setGeneral({ performanceMode: true });
        await ctx.refreshAppearance({ reschedule: false });
        await wait(700);
        const perf1 = await ctx.win.webContents.executeJavaScript(`(() => {
          const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : ""; };
          return {
            perf: document.body.classList.contains("perf"),
            blurVar: getComputedStyle(document.documentElement).getPropertyValue("--blur").trim(),
            titleBlur: css("#titlebar", "backdropFilter"),
            railBlur: css("#rail", "backdropFilter"),
            contentBlur: css("#content", "backdropFilter"),
            zoom: getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim(),
          };
        })()`);
        await wait(600);
        const zoom2 = await ctx.win.webContents.executeJavaScript(
          `getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim()`
        );
        console.log("SMOKE_PERF " + JSON.stringify(Object.assign({}, perf1, { zoom2 })));
        ctx.cfg.setGeneral({ performanceMode: false });
        await ctx.refreshAppearance({ reschedule: false });
        await wait(500);

        // 动态降载：失焦后冻结，重新聚焦后恢复
        const sampleZoom = () =>
          ctx.win.webContents.executeJavaScript(
            `getComputedStyle(document.documentElement).getPropertyValue("--lg-zoom").trim()`
          );
        ctx.win.emit("focus");
        await wait(700);
        const z1 = await sampleZoom();
        await wait(500);
        const z2 = await sampleZoom();
        ctx.win.emit("blur");
        await wait(500);
        const z3 = await sampleZoom();
        await wait(500);
        const z4 = await sampleZoom();
        ctx.win.emit("focus");
        await wait(500);
        const z5 = await sampleZoom();
        console.log(
          "SMOKE_LAZY " +
            JSON.stringify({
              moving: z1 !== z2,
              frozen: z3 === z4,
              resumed: z5 !== z4,
              z: [z1, z2, z3, z4, z5],
            })
        );

      }

      if (process.env.LG_SMOKE_RAIL === "1") {
        const collapsedRail = await ctx.win.webContents.executeJavaScript(`(() => {
          const rail = document.getElementById("rail");
          const labels = [...document.querySelectorAll(".rail-group-label")];
          const text = document.querySelector(".rail-user-text");
          const btn = document.querySelector("#rail-top .rail-btn");
          const br = btn ? btn.getBoundingClientRect() : null;
          const ir = btn && btn.querySelector("svg") ? btn.querySelector("svg").getBoundingClientRect() : null;
          const ur = document.getElementById("rail-user") ? document.getElementById("rail-user").getBoundingClientRect() : null;
          const jr = document.getElementById("rail-jump") ? document.getElementById("rail-jump") : null;
          return {
            groupsHidden: labels.length > 0 && labels.every((el) => getComputedStyle(el).display === "none"),
            userTextHidden: !!text && getComputedStyle(text).display === "none",
            userLast: !!rail.lastElementChild && rail.lastElementChild.id === "rail-user",
            userLabel: ((document.getElementById("rail-user") || {}).innerText || "").replace(/\\s+/g, " ").trim(),
            btnW: br ? Math.round(br.width) : 0,
            btnH: br ? Math.round(br.height) : 0,
            iconW: ir ? Math.round(ir.width) : 0,
            userW: ur ? Math.round(ur.width) : 0,
            userH: ur ? Math.round(ur.height) : 0,
            jumpHidden: !!jr && getComputedStyle(jr).display === "none",
            railPad: getComputedStyle(rail).padding,
          };
        })()`);
        console.log("SMOKE_RAIL_COLLAPSED " + JSON.stringify(collapsedRail));
        if (
          !collapsedRail.groupsHidden ||
          !collapsedRail.userTextHidden ||
          !collapsedRail.userLast ||
          collapsedRail.btnW !== 40 ||
          collapsedRail.btnH !== 30 ||
          collapsedRail.iconW !== 20 ||
          collapsedRail.userW !== 32 ||
          collapsedRail.userH !== 32 ||
          !collapsedRail.jumpHidden
        ) {
          console.log("SMOKE_FAIL 侧栏折叠态分组/账户卡/官方几何");
        }
        ctx.views.setRailHover(true, "jump");
        await wait(60);
        // 0.7.2 抽屉补间：60ms 时宽度应仍在滑动途中（≥208 说明瞬跳，补间缺失）
        const drawerMid = ctx.views.railOverlay ? ctx.views.railOverlay.getBounds().width : -1;
        await wait(740);
        const railWc = ctx.views.railWebContents();
        if (railWc) {
          const railView = ctx.views.railOverlay;
          const visible = !!(railView && railView.getVisible());
          const openBounds = railView ? railView.getBounds() : null;
          if (drawerMid >= 208) console.log("SMOKE_FAIL 侧栏抽屉补间缺失（60ms 已全宽瞬跳）");
          if (openBounds && (openBounds.width !== 208 || openBounds.y !== 40)) {
            console.log("SMOKE_FAIL 侧栏抽屉终态几何（应 y=40 宽 208）");
          }
          console.log("SMOKE_RAIL_VISIBLE " + JSON.stringify({ visible, bounds: openBounds, drawerMid }));
          // 透明 view 在不可见/失焦的冒烟窗口里 capturePage 可能得到空图；
          // 有图才落盘，视觉验收以固定态窗口截图 + DOM 断言为准。
          if (visible) {
            if (railView) railView.setBackgroundColor("#16181d");
            await wait(160);
            const image = await railWc.capturePage(undefined, { stayHidden: true });
            if (image && !image.isEmpty()) {
              const file = path.join(outDir, "smoke-rail-overlay.png");
              fs.writeFileSync(file, image.toPNG());
              console.log("SMOKE_SHOT rail-overlay " + file);
            }
            if (railView) railView.setBackgroundColor("#00000000");
          }
          const metrics = await railWc.executeJavaScript(`(() => {
            const rail = document.getElementById("rail");
            const labels = [...document.querySelectorAll(".rail-label")].filter((el) => getComputedStyle(el).display !== "none");
            const pin = document.getElementById("rail-pin");
            const btn = document.querySelector("#rail-top .rail-btn");
            const br = btn ? btn.getBoundingClientRect() : null;
            const jump = document.getElementById("rail-jump");
            return {
              railW: Math.round(rail.getBoundingClientRect().width),
              labels: labels.length,
              groups: [...document.querySelectorAll(".rail-group-label")].map((el) => el.textContent.trim()),
              user: ((document.getElementById("rail-user") || {}).innerText || "").replace(/\\s+/g, " ").trim(),
              userLast: !!rail.lastElementChild && rail.lastElementChild.id === "rail-user",
              pinVisible: !!pin && getComputedStyle(pin).opacity !== "0",
              pinned: document.body.classList.contains("rail-pinned"),
              jumpFocused: document.activeElement === document.getElementById("rail-jump-input"),
              btnW: br ? Math.round(br.width) : 0,
              btnH: br ? Math.round(br.height) : 0,
              jumpVisible: !!jump && getComputedStyle(jump).display !== "none",
              shadow: getComputedStyle(rail).boxShadow,
            };
          })()`);
          console.log("SMOKE_RAIL " + JSON.stringify(metrics));
          if (
            !metrics.groups.includes("浏览") ||
            !metrics.groups.includes("社区") ||
            !metrics.groups.includes("工具") ||
            !metrics.userLast ||
            !/未登录|个人主页/.test(metrics.user) ||
            metrics.btnW < 188 ||
            metrics.btnW > 193 ||
            metrics.btnH !== 30 ||
            !metrics.jumpVisible ||
            metrics.shadow !== "none"
          ) {
            console.log("SMOKE_FAIL 侧栏分组/账户卡/展开几何");
          }
        }
        ctx.views.setRailPinned(true);
        await wait(600);
        const pinnedShot = await shot("rail-pinned");
        const pinnedMetrics = await ctx.win.webContents.executeJavaScript(`(() => {
          const rail = document.getElementById("rail");
          const pin = document.getElementById("rail-pin");
          return {
            railW: Math.round(rail.getBoundingClientRect().width),
            pinned: document.body.classList.contains("rail-pinned"),
            pinVisible: !!pin && getComputedStyle(pin).opacity !== "0",
            labels: [...document.querySelectorAll(".rail-label")].filter((el) => getComputedStyle(el).display !== "none").length,
            groups: [...document.querySelectorAll(".rail-group-label")].filter((el) => getComputedStyle(el).display !== "none").length,
            userLast: !!rail.lastElementChild && rail.lastElementChild.id === "rail-user",
          };
        })()`);
        console.log("SMOKE_RAIL_PINNED " + JSON.stringify(Object.assign({ shot: pinnedShot }, pinnedMetrics)));
        ctx.views.setRailPinned(false);
        await wait(400);

        // 浮层里的导航与钉子必须真的能点（不是只有 DOM 形状对）
        ctx.views.setRailHover(true);
        await wait(500);
        const railWc2 = ctx.views.railWebContents();
        if (railWc2) {
          await railWc2.executeJavaScript(`document.querySelector('.rail-btn[data-id="home"]').click()`);
          await wait(500);
          console.log(
            "SMOKE_RAIL_NAV " +
              JSON.stringify({
                home: !!ctx.views.currentInfo().home,
                overlay: !!(ctx.views.railOverlay && ctx.views.railOverlay.getVisible()),
              })
          );
          ctx.views.setRailHover(true);
          await wait(500);
          await railWc2.executeJavaScript(`document.getElementById("rail-pin").click()`);
          await wait(600);
          console.log(
            "SMOKE_RAIL_PIN_CLICK " +
              JSON.stringify({
                pinned: !!ctx.cfg.get().rail.pinned,
                railW: Math.round(await ctx.win.webContents.executeJavaScript(`document.getElementById("rail").getBoundingClientRect().width`)),
                overlay: !!(ctx.views.railOverlay && ctx.views.railOverlay.getVisible()),
              })
          );
          ctx.views.setRailPinned(false);
          await wait(400);
        }
      }

      if (process.env.LG_SMOKE_LIB === "1") {
        const libKinds = String(process.env.LG_SMOKE_LIB_ONLY || "problems,contest,article,discuss,training,record")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const filterProbe = process.env.LG_SMOKE_LIB_FILTER === "1" && libKinds.includes("problems");
        const fakeTags = {
          tags: [
            { id: 2, name: "模拟", type: 2, parent: 0 },
            { id: 3, name: "枚举", type: 2, parent: 0 },
            { id: 4, name: "NOIP", type: 3, parent: 0 },
            { id: 5, name: "中国", type: 1, parent: 0 },
          ],
          types: [],
        };
        const originalTags = filterProbe ? ctx.luogu.fetchTags : null;
        if (filterProbe) ctx.luogu.fetchTags = async () => fakeTags;
        for (const kind of libKinds) {
          ctx.views.showLibrary(kind);
          await wait(process.env.LG_SMOKE_NET === "1" ? 12000 : 700);
          await shot("lib-" + kind);
        }
        if (filterProbe) {
          const originalLibrary = ctx.luogu.fetchLibrary;
          const seen = [];
          ctx.luogu.fetchLibrary = async (kind, options = {}) => {
            seen.push({
              kind,
              type: options.type || "",
              difficulty: options.difficulty || "",
              tags: options.tags || [],
              content: !!options.content,
              keyword: options.keyword || "",
            });
            return { kind, page: Number(options.page) || 1, perPage: 50, total: 0, items: [] };
          };
          try {
            const shell = ctx.win.webContents;
            const first = await shell.executeJavaScript(`(async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const $ = (s) => document.querySelector(s);
              const $$ = (s) => [...document.querySelectorAll(s)];
              const result = {
                types: $$(".lib-type").map((b) => b.textContent.trim()),
                typeActive: $(".lib-type.on") ? $(".lib-type.on").textContent.trim() : "",
                captions: $$(".lib-filter-caption").map((e) => e.textContent.trim()),
              };
              $('.lib-type[data-type="CF"]').click();
              await sleep(220);
              result.typeAfter = $(".lib-type.on") ? $(".lib-type.on").textContent.trim() : "";
              $(".lib-diff-btn").click();
              await sleep(120);
              result.diff = {
                open: !$(".lib-diff-menu").hidden,
                levels: $$(".lib-diff-item").map((b) => b.textContent.trim()),
              };
              const level = (n) => $('.lib-diff-item[data-level="' + n + '"]');
              level(3).click();
              await sleep(160);
              level(5).click();
              await sleep(160);
              result.range = {
                text: $(".lib-diff-btn-text").textContent,
                checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
              };
              level(4).click();
              await sleep(160);
              result.inside = {
                text: $(".lib-diff-btn-text").textContent,
                checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
              };
              return result;
            })()`);
            const diffShot = await shot("lib-difficulty");
            const second = await shell.executeJavaScript(`(async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const $ = (s) => document.querySelector(s);
              const $$ = (s) => [...document.querySelectorAll(s)];
              const level = (n) => $('.lib-diff-item[data-level="' + n + '"]');
              level(0).click();
              await sleep(180);
              const cleared = {
                text: $(".lib-diff-btn-text").textContent,
                checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
                menuOpen: !$(".lib-diff-menu").hidden,
              };
              $(".lib-toggle").click();
              await sleep(160);
              const contentOn = $(".lib-toggle").getAttribute("aria-pressed") === "true";
              $(".lib-toggle").click();
              await sleep(160);
              $(".lib-tag-btn").click();
              await sleep(240);
              const modal = {
                open: !$(".lib-modal").hidden,
                title: (document.querySelector(".lib-modal-title") || {}).textContent || "",
                placeholder: (document.querySelector(".lib-modal-search input") || {}).placeholder || "",
                tabs: $$(".lib-tag-tab").map((b) => b.textContent.trim()),
                chips: $$(".lib-tag-chip").length,
              };
              const chips = $$(".lib-tag-chip");
              if (chips[0]) chips[0].click();
              await sleep(90);
              if (chips[1]) chips[1].click();
              await sleep(90);
              return {
                cleared,
                contentOn,
                modal: Object.assign(modal, {
                  pickedTitle: (document.querySelector(".lib-tag-selected-title") || {}).textContent || "",
                  picked: $$(".lib-tag-selected-list .lib-sel-chip").length,
                }),
              };
            })()`);
            const tagShot = await shot("lib-tags");
            const third = await shell.executeJavaScript(`(async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const $ = (s) => document.querySelector(s);
              const confirm = $(".lib-modal-btn.primary");
              if (confirm) confirm.click();
              await sleep(260);
              const applied = {
                badge: (document.querySelector(".lib-tag-count") || {}).textContent || "",
                row: (document.querySelector(".lib-selected") || {}).textContent || "",
              };
              const clear = $(".lib-clear-filters");
              if (clear) clear.click();
              await sleep(240);
              const cleared = {
                badge: (document.querySelector(".lib-tag-count") || {}).textContent || "",
                rowHidden: !!document.querySelector(".lib-selected") && document.querySelector(".lib-selected").hidden,
              };
              const luogu = $('.lib-type[data-type="luogu"]');
              if (luogu) luogu.click();
              await sleep(200);
              return { applied, cleared };
            })()`);
            const checks = [
              ["题库类型标签", first.types.join(",") === "洛谷,主题库,入门与面试,Codeforces,SPOJ,AtCoder,UVa"],
              ["分区标题", first.captions.includes("所属题库") && first.captions.includes("筛选条件")],
              ["切题库", first.typeAfter === "Codeforces"],
              ["难度下拉", first.diff.open && first.diff.levels.length === 9],
              ["难度区间", first.range.text === "普及 ~ 提高" && first.range.checked.join(",") === "3,4,5"],
              ["区间内部收缩", first.inside.text === "普及 ~ 普及+/提高−" && first.inside.checked.join(",") === "3,4"],
              ["清除难度", second.cleared.text === "题目难度范围" && second.cleared.checked.join(",") === "0" && !second.cleared.menuOpen],
              ["搜索题面", second.contentOn],
              [
                "标签弹窗",
                second.modal.open &&
                  second.modal.title === "选择标签" &&
                  second.modal.placeholder === "搜索全部标签" &&
                  second.modal.tabs.join(",") === "算法,来源,时间,区域,特殊题目",
              ],
              ["标签多选", second.modal.pickedTitle === "已选标签（2）" && second.modal.picked === 2],
              ["标签应用", third.applied.badge === "2" && String(third.applied.row).includes("模拟")],
              ["清除筛选", third.cleared.badge === "" && third.cleared.rowHidden],
              ["题库参数", seen.some((item) => item.type === "CF")],
              ["难度参数", seen.some((item) => item.difficulty === "3|5") && seen.some((item) => item.difficulty === "3|4")],
              ["题面参数", seen.some((item) => item.content)],
              ["标签分组参数", seen.some((item) => item.tags.length === 1 && item.tags[0].join(",") === "2,3")],
              [
                "末次无筛选",
                (() => {
                  const last = seen[seen.length - 1] || {};
                  return last.type === "luogu" && !last.difficulty && !last.tags.length && !last.content;
                })(),
              ],
            ];
            const failed = checks.filter(([, pass]) => !pass).map(([name]) => name);
            console.log(
              "SMOKE_LIB_FILTER " +
                JSON.stringify({
                  passed: checks.length - failed.length,
                  failed,
                  first,
                  second,
                  third,
                  seen,
                  diffShot,
                  tagShot,
                })
            );
            if (failed.length) console.log("SMOKE_FAIL 题库筛选: " + failed.join(","));
          } finally {
            ctx.luogu.fetchLibrary = originalLibrary;
            ctx.luogu.fetchTags = originalTags;
          }
          if (process.env.LG_SMOKE_NET === "1") {
            try {
              const catalog = await ctx.luogu.fetchTags();
              const algorithm = (catalog.tags || []).find((tag) => Number(tag.type) === 2 && Number(tag.id) > 0);
              if (!algorithm) throw new Error("标签目录没有算法标签");
              const real = await ctx.luogu.fetchLibrary("problems", {
                page: 1,
                type: "P",
                difficulty: "3|5",
                tags: [[Number(algorithm.id)]],
                content: true,
                force: true,
              });
              const okReal = !real.error && Array.isArray(real.items) && real.items.length > 0 && real.total > 0;
              console.log(
                "SMOKE_LIB_FILTER_NET " +
                  JSON.stringify({
                    tag: algorithm.name,
                    tagId: algorithm.id,
                    total: real.total,
                    items: (real.items || []).length,
                    first: ((real.items || [])[0] || {}).pid || "",
                    itemTags: ((real.items || [])[0] || {}).tags || [],
                    error: real.error || "",
                    cacheKeys: [...ctx.luogu.libCache.keys()].filter((key) => key.includes("t:P|")),
                  })
              );
              if (!okReal) console.log("SMOKE_FAIL 真实筛选请求没有结果");
            } catch (err) {
              console.log("SMOKE_FAIL 真实筛选请求: " + (err && err.message ? err.message : String(err)));
            }
          }
        }
        ctx.views.showHome();
        await wait(400);
      }

      if (process.env.LG_SMOKE_LIST_CLICK === "1") {
        // P0 回归：列表行必须能被鼠标左键打开（数据打桩进 libCache，不联网）
        const clickPayload = {
          kind: "problems",
          page: 1,
          perPage: 50,
          total: 3,
          items: [
            { type: "problem", pid: "P1001", title: "A+B Problem", difficulty: 1, difficultyName: "入门", difficultyColor: "#fe4c61", submissions: 100, accepted: 60, provider: "洛谷" },
            { type: "problem", pid: "P1002", title: "过河卒", difficulty: 3, difficultyName: "普及/提高−", difficultyColor: "#f39c11", submissions: 82, accepted: 41, provider: "洛谷" },
            { type: "problem", pid: "P1003", title: "铺地毯", difficulty: 2, difficultyName: "普及−", difficultyColor: "#ffc116", submissions: 61, accepted: 37, provider: "洛谷" },
          ],
          needLogin: false,
          categories: [],
          error: "",
        };
        ctx.luogu.libCache.set("problems|1||", { at: Date.now(), payload: clickPayload });
        ctx.views.showLibrary("problems");
        await wait(900);
        const clickBefore = ctx.views.currentInfo();
        const clickResult = await ctx.win.webContents.executeJavaScript(`(() => {
          const row = document.querySelector("#library .lib-row");
          if (!row) return "no-row";
          row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          return "clicked";
        })()`);
        await wait(1200);
        const clickAfter = ctx.views.currentInfo();
        const clickOk =
          clickBefore.kind === "library" &&
          clickResult === "clicked" &&
          clickAfter.kind === "problem" &&
          clickAfter.pid === "P1001";
        console.log(
          "SMOKE_LIST_CLICK " +
            JSON.stringify({ before: clickBefore.kind, click: clickResult, after: clickAfter.kind, pid: clickAfter.pid, ok: clickOk })
        );
        if (!clickOk) console.log("SMOKE_FAIL 列表行点击没有打开题目");
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_LANG === "1") {
        // P0 回归：语言表映射正确；联网时再和真实 /_lfe/config 对照
        const { LANGS, resolveLangId } = require("./langs");
        const expect = {
          "C++14 (GCC 9)": 28,
          "C++14": 11,
          "C++17": 12,
          "C++20": 27,
          "C++23": 34,
          "C++11": 4,
          "C++98": 3,
          C: 2,
          "Python 3": 7,
          Pascal: 1,
          "Java 8": 8,
          "Java 21": 33,
          Rust: 15,
          Go: 14,
        };
        const mismatch = Object.entries(expect).filter(([name, id]) => {
          const got = resolveLangId(name);
          return !got || got.id !== id || got.o2 === undefined;
        });
        const unknown = resolveLangId("Brainfuck");
        console.log("SMOKE_LANG_TABLE " + JSON.stringify({ langs: LANGS.length, mismatch, unknownRejected: unknown === null }));
        if (mismatch.length || unknown !== null) console.log("SMOKE_FAIL 语言表映射错误");
        if (process.env.LG_SMOKE_NET === "1") {
          const live = await ctx.luogu.exec(
            `(async () => { try { const r = await fetch("/_lfe/config", { credentials: "include" }); return await r.json(); } catch { return null; } })()`
          );
          if (live && live.CodeLanguage) {
            const byName = new Map(Object.values(live.CodeLanguage).map((item) => [item.name, item]));
            const drift = LANGS.filter((lang) => {
              const cur = byName.get(lang.name);
              return !cur || cur.id !== lang.id || !!cur.canO2 !== !!lang.o2;
            }).map((lang) => lang.name);
            console.log("SMOKE_LANG_LIVE " + JSON.stringify({ liveCount: byName.size, drift }));
            if (drift.length) console.log("SMOKE_FAIL 线上语言表漂移: " + drift.join(","));
          } else {
            console.log("SMOKE_LANG_LIVE skipped（config 拉取失败）");
          }
        }
      }

      if (process.env.LG_SMOKE_VISUAL === "1") {
        await ctx.win.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true, bubbles: true }))`
        );
        await wait(700);
        await shot("palette");
        await ctx.win.webContents.executeJavaScript(
          `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }))`
        );
        await wait(300);
        await ctx.win.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true, bubbles: true }))`
        );
        await wait(700);
        await shot("switcher");
        await ctx.win.webContents.executeJavaScript(
          `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }))`
        );
        await wait(300);
        ctx.toast("已保存", "草稿已保存到本机，断网也不会丢。");
        await wait(500);
        await shot("toast");
        await ctx.win.webContents.executeJavaScript(`document.querySelector(".toast") && document.querySelector(".toast").click()`);
        await wait(250);
        const metrics = await ctx.win.webContents.executeJavaScript(`(() => {
          const q = (s) => document.querySelector(s);
          const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.x * 10) / 10 }; };
          const css = (s) => { const e = q(s); return e ? getComputedStyle(e) : null; };
          return {
            rail: rect("#rail"),
            title: rect("#titlebar"),
            avatar: rect("#tb-avatar"),
            titlePadding: css("#titlebar") ? css("#titlebar").paddingRight : "",
            innerWidth: window.innerWidth,
            toolbar: rect("#toolbar"),
            contentBg: css("#content") ? css("#content").backgroundColor : "",
            homeMax: css(".home-wrap") ? css(".home-wrap").maxWidth : "",
            heatCell: rect(".hc"),
            cardRadius: css(".card") ? css(".card").borderRadius : "",
            bodyFont: css("body") ? css("body").fontSize : "",
            heatLegend: !!q(".heat-legend"),
            statsCard: !!q(".stats-card"),
            sidebarLabel: q("#rail-top .rail-label") ? q("#rail-top .rail-label").textContent : "",
            homeCards: document.querySelectorAll(".home-wrap .card").length,
            homeHello: !!q(".home-hello"),
            welcomeCard: !!q(".welcome-card"),
            calRows: document.querySelectorAll(".cal-row").length,
            cdRows: document.querySelectorAll(".cd-row").length
          };
        })()`);
        console.log("SMOKE_VISUAL_METRICS " + JSON.stringify(metrics));
      }

      if (process.env.LG_SMOKE_LUOGU === "1") {
        ctx.views.openProblem("P1001");
        const maxWait = Number(
          process.env.LG_SMOKE_LUOGU_WAIT || (process.env.LG_SMOKE_NET === "1" ? 30000 : 8000)
        );
        const deadline = Date.now() + maxWait;
        let rendered = false;
        while (Date.now() < deadline) {
          const wc = ctx.views.currentWebContents();
          if (wc) {
            try {
              rendered = await wc.executeJavaScript(`(() => {
                const m = document.querySelector(".lfe-marked");
                const text = m ? (m.innerText || "") : "";
                return !!(m && text.trim().length > 200 && !/\\*\\*[^*\\n]{1,80}\\*\\*/.test(text.slice(0, 4000)));
              })()`);
            } catch {
              rendered = false;
            }
            if (rendered) break;
          }
          await wait(1000);
        }
        console.log("SMOKE_LUOGU_READY " + rendered);
        await shot("problem");
        const entry = ctx.views.currentEntry();
        if (entry) {
          console.log(
            "SMOKE_VIEW url=" +
              entry.view.webContents.getURL() +
              " bounds=" +
              JSON.stringify(entry.view.getBounds())
          );
          // 折叠/固定侧栏时页面视图让位：56 → 208 → 56（真实题面在场）
          try {
            const collapsed = entry.view.getBounds();
            ctx.views.setRailPinned(true);
            await wait(400);
            const pinned = entry.view.getBounds();
            ctx.views.setRailPinned(false);
            await wait(400);
            const restored = entry.view.getBounds();
            const railBoundsOk =
              collapsed.x === 56 && pinned.x === 208 && restored.x === 56;
            console.log(
              "SMOKE_RAIL_BOUNDS " +
                JSON.stringify({
                  collapsed: collapsed.x,
                  pinned: pinned.x,
                  restored: restored.x,
                  ok: railBoundsOk,
                })
            );
            if (!railBoundsOk) console.log("SMOKE_FAIL rail bounds mismatch");
          } catch (err) {
            console.log("SMOKE_FAIL rail bounds: " + err.message);
          }
          let viewImage = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              viewImage = await entry.view.webContents.capturePage(undefined, { stayHidden: true });
              if (!viewImage.isEmpty()) break;
            } catch (err) {
              viewImage = null;
            }
            await wait(900);
          }
          if (viewImage && !viewImage.isEmpty()) {
            fs.writeFileSync(path.join(outDir, "smoke-problem-view.png"), viewImage.toPNG());
            console.log("SMOKE_SHOT problem-view");
          } else {
            console.log("SMOKE_SKIP problem-view（隐藏窗口取帧不稳定，非产品问题）");
          }
          try {
            const skin = await entry.view.webContents.executeJavaScript(`(() => {
              const probe = getComputedStyle(document.body, "::before");
              const rect = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
              };
              const app = document.querySelector("#app");
              const main = document.querySelector("#app > .main-container");
              const card = document.querySelector("#app .l-card");
              const appCS = app ? getComputedStyle(app) : null;
              const mainCS = main ? getComputedStyle(main) : null;
              return {
                bgImage: probe.backgroundImage.slice(0, 160),
                bgSize: probe.backgroundSize,
                scrim: getComputedStyle(document.documentElement).getPropertyValue("--lg-scrim").trim(),
                backdrop: probe.transform,
                bodyBg: getComputedStyle(document.body).backgroundColor,
                htmlBg: getComputedStyle(document.documentElement).backgroundColor,
                innerWidth: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                app: rect(app),
                appPad: appCS ? appCS.padding : "",
                appMargin: appCS ? appCS.margin : "",
                main: rect(main),
                mainPad: mainCS ? mainCS.padding : "",
                mainMargin: mainCS ? mainCS.margin : "",
                card: rect(card),
                scrollbar: {
                  width: getComputedStyle(document.documentElement).scrollbarWidth,
                  thumb: (() => { try { return getComputedStyle(document.documentElement, "::-webkit-scrollbar-thumb").backgroundColor; } catch { return ""; } })(),
                },
              };
            })()`);
            console.log("SMOKE_SKIN " + JSON.stringify(skin));
          } catch (err) {
            console.log("SMOKE_SKIN probe failed: " + err.message);
          }
          try {
            const buttons = await entry.view.webContents.executeJavaScript(`(() => {
              return [...document.querySelectorAll("button, a")].filter((el) => /提交|登录/.test((el.textContent || "").trim())).slice(0, 8).map((el) => ({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === "string" ? el.className : "",
                bg: getComputedStyle(el).backgroundColor,
                color: getComputedStyle(el).color,
                h: Math.round(el.getBoundingClientRect().height)
              }));
            })()`);
            console.log("SMOKE_BUTTONS " + JSON.stringify(buttons));
          } catch (err) {
            console.log("SMOKE_BUTTONS probe failed: " + err.message);
          }
          if (process.env.LG_SMOKE_IDE === "1") {
            ctx.views.setIde(true);
            await wait(1000);
            await shot("ide");
            try {
              const ideProbe = await ctx.win.webContents.executeJavaScript(`(() => {
                const pane = document.querySelector("#ide-pane");
                const resizer = document.querySelector("#ide-resizer");
                const gutter = document.querySelector(".ide-gutter");
                const rect = pane.getBoundingClientRect();
                return {
                  paneHidden: pane.hidden,
                  paneRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                  split: getComputedStyle(document.querySelector("#workspace")).getPropertyValue("--ide-split").trim(),
                  resizerHidden: resizer.hidden,
                  lines: gutter ? gutter.textContent.split("\\n").length : 0,
                  codeFont: getComputedStyle(document.querySelector(".ide-code")).fontSize,
                  headH: Math.round(document.querySelector(".ide-head").getBoundingClientRect().height)
                };
              })()`);
              console.log("SMOKE_IDE " + JSON.stringify(ideProbe));
              const ideEntry = ctx.views.currentEntry();
              console.log(
                "SMOKE_IDE_BOUNDS " +
                  JSON.stringify({
                    view: ideEntry ? ideEntry.view.getBounds() : null,
                    content: ctx.win.getContentBounds(),
                  })
              );
            } catch (err) {
              console.log("SMOKE_IDE probe failed: " + err.message);
            }
            ctx.views.setIde(false);
            await wait(400);
          }
        }

        // 真实题目页的 DOM 快照应在导航停稳 + 4.5s 后落盘（SPA 水合慢会再重试）
        await wait(7000);
        const snapHit = ctx.luogu.problemSnapshot("P1001");
        console.log(
          "SMOKE_SNAPSHOT " +
            JSON.stringify({
              has: !!snapHit,
              len: snapHit ? snapHit.html.length : 0,
              title: snapHit ? String(snapHit.title || "").slice(0, 40) : "",
              hasPid: !!(snapHit && snapHit.html && snapHit.html.toLowerCase().indexOf("a+b") >= 0),
            })
        );
      }

      if (process.env.LG_SMOKE_OFFLINE === "1") {
        /* 断网链路端到端：全程不联网。
           1) 强制离线 → 列表走缓存（stale 标记）；
           2) 打开题目 → lgoff:// 本地快照页可读；
           3) 提交 → 进离线队列；
           4) 恢复在线（submit/refresh 打桩避免真实网络）→ 队列自动重放清空。 */
        if (ctx.luogu.onlineTimer) {
          clearInterval(ctx.luogu.onlineTimer);
          ctx.luogu.onlineTimer = null;
        }
        ctx.luogu.setOnline(false);

        const libPayload = {
          kind: "problems",
          page: 1,
          perPage: 50,
          total: 10,
          items: [
            ["P1001", "A+B Problem（离线缓存）", 1, "入门", "#fe4c61", 100, 60],
            ["P1002", "过河卒", 3, "普及/提高−", "#f39c11", 820000, 410000],
            ["P1003", "铺地毯", 2, "普及−", "#ffc116", 610000, 370000],
            ["P1004", "方格取数", 4, "普及+/提高", "#52c41a", 390000, 210000],
            ["P1005", "矩阵取数游戏", 5, "提高+/省选−", "#3498db", 180000, 62000],
            ["P1006", "传纸条", 4, "普及+/提高", "#52c41a", 300000, 170000],
            ["P1007", "独木桥", 3, "普及/提高−", "#f39c11", 210000, 120000],
            ["P1008", "三连击", 2, "普及−", "#ffc116", 720000, 510000],
            ["P1009", "阶乘之和", 2, "普及−", "#ffc116", 650000, 390000],
            ["P1010", "幂次方", 3, "普及/提高−", "#f39c11", 240000, 160000],
          ].map(([pid, title, difficulty, difficultyName, difficultyColor, submissions, accepted]) => ({
            type: "problem",
            pid,
            title,
            difficulty,
            difficultyName,
            difficultyColor,
            submissions,
            accepted,
            provider: "洛谷",
          })),
          needLogin: false,
          categories: [],
          error: "",
        };
        ctx.store.set("lib:problems|1||", { key: "lib:problems|1||", at: Date.now(), payload: libPayload }, 0);
        ctx.store.flush("lib:problems|1||");
        ctx.luogu.saveProblemSnapshot(
          "P1001",
          "A+B Problem",
          "<h2>题目描述</h2><p>OFFLINE_SNAPSHOT_MARKER 输入两个整数 a 和 b，输出它们的和。</p><p>输入格式：一行两个整数 a 和 b。输出格式：一行一个整数，表示 a+b。数据范围：1 ≤ a, b ≤ 1000，保证结果在 32 位整数范围内。</p><p>样例输入：<code>1 2</code>；样例输出：<code>3</code>。本题考察最基本的输入输出与算术运算，注意使用正确的读入方式并换行输出。</p><pre><code>#include &lt;iostream&gt;</code></pre>"
        );
        ctx.store.flush("problem:P1001");
        ctx.store.set(
          "home",
          {
            quote: "离线也能刷题。",
            heat: [],
            contest: null,
            recent: [{ pid: "P1001", title: "A+B Problem", status: 12, statusText: "AC", score: 100, time: Date.now() }],
            punched: true,
            streak: 3,
            updatedAt: Date.now(),
            error: "",
          },
          0
        );
        ctx.store.flush("home");
        ctx.luogu.home = ctx.store.get("home");

        const libOff = await ctx.luogu.fetchLibrary("problems", { force: true });
        console.log(
          "SMOKE_OFFLINE_LIB " +
            JSON.stringify({
              stale: !!libOff.stale,
              offline: !!libOff.offline,
              items: libOff.items.length,
              first: libOff.items[0] && libOff.items[0].pid,
            })
        );

        ctx.views.showLibrary("problems");
        await wait(900);
        await shot("offline-lib");
        ctx.views.showHome();
        await wait(500);

        ctx.views.openProblem("P1001");
        // ensureEntry 要先装 CDP 守卫（最多 5s）再 loadURL(lgoff)，这里等足
        await wait(7000);
        const snapUrl = ctx.luogu.problemSnapshotUrl("P1001");
        const offEntry = ctx.views.currentEntry();
        const offUrl = offEntry ? offEntry.view.webContents.getURL() : "";
        let offProbe = null;
        if (offEntry && offUrl.startsWith("lgoff://")) {
          try {
            offProbe = await offEntry.view.webContents.executeJavaScript(
              `(() => ({ marker: document.body.innerText.indexOf("OFFLINE_SNAPSHOT_MARKER") >= 0, bar: !!document.querySelector(".lg-off-bar"), bg: getComputedStyle(document.body).backgroundColor }))()`
            );
          } catch (err) {
            offProbe = { error: String(err.message).slice(0, 100) };
          }
        }
        console.log("SMOKE_OFFLINE_PROBLEM " + JSON.stringify({ url: offUrl, snapUrl, probe: offProbe }));
        await shot("offline-problem");
        if (offEntry) {
          try {
            const offImage = await offEntry.view.webContents.capturePage(undefined, { stayHidden: true });
            if (offImage && !offImage.isEmpty()) {
              fs.writeFileSync(path.join(outDir, "smoke-offline-problem-view.png"), offImage.toPNG());
              console.log("SMOKE_SHOT offline-problem-view");
            }
          } catch {
            /* 隐藏窗口取帧不稳定，非产品问题 */
          }
        }

        // 未缓存的题：离线时应出「没有快照」提示页，而不是空白 + 加载失败弹窗
        ctx.views.openProblem("P9999");
        await wait(7000);
        const missEntry = ctx.views.currentEntry();
        const missUrl = missEntry ? missEntry.view.webContents.getURL() : "";
        let missProbe = null;
        try {
          missProbe = await missEntry.view.webContents.executeJavaScript(
            `(() => ({ text: document.body.innerText.slice(0, 120), hasBox: !!document.querySelector(".box") }))()`
          );
        } catch (err) {
          missProbe = { error: String(err.message).slice(0, 100) };
        }
        console.log("SMOKE_OFFLINE_MISSING " + JSON.stringify({ url: missUrl, probe: missProbe }));

        const queuedRes = await ctx.luogu.enqueueSubmit("P1001", "#include <iostream>\nint main() {}", "C++14", "当前离线");
        const qBefore = ctx.luogu.queueState();
        console.log(
          "SMOKE_OFFLINE_QUEUE " +
            JSON.stringify({ queued: !!queuedRes.queued, count: qBefore.count, statuses: qBefore.items.map((item) => item.status) })
        );

        ctx.views.showHome();
        await wait(700);
        await shot("offline-home");

        const realSubmit = ctx.luogu.submit.bind(ctx.luogu);
        const realRefresh = ctx.luogu.refresh.bind(ctx.luogu);
        ctx.luogu.submit = async () => ({ ok: true, rid: "RTEST" });
        ctx.luogu.refresh = async () => ctx.luogu.state();
        ctx.luogu.setOnline(true);
        // flushQueue 每条处理后有 1.5s 间隔，等清理写盘完成再断言
        await wait(3400);
        const qAfter = ctx.luogu.queueState();
        console.log("SMOKE_OFFLINE_FLUSH " + JSON.stringify({ count: qAfter.count, items: qAfter.items.length }));
        ctx.luogu.submit = realSubmit;
        ctx.luogu.refresh = realRefresh;
      }

      if (process.env.LG_SMOKE_GLASS === "1") {
        // R64 回归：「壁纸透出」滑杆必须真实改变内容面/纱层透明度，100% 时归零，
        // 浮层仍保留 60% 可读下限（0.7.0 语义：70→100 线性压到全透）。
        const readGlassVars = () =>
          ctx.win.webContents.executeJavaScript(`(() => ({
            scrim: getComputedStyle(document.documentElement).getPropertyValue("--page-scrim").trim(),
            card: getComputedStyle(document.documentElement).getPropertyValue("--card-alpha").trim(),
            panel: getComputedStyle(document.documentElement).getPropertyValue("--panel-alpha").trim(),
            overlay: getComputedStyle(document.documentElement).getPropertyValue("--overlay-alpha").trim(),
            textShadow: getComputedStyle(document.documentElement).getPropertyValue("--lg-text-shadow").trim(),
          }))()`);
        ctx.cfg.setAppearance({ glass: 0 });
        await ctx.refreshAppearance({ reschedule: false });
        await wait(400);
        const glass0 = await readGlassVars();
        ctx.cfg.setAppearance({ glass: 100 });
        await ctx.refreshAppearance({ reschedule: false });
        await wait(400);
        const glass100 = await readGlassVars();
        const pctNum = (value) => Number(String(value).replace("%", "")) || 0;
        const glassOk =
          pctNum(glass0.scrim) >= 50 &&
          pctNum(glass0.card) >= 55 &&
          pctNum(glass100.scrim) === 0 &&
          pctNum(glass100.card) === 0 &&
          pctNum(glass100.panel) === 0 &&
          pctNum(glass100.overlay) >= 60;
        console.log("SMOKE_GLASS " + JSON.stringify({ glass0, glass100, ok: glassOk }));
        if (!glassOk) console.log("SMOKE_FAIL 壁纸透出 100% 没有归零或浮层可读下限丢失");
        ctx.cfg.setAppearance({ glass: 45 });
        await ctx.refreshAppearance({ reschedule: false });
        await wait(300);
      }

      if (process.env.LG_SMOKE_ADBLOCK === "1") {
        // R64 回归：广告默认关闭；开启后请求级 cancel 生效，页面拿到 data-lg-adblock=1。
        const defaultOff = ctx.cfg.get().general.adBlock === false;
        const wired = adblock.stats().wired;
        const before = adblock.stats().blocked;
        let offErr = "";
        try {
          await ctx.session.fetch("https://doubleclick.net/lgprobe-off-" + Date.now(), { cache: "no-store" });
        } catch (err) {
          offErr = String((err && err.message) || err).slice(0, 80);
        }
        await wait(250);
        const offBlocked = adblock.stats().blocked - before;

        ctx.cfg.setGeneral({ adBlock: true });
        await wait(250);
        const afterToggle = adblock.stats().blocked;
        let onErr = "";
        try {
          await ctx.session.fetch("https://doubleclick.net/lgprobe-on-" + Date.now(), { cache: "no-store" });
        } catch (err) {
          onErr = String((err && err.message) || err).slice(0, 80);
        }
        await wait(300);
        const onBlocked = adblock.stats().blocked - afterToggle;

        // 已打开的页面必须即时拿到 CSS 兜底标记（离线页没有广告，跳过）
        let dataset = "";
        const wc = ctx.views.currentWebContents();
        if (wc) {
          try {
            const url = wc.getURL();
            if (/^https?:/i.test(url)) dataset = await wc.executeJavaScript("document.documentElement.dataset.lgAdblock || ''");
          } catch {
            dataset = "";
          }
        }
        const adOk = defaultOff && wired && offBlocked === 0 && onBlocked >= 1;
        console.log(
          "SMOKE_ADBLOCK " +
            JSON.stringify({ defaultOff, wired, offBlocked, onBlocked, dataset, offErr, onErr, ok: adOk })
        );
        if (!adOk) console.log("SMOKE_FAIL 广告拦截开关没有生效");
        ctx.cfg.setGeneral({ adBlock: false });
        await wait(200);
      }

      if (process.env.LG_SMOKE_HISTORY === "1") {
        // R57 回归：详情页能返回来源列表；最近关闭的页面可一键恢复
        const histPayload = {
          kind: "problems",
          page: 1,
          perPage: 50,
          total: 1,
          items: [
            { type: "problem", pid: "P1001", title: "A+B Problem", difficulty: 1, difficultyName: "入门", difficultyColor: "#fe4c61", submissions: 100, accepted: 60, provider: "洛谷" },
          ],
          needLogin: false,
          categories: [],
          error: "",
        };
        ctx.luogu.libCache.set("problems|1||", { at: Date.now(), payload: histPayload });
        ctx.views.showLibrary("problems");
        await wait(700);
        ctx.views.openDetail("/contest/1", "比赛详情");
        await wait(500);
        const detailInfo = ctx.views.currentInfo();
        ctx.views.back();
        await wait(400);
        const backInfo = ctx.views.currentInfo();
        const backOk = !!detailInfo.canBack && backInfo.kind === "library" && backInfo.library === "problems";
        console.log(
          "SMOKE_HISTORY_BACK " + JSON.stringify({ canBack: detailInfo.canBack, backKind: backInfo.kind, lib: backInfo.library, ok: backOk })
        );
        if (!backOk) console.log("SMOKE_FAIL 详情页返回不到来源列表");

        ctx.views.openProblem("P1001");
        await wait(600);
        const closeEntry = ctx.views.entries.get("problem:P1001");
        const hadEntry = !!closeEntry;
        if (closeEntry) ctx.views.destroyEntry(closeEntry);
        await wait(200);
        const reopenable = ctx.views.canReopen();
        const reopened = ctx.views.reopenClosed();
        await wait(500);
        const reopenInfo = ctx.views.currentInfo();
        const reopenOk =
          hadEntry && reopenable && reopened && reopenInfo.kind === "problem" && reopenInfo.pid === "P1001";
        console.log(
          "SMOKE_HISTORY_REOPEN " +
            JSON.stringify({ hadEntry, reopenable, reopenedKind: reopened && reopened.kind, nowPid: reopenInfo.pid, ok: reopenOk })
        );
        if (!reopenOk) console.log("SMOKE_FAIL 最近关闭恢复失败");
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_DRAFT === "1") {
        // R56 回归：草稿按题目隔离，A 题的代码绝不漏进 B 题的编辑器
        await ctx.win.webContents.executeJavaScript(
          `window.lg.saveDraft({ pid: "P1001", code: "DRAFT_A_MARKER", lang: "C++17", o2: true })`
        );
        const draftA = await ctx.win.webContents.executeJavaScript(`window.lg.getDraft({ pid: "P1001" })`);
        const draftB = await ctx.win.webContents.executeJavaScript(`window.lg.getDraft({ pid: "P1002" })`);
        const ipcOk =
          draftA.code === "DRAFT_A_MARKER" &&
          draftA.lang === "C++17" &&
          draftA.o2 === true &&
          draftB.code === "" &&
          draftB.lang === "C++17"; // 无草稿的题只继承语言偏好
        console.log(
          "SMOKE_DRAFT_IPC " +
            JSON.stringify({
              a: { code: draftA.code, lang: draftA.lang, o2: draftA.o2 },
              bEmpty: draftB.code === "",
              bLang: draftB.lang,
              ok: ipcOk,
            })
        );
        if (!ipcOk) console.log("SMOKE_FAIL 草稿 IPC 隔离失败");

        // UI 级：P1001 的 IDE 里输入 → 切到 P1002 → 编辑器必须是默认模板
        ctx.views.openProblem("P1001");
        await wait(1500);
        ctx.views.setIde(true);
        await wait(500);
        await ctx.win.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector("#ide-pane .ide-code");
          const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          set.call(ta, "UI_DRAFT_A_MARKER");
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          return "typed";
        })()`);
        await wait(1300); // 防抖 800ms + 落盘
        // 矩阵里 IDE 探针可能先打开过本题，编辑器内存里仍是默认语言；
        // 这里显式设一次偏好，验证「切题继承全局语言」而不是依赖前序状态。
        await ctx.win.webContents.executeJavaScript(`(() => {
          const langSel = document.querySelector("#ide-pane .ide-lang");
          langSel.value = "C++17";
          langSel.dispatchEvent(new Event("change", { bubbles: true }));
          return langSel.value;
        })()`);
        await wait(1200);
        ctx.views.openProblem("P1002");
        await wait(1500);
        ctx.views.setIde(true);
        await wait(900);
        const draftUi = await ctx.win.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector("#ide-pane .ide-code");
          const langSel = document.querySelector("#ide-pane .ide-lang");
          return {
            leaked: ta.value.indexOf("DRAFT_A_MARKER") !== -1,
            isDefault: ta.value.indexOf("int a, b;") !== -1,
            lang: langSel ? langSel.value : "",
          };
        })()`);
        console.log("SMOKE_DRAFT_UI " + JSON.stringify(draftUi));
        const draftUiOk = !draftUi.leaked && draftUi.isDefault && draftUi.lang === "C++17";
        if (!draftUiOk) console.log("SMOKE_FAIL 切题后编辑器没有换成本题草稿/默认模板，或没继承语言偏好");
        ctx.views.setIde(false);
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_TOAST === "1") {
        // R58 回归：页面视图盖住外壳时，toast 必须同步画在页面顶层
        ctx.views.openProblem("P1001");
        await wait(1500);
        const toastPageKind = ctx.views.currentInfo().kind;
        // 页面刚装载完的 ~2s 内，隐藏窗口对 webContents.send 的投递可能被丢弃
        //（ctx.toast 直发稳定丢失、同 wc 稍后直发必达——已实测二分定位）。
        // 探针按真实路径重试一次，验证的是「管道通」，不是极限时序。
        const toastRead = async () => {
          try {
            return await ctx.views.currentWebContents().executeJavaScript(`(() => {
              const host = document.getElementById("lg-page-toast");
              return host ? { text: (host.innerText || "").slice(0, 60), visible: getComputedStyle(host).opacity === "1" } : null;
            })()`);
          } catch {
            return null;
          }
        };
        ctx.toast("提交", "已提交 P1001，评测完成后会通知你。");
        let pageToast = null;
        for (let i = 0; i < 3 && !pageToast; i++) {
          await wait(400);
          pageToast = await toastRead();
        }
        if (!pageToast) {
          ctx.toast("提交", "已提交 P1001，评测完成后会通知你。");
          for (let i = 0; i < 3 && !pageToast; i++) {
            await wait(400);
            pageToast = await toastRead();
          }
        }
        const shellToast = await ctx.win.webContents.executeJavaScript(`!!document.querySelector("#toasts .toast")`);
        const toastOk = !!shellToast && !!pageToast && pageToast.visible === true && /提交/.test(pageToast.text || "");
        console.log("SMOKE_TOAST " + JSON.stringify({ pageKind: toastPageKind, shellToast, pageToast, ok: toastOk }));
        if (!toastOk) console.log("SMOKE_FAIL 页面在场时 toast 不可见");
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_KEYS === "1") {
        // R60 回归：Ctrl+W 关页面回来源列表、Alt+← 后退——用真实合成键盘事件
        //（键发给当前页面视图的 webContents）。强制离线让页面落 lgoff:// 单条历史，
        // 保证 Alt+← 走 returnLib 分支（联网时页面自身的 SPA 跳转会先吃掉一次后退）。
        if (ctx.luogu.onlineTimer) {
          clearInterval(ctx.luogu.onlineTimer);
          ctx.luogu.onlineTimer = null;
        }
        ctx.luogu.setOnline(false);
        ctx.views.showLibrary("problems");
        await wait(400);
        ctx.views.openProblem("P1001");
        await wait(900);
        let pageWc = ctx.views.currentWebContents();
        if (pageWc) pageWc.sendInputEvent({ type: "keyDown", keyCode: "w", modifiers: ["control"] });
        await wait(700);
        const afterClose = ctx.views.currentInfo();
        ctx.views.openProblem("P1001");
        await wait(900);
        pageWc = ctx.views.currentWebContents();
        if (pageWc) pageWc.sendInputEvent({ type: "keyDown", keyCode: "Left", modifiers: ["alt"] });
        await wait(700);
        const afterBack = ctx.views.currentInfo();
        const keysOk =
          afterClose.kind === "library" &&
          afterClose.library === "problems" &&
          afterBack.kind === "library" &&
          afterBack.library === "problems";
        console.log(
          "SMOKE_KEYS " + JSON.stringify({ afterClose: afterClose.kind, afterBack: afterBack.kind, ok: keysOk })
        );
        if (!keysOk) console.log("SMOKE_FAIL 键盘关闭/后退没有生效");
        ctx.luogu.online = true; // 恢复在线标志（不触发 refresh/flushQueue 副作用）
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_PALETTE === "1") {
        // R61 回归：命令面板含题目直达、已打开页面切换、恢复关闭页面三项
        ctx.views.openProblem("P1001");
        await wait(600);
        const palPid = await ctx.win.webContents.executeJavaScript(`window.lg.palette("P1001")`);
        const palAll = await ctx.win.webContents.executeJavaScript(`window.lg.palette("")`);
        const hasPid = palPid.length && palPid[0].type === "problem" && palPid[0].pid === "P1001";
        const hasReopen = palAll.some((item) => item.id === "reopen");
        const hasPage = palAll.some((item) => item.type === "page" && /P1001/.test(item.key || ""));
        console.log("SMOKE_PALETTE " + JSON.stringify({ hasPid, hasReopen, hasPage, count: palAll.length }));
        if (!hasPid || !hasReopen || !hasPage) console.log("SMOKE_FAIL 命令面板缺项");
        ctx.views.showHome();
        await wait(300);
      }

      if (process.env.LG_SMOKE_AUDIT === "1") {
        await runAudit(ctx, outDir, wait);
      }
      if (process.env.LG_SMOKE_SKIN_AUDIT === "1") {
        await runSkinAudit(ctx, outDir, wait);
      }

      ctx.openSettings();
      await wait(1400);
      if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
        ctx.settingsWin.setOpacity(0);
        await shot("settings", ctx.settingsWin);
        if (process.env.LG_SMOKE_DEBUG === "1") {
          const dbg = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
            const box = document.getElementById("wallpaper");
            const layers = box ? [...box.querySelectorAll(".wall-layer")] : [];
            return {
              hasBox: !!box,
              layers: layers.length,
              opacity: layers.map((l) => getComputedStyle(l).opacity),
              bg: layers.map((l) => getComputedStyle(l).backgroundImage.slice(0, 100)),
              htmlBg: getComputedStyle(document.documentElement).backgroundColor,
              bodyBg: getComputedStyle(document.body).backgroundColor,
              appBg: getComputedStyle(document.getElementById("app")).backgroundColor,
              paneBg: getComputedStyle(document.querySelector(".set-pane")).backgroundColor,
              rect: box ? JSON.stringify(box.getBoundingClientRect()) : ""
            };
          })()`);
          console.log("SMOKE_SETTINGS " + JSON.stringify(dbg));
        }
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="wallpaper"]').click()`
        );
        await wait(900);
        const wallShown = await ctx.settingsWin.webContents.executeJavaScript(
          `!document.querySelector('[data-panel="wallpaper"]').hidden`
        );
        console.log("SMOKE_SETTINGS_SECTION " + wallShown);
        await shot("settings-wallpaper", ctx.settingsWin);
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="rail"]').click()`
        );
        await wait(400);
        await shot("settings-rail", ctx.settingsWin);

        if (process.env.LG_SMOKE_VISUAL === "1") {
          for (const sec of ["general", "notify", "account", "about"]) {
            await ctx.settingsWin.webContents.executeJavaScript(
              `document.querySelector('.snav[data-sec="${sec}"]').click()`
            );
            await wait(350);
            await shot("settings-" + sec, ctx.settingsWin);
          }
          const settingsMetrics = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
            const q = (s) => document.querySelector(s);
            const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
            const css = (s) => { const e = q(s); return e ? getComputedStyle(e) : null; };
            return {
              nav: rect(".set-nav"),
              paneMax: css(".set-pane section[data-panel]") ? css(".set-pane section[data-panel]").maxWidth : "",
              groupRadius: css(".settings-group") ? css(".settings-group").borderRadius : "",
              rowH: rect(".setting-row"),
              rangeAppearance: css("#mat") ? css("#mat").appearance : "",
              rangeHeight: rect("#mat"),
              navCurrent: q(".snav[aria-current='page']") ? q(".snav[aria-current='page']").textContent.trim() : ""
            };
          })()`);
          console.log("SMOKE_SETTINGS_METRICS " + JSON.stringify(settingsMetrics));
        }

        if (process.env.LG_SMOKE_RAIL === "1") {
          const before = ctx.cfg.get().rail.order.slice();
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelectorAll('#rail-list .rail-mini')[1] && document.querySelectorAll('#rail-list .rail-mini')[1].click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelector('#rail-list .rail-eye') && document.querySelector('#rail-list .rail-eye').click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `(() => { const f = document.getElementById('rail-add'); document.getElementById('rail-add-label').value = 'GitHub'; document.getElementById('rail-add-url').value = 'https://github.com'; f.requestSubmit(); })()`
          );
          await wait(450);
          const railState = ctx.cfg.get().rail;
          const railDom = await ctx.win.webContents.executeJavaScript(
            `[...document.querySelectorAll('#rail-top .rail-btn')].map((b) => ({ id: b.dataset.id, title: b.title }))`
          );
          console.log("SMOKE_RAIL " + JSON.stringify({ before, order: railState.order, hidden: railState.hidden, custom: railState.custom, dom: railDom }));
          await shot("settings-rail-after", ctx.settingsWin);
          ctx.cfg.resetRail();
          ctx.broadcastState();
        }
      }
    } catch (err) {
      console.error("SMOKE_FAIL " + (err && err.stack ? err.stack : err.message));
    }
    app.quitting = true;
    app.quit();
  };

  if (ctx.win.webContents.isLoading()) ctx.win.webContents.once("did-finish-load", capture);
  else capture();
}

async function loadAndWait(ctx, url, title) {
  // 每页独立 entry:复用同一 entry 跨页导航时,旧文档上的样式状态会污染度量
  ctx.views.openDetail(url, title, "audit:" + title);
  const wc = ctx.views.currentWebContents();
  if (!wc) return null;
  for (let i = 0; i < 80; i++) {
    if (!wc.isLoading()) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 900));
  return wc;
}

async function runAudit(ctx, outDir, wait) {
  const only = String(process.env.LG_AUDIT_ONLY || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pages = [
    ["problem", "https://www.luogu.com.cn/problem/P1001"],
    ["article", "https://www.luogu.com.cn/article"],
    ["discuss", "https://www.luogu.com.cn/discuss"],
    ["training", "https://www.luogu.com.cn/training/100"],
    ["user", "https://www.luogu.com.cn/user/1"],
    ["login", "https://www.luogu.com.cn/auth/login"],
  ].filter(([name]) => !only.length || only.includes(name));
  const report = {};
  for (const [name, url] of pages) {
    const wc = await loadAndWait(ctx, url, name);
    if (!wc) continue;
    try {
      const data = await wc.executeJavaScript(`(() => {
        const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
        const parse = (c) => {
          const s = String(c || "").trim();
          let m = s.match(/^#([0-9a-f]{6})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
          }
          m = s.match(/^#([0-9a-f]{3})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
          }
          m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
          m = s.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
          return null;
        };
        const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        const pathOf = (el) => {
          const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
          return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
        };
        const themeBg = parse(getComputedStyle(document.documentElement).getPropertyValue("--lg-bg").trim()) || { r: 27, g: 28, b: 32, a: 1 };
        const effectiveBg = (el) => {
          let node = el;
          while (node) {
            const bg = parse(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0.5) return bg;
            node = node.parentElement;
          }
          return themeBg;
        };
        const contrast = (a, b) => {
          const L = (c) => {
            const f = (v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
          };
          const l1 = L(a);
          const l2 = L(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const light = new Map();
        const darkText = new Map();
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.height < 8) continue;
          if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          const bg = parse(cs.backgroundColor);
          if (isDark && bg && bg.a > 0.5 && lum(bg) > 0.55) {
            const key = pathOf(el);
            const item = light.get(key);
            const area = Math.round(r.width * r.height);
            if (!item || item.area < area) light.set(key, {
              path: key,
              bg: cs.backgroundColor,
              color: cs.color,
              area,
              chain: [el.parentElement, el.parentElement && el.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
              html: el.outerHTML.slice(0, 220),
              text: (el.textContent || "").trim().slice(0, 40)
            });
          }
          const text = (el.textContent || "").trim();
          if (text && el.childElementCount === 0) {
            const fg = parse(cs.color);
            if (fg && fg.a > 0.5) {
              const ratio = contrast(fg, effectiveBg(el));
              if (ratio < 3.0) {
                const key = pathOf(el);
                darkText.set(key, {
                  path: key,
                  color: cs.color,
                  fontSize: cs.fontSize,
                  ratio: Math.round(ratio * 100) / 100,
                  chain: [el.parentElement, el.parentElement && el.parentElement.parentElement, el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
                  html: el.outerHTML.slice(0, 220),
                  text: text.slice(0, 40)
                });
              }
            }
          }
        }
        const vars = {};
        const cs = getComputedStyle(document.documentElement);
        for (const name of ["--theme-body-back","--theme-body-color","--theme-body-image","--theme-card-background","--theme-navi-back","--theme-dropdown","--theme-tooltip"]) {
          vars[name] = cs.getPropertyValue(name).trim().slice(0, 80);
        }
        return {
          isDark,
          passkeyGuard: window.__lgPasskeyGuard === true,
          light: [...light.values()].sort((a, b) => b.area - a.area).slice(0, 35),
          darkText: [...darkText.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 30),
          vars
        };
      })()`);
      report[name] = data;
      if (name === "login" || name === "user" || name === "article") {
        try {
          const image = await wc.capturePage(undefined, { stayHidden: true });
          fs.writeFileSync(path.join(outDir, `audit-${name}.png`), image.toPNG());
          console.log("SMOKE_SHOT audit-" + name);
        } catch {
          /* ignore */
        }
      }
      console.log("AUDIT_" + name.toUpperCase() + " light=" + data.light.length + " darkText=" + data.darkText.length + " passkey=" + data.passkeyGuard);
      console.log("AUDIT_LIGHT_" + name.toUpperCase() + " " + JSON.stringify(data.light.slice(0, 6)));
      if (data.darkText.length) console.log("AUDIT_DARKTEXT_" + name.toUpperCase() + " " + JSON.stringify(data.darkText.slice(0, 8)));
    } catch (err) {
      console.log("AUDIT_FAIL_" + name + " " + err.message);
    }
    await wait(300);
  }
  fs.writeFileSync(path.join(outDir, "audit-dark.json"), JSON.stringify(report, null, 2));
  console.log("SMOKE_AUDIT " + path.join(outDir, "audit-dark.json"));
}

/* 隐藏窗口里的页面视图截图：capturePage 在从未 show 过的窗口上可能拿不到合成层
   （Windows 上偶发，与 GPU/DWM 状态有关），重试三次后用 CDP 强制出一帧兜底。 */
async function captureWC(wc, wait) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const image = await wc.capturePage(undefined, { stayHidden: true });
      if (image && !image.isEmpty()) return image;
    } catch {
      /* 空/失败继续重试，最后走 CDP 兜底 */
    }
    await wait(600);
    if (wc.isDestroyed()) return null;
  }
  try {
    const dbg = wc.debugger;
    if (!dbg.isAttached()) dbg.attach();
    const res = await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    dbg.detach();
    return require("electron").nativeImage.createFromBuffer(Buffer.from(res.data, "base64"));
  } catch (err) {
    console.log("SMOKE_CAPTURE_CDP_FAIL " + err.message);
    return null;
  }
}

/* 皮肤几何审计：真实页面上找“深底深字 / 横向溢出 / 容器空白”，并逐页截图。
   只读 DOM，不发任何提交请求。 */
async function runSkinAudit(ctx, outDir, wait) {
  const only = String(process.env.LG_AUDIT_ONLY || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pages = [
    ["home", "https://www.luogu.com.cn/"],
    ["problem", "https://www.luogu.com.cn/problem/P1001"],
    ["problem-list", "https://www.luogu.com.cn/problem/list"],
    ["contest-list", "https://www.luogu.com.cn/contest/list"],
    ["solution", "https://www.luogu.com.cn/problem/solution/P1001"],
    ["article", "https://www.luogu.com.cn/article"],
    ["article-detail", "https://www.luogu.com.cn/article/q3usb3ep"],
    ["discuss", "https://www.luogu.com.cn/discuss"],
    ["discuss-detail", "https://www.luogu.com.cn/discuss"], // 从列表页动态取帖 ID
    ["training", "https://www.luogu.com.cn/training/100"],
    ["user", "https://www.luogu.com.cn/user/1"],
    ["record-list", "https://www.luogu.com.cn/record/list"],
    ["record-detail", "https://www.luogu.com.cn/record/list"], // 从列表页动态取 rid(游客不可见则跳过)
    ["contest-detail", "https://www.luogu.com.cn/contest/list"], // 从列表页动态取赛 ID
    ["search", "https://www.luogu.com.cn/search?q=%E5%9B%BE%E8%AE%BA"],
    ["notification", "https://www.luogu.com.cn/user/notification"],
    ["user-setting", "https://www.luogu.com.cn/settings"],
    ["error-404", "https://www.luogu.com.cn/problem/P99999"],
  ].filter(([name]) => !only.length || only.includes(name));
  const report = {};
  for (const [name, url] of pages) {
    let wc = await loadAndWait(ctx, url, name);
    if (!wc) continue;
    const finalUrl = String(await wc.executeJavaScript("location.href").catch(() => ""));
    if (/\/auth\/login/.test(finalUrl)) {
      // 游客不可见的页面(消息/设置/记录列表)标记后跳过,亮暗样式规则无从谈起
      report[name] = { url, finalUrl, authGated: true };
      console.log("SMOKE_SKIN_AUDIT_" + name.toUpperCase() + " " + JSON.stringify({ authGated: true, finalUrl }));
      continue;
    }
    if (["discuss-detail", "contest-detail", "record-detail"].includes(name)) {
      const href = await wc.executeJavaScript(`(() => {
        const pat = ${JSON.stringify(
          name === "discuss-detail" ? "^\\/discuss\\/\\d+" : name === "contest-detail" ? "^\\/contest\\/\\d+" : "^\\/record\\/\\d+"
        )};
        const re = new RegExp(pat);
        const a = [...document.querySelectorAll('a[href]')].map((x) => x.getAttribute("href"));
        const hit = a.find((h) => re.test(h));
        return hit ? new URL(hit, location.origin).href : "";
      })()`);
      if (!href) {
        report[name] = { url, finalUrl, skipped: "no-detail-link" };
        console.log("SMOKE_SKIN_AUDIT_" + name.toUpperCase() + " " + JSON.stringify({ skipped: "no-detail-link" }));
        continue;
      }
      wc = await loadAndWait(ctx, href, name);
      if (!wc) continue;
    }
    // 皮肤静态 CSS/变量表都是 dom-ready 时异步 insertCSS 的;重页水合时变量表
    // 可能落得比度量晚,保险起见等 --lg-text 真正可解析,最多 3 秒。
    for (let i = 0; i < 20; i++) {
      const ready = await wc.executeJavaScript(
        `getComputedStyle(document.documentElement).getPropertyValue("--lg-text").trim() !== ""`
      ).catch(() => false);
      if (ready) break;
      await wait(150);
    }
    // 皮肤给链接/按钮加了 120ms 过渡:元素在水合中从官方色过渡到主题色,
    // 度量会读到中间值。审计页冻结所有过渡/动画,保证量到的是终态。
    try {
      await wc.insertCSS("*, *::before, *::after { transition: none !important; animation: none !important; }");
    } catch {
      /* 度量页而已 */
    }
    try {
      const data = await wc.executeJavaScript(`(() => {
        const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
        const parse = (c) => {
          const s = String(c || "").trim();
          let m = s.match(/^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
          m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
          return null;
        };
        const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        const pathOf = (el) => {
          const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
          return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
        };
        const dark = [];
        const dim = [];
        const over = [];
        const light = [];
        const vw = window.innerWidth;
        const relLum = (c) => {
          const f = (v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const contrast = (a, b) => {
          const l1 = relLum(a);
          const l2 = relLum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        for (const el of document.querySelectorAll("#app *")) {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.height < 8) continue;
          if (r.bottom <= 0 || r.top >= document.documentElement.scrollHeight) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          if (r.right > vw + 1 && !el.closest(".am-slider")) {
            over.push({
              path: pathOf(el),
              x: Math.round(r.x),
              right: Math.round(r.right),
              w: Math.round(r.width),
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
              parent: el.parentElement ? pathOf(el.parentElement) : "",
            });
          }
          const bgc = parse(cs.backgroundColor);
          if (
            isDark &&
            bgc &&
            bgc.a > 0.5 &&
            lum(bgc) > 0.55 &&
            r.width * r.height > 2000 &&
            !el.closest(".difficulty, .luogu-username")
          ) {
            light.push({
              path: pathOf(el),
              bg: cs.backgroundColor,
              color: cs.color,
              area: Math.round(r.width * r.height),
              text: (el.innerText || "").trim().slice(0, 30),
              chain: (() => {
                const out = [];
                let n = el;
                for (let i = 0; i < 5 && n; i++) { out.push(pathOf(n)); n = n.parentElement; }
                return out.join(" < ");
              })(),
              style: (el.getAttribute("style") || "").slice(0, 120),
              html: el.outerHTML.slice(0, 180),
            });
          }
          const direct = [...el.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join("")
            .trim();
          if (direct.length < 3 || direct.length > 90) continue;
          const fg = parse(cs.color);
          if (!fg || fg.a <= 0.5) continue;
          // 只审计深色主题：祖先实际底色是深色时，深色/灰暗文字都难读
          let node = el;
          let bg = null;
          let hasImage = false;
          while (node) {
            const ncs = getComputedStyle(node);
            if (!hasImage && ncs.backgroundImage && ncs.backgroundImage !== "none") hasImage = true;
            const c = parse(ncs.backgroundColor);
            if (c && c.a > 0.5) { bg = c; break; }
            node = node.parentElement;
          }
          if (hasImage) continue; // 装饰图/渐变上的文字无法用纯色对比度判定
          if (el.closest(".difficulty, .luogu-username, .tags")) continue; // 站点品牌色徽标/标签
          if (isDark && bg && lum(bg) > 0.35) continue;
          const chainOf = (n) => {
            const out = [];
            let cur = n;
            for (let i = 0; i < 4 && cur; i++) { out.push(pathOf(cur)); cur = cur.parentElement; }
            return out.join(" < ");
          };
          if (isDark && lum(fg) <= 0.45) {
            dark.push({
              path: pathOf(el),
              color: cs.color,
              text: direct.slice(0, 40),
              w: Math.round(r.width),
              h: Math.round(r.height),
              chain: chainOf(el),
              html: el.outerHTML.slice(0, 160),
            });
          } else {
            const ratio = bg ? contrast(fg, bg) : 0;
            if (ratio >= 0.1 && ratio < 2.6) {
              dim.push({
                path: pathOf(el),
                color: cs.color,
                text: direct.slice(0, 40),
                ratio: Math.round(ratio * 100) / 100,
                w: Math.round(r.width),
                h: Math.round(r.height),
                chain: chainOf(el),
                html: el.outerHTML.slice(0, 160),
              });
            }
          }
        }
        const main = document.querySelector("#app > .main-container");
        const bigText = [];
        const controls = [];
        for (const el of document.querySelectorAll(
          "#app a.l-button, #app button.l-button, #app .l-button, #app a[class*='l-button'], #app button[class*='l-button']"
        )) {
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          let tr = null;
          try {
            const range = document.createRange();
            range.selectNodeContents(el);
            tr = range.getBoundingClientRect();
          } catch {
            tr = null;
          }
          if (!tr || !tr.width) continue;
          controls.push({
            path: pathOf(el),
            text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 24),
            w: Math.round(r.width),
            h: Math.round(r.height),
            dx: Math.round(tr.left + tr.width / 2 - (r.left + r.width / 2)),
            dy: Math.round(tr.top + tr.height / 2 - (r.top + r.height / 2)),
            clipped: el.scrollWidth > el.clientWidth + 1,
            display: cs.display,
            align: cs.alignItems,
            justify: cs.justifyContent,
          });
        }
        for (const el of document.querySelectorAll("#app *")) {
          const direct = [...el.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join("")
            .trim();
          if (direct.length < 8 || direct.length > 90) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 10 || r.top < 0 || r.top > 700) continue;
          const cs = getComputedStyle(el);
          if (parseFloat(cs.fontSize) < 15) continue;
          bigText.push({
            path: pathOf(el),
            text: direct.slice(0, 30),
            color: cs.color,
            fill: cs.webkitTextFillColor,
            size: cs.fontSize,
            y: Math.round(r.top),
            opacity: cs.opacity,
            bgImage: cs.backgroundImage.slice(0, 120),
            bgClip: cs.webkitBackgroundClip || cs.backgroundClip,
            blend: cs.mixBlendMode,
            filter: cs.filter,
            chain: (() => {
              const out = [];
              let n = el;
              for (let i = 0; i < 4 && n; i++) { out.push(pathOf(n)); n = n.parentElement; }
              return out.join(" < ");
            })(),
          });
        }
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        // 0.7.2 同层透出：承载面孤岛（卡片/chips/输入/分页）透明度必须同层
        const tierAlphas = [];
        for (const el of document.querySelectorAll(
          '#app .l-card, #app .lfe-card, #app .card, #app .lg-article, #app .filter-section .text, #app .tag-select-area .toggle-tag, #app .combo-wrapper .text, #app .filter .tag-button, #app input:not([type="checkbox"]):not([type="radio"]), #app textarea, #app .pagination > *, #app .page-bar button, #app .bottom-wrap.float'
        )) {
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 8) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const c = parse(cs.backgroundColor);
          if (!c) continue;
          tierAlphas.push({ path: pathOf(el), a: c.a });
        }
        const tierMax = tierAlphas.reduce((m, t) => Math.max(m, t.a), 0);
        const tierMin = tierAlphas.length ? tierAlphas.reduce((m, t) => Math.min(m, t.a), 1) : 0;
        const firstLink = document.querySelector("#app a");
        return {
          url: location.href,
          isDark,
          probe: {
            link: firstLink ? getComputedStyle(firstLink).color : "",
            varText: getComputedStyle(document.documentElement).getPropertyValue("--lg-text").trim(),
          },
          vw,
          scrollW: document.documentElement.scrollWidth,
          main: rect(main),
          mainStyle: main ? { pad: getComputedStyle(main).padding, margin: getComputedStyle(main).margin } : null,
          darkCount: dark.length,
          dark: dark.slice(0, 24),
          dimCount: dim.length,
          dim: dim.sort((a, b) => a.ratio - b.ratio).slice(0, 20),
          overCount: over.length,
          over: over.sort((a, b) => b.right - a.right).slice(0, 8),
          lightCount: light.length,
          light: light.sort((a, b) => b.area - a.area).slice(0, 10),
          bigText: bigText.slice(0, 10),
          headers: [...document.querySelectorAll('#app [class*="user-header"], #app [class*="banner"]')].slice(0, 10).map((el) => {
            const cs = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            return {
              path: pathOf(el),
              bg: cs.backgroundColor,
              image: cs.backgroundImage.slice(0, 140),
              y: Math.round(b.y),
              h: Math.round(b.height),
            };
          }),
          controlCount: controls.length,
          controls: controls
            .sort((a, b) => Math.abs(b.dy) + Math.abs(b.dx) - (Math.abs(a.dy) + Math.abs(a.dx)))
            .slice(0, 12),
          tiers: {
            count: tierAlphas.length,
            min: Math.round(tierMin * 100) / 100,
            max: Math.round(tierMax * 100) / 100,
            spread: Math.round((tierMax - tierMin) * 100) / 100,
          },
        };
      })()`);
      report[name] = data;
      if (process.env.LG_SURVEY_DUMP === "1") {
        const dump = await wc.executeJavaScript(`(() => {
          const out = { ths: [], fixed: [], headers: [], mode: document.documentElement.dataset.lgMode || "", linkColor: (() => { const a = document.querySelector('#app a'); return a ? getComputedStyle(a).color : ''; })(), varText: getComputedStyle(document.documentElement).getPropertyValue('--lg-text').trim() };
          const cls = (el) => String(el.className || "").slice(0, 60);
          for (const th of document.querySelectorAll("#app th")) {
            const c = getComputedStyle(th);
            out.ths.push({ cls: cls(th), bg: c.backgroundColor, color: c.color, text: th.textContent.trim().slice(0, 16) });
          }
          for (const el of document.querySelectorAll("body *")) {
            const c = getComputedStyle(el);
            if (c.position !== "fixed" || c.display === "none") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) continue;
            out.fixed.push({
              cls: cls(el),
              id: el.id,
              bg: c.backgroundColor,
              image: c.backgroundImage.slice(0, 60),
              rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
              html: el.outerHTML.slice(0, 140),
            });
          }
          for (const el of document.querySelectorAll('#app [class*="header"], #app [class*="topbar"], #app [class*="top-bar"]')) {
            const c = getComputedStyle(el);
            if (c.display === "none") continue;
            out.headers.push({ cls: cls(el), bg: c.backgroundColor, html: el.outerHTML.slice(0, 140) });
          }
          ["headers", "fixed", "ths"].forEach((k) => { out[k] = out[k].slice(0, 12); });
          return out;
        })()`);
        console.log("SMOKE_SURVEY_" + name.toUpperCase() + " " + JSON.stringify(dump));
      }
      const image = await captureWC(wc, wait);
      if (image) {
        fs.writeFileSync(path.join(outDir, `skin-${name}.png`), image.toPNG());
        console.log("SMOKE_SHOT skin-" + name);
      }
      console.log(
        "SMOKE_SKIN_AUDIT_" +
          name.toUpperCase() +
          " " +
          JSON.stringify({
            isDark: data.isDark,
            vw: data.vw,
            scrollW: data.scrollW,
            main: data.main,
            darkCount: data.darkCount,
            dimCount: data.dimCount,
            overCount: data.overCount,
            lightCount: data.lightCount,
            dark: data.dark.slice(0, 5),
            dim: data.dim.slice(0, 6),
            over: data.over.slice(0, 4),
            light: data.light.slice(0, 4),
            controlCount: data.controlCount,
            controls: data.controls.slice(0, 4),
            tiers: data.tiers,
          })
      );
    } catch (err) {
      console.log("SMOKE_SKIN_AUDIT_FAIL_" + name + " " + err.message);
    }
    await wait(400);
  }
  fs.writeFileSync(path.join(outDir, "skin-audit.json"), JSON.stringify(report, null, 2));
  console.log("SMOKE_SKIN_AUDIT " + path.join(outDir, "skin-audit.json"));
}

/* 演示数据：只给截图用，不代表真实账号。 */
function seedDemo(ctx) {
  const now = new Date();
  const heat = [];
  for (let i = 139; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const v = (i * 7 + Math.floor(i / 9) * 3) % 11;
    heat.push({ date: key, count: v < 3 ? 0 : (v % 5) + 1 });
  }
  ctx.luogu.user = { loggedIn: true, uid: 1, name: "示例用户", avatar: "" };
  ctx.luogu.home = {
    quote: "把每一道题，都当成一次新的开始。",
    heat,
    contest: {
      id: 1,
      name: "CSP-S 模拟赛 #12",
      start: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 36000,
      end: Date.now() + 5 * 3600 * 1000,
      live: false,
    },
    contests: [
      { id: 1, name: "CSP-S 模拟赛 #12", start: Date.now() + 2 * 3600 * 1000, end: Date.now() + 5 * 3600 * 1000, live: false },
      { id: 2, name: "洛谷 11 月月赛 I", start: Date.now() + 26 * 3600 * 1000, end: Date.now() + 29 * 3600 * 1000, live: false },
    ],
    official: {
      ok: true,
      countdowns: [
        { name: "CSP-J/S 2026 第二轮", days: 3 },
        { name: "NOIP 2026", days: 27 },
      ],
      welcome: "示例用户",
      fortune: "宜刷题，忌摆烂。",
    },
    recent: [
      { pid: "P1001", title: "A+B Problem", status: 12, statusText: "AC", score: 100, time: Date.now() - 2 * 60 * 1000 },
      { pid: "P1048", title: "采药", status: 6, statusText: "WA", score: 0, time: Date.now() - 60 * 60 * 1000 },
      { pid: "P1216", title: "数字三角形", status: 12, statusText: "AC", score: 100, time: Date.now() - 26 * 3600 * 1000 },
      { pid: "P1002", title: "过河卒", status: 5, statusText: "TLE", score: 60, time: Date.now() - 30 * 3600 * 1000 },
    ],
    punched: true,
    streak: 7,
    updatedAt: Date.now(),
    error: "",
  };
}

module.exports = { runSmoke, seedDemo };
