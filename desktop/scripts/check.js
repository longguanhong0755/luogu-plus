/* 静态检查：薄运行器。断言实现见 check/sections/**，基础设施见 check/lib/env.js。
   不联网、不启动 Electron，CI 与本地共用。
   执行顺序与拆分前逐段一致，stdout 可逐行比对。 */
const env = require("./check/lib/env");

const ctx = {
  ok: env.ok,
  fail: env.fail,
  read: env.read,
  walk: env.walk,
  ROOT: env.ROOT,
  fs: env.fs,
  path: env.path,
  spawnSync: env.spawnSync,
  scriptsDir: env.SCRIPTS_DIR,
  store: env.store,
};

const sections = [
  require("./check/sections/files"),
  require("./check/sections/ipc"),
  require("./check/sections/product"),
  require("./check/sections/offline"),
  require("./check/sections/design"),
  require("./check/sections/layout"),
  require("./check/sections/display"),
  require("./check/sections/submit"),
  require("./check/sections/polish"),
  require("./check/sections/evidence"),
  require("./check/sections/release"),
  require("./check/sections/memory"),
  require("./check/sections/features"),
  require("./check/sections/regressions"),
  require("./check/sections/runtime"),
  require("./check/sections/budget"),
];

for (const run of sections) run(ctx);

console.log("");
const { checks, failures } = env.counts();
console.log(`check: ${checks} 项通过, ${failures} 项失败`);
process.exit(failures ? 1 : 0);
