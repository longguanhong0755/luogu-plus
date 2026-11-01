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
// 裁决合并 stdout+stderr：探针异常的 SMOKE_FAIL 可能走 stderr，漏扫就假 PASS
const allOut = String(result.stdout || "") + String(result.stderr || "");
const manifestMatch = allOut.match(/SMOKE_MANIFEST (.+)/);
let manifestOk = false;
let manifestError = "";
if (manifestMatch) {
  try {
    const manifestFile = manifestMatch[1].trim();
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifestOk = Array.isArray(manifest.shots) && manifest.shots.length > 0 && manifest.shots.every((item) => {
      if (!item.file || !fs.existsSync(item.file) || fs.statSync(item.file).size <= 5000) return false;
      if (!item.width || !item.height || item.width < 320 || item.height < 240) return false;
      const hash = require("node:crypto").createHash("sha256").update(fs.readFileSync(item.file)).digest("hex");
      return hash === item.sha256;
    });
    if (!manifestOk) manifestError = "manifest 条目缺失/尺寸异常/哈希不一致";
  } catch (err) {
    manifestError = err.message;
  }
} else {
  manifestError = "未找到 SMOKE_MANIFEST";
}
const skipped = (allOut.match(/SMOKE_SKIP/g) || []).length;
const captureFailures = (allOut.match(/SMOKE_CAPTURE_CDP_FAIL/g) || []).length;
const railSummary = allOut.match(/SMOKE_RAIL_SUMMARY .*$/m);
const railFailure = !railSummary || !/"failed":\[\]/.test(railSummary[0]);
const ok =
  result.status === 0 &&
  allOut.includes("SMOKE_OK") &&
  !allOut.includes("SMOKE_FAIL") &&
  skipped === 0 &&
  captureFailures === 0 &&
  !railFailure &&
  manifestOk &&
  fs.existsSync(out) &&
  fs.statSync(out).size > 5000 &&
  badShots.length === 0;
if (badShots.length) console.error("empty/small screenshots: " + badShots.join(", "));
if (!manifestOk) console.error("manifest: " + manifestError);
if (skipped || captureFailures || railFailure) console.error("probe gaps: skipped=" + skipped + " captureFails=" + captureFailures + " railFailure=" + railFailure);

if (ok) {
  console.log("smoke: PASS");
  if (!process.env.LG_SMOKE_PROFILE) fs.rmSync(userData, { recursive: true, force: true });
  process.exit(0);
}

console.error("smoke: FAIL status=" + result.status);
// 失败证据按时间戳归档，不覆盖（探针抓 bug 的失败现场可追溯）
try {
  const failDir = path.join(repo, ".lg-dev", "fails");
  fs.mkdirSync(failDir, { recursive: true });
  const failLog = path.join(failDir, "fail-" + new Date().toISOString().replace(/[:.]/g, "-") + ".log");
  const ctxLine = result.status === null ? "TIMEOUT after " + (Number(process.env.LG_SMOKE_TIMEOUT) || 60000) + "ms\n" : "";
  fs.writeFileSync(failLog, ctxLine + "exit=" + result.status + "\n" + String(result.stdout || "") + String(result.stderr || ""));
  console.error("fail log: " + failLog);
} catch {
  /* ignore */
}
process.exit(1);
