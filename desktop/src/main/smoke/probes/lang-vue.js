

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

module.exports = { langVueProbe };
