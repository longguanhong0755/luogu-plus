#!/usr/bin/env node
/* ============================================================
   Luogu++ — 静默失败扫描
   用法: node scripts/lint-silent-catch.cjs
   退出码 0 = clean，1 = 有需要留意的空 catch

   为什么查这个：空 catch（catch (e) {}）是"静默失败"的温床——出错时
   什么都不发生，用户看到的是"功能没反应"，维护者看到的是"没报错"。
   本项目里 `catch (e) {}` 大量存在，很多是**故意**的（清理性代码不该因
   失败而中断），但混在里面的**真问题**只能靠人判断——所以这份扫描的价值
   不是"消灭空 catch"，而是**给出一张清单让每次 review 都过一遍**。

   分级：
     error  紧跟在"会吞掉用户可见失败"的位置（如写盘、配置保存、IPC 返回）
     note   清理性/幂等位置的空 catch（多数是合理的）
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  "main.js",
  "src/inject.js",
  "src/chrome/chrome.js",
  "src/settings/settings.js",
  "src/home/home.js",
  "src/popup/popup.js",
  "src/history/history.js",
  "src/dock/dock.js",
  "preload-chrome.js",
  "preload-config.js",
  "preload-page.js",
  "preload-popup.js",
  "preload-dock.js",
];

/* 人工豁免清单：每个空 catch 大多是有意的（清理性代码不该因失败而中断），
   但"有意的"这件事必须有人确认过——所以豁免要写清理由，这份清单本身
   就是文档。匹配用代码片段而不是行号：行号会随改动漂移。 */
const IGNORE = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/lint-silent-catch.ignore.json"), "utf8"));
  } catch (e) { return { allow: [] }; }
})();
function isAllowed(file, snippet) {
  return (IGNORE.allow || []).some(
    (a) => a.file === file && snippet.indexOf(a.match) >= 0
  );
}

const problems = [];
let totalEmpty = 0;

for (const f of TARGETS) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) continue;
    totalEmpty++;
    /* 只报**最高危的一类**："明明失败了，却仍然告诉调用方成功"。
       判据必须精确——用宽泛的关键词启发式（上下文含 write/save/return）
       会把 410 个里的 218 个都标成高危，实质等于没筛。这里的判据是：
       catch 之后 12 行内出现 return { ok: true }，而 catch 之前没有
       ok:false —— 也就是"异常被吃掉，还报成功"。 */
    const win = lines.slice(i, Math.min(lines.length, i + 12)).join("\n");
    const before = lines.slice(Math.max(0, i - 10), i).join("\n");
    const liesOk = /return\s*\{[^}]*ok\s*:\s*true/.test(win) && !/ok\s*:\s*false/.test(before);
    /* 已经有痕迹的（dbg / reportWriteFail / toast）就不算"静默"——
       出问题查得到日志或用户看得见提示，性质完全不同。 */
    const hasTrace = /(dbg\(|reportWriteFail\(|toast\()/.test(win);
    /* 豁免匹配用前后各 12 行的窗口：豁免项写的是"这一段代码的用途"，
       未必正好落在 catch 之后那几行里。 */
    if (liesOk && !hasTrace && !isAllowed(f, before + win)) {
      problems.push({
        file: f, line: i + 1, text: line.trim(),
        ctx: before.split("\n").pop().trim().slice(0, 70),
      });
    }
  }
}

console.log(`静默失败扫描：${totalEmpty} 个空 catch，其中 ${problems.length} 个在"会吞掉用户可见失败"的位置\n`);
if (problems.length) {
  for (const p of problems) {
    console.log(`  ${p.file}:${p.line}  ${p.text}`);
    console.log(`      上文: ${p.ctx}`);
  }
  console.log("\n（这些位置出错时用户看不到任何提示。逐个确认：是不是该补一句 dbg/toast？");
  console.log("  确认无害的，加进下面的白名单再跑一次。）");
  process.exit(1);
}
console.log("  没有需要留意的空 catch");
process.exit(0);
