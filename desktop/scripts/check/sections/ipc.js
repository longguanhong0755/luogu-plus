/* renderer 资源引用与 IPC 通道双向对齐（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function ipc(ctx) {
  const { ok, fail, read, walk, ROOT, fs, path } = ctx;
  const store = ctx.store;
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

/* 发送点既可能是字面量，也可能走通道常量（R96 拆分后 views/rail.js 用
   RAIL_LAYOUT_CHANNEL），所以先把常量名解析回通道名再比对。 */
const SEND_CONSTANTS = new Map();
const MAIN_FILES = walk(path.join(ROOT, "src", "main"), []).filter((f) => f.endsWith(".js"));
for (const file of MAIN_FILES) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g)) {
    if (!SEND_CONSTANTS.has(m[1])) SEND_CONSTANTS.set(m[1], m[2]);
  }
}
const mainSends = new Set();
for (const file of MAIN_FILES) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(/webContents\.send\(\s*(?:"([^"]+)"|([A-Z][A-Z0-9_]*))/g)) {
    const channel = m[1] || SEND_CONSTANTS.get(m[2]);
    if (channel) mainSends.add(channel);
  }
}
const preloadListeners = new Set();
for (const file of ["src/preload/shell.js", "src/preload/settings.js", "src/preload/page.js"]) {
  const source = read(file);
  for (const m of source.matchAll(/on\("([^"]+)"/g)) preloadListeners.add(m[1]);
}
for (const channel of mainSends) {
  if (preloadListeners.has(channel)) ok("推送 " + channel);
  else fail("主进程推送了没有 preload 监听的通道 " + channel);
}

  /* 后续段落复用的中间变量 */
  Object.assign(store, { ipcSource });
};
