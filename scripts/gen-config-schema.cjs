#!/usr/bin/env node
/* ============================================================
   Luogu++ — 配置 schema 生成器
   用法: node scripts/gen-config-schema.cjs [--write]
          （不带 --write 只打印，用于核对）

   为什么要有它：配置值的合法范围此前散落在设置页的滑杆声明里
   （<input type="range" min="0" max="28"> 与 bindSlider(..., "radius", 0, 28)），
   主进程却**不知道**这些范围——配置被手改坏（比如 radius 写成 9999）时，
   一路流到渲染层才炸，甚至渲染出一屏乱码。

   做法：从设置页的绑定语句里**自动**抽出每个键的类型与范围，生成
   src/config-schema.json，主进程启动时按它做一次 sanitize（非法值回退
   默认）。自动生成的意义：设置页改了滑杆范围，schema 跟着变，不会出现
   "设置页能设的值被启动校验拒了"这种自相矛盾。

   抽取来源：
     bindSlider(id, out, KEY, min, max)  → 数值键，带范围
     ck(id, "KEY")                        → 布尔键
     set({ KEY: ... })                    → 其它键（类型不严格约束）
   ============================================================ */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, p);

const settingsJs = fs.readFileSync(R("src/settings/settings.js"), "utf8");
const settingsHtml = fs.readFileSync(R("src/settings/settings.html"), "utf8");
const mainJs = fs.readFileSync(R("main.js"), "utf8");

/* DEFAULT_CONFIG 里定义的键（含嵌套对象的顶层键） */
const cfgBlock = (() => {
  const i = mainJs.indexOf("const DEFAULT_CONFIG = {");
  if (i < 0) return "";
  let depth = 0, started = false;
  for (let k = i; k < mainJs.length; k++) {
    const c = mainJs[k];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return mainJs.slice(i, k + 1); }
  }
  return "";
})();
const defaults = {};
{
  /* 顶层键 + 它的字面量默认值：只取 "key: <字面量>" 这一种形式，
     对象/数组/函数值不在 schema 范围内（它们由各自的代码负责）。 */
  const re = /^ {2}([a-zA-Z]\w*)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*,/gm;
  let m;
  while ((m = re.exec(cfgBlock))) {
    let v = m[2];
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^"/.test(v)) { try { v = JSON.parse(v); } catch (e) { continue; } }
    else v = Number(v);
    defaults[m[1]] = v;
  }
}

const schema = {};

/* 1) 滑杆：范围在 HTML 的 <input type="range" min max>，键名在 JS 的
      bindSlider(id, out, KEY, div, fmt) 里 —— 两处信息要合起来：
        settings.html: <input type="range" id="s-radius" min="0" max="28" step="1" />
        settings.js:    bindSlider("s-radius", "o-radius", "radius", 1, (v) => v + "px");
      ⚠️ bindSlider 的第 4 参是**除数**不是下限：div=100 表示滑杆值要除以
      100（百分比）。所以真实范围 = [min/div, max/div]。 */
{
  const rangeById = {};
  const reHtml = /<input[^>]*type="range"[^>]*id="([^"]+)"[^>]*>/g;
  let mh;
  while ((mh = reHtml.exec(settingsHtml))) {
    const tag = mh[0];
    const min = /min="(-?[\d.]+)"/.exec(tag);
    const max = /max="(-?[\d.]+)"/.exec(tag);
    if (!min || !max) continue;
    rangeById[mh[1]] = { min: Number(min[1]), max: Number(max[1]) };
  }
  /* bindSlider(id, out, key, div, fmt)：第 1 个字符串是滑杆 id，第 2 个是
     输出元素的 id，第 3 个才是**配置键**。少写一个就会把 out 当成 key。 */
  const reBind = /bindSlider\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`][^"'`]+["'`]\s*,\s*["'`]([a-zA-Z]\w*)["'`]\s*,\s*(\d+(?:\.\d+)?)?/g;
  let mb;
  while ((mb = reBind.exec(settingsJs))) {
    const id = mb[1], key = mb[2], div = mb[3] ? Number(mb[3]) : 1;
    const r = rangeById[id];
    if (!r || !(key in defaults)) continue;
    schema[key] = {
      type: "number",
      min: r.min / div,
      max: r.max / div,
      def: defaults[key],
    };
  }
}

/* 2) 开关：ck(id, "KEY") —— 布尔 */
{
  const re = /\bck\(\s*[^,]+,\s*["'`]([a-zA-Z]\w*)["'`]/g;
  let m;
  while ((m = re.exec(settingsJs))) {
    const key = m[1];
    if (!(key in defaults)) continue;
    if (schema[key]) continue;              // 滑杆优先
    if (typeof defaults[key] === "boolean") schema[key] = { type: "boolean", def: defaults[key] };
  }
}

/* 3) 其余有字面量默认值的键：只约束类型，不约束取值范围 */
for (const [k, v] of Object.entries(defaults)) {
  if (schema[k]) continue;
  if (typeof v === "number") schema[k] = { type: "number", def: v };
  else if (typeof v === "string") schema[k] = { type: "string", def: v };
}

/* 4) 枚举：分段控件（seg）的可选值
     settings.html: <button data-v="auto">跟随</button>（在 #seg-theme 内）
     settings.js:    document.querySelectorAll("#seg-theme button").forEach(b =>
                        b.addEventListener("click", () => set({ theme: b.dataset.v }, true)));
     两处配对：seg 容器 id → 配置键，容器里的 data-v → 合法取值。 */
{
  /* seg 容器 → 候选值 */
  const segValues = {};
  {
    const reSeg = /<div[^>]*id="(seg-[\w-]+)"[^>]*>([\s\S]*?)<\/div>/g;
    let ms;
    while ((ms = reSeg.exec(settingsHtml))) {
      const vals = [...ms[2].matchAll(/data-v="([^"]+)"/g)].map((x) => x[1]);
      if (vals.length) segValues[ms[1]] = vals;
    }
  }
  /* seg 容器 → 配置键 */
  /* 选择器形如 "#seg-theme button"——引号在 # 之前、id 之后还有内容，
     所以不能假设引号紧贴 id。 */
  /* 配对区间内不允许再出现 querySelectorAll：paint() 里也有 seg 绑定
     （只切 class、不写配置），不加这条会把 seg-theme 配到**下一个** seg 的
     set 上——表现为 searchEngine 拿到了 dockPos 的取值，整张表全是错位的。 */
  const reSegKey = /querySelectorAll\(\s*["'`][^"'`]*#(seg-[\w-]+)(?:(?!querySelectorAll)[\s\S]){0,400}?set\(\s*\{\s*([a-zA-Z]\w*)\s*:/g;
  let mk;
  while ((mk = reSegKey.exec(settingsJs))) {
    const segId = mk[1], key = mk[2];
    const vals = segValues[segId];
    if (!vals || !(key in defaults)) continue;
    /* 允许覆盖第 3 步放进来的"只约束类型"的 string 项——枚举比类型更严，
       正是它要替换掉那个宽泛条目。 */
    if (schema[key] && schema[key].type !== "string") continue;
    if (typeof defaults[key] !== "string") continue;
    /* ⚠️ 自校验：配错位是这个提取器最可能出的错（paint 里也有 seg 绑定，
       而 seg 的 id 是缩写、跟配置键没有字面关系）。判据很硬——**默认值必须
       在候选值里**。默认值不在候选里就说明配到了别的 seg，宁可丢掉这条
       枚举（退化成"只校验类型"），也不能生成一张错位的枚举表：错表会把
       用户的合法配置判成非法并回退，比没有校验更糟。 */
    if (!vals.includes(defaults[key])) continue;
    schema[key] = { type: "enum", values: vals, def: defaults[key] };
  }
}

/* 4) 枚举：分段控件（seg）的可选值
     settings.html: <button data-v="auto">跟随</button>（在 #seg-theme 内）
     settings.js:    document.querySelectorAll("#seg-theme button").forEach(b =>
                        b.addEventListener("click", () => set({ theme: b.dataset.v }, true)));
     两处配对：seg 容器 id → 配置键，容器里的 data-v → 合法取值。
     没有这一条的话，theme 被手改成 "neon" 也会被当成合法字符串放行。 */
{
  /* seg 容器 → 候选值 */
  const segValues = {};
  {
    const reSeg = /<div[^>]*id="(seg-[\w-]+)"[^>]*>([\s\S]*?)<\/div>/g;
    let ms;
    while ((ms = reSeg.exec(settingsHtml))) {
      const vals = [...ms[2].matchAll(/data-v="([^"]+)"/g)].map((x) => x[1]);
      if (vals.length) segValues[ms[1]] = vals;
    }
  }
  /* seg 容器 → 配置键 */
  const reSegKey = /querySelectorAll\(\s*["'`]#(seg-[\w-]+)["'`][\s\S]{0,400}?set\(\s*\{\s*([a-zA-Z]\w*)\s*:/g;
  let mk;
  while ((mk = reSegKey.exec(settingsJs))) {
    const segId = mk[1], key = mk[2];
    const vals = segValues[segId];
    if (!vals || !(key in defaults)) continue;
    if (schema[key]) continue;
    if (typeof defaults[key] === "string") {
      schema[key] = { type: "enum", values: vals, def: defaults[key] };
    }
  }
}

const out = {
  _说明: "本文件由 scripts/gen-config-schema.cjs 自动生成，请勿手改。改了设置页的滑杆范围后重新生成。",
  _来源: "src/settings/settings.js 的 bindSlider/ck 绑定 + main.js 的 DEFAULT_CONFIG 字面量默认值",
  keys: schema,
};

const text = JSON.stringify(out, null, 2) + "\n";
if (process.argv.includes("--write")) {
  fs.writeFileSync(R("src/config-schema.json"), text, "utf8");
  console.log("已写入 src/config-schema.json（" + Object.keys(schema).length + " 个键）");
} else {
  process.stdout.write(text);
}
