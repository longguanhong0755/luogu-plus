#!/usr/bin/env node
/* 材质单一来源守卫 CLI：node scripts/lint-material.js [srcDir]
   退出码 0 = 通过，1 = 有违规（列出文件:行 + 原因）。
   R41：扫描范围 = src/ 全量 + 仓库根的 main.js（内联探针样式同受约束）。
   R42：额外输出"投影配方"软约束清单（不影响退出码）——数量基线由
        --lg-v315test 钉住，只许减不许增。 */
const path = require("path");
const { scan, scanShadows, SHADOW_BASELINE } = require(path.join(__dirname, "..", "src", "material-lint.js"));
const root = path.join(__dirname, "..");
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "src");
const bad = [...scan(dir), ...scan(path.join(root, "main.js"))];
const shadows = [...scanShadows(dir), ...scanShadows(path.join(root, "main.js"))];

if (shadows.length) {
  console.log(`投影配方（软约束，基线 ${SHADOW_BASELINE} 处，只许减）：`);
  for (const s of shadows) console.log(`  ${s.file}:${s.line}  ${s.text}`);
  if (shadows.length > SHADOW_BASELINE) console.log("  ↑ 比基线多了，新写的投影请走 --lg-glass-drop");
}

if (!bad.length) {
  console.log("material-lint: clean (src + main.js)");
  process.exit(0);
}
for (const b of bad) console.log(`${b.file}:${b.line}  ${b.why}\n    ${b.text}`);
console.log("material-lint: " + bad.length + " violation(s)");
process.exit(1);
