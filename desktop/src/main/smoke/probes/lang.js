

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

module.exports = { langProbe };
