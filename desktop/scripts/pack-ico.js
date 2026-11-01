/* 把 gen-icons.ps1 生成的官方蓝色标志 PNG 打包成多尺寸 ICO（PNG 条目，Vista+ 支持）。 */
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "src", "assets");
const sizes = [16, 20, 24, 32, 40, 48, 64, 80, 128, 256];

/* 覆盖守卫：目标产物已存在且未传 -Force 时跳过。 */
if (!process.argv.includes("-Force") && ["icon.ico", "icon.png", "tray.png"].every((f) => fs.existsSync(path.join(dir, f)))) {
  console.log("ICON-KEEP icon.ico/icon.png/tray.png exist; pass -Force to regenerate.");
  process.exit(0);
}

const entries = sizes.map((size) => {
  const file = path.join(dir, `icon-${size}.png`);
  return { size, data: fs.readFileSync(file) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(entries.length, 4);

let offset = 6 + entries.length * 16;
const directory = Buffer.alloc(entries.length * 16);
entries.forEach((entry, i) => {
  const base = i * 16;
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
  directory.writeUInt8(0, base + 2); // palette
  directory.writeUInt8(0, base + 3); // reserved
  directory.writeUInt16LE(1, base + 4); // planes
  directory.writeUInt16LE(32, base + 6); // bpp
  directory.writeUInt32LE(entry.data.length, base + 8);
  directory.writeUInt32LE(offset, base + 12);
  offset += entry.data.length;
});

const ico = Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
fs.writeFileSync(path.join(dir, "icon.ico"), ico);

// 给窗口/托盘用的单图
fs.copyFileSync(path.join(dir, "icon-256.png"), path.join(dir, "icon.png"));
fs.copyFileSync(path.join(dir, "icon-32.png"), path.join(dir, "tray.png"));

console.log(`icon.ico (${entries.length} sizes, ${ico.length} bytes)`);
console.log("icon.png / tray.png");
