/* 皮肤审计的页面端度量脚本（注入真实页面执行，返回 JSON 可序列化结果）。 */

function skinAuditProbeSource() {
  return `(() => {
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
              html: ${JSON.stringify(!!process.env.LG_AUDIT_OVER_DUMP)} ? el.outerHTML.slice(0, 300) : undefined,
            });
          }
          const bgc = parse(cs.backgroundColor);
          if (
            isDark &&
            bgc &&
            bgc.a > 0.5 &&
            lum(bgc) > 0.55 &&
            r.width * r.height > 2000 &&
            !el.closest(".difficulty, .difficulty-tags, [data-lgplus-difficulty], .luogu-username")
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
      })()`;
}

module.exports = { skinAuditProbeSource };
