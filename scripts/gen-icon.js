/* ============================================================
   LuoguLab — 图标生成器（纯 Node，无第三方依赖）
   产出 assets/icon.ico（16/32/48/256 四档，PNG 压缩条目）
        assets/icon.png（256 预览）
   设计：墨色圆角方块 + 白色 </> 线稿（单色 / 线条风）
   ============================================================ */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
              : raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制 ---------- */
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

function lerpColor(c1, c2, t) {
  return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const SS = 3; // 3x3 超采样
  const scale = S / 256;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = shade(px, py, S, scale);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = SS * SS;
      const ia = a / n;
      const i = (y * S + x) * 4;
      if (ia > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
        buf[i + 3] = Math.round(clamp01(ia) * 255);
      }
    }
  }
  return buf;
}

function segDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

function shade(px, py, S, k) {
  const cx = S / 2, cy = S / 2;
  // 1) 墨色圆角方块
  const dTile = roundedRectSDF(px, py, cx, cy, S * 0.46, S * 0.46, S * 0.215);
  const aTile = clamp01(0.5 - dTile);
  if (aTile <= 0) return [0, 0, 0, 0];
  let col = [24, 24, 27];

  // 2) 白色 </> 线稿（胶囊笔画，圆头）
  const w = S * 0.056; // 笔画宽度
  const strokes = [
    // < ：两段折线
    [0.362 * S, 0.385 * S, 0.245 * S, 0.5 * S],
    [0.245 * S, 0.5 * S, 0.362 * S, 0.615 * S],
    // / ：斜线
    [0.578 * S, 0.638 * S, 0.455 * S, 0.362 * S],
    // > ：两段折线
    [0.638 * S, 0.385 * S, 0.755 * S, 0.5 * S],
    [0.755 * S, 0.5 * S, 0.638 * S, 0.615 * S],
  ];
  for (const [x1, y1, x2, y2] of strokes) {
    const d = segDist(px, py, x1, y1, x2, y2) - w / 2;
    const a = clamp01(0.5 - d);
    if (a > 0) col = lerpColor(col, [245, 245, 245], a);
  }
  return [col[0], col[1], col[2], aTile];
}

/* ---------- ICO 打包 ---------- */
function buildICO(sizes) {
  const pngs = sizes.map((s) => ({ s, png: encodePNG(s, s, drawIcon(s)) }));
  const count = pngs.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach(({ s, png }, i) => {
    const e = entries.subarray(i * 16, i * 16 + 16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
  });
  return Buffer.concat([dir, entries, ...pngs.map((p) => p.png)]);
}

/* ---------- main ---------- */
const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.ico"), buildICO([16, 32, 48, 256]));
fs.writeFileSync(path.join(outDir, "icon.png"), encodePNG(256, 256, drawIcon(256)));
console.log("icon.ico / icon.png written to", outDir);
