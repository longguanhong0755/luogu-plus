/* 静态检查：语法、必需文件、渲染层引用、IPC 通道双向对齐。
   不联网、不启动 Electron，CI 与本地共用。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let checks = 0;

function ok(message) {
  checks++;
  console.log("  ok  " + message);
}

function fail(message, detail) {
  failures++;
  console.log("  FAIL " + message);
  if (detail) console.log("       " + detail);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
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
  "src/main/views.js",
  "src/main/luogu.js",
  "src/main/tray.js",
  "src/main/notify.js",
  "src/main/ipc.js",
  "src/main/smoke.js",
  "src/preload/shell.js",
  "src/preload/page.js",
  "src/preload/settings.js",
  "src/renderer/shell/index.html",
  "src/renderer/shell/shell.js",
  "src/renderer/shell/shell.css",
  "src/renderer/settings/index.html",
  "src/renderer/settings/settings.js",
  "src/renderer/settings/settings.css",
  "src/renderer/skin/luogu-skin.css",
  "src/assets/icon.ico",
  "src/assets/tray.png",
];
for (const file of required) {
  if (fs.existsSync(path.join(ROOT, file))) ok("存在 " + file);
  else fail("缺少 " + file);
}

/* 3. package.json 可解析且入口存在 */
try {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.main && fs.existsSync(path.join(ROOT, pkg.main))) ok("package.json main 指向有效入口");
  else fail("package.json main 无效");
} catch (err) {
  fail("package.json 解析失败", err.message);
}

/* 4. renderer HTML 的资源引用都存在 */
for (const html of [
  "src/renderer/shell/index.html",
  "src/renderer/settings/index.html",
]) {
  const source = read(html);
  const refs = [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    const resolved = path.join(ROOT, path.dirname(html), ref);
    if (fs.existsSync(resolved)) ok(`${html} → ${ref}`);
    else fail(`${html} 引用了不存在的 ${ref}`);
  }
}

/* 5. IPC 双向对齐 */
const ipcSource = read("src/main/ipc.js");
const mainHandlers = new Set(
  [...ipcSource.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1])
);
const preloadCalls = new Set();
for (const file of ["src/preload/shell.js", "src/preload/settings.js", "src/preload/page.js"]) {
  const source = read(file);
  for (const m of source.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)) preloadCalls.add(m[1]);
}
for (const channel of preloadCalls) {
  if (mainHandlers.has(channel)) ok("IPC " + channel);
  else fail("preload 调用了未注册的通道 " + channel);
}

const mainSends = new Set();
for (const file of walk(path.join(ROOT, "src", "main"), []).filter((f) => f.endsWith(".js"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(/webContents\.send\("([^"]+)"/g)) mainSends.add(m[1]);
}
const preloadListeners = new Set();
for (const file of ["src/preload/shell.js", "src/preload/settings.js"]) {
  const source = read(file);
  for (const m of source.matchAll(/on\("([^"]+)"/g)) preloadListeners.add(m[1]);
}
for (const channel of mainSends) {
  if (preloadListeners.has(channel)) ok("推送 " + channel);
  else fail("主进程推送了没有 preload 监听的通道 " + channel);
}

/* 6. 危险默认值检查 */
const configSource = read("src/main/config.js");
if (/closeAction:\s*"tray"/.test(configSource)) ok("默认关窗收托盘");
else fail("默认关窗行为不是 tray");
if (/autoLaunch:\s*false/.test(configSource)) ok("默认不开机自启");
else fail("开机自启默认值不是 false");

const luoguSource = read("src/main/luogu.js");
if (/shell\.openExternal/.test(luoguSource)) fail("luogu.js 不应直接调用 shell.openExternal");
else ok("站外链接不在数据层处理");

const viewsSource = read("src/main/views.js");
if (/openExternal\(url\)/.test(viewsSource)) ok("站外链接交给系统浏览器");
else fail("views.js 没有站外链接出口");

console.log("");
console.log(`check: ${checks} 项通过, ${failures} 项失败`);
process.exit(failures ? 1 : 0);
