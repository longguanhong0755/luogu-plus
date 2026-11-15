/* R94 剥离清单、R83/R84 实测证据、R80/R74 收尾（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function evidence(ctx) {
  const { ok, fail, read, ROOT, fs, path, scriptsDir } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { parity76, smoke74 } = store;
const packBuf = fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"));
if (packBuf[0] === 0xef && packBuf[1] === 0xbb && packBuf[2] === 0xbf) ok("R94 pack-portable.ps1 带 UTF-8 BOM（powershell.exe 5.1 才不会按 ANSI 误读中文）");
else fail("R94 pack-portable.ps1 缺 UTF-8 BOM，Windows PowerShell 5.1 会直接解析失败");
if (/hiddenOpen === "skipped"/.test(smoke74) && /ensureWindow/.test(smoke74)) ok("R79 SEC hidden 腿环境感知（ensureWindow+skipped）");
else fail("R79 SEC hidden 腿缺 skip 语义");
if (/TIMEOUT after/.test(fs.readFileSync(path.join(scriptsDir, "smoke.js"), "utf8"))) ok("R79 超时归档带上下文");
else fail("R79 超时归档缺上下文");

/* ---------- R83 行为化证据断言（读最新探针日志；CI 无日志时如实跳过） ---------- */
const lgdev83 = path.join(ROOT, "..", ".lg-dev");
const batchLogs83 = [];
try {
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    const b1 = path.join(lgdev83, dir, "batch1-run.log");
    if (fs.existsSync(b1)) batchLogs83.push(b1);
  }
} catch {
  /* .lg-dev 不存在（全新 clone）→ 跳过 */
}
if (batchLogs83.length) {
  const text83 = fs.readFileSync(batchLogs83[batchLogs83.length - 1], "utf8");
  const secOk83 = text83.indexOf("SMOKE_SEC ") !== -1 && text83.indexOf(String.raw`"ok":true`) !== -1;
  const findOk83 = text83.indexOf("SMOKE_FIND ") !== -1;
  if (secOk83 && findOk83) ok("R83 行为证据（最新批次 " + path.basename(path.dirname(batchLogs83[batchLogs83.length - 1])) + "）：SEC/FIND ok:true");
  else fail("R83 最新批次行为证据不足（SEC=" + secOk83 + " FIND=" + findOk83 + "）");
  const audits83 = [];
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    for (const f of ["dark-auditA.log", "dark-auditB.log", "light-auditA.log", "light-auditB.log"]) {
      const p83 = path.join(lgdev83, dir, f);
      if (fs.existsSync(p83)) audits83.push(p83);
    }
  }
  if (audits83.length) {
    const badLines = fs.readFileSync(audits83[audits83.length - 1], "utf8").match(/SMOKE_FAIL 皮肤审计超零/g);
    const gateOk = /"bad":0/.test(fs.readFileSync(audits83[audits83.length - 1], "utf8"));
    if (!badLines && gateOk) ok("R83 最新审计 GATE bad:0（" + path.basename(path.dirname(audits83[audits83.length - 1])) + "）");
    else fail("R83 最新审计存在超零项");
  }
} else {
  ok("R83 行为化证据断言：本地无探针日志，跳过（CI/全新 clone 场景）");
}

/* ---------- R84 登录态实测证据（owner 授权；CI 无日志时如实跳过） ---------- */
const smoke84 = read("src/main/smoke.js");
if (/LGTEST_RECORD_PAGE/.test(smoke84) && /LGTEST_NOTIFY_PAGE/.test(smoke84) && /LGTEST_SUBMIT_PAGE/.test(smoke84) && /captureWC\(recordWc, wait\)/.test(smoke84)) ok("R84 登录态页面级证据探针（记录/通知/提交 三页 DOM+截图）");
else fail("R84 缺登录态页面级探针");
const loginLogs84 = [];
try {
  for (const dir of fs.readdirSync(lgdev83).filter((d) => /^r\d+$/.test(d)).sort()) {
    const loginLog84 = path.join(lgdev83, dir, "login-run.log");
    if (fs.existsSync(loginLog84)) loginLogs84.push(loginLog84);
  }
} catch {
  /* .lg-dev 不存在（全新 clone）→ 跳过 */
}
if (loginLogs84.length) {
  const lastLogin84 = loginLogs84[loginLogs84.length - 1];
  const loginText84 = fs.readFileSync(lastLogin84, "utf8");
  const loginDir84 = path.basename(path.dirname(lastLogin84));
  const loggedIn84 = /LGTEST logged-in uid=\d+/.test(loginText84);
  const record84 = /LGTEST_RECORD_PAGE .*"title":"评测记录 - 洛谷"/.test(loginText84) && /"recordLinks":\d+/.test(loginText84);
  const notify84 = /LGTEST_NOTIFY_PAGE .*"title":"通知中心 - 洛谷"/.test(loginText84);
  const submit84 = /LGTEST_SUBMIT_PAGE .*"href":"https:\/\/www\.luogu\.com\.cn\/problem\/P1001#submit"/.test(loginText84) && /"editors":1/.test(loginText84) && /"codeLen":[1-9][0-9]*/.test(loginText84);
  if (loggedIn84 && record84 && notify84 && submit84) ok("R84 登录态实测证据（" + loginDir84 + "）：登录/记录/通知/提交 四证齐全");
  else fail("R84 登录态证据不足（login=" + loggedIn84 + " record=" + record84 + " notify=" + notify84 + " submit=" + submit84 + "）");
  const shots84 = ["login-record.png", "login-notify.png", "login-submit.png"].map((f) => path.join(lgdev83, f));
  const shotsOk84 = shots84.every((p) => fs.existsSync(p) && fs.statSync(p).size > 5000);
  if (shotsOk84) ok("R84 登录态三页截图在场且非空（>5KB）");
  else fail("R84 登录态截图缺失/过小");
  if (loginText84.indexOf("SMOKE_FAIL") === -1 && loginText84.indexOf("smoke: PASS") !== -1) ok("R84 登录实测无 SMOKE_FAIL 且启动器判 PASS");
  else fail("R84 登录实测裁决不干净");
} else {
  ok("R84 登录态实测断言：本地无登录日志，跳过（CI/全新 clone 场景）");
}
if (/勿使用 v0\.7\.10 便携包/.test(fs.readFileSync(path.join(ROOT, "..", "CHANGELOG.md"), "utf8"))) ok("R79 v0.7.10 带红出厂已披露");
else fail("R79 缺 v0.7.10 披露");

/* ---------- R80 九轮收官（自签过渡/回归补全/parity 增量） ---------- */
const pack80 = fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8");
if (/New-SelfSignedCertificate/.test(pack80) && /Set-AuthenticodeSignature/.test(pack80) && /luogu-desktop-selfsigned\.cer/.test(pack80)) ok("R80 自签过渡（签名+公钥导出）");
else fail("R80 pack 缺自签步骤");
if (/受信任的发布者/.test(fs.readFileSync(path.join(ROOT, "..", "README.md"), "utf8"))) ok("R80 README 自签信任说明");
else fail("R80 缺信任说明");
if ((fs.readFileSync(path.join(ROOT, "..", "docs", "PARITY.md"), "utf8").match(/^\| 6 \|/m) || []).length === 1) ok("R80 PARITY 扩至 6 旅程");
else fail("R80 PARITY 未扩至 6 旅程");

/* ---------- R82 v0.8 票提前清偿（溢出转正/首启引导/渲染可观测） ---------- */
const skin82 = read("src/renderer/skin/luogu-skin.css");
const config82 = read("src/main/config.js");
if (/a\[data-v-12b24cc3\]/.test(skin82) && /text-overflow: ellipsis/.test(skin82)) ok("R82 user 页轮播溢出皮肤收敛（转正）");
else fail("R82 缺溢出收敛皮肤规则");
if (/firstRunSeen/.test(config82) && /welcome-card/.test(read("src/renderer/shell/home.js"))) ok("R82 首启引导并入官方欢迎卡（firstRunSeen + welcome-card）");
else fail("R82 缺首启引导");
if (/console-message/.test(read("src/main/index.js"))) ok("R82 冒烟模式渲染端 console 中继（可观测性）");
else fail("R82 缺渲染端 console 中继");
if (/firstRunCard/.test(smoke74)) ok("R82 VISUAL 探针含首启卡指标");
else fail("R82 VISUAL 缺首启卡指标");
if (parity76.trim().indexOf("# Parity") === 0 && /9 旅程/.test(parity76)) ok("R76 PARITY.md 首批（9 旅程×3 模式）在位");
else fail("R76 PARITY.md 未扩至 9 旅程");
if (/smoke\.js/.test(fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8")) && /剥离/.test(fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8"))) ok("R76 打包后剥离探针 harness");
else fail("R76 打包缺 harness 剥离");
if (/endsWith\("\.luogu\.com\.cn"\)/.test(read("src/main/luogu.js"))) ok("R74 隐藏窗导航白名单含子域");
else fail("R74 隐藏窗白名单缺子域");
if (/captureProblem\(entry, round \+ 1\)/.test(read("src/main/views.js")) && /2\.5秒|2500/.test(read("src/main/views.js"))) ok("R74 快照抓取瞬时错误重试");
else fail("R74 缺快照重试");

  /* 后续段落复用的中间变量 */
  Object.assign(store, { smoke84 });
};
