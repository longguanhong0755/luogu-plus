/* 开发启动器：渲染层变更原地刷新，主进程/预加载变更重启 Electron。
   仅 npm start/dev 使用；正常打包产物不包含文件监听。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const electron = require("electron");

const desktop = path.join(__dirname, "..");
const appArgs = [".", ...process.argv.slice(2)];

function classifyChange(file) {
  const rel = String(file || "").replace(/\\/g, "/");
  if (!rel) return "";
  if (rel === "package.json" || rel.startsWith("src/main/") || rel.startsWith("src/preload/")) return "restart";
  if (rel.startsWith("src/renderer/skin/")) return "reload-skin";
  if (rel.startsWith("src/renderer/settings/")) return "reload-settings";
  if (rel.startsWith("src/renderer/shell/")) return "reload-shell";
  if (rel.startsWith("src/renderer/shared/") || rel.startsWith("src/assets/")) return "reload-ui";
  return "";
}

function startSupervisor() {
  let child = null;
  let stopped = false;
  let restarting = false;
  let restartFallback = null;
  let flushTimer = null;
  const pending = new Set();
  const watchers = [];
  const watchReadyAt = Date.now() + 600;

  function spawnApp() {
    if (stopped) return;
    console.log("[dev] starting Electron");
    child = spawn(electron, appArgs, {
      cwd: desktop,
      env: Object.assign({}, process.env, { LG_DEV_WATCH: "1" }),
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child.on("message", (message) => {
      if (message && message.type === "dev-ack") {
        console.log("[dev] acknowledged", message.command, message.ok ? "ok" : "skipped");
      }
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (restartFallback) clearTimeout(restartFallback);
      restartFallback = null;
      if (stopped) return;
      if (restarting) {
        restarting = false;
        setTimeout(spawnApp, 180);
        return;
      }
      process.exit(code == null ? (signal ? 1 : 0) : code);
    });
  }

  function send(command) {
    if (!child || !child.connected) return;
    child.send({ type: "dev", command });
  }

  function flush() {
    flushTimer = null;
    if (pending.has("restart")) {
      pending.clear();
      restarting = true;
      console.log("[dev] main/preload changed; restarting Electron");
      send("restart");
      restartFallback = setTimeout(() => {
        if (child) child.kill();
      }, 2500);
      return;
    }
    for (const command of pending) send(command);
    pending.clear();
  }

  function enqueue(command) {
    if (!command) return;
    pending.add(command);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 180);
  }

  function watchDir(relDir) {
    const abs = path.join(desktop, relDir);
    if (!fs.existsSync(abs)) return;
    const watcher = fs.watch(abs, { recursive: true }, (_event, filename) => {
      if (Date.now() < watchReadyAt) return;
      const rel = path.join(relDir, String(filename || ""));
      const command = classifyChange(rel);
      if (command) console.log("[dev] change", rel.replace(/\\/g, "/"), "->", command);
      enqueue(command);
    });
    watcher.on("error", (err) => console.error("[dev] watch error:", err.message));
    watchers.push(watcher);
  }

  for (const dir of ["src/main", "src/preload", "src/renderer", "src/assets"]) watchDir(dir);
  const packageFile = path.join(desktop, "package.json");
  const packageWatcher = fs.watch(packageFile, () => {
    if (Date.now() < watchReadyAt) return;
    enqueue(classifyChange("package.json"));
  });
  packageWatcher.on("error", (err) => console.error("[dev] package watch error:", err.message));
  watchers.push(packageWatcher);

  function shutdown() {
    if (stopped) return;
    stopped = true;
    clearTimeout(flushTimer);
    if (restartFallback) clearTimeout(restartFallback);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {}
    }
    if (child) child.kill();
  }

  process.once("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  spawnApp();
}

if (require.main === module) startSupervisor();

module.exports = { classifyChange, startSupervisor };
