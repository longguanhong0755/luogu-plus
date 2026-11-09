

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

module.exports = { interactiveProbe };
