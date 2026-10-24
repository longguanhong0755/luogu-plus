/* ============================================================
   LuoguLab — 生成洛谷图标 assets/icon.ico / icon.png
   luogu-mark.png 是透明底的淡蓝细线 logo（给深色顶栏用的），
   直接缩成小图标就是"一坨白色"。这里按 App 图标的标准做法：
   洛谷品牌蓝(#3f83c4，取自 mark 主色)圆角实底 + 白色化 mark 图案。
   条目全部用 32bpp BMP DIB（兼容性最好，rcedit/资源管理器都认）。
   ============================================================ */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- PNG 解码（8-bit RGBA/RGB 非交错） ---------- */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    prev = cur;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (channels === 4) { out[o] = cur[x*4]; out[o+1] = cur[x*4+1]; out[o+2] = cur[x*4+2]; out[o+3] = cur[x*4+3]; }
      else { out[o] = cur[x*3]; out[o+1] = cur[x*3+1]; out[o+2] = cur[x*3+2]; out[o+3] = 255; }
    }
  }
  return { w, h, rgba: out };
}

/* ---------- 盒式采样缩放（预乘 alpha 平均） ---------- */
function resize(img, dw, dh) {
  const { w, h, rgba } = img;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * h) / dh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * w) / dw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++)
        for (let xx = x0; xx < x1 && xx < w; xx++) {
          const o = (yy * w + xx) * 4;
          const al = rgba[o + 3] / 255;
          r += rgba[o] * al; g += rgba[o + 1] * al; b += rgba[o + 2] * al;
          a += rgba[o + 3]; n++;
        }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out[o] = Math.min(255, Math.round((r * n * 255) / a));
        out[o + 1] = Math.min(255, Math.round((g * n * 255) / a));
        out[o + 2] = Math.min(255, Math.round((b * n * 255) / a));
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { w: dw, h: dh, rgba: out };
}

/* ---------- 合成：品牌蓝圆角实底 + 白色化图案 ---------- */
function composeBadge(mask, size) {
  const out = Buffer.alloc(size * size * 4);
  const R = Math.round(size * 0.225); // 圆角半径
  const r0 = 63, g0 = 131, b0 = 196;  // 洛谷品牌蓝（取自 mark 主色 #4080c0 微调）
  // 图案占中间 ~72%，等比铺满
  const inner = resize(mask, Math.round(size * 0.72), Math.round(size * 0.72));
  const ix = Math.floor((size - inner.w) / 2), iy = Math.floor((size - inner.h) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      // 圆角矩形覆盖判定（边缘 1px 抗锯齿）
      const dx = Math.max(R - x, x - (size - 1 - R), 0);
      const dy = Math.max(R - y, y - (size - 1 - R), 0);
      const d = Math.sqrt(dx * dx + dy * dy) - R;
      const cover = d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
      if (cover <= 0) { out[o + 3] = 0; continue; }
      // 白色图案 alpha 混在蓝底上
      const px = x - ix, py = y - iy;
      let al = 0;
      if (px >= 0 && py >= 0 && px < inner.w && py < inner.h) {
        al = inner.rgba[(py * inner.w + px) * 4 + 3] / 255;
      }
      out[o]     = Math.round(r0 + (255 - r0) * al);
      out[o + 1] = Math.round(g0 + (255 - g0) * al);
      out[o + 2] = Math.round(b0 + (255 - b0) * al);
      out[o + 3] = Math.round(255 * cover);
    }
  }
  return { w: size, h: size, rgba: out };
}

/* ---------- 32bpp BMP DIB 条目（bottom-up BGRA + AND mask） ---------- */
function dibEntry(img) {
  const { w, h, rgba } = img;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8); // DIB 高度 = 双高（像素 + mask）
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const andStride = Math.ceil(w / 32) * 4;
  const px = Buffer.alloc(w * h * 4);
  const mask = Buffer.alloc(andStride * h);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y; // bottom-up
    for (let x = 0; x < w; x++) {
      const so = (sy * w + x) * 4, doo = (y * w + x) * 4;
      px[doo] = rgba[so + 2]; px[doo + 1] = rgba[so + 1]; px[doo + 2] = rgba[so]; px[doo + 3] = rgba[so + 3];
    }
  }
  return Buffer.concat([header, px, mask]);
}

function buildICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let dataOff = header.length + 16 * entries.length;
  const dir = [], blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size; d[1] = e.size;
    d.writeUInt16LE(1, 4);  // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(e.blob.length, 8);
    d.writeUInt32LE(dataOff, 12);
    dir.push(d); blobs.push(e.blob);
    dataOff += e.blob.length;
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

/* ---------- PNG 编码（预览用） ---------- */
function encodePNG(w, h, rgba) {
  const chunk = (t, data) => {
    const L = Buffer.alloc(4); L.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t, "ascii"), data])) >>> 0);
    return Buffer.concat([L, Buffer.from(t, "ascii"), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mask = decodePNG(fs.readFileSync(path.join(__dirname, "..", "assets", "luogu-mark.png")));
const sizes = [128, 64, 48, 32, 16];
const entries = sizes.map((s) => ({ size: s, blob: dibEntry(composeBadge(mask, s)) }));
fs.writeFileSync(path.join(__dirname, "..", "assets", "icon.ico"), buildICO(entries));
fs.writeFileSync(path.join(__dirname, "..", "assets", "icon.png"), encodePNG(128, 128, composeBadge(mask, 128).rgba));
console.log("icon.ico written (DIB entries):", sizes.join("/"));
