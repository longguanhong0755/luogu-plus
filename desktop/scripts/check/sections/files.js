/* 语法、必需文件、图标资产、package.json（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function files(ctx) {
  const { ok, fail, read, walk, ROOT, fs, path, spawnSync } = ctx;
  const { decodeRgbaPng } = require("../lib/png");
function iconAssetProblems() {
  const problems = [];
  const sizes = [16, 20, 24, 32, 40, 48, 64, 80, 128, 256];
  for (const size of sizes) {
    const rel = `src/assets/icon-${size}.png`;
    try {
      const png = decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)));
      if (png.width !== size || png.height !== size) problems.push(`${size}:尺寸`);
      let visible = 0;
      let wrongColor = 0;
      let edgeVisible = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          const a = png.pixels[i + 3];
          if (!a) continue;
          visible++;
          if (png.pixels[i] !== 91 || png.pixels[i + 1] !== 155 || png.pixels[i + 2] !== 213) wrongColor++;
          if (x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1) edgeVisible++;
        }
      }
      if (!visible) problems.push(`${size}:空白`);
      if (wrongColor) problems.push(`${size}:${wrongColor}个非官方色素`);
      if (edgeVisible) problems.push(`${size}:${edgeVisible}个触边素`);
    } catch (err) {
      problems.push(`${size}:${err.message}`);
    }
  }
  for (const copy of ["icon.png", "tray.png"]) {
    const a = fs.readFileSync(path.join(ROOT, "src/assets", copy));
    const expected = fs.readFileSync(path.join(ROOT, copy === "icon.png" ? "src/assets/icon-256.png" : "src/assets/icon-32.png"));
    if (!a.equals(expected)) problems.push(copy + ":副本不一致");
  }
  const ico = fs.readFileSync(path.join(ROOT, "src/assets/icon.ico"));
  const count = ico.readUInt16LE(4);
  const icoSizes = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    icoSizes.push(ico[base] || 256);
  }
  if (count !== sizes.length || icoSizes.join(",") !== sizes.join(",")) problems.push("ICO:" + icoSizes.join(","));
  return problems;
}

/* 1. 所有 JS 通过 node --check */
const files = walk(path.join(ROOT, "src"), []).filter((file) => file.endsWith(".js"));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail("语法 " + path.relative(ROOT, file).replace(/\\/g, "/"), result.stderr.trim());
}
ok(`${files.length} 个 JS 文件语法通过`);

/* 2. 必需文件 */
const required = [
  "src/main/index.js",
  "src/main/config.js",
  "src/main/theme.js",
  "src/main/material.js",
  "src/main/adblock.js",
  "src/main/views.js",
  "src/main/sections.js",
  "src/main/passkey-guard.js",
  "src/main/ocr.js",
  "src/main/store.js",
  "scripts/captcha-ocr.py",
  "src/main/luogu.js",
  "src/main/tray.js",
  "src/main/taskbar.js",
  "src/main/notify.js",
  "src/main/ipc.js",
  "src/main/smoke.js",
  "src/preload/shell.js",
  "src/preload/page.js",
  "src/preload/settings.js",
  "src/renderer/shell/index.html",
  "src/renderer/shell/shell.js",
  "src/renderer/shell/library.js",
  "src/renderer/shell/shell.css",
  "src/renderer/settings/index.html",
  "src/renderer/settings/settings.js",
  "src/renderer/settings/settings.css",
  "src/renderer/skin/luogu-skin.css",
  "src/assets/luogu-mark.svg",
  "src/assets/icon.ico",
  "src/assets/tray.png",
  "scripts/patch-exe.js",
  "scripts/build-icon-assets.py",
];
for (const file of required) {
  if (fs.existsSync(path.join(ROOT, file))) ok("存在 " + file);
  else fail("缺少 " + file);
}

const iconProblems = iconAssetProblems();
if (!iconProblems.length) ok("图标资产：10 尺寸透明蓝色标志，无白边/白底/触边");
else fail("图标资产契约失败", iconProblems.join("；"));

/* 3. package.json 可解析且入口存在 */
try {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.main && fs.existsSync(path.join(ROOT, pkg.main))) ok("package.json main 指向有效入口");
  else fail("package.json main 无效");
} catch (err) {
  fail("package.json 解析失败", err.message);
}
};
