/* ============================================================
   LuoguLab — 材质单一来源守卫（material-lint）

   规则：除了 src/material.css，任何 CSS/JS 都不许声明"面"。
   检查 src 目录下所有 css/js；命中即报错（v35test 里也会跑一遍，
   改歪立刻红）。这不是风格洁癖：历史上"外面一套、里面一套"的每一次
   复发，都是某处又手写了一份 rgba/backdrop-filter/面子配方。

   允许的例外：src/material.css（唯一材质文件）、main.js 里的探针字符串
   （探针只消费 .lg-face 类，不写配方）、本文件自身。
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

/* 命中即违规：这些只能出现在 material.css 里 */
const FORBIDDEN = [
  { re: /backdrop-filter\s*:/i, why: "面的模糊链只能在 material.css 声明" },
  { re: /-webkit-backdrop-filter\s*:/i, why: "面的模糊链只能在 material.css 声明" },
  { re: /inset\s+0\s+1px\s+0\s+var\(--/i, why: "顶部高光是材质配方的一部分" },
  { re: /linear-gradient\(\s*180deg\s*,\s*var\(--lg-glass-sheen/i, why: "sheen 配方只能在 material.css" },
  { re: /color-mix\(\s*in\s+srgb\s*,\s*var\(--lg-glass-card/i, why: "内块档配方只能在 material.css" },
  { re: /--glass-(bg|bg-2|panel|line|hi|sheen|blur|drop)\s*:/i, why: "旧外壳词汇已废弃（唯一词汇是 --lg-glass-*）" },
  { re: /--lg-glass-[a-z0-9-]+\s*:/i, why: "材质变量只能由主进程下发，CSS 不许声明" },
  { re: /--lg-alpha-(bar|card)\s*:/i, why: "已并入 faceAlpha，不许再下发" },
  { re: /--surface\s*:\s*(?!var\(--lg-glass)/i, why: "--surface 必须是指向 --lg-glass-* 的别名" },
  { re: /--hairline\s*:\s*(?!var\(--lg-glass)/i, why: "--hairline 必须是指向 --lg-glass-* 的别名" },
  { re: /--surface-2\s*:\s*(?!color-mix\(in srgb, var\(--lg-glass-soft)/i, why: "--surface-2 必须从 --lg-glass-soft 派生" },
  { re: /data-glass\s*=\s*"(liquid|flat)"\s*\]/i, why: "材质不许再按皮肤分叉（皮肤只改变量取值）" },
];
/* 免检文件：唯一材质文件；本文件（规则里写着这些模式） */
const ALLOW = new Set(["material.css", "material-lint.js"]);

function stripComments(text, isCss) {
  /* R42：注释替换成**等量换行**而不是空串。整块删掉会让后面的行号整体前移，
     报出来的 file:line 对不上真实文件（按它去改会改错行）。 */
  const keepNl = (m) => m.replace(/[^\n]/g, "");
  let s = text.replace(/\/\*[\s\S]*?\*\//g, keepNl);
  if (!isCss) s = s.replace(/^[ 	]*\/\/.*$/gm, "");
  return s;
}
/* R41：root 也可以直接是单个文件（main.js 在仓库根、不在 src/ 下，
   但它内联的探针 HTML/CSS 同样不许写配方——守卫口径收齐） */
function walk(dirOrFile, out) {
  let st = null;
  try { st = fs.statSync(dirOrFile); } catch { return out; }
  if (st.isFile()) {
    if (/\.(css|js)$/i.test(dirOrFile)) out.push(dirOrFile);
    return out;
  }
  for (const ent of fs.readdirSync(dirOrFile, { withFileTypes: true })) {
    const p = path.join(dirOrFile, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(css|js)$/i.test(ent.name)) out.push(p);
  }
  return out;
}
/* 返回 [{file, line, why, text}]；clean 为空 = 通过 */
function scan(rootDir) {
  const files = walk(rootDir, []);
  const bad = [];
  for (const f of files) {
    const base = path.basename(f);
    if (ALLOW.has(base)) continue;
    const isCss = /\.css$/i.test(f);
    const raw = fs.readFileSync(f, "utf8");
    const text = stripComments(raw, isCss);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const rule of FORBIDDEN) {
        if (rule.re.test(lines[i])) {
          bad.push({ file: path.relative(rootDir, f), line: i + 1, why: rule.why, text: lines[i].trim().slice(0, 120) });
          break;
        }
      }
    }
  }
  return bad;
}
/* ---------- 投影配方（R42）：软约束 ----------
   box-shadow 的**外投影**（裸 rgba 黑色）是"材质单源"最后一块缺口：它不受
   --lg-glass-drop 控制，用户调面不透明度/皮肤时这些浮层投影不跟着走。
   存量 6 处（material.css 的 #drag-tip + settings×3 + inject×2），先把它们
   钉成基线（v315test 断言数量），**新增一处就红**；收敛成变量要先定档位
   （会动观感），留给后续设计轮。
   注意：inset 描边 / 落点线（inset 0 0 0 1px var(--hairline)）是**形态**，
   颜色来自变量，不算配方，不在检查范围。 */
const SHADOW_HARD = /box-shadow\s*:[^;]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i;
const SHADOW_BASELINE = 6; // 2026-10-21 存量；只许减，不许增

function scanShadows(rootDir) {
  const files = walk(rootDir, []);
  const hits = [];
  for (const f of files) {
    if (!/\.(css|js)$/i.test(f)) continue;
    const raw = fs.readFileSync(f, "utf8");
    const text = stripComments(raw, /\.css$/i.test(f));
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (SHADOW_HARD.test(lines[i])) {
        hits.push({ file: path.relative(rootDir, f), line: i + 1, text: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

module.exports = { scan, FORBIDDEN, scanShadows, SHADOW_BASELINE };
