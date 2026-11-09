

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

module.exports = { captchaFetchProbe };
