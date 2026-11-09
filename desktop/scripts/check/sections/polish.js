/* R70-R79 布局、加固、证据、剥离清单（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function polish(ctx) {
  const { ok, fail, read, walk, ROOT, fs, path, scriptsDir } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { ipcSource } = store;
/* ---------- R70 同层透出 · 主页融合 · 单侧栏布局 ---------- */
const views70 = read("src/main/views.js");
const skin70 = read("src/renderer/skin/luogu-skin.css");
const shellCss70 = read("src/renderer/shell/shell.css");
const shellHtml70 = read("src/renderer/shell/index.html");
const luogu70 = read("src/main/luogu.js");
const homeJs70 = read("src/renderer/shell/home.js");
const shellJs70 = read("src/renderer/shell/shell.js");

for (const [name, re, src] of [
  ["官方主页抓取管线", /async fetchOfficialHome\(\)/, luogu70],
  ["比赛日历数据", /buildContests\(contests\)/, luogu70],
  ["refresh 容错挂载", /next\.official = await this\.fetchOfficialHome\(\)/, luogu70],
  ["官方问候/运势紧凑头", /function buildDailyHeader\(home/, homeJs70],
  ["比赛日历行", /"cal-row"/, homeJs70],
  ["顶部官方倒计时", /"home-countdown"/, homeJs70],
  ["主页问候", /"home-greeting"/, homeJs70],
  ["旧问候卡已移除", /^(?!.*function buildWelcome\(home)/s, homeJs70],
  ["homeKey 含官方块", /home\.official\s*\?/, shellJs70],
]) {
  if (re.test(src)) ok("R70 " + name);
  else fail("R70 缺少 " + name);
}
if (
  /fortuneResult/.test(luogu70) &&
  /fortuneGood/.test(luogu70) &&
  /fortuneBad/.test(luogu70) &&
  !/fortune:\s*punch\s*\?\s*text\(punch\)/.test(luogu70) &&
  /normalizeFortune/.test(homeJs70)
) {
  ok("官方问候只接受结构化昵称/运势，不再回填整块打卡文本");
} else {
  fail("官方问候仍可能把日期/倒计时误当运势");
}
if (!/rail-mark/.test(shellHtml70)) ok("R70 侧栏 luogu 标志已删");
else fail("R70 rail-mark 仍有残留");
if (!/lg-card-alpha/.test(skin70) && /lg-raise/.test(skin70) && /lg-code-alpha/.test(skin70)) ok("R70 皮肤孤岛收编为 raise/code 档位");
else fail("R70 皮肤仍有 --lg-card-alpha 或缺 raise/code");
if (!/cardAlpha <= 30/.test(views70) && /--lg-raise:\$\{t\.raiseAlpha\}%/.test(views70)) ok("R70 skinVars 发射 raise/code 档位");
else fail("R70 skinVars 未接入新档位");
for (const [name, re] of [
  ["轨道宽统一变量", /grid-template-columns: var\(--rail-current-w/],
  ["顶部导航独立滚动", /#rail-top \{[\s\S]*?overflow-y: auto;/],
]) {
  if (re.test(shellCss70)) ok("R70 外壳 " + name);
  else fail("R70 外壳缺少 " + name);
}
if (!/transition:\s*grid-template-columns/.test(shellCss70)) ok("R70 外壳宽度无独立 CSS 补间");
else fail("R70 外壳仍有独立 CSS 宽度补间");
if (!/\.rail-overlay/.test(shellCss70)) ok("R70 旧侧栏浮层选择器已移除");
else fail("R70 旧侧栏浮层选择器仍有残留");
if (!/92%, transparent/.test(skin70) && !/95%, transparent/.test(skin70) && !/84%, transparent/.test(skin70)) ok("R70 皮肤孤岛百分比清零");
else fail("R70 皮肤仍有写死百分比孤岛");

/* ---------- R71 生产加固（agent-skills 教义落地） ---------- */
const external71 = read("src/main/external.js");
const idx71 = read("src/main/index.js");
const win71 = read("src/main/window.js");
if (/function safeOpenExternal/.test(external71) && /u\.protocol === "https:" \|\| u\.protocol === "http:"/.test(external71)) ok("R71 安全出口模块+协议白名单");
else fail("R71 external.js 缺 safeOpenExternal 或协议白名单");
if (/require\("\.\.?\/external"\)/.test(views70) && /require\("\.\.?\/external"\)/.test(win71)) ok("R71 views/window 已接入安全出口");
else fail("R71 views/window 未接入 safeOpenExternal");
if (!/shell\.openExternal/.test(views70) && !/shell\.openExternal/.test(win71)) ok("R71 shell.openExternal 全仓唯一出口（external.js）");
else fail("R71 仍有裸 shell.openExternal 残留");
if ((views70.match(/safeOpenExternal\(/g) || []).length >= 6) ok("R71 views 六处外开调用点全收口");
else fail("R71 views.js safeOpenExternal 调用点不足 6 处");
if (/persistCrash/.test(idx71) && /crash\.log/.test(idx71) && /uncaughtException/.test(idx71)) ok("R71 崩溃落盘 crash.log");
else fail("R71 index.js 缺崩溃落盘");

/* ---------- R72 评审团整改（sandbox/导航防护/离线CSP/查找缩放/便携包） ---------- */
const win72 = read("src/main/window.js");
const idx72 = read("src/main/index.js");
const page72 = read("src/preload/page.js");
if (!/sandbox: false/.test(win72) && !/sandbox: false/.test(views70) && /sandbox: true/.test(win72)) ok("R72 全部渲染宿主 sandbox:true");
else fail("R72 仍有 sandbox:false 渲染宿主");
if ((win72.match(/will-navigate/g) || []).length >= 2 && (win72.match(/setWindowOpenHandler/g) || []).length >= 2 && (win72.match(/will-attach-webview/g) || []).length >= 2) ok("R72 主壳/设置窗导航防护（will-navigate/open/attach×2）");
else fail("R72 主壳/设置窗缺导航防护");
if (/Content-Security-Policy/.test(idx72) && /name\.startsWith\("on"\)/.test(views70)) ok("R72 离线页 CSP + 快照 on* 剥离");
else fail("R72 离线页缺 CSP 或快照未剥 on*");
if (/__lgReloadCount/.test(views70) && (views70.match(/__lgReloadCount/g) || []).length >= 2) ok("R72 渲染崩溃重载上限");
else fail("R72 缺渲染崩溃重载上限");
if (/"app:find"/.test(ipcSource) && /app:find-open/.test(page72) && /app:find-result/.test(page72) && /app:zoom-hud/.test(page72) && /findInPage/.test(ipcSource)) ok("R72 页内查找/缩放 HUD（IPC 对齐由第 5 节保证）");
else fail("R72 查找/缩放通道缺失");
if (/clipboard-sanitized-write/.test(idx72) && /basename\(item\.getFilename/.test(idx72)) ok("R72 剪贴板豁免 + 下载文件名收敛");
else fail("R72 缺剪贴板豁免或下载文件名收敛");
if (/内部错误/.test(idx72)) ok("R72 崩溃时用户可见提示");
else fail("R72 缺崩溃用户提示");
if (fs.existsSync(path.join(ROOT, "..", "LICENSE"))) ok("R72 LICENSE 文件在位");
else fail("R72 缺 LICENSE");
if (fs.existsSync(path.join(scriptsDir, "pack-portable.ps1"))) ok("R72 便携包脚本在位");
else fail("R72 缺 scripts/pack-portable.ps1");

/* ---------- R74 三轮评审整改（口径/白名单/文档一致性） ---------- */
const readmeFront = fs.readFileSync(path.join(ROOT, "..", "README.md"), "utf8");
const smoke74 = read("src/main/smoke.js");
if (readmeFront.indexOf("为 Windows 打造的洛谷客户端，v" + (JSON.parse(read("package.json")).version) + "。") !== -1) ok("R74 README 门面版本与 package.json 同步");
else fail("R74 README 门面版本未同步");
if (/overAllowedItems/.test(smoke74) && /div\.right/.test(smoke74)) ok("R74 审计 over 显式白名单（锚定 parent，明细落盘）");
else fail("R74 缺 over 白名单");
if (/wc\.on\("will-navigate"/.test(read("src/main/views.js")) && /wc\.setWindowOpenHandler/.test(read("src/main/views.js"))) ok("R74 单页面宿主导航防护（will-navigate + window-open）");
else fail("R74 页面宿主缺导航防护");
if (idx72.indexOf(String.raw`luogu\.com\.cn(:\d+)?(\/|$)`) !== -1) ok("R74 请求 handler 洛谷源正则尾边界");
else fail("R74 缺正则尾边界");

/* ---------- R76 量化路径兑现（AT 题号/行为探针/parity 首批/harness 剥离） ---------- */
const sections76 = read("src/main/sections.js");
const overlays76 = read("src/renderer/shell/overlays.js");
const page76x = read("src/preload/page.js");
const parity76 = fs.readFileSync(path.join(ROOT, "..", "docs", "PARITY.md"), "utf8");
if (/function canonicalPid/.test(sections76) && /AT_/.test(sections76) && /toLowerCase/.test(sections76)) ok("R76 canonicalPid 单源（AT_ 小写规范形）");
else fail("R76 缺 canonicalPid 单源");
if (/canonicalPid/.test(views70) && /canonicalPid/.test(ipcSource) && (views70.match(/canonicalPid/g) || []).length >= 3) ok("R76 views/ipc 接入 canonicalPid（openProblem/palette/submit/草稿）");
else fail("R76 views/ipc 未接入 canonicalPid");
if (page76x.indexOf(String.raw`[A-Za-z0-9_]*\d[A-Za-z0-9_]*`) !== -1 && /normalizeProblemInput/.test(overlays76)) ok("R76 题号入口正则接受下划线题号（页面转交 + 全局面板）");
else fail("R76 题号入口正则未更新");
if (/LG_SMOKE_FIND === "1"/.test(smoke74) && /SMOKE_FIND /.test(smoke74)) ok("R76 FIND 行为探针（Ctrl+F/缩放 HUD/Esc 真实键鼠链）");
else fail("R76 缺 FIND 行为探针");
if (/atOk/.test(smoke74)) ok("R76 PALETTE 探针含 AT_ 规范化断言");
else fail("R76 PALETTE 探针缺 AT 断言");

/* ---------- R77 六轮评审整改（裁决洞 #2/SEC 探针/GATE 三元/证据纪律） ---------- */
const idx77 = read("src/main/index.js");
if (/guardIpcMain/.test(read("src/main/ipc.js")) && /SMOKE_FAIL ipc:/.test(read("src/main/smoke-guard.js"))) ok("R77 ipc handler 冒烟守卫（裁决洞 #2，smoke-guard 纯模块）");
else fail("R77 缺 ipc handler 冒烟守卫");
if (/LG_SMOKE_SEC === "1"/.test(smoke74) && /SMOKE_SEC /.test(smoke74) && /lg-sec:\/\/probe/.test(smoke74)) ok("R77 SEC 安全行为探针");
else fail("R77 缺 SEC 探针");
if (/gated: auditGated/.test(smoke74) && /checked: auditChecked\.length/.test(smoke74)) ok("R77 GATE 三元计数（checked/gated/bad）");
else fail("R77 GATE 仍为二元");
if (/fails/.test(fs.readFileSync(path.join(scriptsDir, "smoke.js"), "utf8")) && /failLog/.test(fs.readFileSync(path.join(scriptsDir, "smoke.js"), "utf8"))) ok("R77 失败证据时间戳归档");
else fail("R77 缺失败归档");
if (/LGR-\|月赛/.test(smoke74)) ok("R77 over 白名单双锚");
else fail("R77 白名单仍单锚");
if (/harness not available/.test(idx77)) ok("R77 剥离后 LG_DEMO/--smoke 路径守卫");
else fail("R77 缺剥离后守卫");

/* ---------- R78 七轮评审整改（守卫单测/SEC 五宿主/pack 行为门禁/判源修复） ---------- */
const guard78 = require(path.join(ROOT, "src", "main", "smoke-guard.js"));
if (typeof guard78.guardIpcMain === "function") ok("R78 smoke-guard 纯模块在位");
else fail("R78 smoke-guard 缺导出");
{
  let guardHit = false;
  const origErr = console.error;
  console.error = (...args) => {
    if (String(args[0] || "").indexOf("SMOKE_FAIL ipc:") === 0) guardHit = true;
  };
  const reg = [];
  const fake = { handle: (c, f) => reg.push(f), on: (c, f) => reg.push(f) };
  guard78.guardIpcMain(fake, true);
  fake.handle("app:unit", () => {
    throw new TypeError("unit-boom"); // 同步抛：守卫的 console.error 在调用方同步段执行
  });
  reg[0]({}).catch(() => {});
  console.error = origErr;
  const regOff = [];
  const rawFn = () => {
    throw new TypeError("raw-boom");
  };
  const fakeOff = { handle: (c, f) => regOff.push(f), on: (c, f) => regOff.push(f) };
  const before = fakeOff.handle;
  guard78.guardIpcMain(fakeOff, false);
  fakeOff.handle("app:raw", rawFn);
  const passthrough = fakeOff.handle === before && regOff[0] === rawFn;
  if (guardHit && passthrough) ok("R78 守卫单测：异常打 SMOKE_FAIL 且禁用态直通");
  else fail("R78 守卫单测未过（guardHit=" + guardHit + " passthrough=" + passthrough + "）");
}
if (smoke74.indexOf(String.raw`sec.settingsOpen === true;`) !== -1 && smoke74.indexOf(String.raw`ctx.openSettings();`) !== -1 && smoke74.indexOf(String.raw`settingsWin.close();`) !== -1) ok("R78 SEC 五宿主覆盖（settings 开-测-关）");
else fail("R78 SEC 缺 settings 腿");
const pack78 = fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8");
if (/LG_SMOKE_SEC = "1"/.test(pack78) && /LG_SMOKE_FIND = "1"/.test(pack78)) ok("R78 出包门禁携带行为探针（SEC/FIND）");
else fail("R78 出包门禁缺行为探针 env");
if (/requestingUrl/.test(idx77)) ok("R78 fullscreen 判源 frame 粒度（requestingUrl）");
else fail("R78 fullscreen 判源未修");
if (/ipcMain.on = \(channel, fn\)/.test(fs.readFileSync(path.join(ROOT, "src", "main", "smoke-guard.js"), "utf8"))) ok("R78 on 型通道入守卫");
else fail("R78 on 型通道未入守卫");

/* ---------- R79 八轮评审整改（出包裁决洞 #3/SEC 环境感知/剥离清单） ---------- */
const pack79 = fs.readFileSync(path.join(scriptsDir, "pack-portable.ps1"), "utf8");
if (/node /.test(pack79) && /smoke\.js/.test(pack79) && /LASTEXITCODE/.test(pack79)) ok("R79 出包冒烟走真裁决启动器（exit code 算数）");
else fail("R79 出包门禁仍绕过启动器");
if (/smoke-guard\.js/.test(pack79)) ok("R79 剥离清单含 smoke-guard.js");
else fail("R79 剥离清单缺 guard 模块");
/* 剥离清单 × 顶层 require：出包会删掉清单内的文件，任何裸顶层 require 都会让整包
   启动即 Error 弹窗（v0.7.15 便携包因 ipc.js require("./smoke-guard") 无法启动，
   而打包冒烟只跑 desktop/ 开发态，漏掉了这一层）。 */
const stripNames = [];
for (const line of pack79.split("\n")) {
  if (!/Remove-Item/.test(line) || /Test-Path/.test(line)) continue;
  const m = line.match(/"src\\main\\([\w-]+)\.js"/);
  if (m && !stripNames.includes(m[1])) stripNames.push(m[1]);
}
if (stripNames.length) ok("R94 剥离清单可解析（" + stripNames.join(" / ") + "）");
else fail("R94 无法从 pack-portable.ps1 解析剥离清单");
const bareStripRequires = [];
for (const file of walk(path.join(ROOT, "src"), [])) {
  if (!/\.js$/.test(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const name of stripNames) {
    const re = new RegExp("require\\([\"']\\./" + name + "[\"']\\)");
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      const safe = /try\s*\{/.test(near) || /=>\s*require\(/.test(line);
      if (!safe) bareStripRequires.push(path.relative(ROOT, file) + ":" + (i + 1) + ' require("./' + name + '")');
    });
  }
}
if (!bareStripRequires.length) ok("R94 剥离清单内模块无顶层裸 require（出包不会因缺模块崩启动）");
else fail("R94 剥离清单内模块被顶层裸 require：" + bareStripRequires.join("；"));
if (/BOOT-OK/.test(pack79) && /LG_USERDATA/.test(pack79)) ok("R94 出包对暂存产物做隔离启动自检（BOOT-OK）");
else fail("R94 出包缺少针对暂存产物的启动自检");

  /* 后续段落复用的中间变量 */
  Object.assign(store, { idx72, parity76, smoke74, views70 });
};
