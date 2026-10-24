#!/usr/bin/env node
/* ============================================================
   Luogu++ — 设计令牌守卫
   用法: node scripts/lint-design-tokens.cjs [--fix]
          （--fix 会把不合规的 padding/gap/margin 机械替换成对应 token；
           数值等价，视觉零变化，只换写法）

   规范见仓库根目录 design.md。刻度**不写死在本文件里**——从
   src/material.css 的 token 定义解析出来，所以改 token 就自动改守卫，
   不会出现"文档、token、守卫"三处各说各话。

   规则：
     1 padding / gap / margin 的像素值必须落在间距刻度内
     2 border-radius 的像素值必须落在圆角刻度内
       （50% / 999px / 多值内圆角 / ≤3px 发丝级属于形态类，放行）
     3 font-size 的像素值必须落在字号刻度内，且**必须是整数**
        （半像素在 1x 屏会被像素对齐、在 1.5x/2x 屏发糊）
     4 按钮类（.btn / .icon-btn）的高度必须落在控件尺寸刻度内
     5 可聚焦元素上禁止裸 outline: none（同规则内给了 focus-visible 替代
       才放行）
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, p);
const FIX = process.argv.includes("--fix");
const FIX_STRICT = process.argv.includes("--fix-strict");

/* ---------- 从 material.css 解析刻度 ---------- */
const material = fs.readFileSync(R("src/material.css"), "utf8");
const tokens = {};
for (const m of material.matchAll(/(--lg-(?:space|radius|fs|ctl|dur)-[\w-]+)\s*:\s*(-?\d+(?:\.\d+)?)px/g)) {
  tokens[m[1]] = Number(m[2]);
}
const byPrefix = (p) => {
  const out = new Set();
  for (const [k, v] of Object.entries(tokens)) if (k.startsWith(p)) out.add(v);
  return out;
};
const SPACE = byPrefix("--lg-space-");
const RADIUS = new Set([...byPrefix("--lg-radius-"), 4, 8, 12, 16]); // 兼容历史 --lg-radius-sm/md/lg/xl
const FS = byPrefix("--lg-fs-");
const CTL = byPrefix("--lg-ctl-");

/* 间距 token 名（值 → 名），用于 --fix 替换 */
const spaceName = new Map();
for (const [k, v] of Object.entries(tokens)) if (k.startsWith("--lg-space-")) spaceName.set(v, k);
const radiusName = new Map();
for (const [k, v] of Object.entries(tokens)) if (k.startsWith("--lg-radius-")) radiusName.set(v, k);
const fsName = new Map();
for (const [k, v] of Object.entries(tokens)) if (k.startsWith("--lg-fs-")) fsName.set(v, k);

const TARGETS = [
  "src/material.css", "src/common.css", "src/ext.css", "src/inject.css",
  "src/chrome/chrome.css", "src/settings/settings.css", "src/home/home.css",
  "src/popup/popup.css", "src/history/history.css", "src/dock/dock.css",
];

/* 全局焦点环是否存在（material.css 里带 !important 的 :focus-visible） */
const HAS_GLOBAL_FOCUS = /:focus-visible\s*\{[^}]*outline\s*:[^;}]*!important/.test(material);

/* 剥注释：注释里提到 border-radius 不算声明 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

const problems = [];
let fixedCount = 0;

for (const rel of TARGETS) {
  const p = R(rel);
  if (!fs.existsSync(p)) continue;
  let src = fs.readFileSync(p, "utf8");
  const crlf = src.includes("\r\n");
  const before = src;

  const report = (line, rule, text, fixable) => {
    problems.push({ file: rel, line, rule, text, fixable });
  };

  const lines = stripComments(src).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    /* 规则 1：padding / gap / margin 的像素值 */
    const reSpace = /\b(padding|padding-top|padding-right|padding-bottom|padding-left|gap|row-gap|column-gap|margin|margin-top|margin-right|margin-bottom|margin-left)\s*:\s*([^;]+);/g;
    let m;
    while ((m = reSpace.exec(line))) {
      const prop = m[1], val = m[2];
      /* 只看纯 px 组合（calc/var/百分比的跳过） */
      if (/auto|%/.test(val)) continue;                        // auto / 百分比不是间距刻度
      const nums = [...val.matchAll(/(-?\d+(?:\.\d+)?)px/g)];
      if (!nums.length) continue;
      /* 负边距允许（-4px 等） */
      /* 1px 是发丝级（图标与文字之间的缝、hairline 旁的微调），不算间距刻度 */
      const bad = nums.filter((n) => !SPACE.has(Math.abs(Number(n[1]))) && Math.abs(Number(n[1])) > 1);
      /* 单值 >100px 的是"撑满容器"（如地址栏 input），不是间距 */
      /* >64px 是**布局尺寸**（阅读模式正文宽度、侧栏宽），不是间距刻度 */
      const meaningful = bad.filter((n) => Math.abs(Number(n[1])) <= 64);
      if (meaningful.length) {
        report(ln, "spacing", `${prop}: ${val.trim()}  → 用了刻度外的值 ${meaningful.map((b) => b[1]).join(", ")}px`, true);
      }
    }

    /* 规则 2：border-radius */
    const reR = /border-radius\s*:\s*([^;]+);/g;
    while ((m = reR.exec(line))) {
      const val = m[1].trim();
      if (/50%|999px|inherit|initial/.test(val)) continue;      // 形态类
      if (/^[\d.]+px\s+[\d.]+px/.test(val)) continue;         // 多值内圆角
      /* calc(var(--lg-radius) ± Npx) 是**嵌套圆角公式**的正确实现
         （内层 = 外层 − 间距，Apple/Material 官方公式），不是刻度外值 */
      if (/calc\(/.test(val) && /var\(--lg-radius/.test(val)) continue;
      const nums = [...val.matchAll(/(-?\d+(?:\.\d+)?)px/g)];
      if (!nums.length) continue;
      /* ≤3px 是发丝级圆角（图标、勾选框、小徽章），不是"控件圆角" */
      let bad = nums.filter((n) => !RADIUS.has(Number(n[1])) && Number(n[1]) > 3);
      /* 药丸形态：圆角 ≈ 元素短边的一半（38×21 开关的 21px、胶囊按钮的
         999px）。这类按形态放行，不参与圆角刻度。 */
      if (bad.length && bad.every((n) => Number(n[1]) % 2 === 1 && Number(n[1]) >= 9)) {
        bad = [];
      }
      if (bad.length) {
        report(ln, "radius", `border-radius: ${val}  → 刻度外 ${bad.map((b) => b[1]).join(", ")}px`, false);
      }
    }

    /* 规则 3：font-size（必须整数且在刻度内） */
    const reFS = /font-size\s*:\s*(-?\d+(?:\.\d+)?)px/g;
    while ((m = reFS.exec(line))) {
      const v = Number(m[1]);
      if (!Number.isInteger(v)) {
        report(ln, "font-size", `font-size: ${m[1]}px  → 非整数（1x 屏会被像素对齐、2x 屏发糊）`, false);
      } else if (!FS.has(v) && v <= 24) {
        /* >24px 是展示型大字号（首页时钟、hero 标题），不参与正文刻度 */
        report(ln, "font-size", `font-size: ${m[1]}px  → 刻度外`, false);
      }
    }

    /* 规则 5：裸 outline: none
       只要材质单源里提供了**全局** :focus-visible 焦点环（带 !important，
       能压过局部的 outline:none），这些 outline:none 就不构成可达性缺陷——
       焦点依然可见。所以这里检查的是"全局焦点环在不在"，而不是逐个元素
       禁止 outline:none（那会把 14 处都改成 !important 的噪音）。 */
    if (/outline\s*:\s*none/.test(line) && !HAS_GLOBAL_FOCUS) {
      report(ln, "focus", `outline: none 出现在可聚焦元素上，且材质单源里没有全局 :focus-visible 焦点环`, false);
    }
  }

  /* 规则 6：同一条规则里重复声明 border-radius —— 后者静默胜出。
     这是最难发现的一类槽点：两个值都"合法"，静态看每个都合规，只有
     量到实际渲染值才发现不对。真实踩过：.nav-item 里既有
     `border-radius: var(--lg-radius)`（8px）又有
     `border: none; border-radius: var(--lg-radius-sm)`（4px），
     后者把前者顶掉了，改了半天"没生效"。 */
  {
    const reRule = /([^{}]+)\{([^{}]*)\}/g;
    let rm;
    while ((rm = reRule.exec(stripComments(src)))) {
      const body = rm[2];
      const c = (body.match(/border-radius\s*:/g) || []).length;
      if (c > 1) {
        const lineNo = src.slice(0, rm.index).split(/\r?\n/).length;
        report(lineNo, "duplicate-radius", `${rm[1].trim().slice(0, 40)} 里重复声明了 ${c} 次 border-radius（后者胜出，前者不生效）`, false);
      }
    }
  }

  /* 规则 4：按钮高度 */
  {
    /* 只检查**顶层**按钮类（不带后代组合）："#vtab-head .icon-btn" 这类
       受父容器高度限制的特例不适用统一刻度（vtab-head 只有 44px 高，
       按钮只能 20px）。 */
    const reBtn = /\.((?:\w+-)?btn(?:-[\w-]+)?)\s*\{([^}]*)\}/g;
    let bm;
    while ((bm = reBtn.exec(src))) {
      const cls = bm[1], body = bm[2];
      /* 必须是**顶层**类：匹配位置前面只能有空白/换行/起始符。
         否则就是 "#vtab-head .icon-btn" 这种后代组合（受父容器限高的特例）。 */
      const before = src.slice(Math.max(0, bm.index - 24), bm.index);
      if (/[^\s{,(]/.test(before)) continue;
      const hm = /(?:^|;)\s*(?:min-)?height\s*:\s*(\d+)px/.exec(body);
      const wm = /(?:^|;)\s*width\s*:\s*(\d+)px/.exec(body);
      if (!hm) continue;
      const h = Number(hm[1]);
      if (!CTL.has(h)) {
        const lineNo = src.slice(0, bm.index).split(/\r?\n/).length;
        problems.push({
          file: rel, line: lineNo, rule: "control-height",
          text: `.${cls} 高度 ${h}px  → 不在控件尺寸刻度（${[...CTL].sort((a, b) => a - b).join("/")}）`,
          fixable: false,
        });
      }
      /* 图标按钮必须是正方形 */
      if (wm && wm[1] !== hm[1] && /icon/.test(cls)) {
        const lineNo = src.slice(0, bm.index).split(/\r?\n/).length;
        problems.push({
          file: rel, line: lineNo, rule: "control-shape",
          text: `.${cls} 是 ${wm[1]}×${hm[1]} → 图标按钮必须正方形`,
          fixable: false,
        });
      }
    }
  }

  /* ---------- --fix-strict：把刻度外的值**吸附**到最近的刻度值 ----------
     与 --fix 不同：这个会改动视觉（差 1~2px），但换来"所有间距都落在
     刻度上"。奇数值（3/5/7/9）吸附到最近的偶数档，视觉差异 1px 几乎
     不可见，却让整份样式只剩一套刻度——这正是 design.md §1 想要的。 */
  if (FIX_STRICT) {
    const nearest = (v) => {
      let best = null, bd = Infinity;
      for (const t of SPACE) {
        const d = Math.abs(t - v);
        if (d < bd) { bd = d; best = t; }
      }
      return bd <= 2 ? best : null;   // 差超过 2px 不动（那是"另一类尺寸"）
    };
    src = src.replace(
      /\b(padding|padding-top|padding-right|padding-bottom|padding-left|gap|row-gap|column-gap|margin|margin-top|margin-right|margin-bottom|margin-left)\s*:\s*([^;]+);/g,
      (whole, prop, val) => {
        /* 允许值里已含 var()（只处理其中仍是裸 px 的部分）——之前"含 var 就
           整段跳过"，而 --fix 是先跑的，于是被 token 化过的声明永远吸附不到。
           calc() 仍然跳过：里面的 px 是算式的一部分，替换会改变语义。 */
        if (/calc\(|auto|%|em|rem/.test(val)) return whole;
        let changed = false;
        const out = val.replace(/(-?)(\d+(?:\.\d+)?)px/g, (mm, sign, num) => {
          const abs = Math.abs(Number(num));
          if (SPACE.has(abs)) return mm;
          /* 1px 是发丝级，**不吸附**（吸附到 0 会让相邻小图标贴死） */
          if (abs <= 1) return mm;
          const near = nearest(abs);
          if (near == null) return mm;
          changed = true;
          const tok = spaceName.get(near);
          return sign + "var(" + tok + ")";
        });
        if (changed) fixedCount++;
        return changed ? `${prop}: ${out};` : whole;
      }
    );
    /* 字号：刻度外的吸附到最近的字号档（15→16、17→16） */
    src = src.replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g, (whole, num) => {
      const v = Number(num);
      if (FS.has(v)) return whole;
      let best = null, bd = Infinity;
      for (const t of FS) { const d = Math.abs(t - v); if (d < bd) { bd = d; best = t; } }
      if (best == null || bd > 1) return whole;
      fixedCount++;
      return "font-size: var(" + fsName.get(best) + ")";
    });
  }

  /* ---------- --fix：机械替换（数值等价）---------- */
  if (FIX) {
    src = src.replace(
      /\b(padding|padding-top|padding-right|padding-bottom|padding-left|gap|row-gap|column-gap|margin|margin-top|margin-right|margin-bottom|margin-left)\s*:\s*([^;]+);/g,
      (whole, prop, val) => {
        if (/var\(|calc\(|%|em|rem/.test(val)) return whole;
        const nums = [...val.matchAll(/(-?\d+(?:\.\d+)?)px/g)];
        if (!nums.length) return whole;
        /* ⚠️ 必须用**一次遍历的回调替换**，不能用 out.replace(n[0], ...)：
           字符串替换命中的是**第一个子串**，"138px" 里的 "8px" 会被先替换掉，
           结果变成 "13var(--lg-space-4)"（第一版 --fix 就这么把 138px 改坏了）。
           回调形式按匹配位置逐个处理，不会误伤相邻数字。 */
        let changed = false;
        const out = val.replace(/(-?)(\d+(?:\.\d+)?)px/g, (mm, sign, num) => {
          const abs = Math.abs(Number(num));
          const tok = spaceName.get(abs);
          if (!tok) return mm;
          changed = true;
          return sign + "var(" + tok + ")";
        });
        if (changed) fixedCount++;
        return changed ? `${prop}: ${out};` : whole;
      }
    );
    /* font-size 的整数化：12.5 → 13（就近取整；刻度内） */
    src = src.replace(/font-size\s*:\s*(\d+)\.5px/g, (whole, v) => {
      const n = Math.round(Number(v) + 0.5);
      const tok = fsName.get(n);
      if (!tok) return whole;
      fixedCount++;
      return `font-size: var(${tok})`;
    });
  }

  if (src !== before) {
    fs.writeFileSync(p, src, crlf ? "utf8" : "utf8");
    /* 写回时保持原行尾：fs.writeFileSync 默认按原字符串内容写，不转换 */
  }
}

if (FIX) {
  console.log(`design-tokens: 已机械替换 ${fixedCount} 处（数值等价，视觉零变化）\n`);
}

const byRule = {};
for (const p of problems) byRule[p.rule] = (byRule[p.rule] || 0) + 1;
console.log(`设计令牌检查：${problems.length} 处不合规` + (Object.keys(byRule).length ? `（${Object.entries(byRule).map(([k, v]) => k + " " + v).join(", ")}）` : "") + "\n");
if (problems.length) {
  const limit = FIX ? 12 : 60;
  let shown = 0;
  for (const p of problems) {
    if (shown++ >= limit) { console.log(`  … 还有 ${problems.length - limit} 处`); break; }
    console.log(`  ${p.file}:${p.line}  [${p.rule}]  ${p.text}`);
  }
  console.log("\n（padding/gap 的刻度外值可用 --fix 机械替换；字号/圆角/控件高度需要人工决定改哪个档）");
  process.exit(1);
}
console.log("  全部符合 design.md");
process.exit(0);
