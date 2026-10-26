/* 冒烟：用隔离 userData 启动一次（窗口 opacity=0，不可见、不抢焦点），
   截图到 .lg-dev/smoke-home.png，然后正常退出。 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktop = path.join(__dirname, "..");
const repo = path.join(desktop, "..");
const electron = require("electron");

const stamp = Date.now();
// LG_SMOKE_PROFILE：持久 profile（登录测试用，保留 cookie）；默认一次性临时目录。
const userData = process.env.LG_SMOKE_PROFILE || path.join(os.tmpdir(), "luogu-desktop-smoke-" + stamp);
const outDir = path.join(repo, ".lg-dev");
const out = process.env.LG_SMOKE_OUT || path.join(outDir, "smoke-home.png");
fs.mkdirSync(outDir, { recursive: true });
if (process.env.LG_SMOKE_PROFILE) fs.mkdirSync(userData, { recursive: true });

console.log("electron:", electron);
console.log("userData:", userData);
console.log("screenshot:", out);

const result = spawnSync(electron, [".", "--smoke"], {
  cwd: desktop,
  env: Object.assign({}, process.env, {
    LG_USERDATA: userData,
    LG_SMOKE_OUT: out,
    LG_SMOKE: "1",
    LG_DEMO: process.env.LG_DEMO === "0" ? "0" : process.env.LG_DEMO || "1",
  }),
  encoding: "utf8",
  timeout: Number(process.env.LG_SMOKE_TIMEOUT || 60000),
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const shots = [...String(result.stdout || "").matchAll(/SMOKE_SHOT \S+ (.+)/g)]
  .map((m) => m[1].trim())
  .filter((file) => !/SKIPPED/.test(file));
const badShots = shots.filter((file) => !fs.existsSync(file) || fs.statSync(file).size <= 5000);
const ok =
  result.status === 0 &&
  String(result.stdout || "").includes("SMOKE_OK") &&
  !String(result.stdout || "").includes("SMOKE_FAIL") &&
  fs.existsSync(out) &&
  fs.statSync(out).size > 5000 &&
  badShots.length === 0;
if (badShots.length) console.error("empty/small screenshots: " + badShots.join(", "));

if (ok) {
  console.log("smoke: PASS");
  if (!process.env.LG_SMOKE_PROFILE) fs.rmSync(userData, { recursive: true, force: true });
  process.exit(0);
}

console.error("smoke: FAIL status=" + result.status);
process.exit(1);
