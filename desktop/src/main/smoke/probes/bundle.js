

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

module.exports = { bundleProbe };
