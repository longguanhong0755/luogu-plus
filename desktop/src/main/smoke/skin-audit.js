/* 皮肤几何审计：真实页面上找“深底深字 / 横向溢出 / 容器空白”，并逐页截图。
   只读 DOM，不发任何提交请求。 */
const fs = require("node:fs");
const path = require("node:path");
const { loadAndWait } = require("./audit");
const { captureWC } = require("./capture");
const { skinAuditProbeSource } = require("./skin-probe");

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
    ["chat", "https://www.luogu.com.cn/chat"],
    ["practice", "https://www.luogu.com.cn/user/2/practice"],
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
      const data = await wc.executeJavaScript(skinAuditProbeSource());
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
    // over 白名单（显式入册，不静默）：user 页右栏「近期赛程」轮播为洛谷自带
    // 横向轮播（锚定 parent=div.right，防止未来其它 <a> 溢出被误豁免）；
    // 量级移入 overAllowed 计数并保留明细，溢出收敛排期 v0.8。
    const overAllowHit =
      name === "user" &&
      data.overCount > 0 &&
      (data.over || []).every((o) => o.tag === "a" && o.parent === "div.right" && /LGR-|月赛/.test(o.text || ""));
    if (overAllowHit) {
      data.overAllowed = data.overCount;
      data.overAllowedItems = data.over;
      data.overCount = 0;
      data.over = [];
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
            overAllowed: data.overAllowed || 0,
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
  // 零阈值门禁（真实判定，不再只靠人眼/源码 grep）：实测页 dark/dim/over/light
  // 任一超零即 SMOKE_FAIL（overAllowed 白名单计数不计入）。
  let auditBad = 0;
  let auditGated = 0;
  const auditChecked = [];
  for (const [name, data] of Object.entries(report)) {
    if (!data || data.authGated) {
      auditGated++;
      continue;
    }
    auditChecked.push(name);
    const bad =
      (data.darkCount || 0) > 0 ||
      (data.dimCount || 0) > 0 ||
      (data.overCount || 0) > 0 ||
      (data.lightCount || 0) > 0;
    if (bad) {
      auditBad++;
      console.log(
        "SMOKE_FAIL 皮肤审计超零 " + name + " dark=" + (data.darkCount || 0) + " dim=" + (data.dimCount || 0)
      );
    }
  }
  console.log("SMOKE_SKIN_AUDIT_GATE " + JSON.stringify({ checked: auditChecked.length, gated: auditGated, bad: auditBad }));
}

module.exports = { runSkinAudit };
