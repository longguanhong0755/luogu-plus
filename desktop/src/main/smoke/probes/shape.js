

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

module.exports = { shapeProbe };
