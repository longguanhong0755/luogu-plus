const fs = require("node:fs");
const path = require("node:path");
const ocr = require("../../ocr");

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

module.exports = { uiSubmitProbe };
