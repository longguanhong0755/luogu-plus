#!/usr/bin/env node
/* ============================================================
   Luogu++ — 契约静态检查（CI 与本地提交前都该跑）
   用法: node scripts/lint-contracts.cjs
   退出码 0 = clean，1 = 有问题

   为什么要有这个：本项目 127 个 IPC 通道、101 个配置键，全靠字符串
   约定彼此关联，"preload 加方法要三处同步"这种规则靠人记必然漏。
   漏了不会报错，只是**静默失效**——最难查的一类 bug。本脚本把这类
   约定变成机器检查。

   检查项：
     1 IPC 通道三方对账：preload 里 invoke 的通道 vs main.js 里
       handle/on 的通道。preload 引了但主进程没注册 → 必是死通道。
     2 反向：主进程注册了但没有任何 preload 引用 → 标注（可能只走
       webContents.send 内部推送，不算错，但要人工确认）。
     3 preload 方法 vs 调用方：chrome.js / settings.js 里调了
       window.lgChrome.xxx 但 preload 没暴露 → 运行期 TypeError。
     4 配置键三方对账：DEFAULT_CONFIG 定义 vs 代码消费点（cfg.x /
       cfgState.x）vs 设置页绑定（bindSlider / ck / set）。
       - 定义了没人用 → 死配置
       - 用了但没定义 → **隐式 undefined**（最危险：静默取到 undefined）
     5 设置页绑定的配置键是否在 DEFAULT_CONFIG 里有定义。
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), "utf8");
/* 剥掉注释再匹配：否则"这里原来有个 ipcMain.handle("x")"这种说明性注释
   会被当成真的注册/调用，lint 报出已修掉的问题（自己跟自己过不去）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

const problems = [];
const notes = [];
const P = (level, file, msg) => problems.push({ level, file, msg });

/* ---------- 读源文件 ---------- */
const mainJs = read("main.js");
const settingsJs = read("src/settings/settings.js");
const settingsHtml = read("src/settings/settings.html");
const chromeJs = read("src/chrome/chrome.js");
const injectJs = read("src/inject.js");
const homeJs = read("src/home/home.js");
const popupJs = read("src/popup/popup.js");
const historyJs = read("src/history/history.js");
const dockJs = read("src/dock/dock.js");
/* 参与"模式匹配"的源码一律用剥注释后的版本 */
const MCmain = stripComments(mainJs);
const MCsettings = stripComments(settingsJs);
const MChrome = stripComments(chromeJs);

const preloads = {
  "preload-page.js": read("preload-page.js"),
  "preload-chrome.js": read("preload-chrome.js"),
  "preload-popup.js": read("preload-popup.js"),
  "preload-dock.js": read("preload-dock.js"),
  "preload-config.js": read("preload-config.js"),
};
const preloadNames = Object.keys(preloads);
const preloadAll = preloadNames.map((n) => preloads[n]).join("\n");

/* ---------- 1 & 2：IPC 通道对账 ---------- */
const invoked = new Map(); // channel -> [preload 文件]
for (const name of preloadNames) {
  /* invoke（请求-响应）与 send（单向推送）都算"引用"：
     主进程 ipcMain.on("x") 的通道由渲染进程 ipcRenderer.send("x") 触发，
     只认 invoke 会把一批正常通道误报成"没人引用"。 */
  const re = /(?:invoke|send)\(\s*["'`]([a-zA-Z0-9:_-]+)["'`]/g;
  let m;
  while ((m = re.exec(preloads[name]))) {
    if (!invoked.has(m[1])) invoked.set(m[1], []);
    invoked.get(m[1]).push(name);
  }
}
const registered = new Map(); // channel -> handle|on
{
  const re = /ipcMain\.(handle|on)\(\s*["'`]([a-zA-Z0-9:_-]+)["'`]/g;
  let m;
  while ((m = re.exec(MCmain))) {
    registered.set(m[2], m[1]);
    // ipcMain.handle("x", ...) 的通道名可能带前缀写法不同，这里只取标准形式
  }
}
for (const [ch, files] of invoked) {
  if (!registered.has(ch)) {
    P("error", files.join(","), `preload 调用了 IPC 通道 "${ch}"，但 main.js 没有注册 handler → 调用必然 reject`);
  }
}
for (const [ch, kind] of registered) {
  if (!invoked.has(ch)) {
    notes.push(`main.js 注册了 ${kind} "${ch}"，但没有任何 preload invoke 它（可能只走 webContents.send 内部推送）`);
  }
}

/* ---------- 3：preload 方法 vs 调用方 ---------- */
const exposed = new Map(); // 全局名 -> Map(方法名 -> [preload 文件])
/* 用**括号配对**找对象体，不用正则：exposeInMainWorld 的第二个参数里有嵌套
   的大括号（onConfig 那种多行回调），非贪婪正则会在嵌套处截断——第一版
   就是这么把 90 多个方法只认出 6 个的。 */
function extractBalanced(src, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    const c = src[k];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, k);
    }
  }
  return "";
}
/* 只取对象体**顶层**的 "key:" 成员：逐字符扫，深度为 0 时遇到 "key:" 才是成员。
   否则嵌套回调里的 "cb:" / Object.assign({...}) 里的键会被误当成顶层键。 */
function topLevelKeys(obj) {
  const out = [];
  let depth = 0;
  let key = "";
  for (let k = 0; k < obj.length; k++) {
    const c = obj[k];
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) { key += c; continue; }
    if (depth === 0 && key) {
      if (c === ":") out.push(key);
      key = "";
    }
  }
  return out;
}
for (const name of preloadNames) {
  const body = preloads[name];
  const re = /exposeInMainWorld\(\s*["'`]([\w$]+)["'`]\s*,\s*\{/g;
  let m;
  while ((m = re.exec(stripComments(body)))) {
    const globalName = m[1];
    const clean = stripComments(body);
    const openIdx = clean.indexOf("{", m.index);
    const obj = extractBalanced(clean, openIdx);
    if (!exposed.has(globalName)) exposed.set(globalName, new Map());
    const inner = exposed.get(globalName);
    for (const key of topLevelKeys(obj)) {
      if (!inner.has(key)) inner.set(key, []);
      inner.get(key).push(name);
    }
  }
}
const CALLERS = {
  "src/chrome/chrome.js": chromeJs,
  "src/settings/settings.js": settingsJs,
  "src/home/home.js": homeJs,
  "src/popup/popup.js": popupJs,
  "src/history/history.js": historyJs,
  "src/dock/dock.js": dockJs,
};
for (const [file, body] of Object.entries(CALLERS)) {
  const re = /window\.(lg\w+)\.(\w+)\s*\(/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(stripComments(body)))) {
    const key = m[1] + "." + m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    const inner = exposed.get(m[1]);
    if (!inner) {
      P("error", file, `调用了 window.${m[1]}.${m[2]}()，但没有任何 preload 暴露 ${m[1]} → 运行期 TypeError`);
    } else if (!inner.has(m[2])) {
      P("error", file, `调用了 window.${m[1]}.${m[2]}()，但 ${m[1]} 没有暴露这个方法（暴露的是：${[...inner.keys()].join(", ")}）`);
    }
  }
}

/* ---------- 4 & 5：配置键三方对账 ---------- */
// 4a. DEFAULT_CONFIG 的键
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
const defined = new Set();
{
  /* 取**顶层**键：按"行首恰好 2 空格缩进"判定。嵌套对象（homePrefs: {...}）
     内部的行缩进更深，不会被匹配到。
     ⚠️ 不要用括号配对 + 深度法：cfgBlock 本身含最外层的花括号，深度从 1
     起算，结果一个键都取不到（试过，63 个键集体消失）。 */
  const re = /^ {2}([a-zA-Z]\w*)\s*:/gm;
  let m;
  while ((m = re.exec(stripComments(cfgBlock)))) defined.add(m[1]);
}
/* 4b. 消费点：cfg.x / cfgState.x（rawCfg.x 也算） */
const consumed = new Map(); // key -> [文件]
const CONSUMERS = {
  "main.js": mainJs,
  "src/inject.js": injectJs,
  "src/chrome/chrome.js": chromeJs,
  "src/settings/settings.js": settingsJs,
  "src/home/home.js": homeJs,
  "src/popup/popup.js": popupJs,
};
/* 配置对象的别名：本地页常写 `const c = await lgConfig.get()` 之后读
   c.countdowns —— 只认 cfg.xxx 会把这类合法消费判成死配置。先扫出"从
   lgConfig.get() 拿到配置"的变量名，把它们的属性访问也算消费点。 */
/* 别名**按文件生效**：同名变量在不同文件里含义不同——main.js 里满地都是
   `c` 这个局部参数（c.match / c.width），若把 home.js 的别名 c 全局套用，
   就会把一堆普通局部变量误判成配置消费点。 */
const cfgAliases = new Map([["cfg", "*"], ["rawCfg", "*"], ["cfgState", "*"]]);
{
  const reAlias = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+window\.lgConfig\.get\(\)/g;
  for (const [f, b] of Object.entries(CONSUMERS)) {
    let ma;
    while ((ma = reAlias.exec(b))) cfgAliases.set(ma[1], f);
  }
}
for (const [file, body] of Object.entries(CONSUMERS)) {
  const aliasAlt = [...cfgAliases.entries()]
    .filter(([, f]) => f === "*" || f === file)
    .map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp("\\b(?:" + aliasAlt + "|state\\.cfg)\\.([a-zA-Z]\\w*)", "g");
  let m;
  while ((m = re.exec(stripComments(body)))) {
    const k = m[1];
    if (!consumed.has(k)) consumed.set(k, []);
    if (!consumed.get(k).includes(file)) consumed.get(k).push(file);
  }
}
// 4c. 设置页绑定：bindSlider(id, out, KEY) / ck(id, "key") / set({ key: ... })
const uiBound = new Set();
{
  const re1 = /bindSlider\(\s*[^,]+,\s*[^,]+,\s*["'`]([a-zA-Z]\w*)["'`]/g;
  const re2 = /\bck\(\s*[^,]+,\s*["'`]([a-zA-Z]\w*)["'`]/g;
  // set({ key: ... }) 里的**所有**顶层键（一个 set 调用可能带多个键）
  // ⚠️ 两条坑：① 必须带词边界 \b，否则 "Object.assign({" 的尾巴 "set({"
  //    也会被匹配；② 必须用括号配对取顶层键，否则 set({ homePrefs:
  //    Object.assign({ clock: true, ... }) }) 里的嵌套键会被当成顶层配置键。
  const re3 = /\bset\(\s*\{/g;
  for (const re of [re1, re2]) {
    let m;
    while ((m = re.exec(MCsettings))) uiBound.add(m[1]);
  }
  let m3;
  while ((m3 = re3.exec(MCsettings))) {
    const openIdx = MCsettings.indexOf("{", m3.index);
    for (const key of topLevelKeys(extractBalanced(MCsettings, openIdx))) uiBound.add(key);
  }
  /* seg 的 id 尾段**不是**配置键：UI id 是缩写（seg-vtabside → 真实键
     vtabSide），把它当配置键全是误报。seg 的真实键由上面的 set({...}) 覆盖。 */
}

/* 死配置：定义了，但没有任何消费点（UI 绑定也算消费）。
   ⚠️ 这一项**只能提示不能报错**：消费点不一定写成 cfg.xxx —— 可能是
   别名访问（home.js 里 `const c = await lgConfig.get()` 之后读 c.countdowns），
   静态扫看不出来。误报会让人对整个 lint 失去信任，那比漏报更糟。
   已人工确认的（有意保留的兼容字段等）写进 scripts/lint-contracts.ignore.json。 */
const IGNORE = (() => {
  try {
    return JSON.parse(fs.readFileSync(R("scripts/lint-contracts.ignore.json"), "utf8"));
  } catch (e) { return {}; }
})();
const ignoreDead = new Set(IGNORE.deadConfig || []);
for (const k of defined) {
  if (!consumed.has(k) && !uiBound.has(k)) {
    if (ignoreDead.has(k)) continue;
    notes.push(`配置键 "${k}" 在 DEFAULT_CONFIG 里定义，但没扫到消费点（可能是别名访问，也可能是死配置）`);
  }
}
// 隐式 undefined：消费了但没定义（最危险：静默取到 undefined）
/* 只对 main.js 判为 error：那里的 cfg 是全局配置对象，键必须来自
   DEFAULT_CONFIG 或运行时写入。inject.js / chrome.js 里的 cfg 是主进程
   下发的**派生快照**（cfgForPages 的结果），键来自主进程的推导逻辑，
   本来就不在 DEFAULT_CONFIG 里，拿 DEFAULT_CONFIG 去校验它们全是误报。 */
const runtimeKeys = new Set();
{
  // main.js 里对 cfg 的运行时写入：cfg.xxx = ...
  for (const m of MCmain.matchAll(/\bcfg\.([a-zA-Z]\w*)\s*=[^=]/g)) runtimeKeys.add(m[1]);
  // cfgForPages() 下发的派生键
  const fp = MCmain.match(/function cfgForPages[\s\S]*?\n\}/);
  if (fp) for (const m of fp[0].matchAll(/([a-zA-Z]\w*)\s*[:=]/g)) runtimeKeys.add(m[1]);
  // 主进程往渲染进程推的对象里的键（webContents.send("chrome:config", {...})）
  // —— shortcutRows / presetVars / resolvedTheme 都是这样下发的，不在
  // DEFAULT_CONFIG 里，但它们是**合法**的派生键。
  const reSend = /webContents\.send\(\s*["'`][\w:.-]+["'`]\s*,\s*\{/g;
  let ms;
  while ((ms = reSend.exec(MCmain))) {
    const openIdx = MCmain.indexOf("{", ms.index);
    for (const k of topLevelKeys(extractBalanced(MCmain, openIdx))) runtimeKeys.add(k);
  }
}
// 嵌套键：cfg.<parent>.<child> 里的 child 是**子对象**的内部结构
// （如 cfg.homePrefs.clock），不是顶层配置键，不参与顶层对账。
const nestedKeys = new Set();
{
  const re = /\b(?:cfg|rawCfg|cfgState|state\.cfg)\.[a-zA-Z]\w*\.([a-zA-Z]\w*)/g;
  let m;
  while ((m = re.exec(Object.values(CONSUMERS).join("\n")))) nestedKeys.add(m[1]);
}
for (const [k, files] of consumed) {
  if (defined.has(k) || runtimeKeys.has(k) || nestedKeys.has(k)) continue;
  if (/^(file|root|dir|name|path|el|node|item|list|map|key|val|value|data|state|tmp|raw|t)$/.test(k)) continue;
  /* 迁移代码里的"确保删掉这个旧键"（delete cfg.x / "x" in cfg）不是消费点，
     它恰恰说明这个键**不该**存在。 */
  const mig = new RegExp("(delete\\s+cfg\\." + k + "\\b)|(\"" + k + "\"\\s+in\\s+cfg)");
  if (mig.test(MCmain)) continue;
  const isMain = files.includes("main.js");
  const msg = `消费了配置键 "${k}"，但 DEFAULT_CONFIG 与运行时派生里都没有它 → 恒为 undefined`;
  if (isMain) P("error", files.join(","), msg);
  else notes.push(`${files.join(",")}：${msg}（派生快照的键，确认主进程确实下发了它）`);
}
// 设置页绑定了不存在的配置键
for (const k of uiBound) {
  if (!defined.has(k)) {
    P("error", "src/settings/settings.js", `设置页绑定了配置键 "${k}"，但 DEFAULT_CONFIG 里没有它 → 开关读不到值`);
  }
}

/* ---------- 6：配置 schema 与 DEFAULT_CONFIG 对账 ----------
   src/config-schema.json 是自动生成的（scripts/gen-config-schema.cjs），
   但生成之后没人保证它没过期：改了 DEFAULT_CONFIG 的默认值而忘了重新生成，
   启动校验就会用旧值把用户的配置判成"非法"并回退——比不校验更糟。 */
try {
  const schema = JSON.parse(fs.readFileSync(R("src/config-schema.json"), "utf8"));
  const skeys = Object.keys(schema.keys || {});
  for (const k of skeys) {
    if (!defined.has(k)) {
      P("error", "src/config-schema.json", `schema 里有键 "${k}"，但 DEFAULT_CONFIG 没有它 → 重新生成 schema`);
    }
  }
  /* 重新生成一遍比对：内容不一致说明 schema 过期了 */
  const { execFileSync } = require("child_process");
  const fresh = execFileSync(process.execPath, [R("scripts/gen-config-schema.cjs")], { encoding: "utf8" });
  const cur = fs.readFileSync(R("src/config-schema.json"), "utf8");
  if (fresh.trim() !== cur.trim()) {
    P("error", "src/config-schema.json", "schema 与源码不同步（默认值或滑杆范围变了）→ 跑 node scripts/gen-config-schema.cjs --write");
  }
} catch (e) {
  P("error", "src/config-schema.json", "读不到或解析失败: " + ((e && e.message) || e));
}

/* ---------- 输出 ---------- */
console.log("契约检查：" + problems.length + " 个问题，" + notes.length + " 条待人工确认\n");
if (problems.length) {
  console.log("=== 问题 ===");
  for (const p of problems) console.log(`  [${p.level}] ${p.file}\n      ${p.msg}`);
  console.log("");
}
if (notes.length) {
  console.log("=== 待人工确认 ===");
  for (const n of notes) console.log("  " + n);
  console.log("");
}
console.log(`统计：IPC 通道 ${registered.size} 个（preload 引用 ${invoked.size} 个）/ 配置键 ${defined.size} 个 / 设置页绑定 ${uiBound.size} 个`);
process.exit(problems.length ? 1 : 0);
