/* 崩溃可观测性：主进程未捕获异常落盘到 logs/crash.log（userData 内标准 logs 目录，
   隔离测试实例落自己的 profile，互不可见）。仅追加，失败静默——崩溃路径上不能再抛。 */
function persistCrash(err) {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const { app } = require("electron");
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "crash.log"),
      JSON.stringify({
        t: new Date().toISOString(),
        ver: app.getVersion(),
        msg: String((err && err.message) || err),
        stack: String((err && err.stack) || "").slice(0, 4000),
      }) + "\n",
    );
  } catch {
    /* ignore */
  }
}

module.exports = { persistCrash };
