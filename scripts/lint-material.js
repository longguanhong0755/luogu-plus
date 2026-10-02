#!/usr/bin/env node
/* 材质单一来源守卫 CLI：node scripts/lint-material.js [srcDir]
   退出码 0 = 通过，1 = 有违规（列出文件:行 + 原因）。 */
const path = require("path");
const { scan } = require(path.join(__dirname, "..", "src", "material-lint.js"));
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "src");
const bad = scan(dir);
if (!bad.length) {
  console.log("material-lint: clean (" + dir + ")");
  process.exit(0);
}
for (const b of bad) console.log(`${b.file}:${b.line}  ${b.why}\n    ${b.text}`);
console.log("material-lint: " + bad.length + " violation(s)");
process.exit(1);
