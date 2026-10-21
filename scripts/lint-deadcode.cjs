#!/usr/bin/env node
/* ============================================================
   Luogu++ — 死函数扫描
   用法: node scripts/lint-deadcode.cjs
   退出码 0 = clean（只报"确定没人用"的），1 = 有死函数

   为什么单独一个脚本：文件越大，搜一个函数名越可能被噪声淹没
   （main.js 已经 13877 行）。死函数留着有两个害处：① 让人以为它还在
   工作，改了它却没效果；② 让人不敢删（"万一有人用呢"）。

   判定：顶层 function 声明 / const 箭头函数，在**去掉自己定义那一行**的
   全文里没有第二处引用 → 死函数。
   ⚠️ 必须排除"字符串里提到"的情况：探针、executeJavaScript、事件名
   都会用字符串引用函数——这类不算死。
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, p);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

const TARGETS = ["main.js", "src/inject.js", "src/chrome/chrome.js", "src/settings/settings.js", "src/home/home.js", "src/popup/popup.js", "src/history/history.js", "src/dock/dock.js"];

/* 全文（去注释）：用于"这个名字在别处出现过吗" */
const allSrc = TARGETS.map((f) => stripComments(fs.readFileSync(R(f), "utf8"))).join("\n");
/* 字符串字面量内容：出现在这里的引用不算死（探针/事件名/executeJavaScript） */
const stringLiterals = new Set();
{
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(allSrc))) {
    const t = m[2];
    if (t && t.length < 80) stringLiterals.add(t);
  }
}

const dead = [];
for (const f of TARGETS) {
  const src = stripComments(fs.readFileSync(R(f), "utf8"));
  const lines = src.split(/\r?\n/);
  /* 顶层定义：function 声明 与 const 箭头函数（行首无缩进） */
  const reFn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const reArr = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
  for (let i = 0; i < lines.length; i++) {
    const m = reFn.exec(lines[i]) || reArr.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    /* 箭头函数若是 React 风格/事件回调的容器就跳过（形如 const x = (…) => { … }） */
    if (/^const\s/.test(lines[i]) && !/=>\s*\{?\s*$/.test(lines[i])) continue;
    if (stringLiterals.has(name)) continue;      /* 字符串里出现过 → 可能被反射调用 */
    /* 统计全文里的出现次数：定义处算 1 次，还有别的吗？ */
    const re2 = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    let count = 0;
    let mm;
    const hay = allSrc;
    while ((mm = re2.exec(hay))) {
      count++;
      if (count > 2) break;
    }
    if (count <= 1) dead.push({ file: f, line: i + 1, name });
  }
}

console.log(`死函数扫描：${dead.length} 个确定无人调用的顶层函数\n`);
if (dead.length) {
  const byFile = {};
  for (const d of dead) (byFile[d.file] = byFile[d.file] || []).push(d);
  for (const [f, list] of Object.entries(byFile)) {
    console.log(`  ${f}`);
    for (const d of list) console.log(`    第 ${d.line} 行  ${d.name}()`);
    console.log("");
  }
  console.log("（这些函数被删掉不影响行为——但删之前请确认没有通过字符串/动态方式调用）");
  process.exit(1);
}
console.log("  没有发现死函数");
process.exit(0);
