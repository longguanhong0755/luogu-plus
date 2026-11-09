/* R96 拆分预算：单个 JS/CSS 文件不得超过 400 行，防止再长回千行大文件。
   规则见 docs/CODE-LAYOUT.md，豁免只有沙箱 preload（src/preload/page.js）。 */
const LIMIT = 400;
const EXEMPT = new Set(["src/preload/page.js"]);

module.exports = function budget(ctx) {
  const { ok, fail, walk, ROOT, fs, path } = ctx;

  const roots = [path.join(ROOT, "src"), path.join(ROOT, "scripts")];
  const files = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = walk(root, []);
    } catch {
      entries = [];
    }
    for (const full of entries) {
      if (!/\.(js|css)$/.test(full)) continue;
      files.push(full);
    }
  }

  const rel = (full) => path.relative(ROOT, full).replace(/\\/g, "/");
  const exceeded = [];
  let max = { lines: 0, file: "" };
  let counted = 0;
  for (const full of files) {
    const name = rel(full);
    if (EXEMPT.has(name)) continue;
    const text = fs.readFileSync(full, "utf8");
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    counted++;
    if (lines > max.lines) max = { lines, file: name };
    if (lines > LIMIT) exceeded.push(name + " (" + lines + " 行)");
  }

  if (!exceeded.length) {
    ok(`拆分预算：${counted} 个 JS/CSS 文件全部 ≤ ${LIMIT} 行（最大 ${max.lines} 行：${max.file}）`);
  } else {
    fail(`拆分预算超标（上限 ${LIMIT} 行）：${exceeded.join("、")}`);
  }

  for (const name of EXEMPT) {
    if (!fs.existsSync(path.join(ROOT, name))) fail("拆分预算豁免项不存在：" + name);
  }
};
