/* 危险默认值、导航契约、0.2.0 产品关键约束（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function product(ctx) {
  const { ok, fail, read, ROOT, fs, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { ipcSource } = store;
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
if (/safeOpenExternal\(/.test(viewsSource) || /openExternal\(url\)/.test(viewsSource)) ok("站外链接交给系统浏览器");
else fail("views.js 没有站外链接出口");

/* R57 导航契约 */
if (/reopenClosed/.test(viewsSource) && /closedStack/.test(viewsSource) && /canReopen/.test(viewsSource)) ok("最近关闭栈与恢复入口存在");
else fail("views.js 缺少最近关闭恢复");
if (viewsSource.split("this.returnLib = this.library").length >= 3) ok("题目/详情/个人页都会记住来源列表");
else fail("部分入口没有设置 returnLib");
if (/"t"\) command = "reopen"/.test(viewsSource)) ok("Ctrl+Shift+T 恢复关闭页面");
else fail("缺少 Ctrl+Shift+T 恢复快捷键");
const openLoginBody = viewsSource.split("openLogin()")[1] || "";
if (/auth\/login"\)\.catch/.test(openLoginBody)) ok("登录页复用时按需重载");
else fail("openLogin 缺少重载逻辑");
if (/canReopen,/.test(viewsSource)) ok("页面状态带 canReopen（工具条按钮可置灰）");
else fail("currentInfo 缺少 canReopen");
if (/"reopen"\) ctx\.views\.reopenClosed\(\)/.test(ipcSource)) ok("app:viewAction 支持恢复关闭页面");
else fail("ipc.js 未接入 reopen 动作");
if (/iconButton\("reopen"/.test(read("src/renderer/shell/chrome.js"))) ok("工具条有恢复关闭页面按钮");
else fail("工具条缺少恢复按钮");

/* 7. 产品关键约束（0.2.0） */
const passkeySource = read("src/main/passkey-guard.js");
if (/__lgPasskeyGuard/.test(passkeySource) && /options\.publicKey/.test(passkeySource) && /credentials\.get/.test(passkeySource)) {
  ok("通行密钥守卫存在且完全阻止系统凭据弹窗");
} else {
  fail("通行密钥守卫不完整");
}
if (
  /attachPasskeyGuard/.test(viewsSource) &&
  /addScriptToEvaluateOnNewDocument/.test(passkeySource) &&
  /runImmediately/.test(passkeySource) &&
  /attachToWebContents/.test(passkeySource)
) {
  ok("守卫在主世界文档创建前注入所有页面视图");
} else {
  fail("页面视图没有主世界守卫注入");
}
if (/uid > 0/.test(luoguSource)) ok("登录态要求真实 uid（游客 _uid=0 不算登录）");
else fail("登录态可能把游客误判为已登录");

const ocrSource = read("src/main/ocr.js");
if (/ddddocr/.test(ocrSource) && /recognize/.test(ocrSource) && /timeout/.test(ocrSource)) {
  ok("验证码自动识别模块存在且有超时保护");
} else {
  fail("ocr.js 缺少 ddddocr/recognize/超时保护");
}
if (/captchaOcr/.test(luoguSource) && /fetchCaptchaPng/.test(luoguSource) && /captchaRequired/.test(luoguSource)) {
  ok("提交验证码自动识别重试已接入产品路径");
} else {
  fail("luogu.js 缺少提交验证码自动识别链路");
}
if (/interactive/.test(luoguSource) && /YIDUN|易盾/.test(luoguSource)) {
  ok("易盾交互式挑战不自动破解，交给页面内辅助");
} else {
  fail("luogu.js 缺少交互式挑战识别");
}
const viewsSource2 = read("src/main/views.js");
if (/openSubmitAssist/.test(viewsSource2) && /insertText/.test(viewsSource2)) {
  ok("页面内提交辅助（打开提交区并填代码）存在");
} else {
  fail("views.js 缺少页面内提交辅助");
}

const sectionsSource = read("src/main/sections.js");
if (!/class: \{ label: "课程"/.test(sectionsSource) && /article: \{ label: "文章"/.test(sectionsSource)) {
  ok("侧栏已移除课程并保留文章");
} else {
  fail("sections.js 仍包含课程板块");
}
if (/resolveRail/.test(sectionsSource) && /custom/.test(sectionsSource)) ok("侧栏支持排序/显隐/自定义");
else fail("sections.js 缺少侧栏定制模型");

const themeSource = read("src/main/theme.js");
if (/accentFill/.test(themeSource) && /onAccent/.test(themeSource)) ok("强调色实心按钮有对比度令牌");
else fail("theme.js 缺少 accentFill/onAccent");
if (
  /const tint = \(base, amount\) => mixHex\(colors\.accent, base, amount\)/.test(themeSource) &&
  /colors\.bg = tint\(neutral\.bg/.test(themeSource) &&
  /colors\.rail = tint\(neutral\.rail/.test(themeSource) &&
  /colors\.surface = tint\(neutral\.surface/.test(themeSource) &&
  /colors\.glassTint = colors\.accent/.test(themeSource) &&
  /--lg-glass-tint/.test(viewsSource)
) {
  ok("自定义主题色统一给外壳/设置/页面玻璃着色");
} else {
  fail("自定义主题色只改变强调元素，未覆盖全部玻璃承载面");
}

for (const [name, content, needle] of [
  ["壁纸来源", configSource, /wallpaperInterval/],
  ["文件夹轮换", configSource, /wallpaperDir/],
  ["Wallpaper Engine", configSource, /weRoot/],
]) {
  if (needle.test(content)) ok(name + "配置存在");
  else fail(name + "配置缺失");
}

const shellHtml = read("src/renderer/shell/index.html");
if (/id="tb-jump"/.test(shellHtml) && !/rail-jump-input/.test(shellHtml) && /id="library"/.test(shellHtml)) {
  ok("外壳包含题号跳转按钮与原生列表容器");
} else {
  fail("外壳缺少题号跳转按钮或仍保留侧栏内联输入框");
}
const settingsHtml = read("src/renderer/settings/index.html");
if (/data-sec="wallpaper"/.test(settingsHtml) && /data-sec="rail"/.test(settingsHtml) && /id="wp-we-list"/.test(settingsHtml)) {
  ok("设置包含壁纸与侧边栏分区");
} else {
  fail("设置缺少壁纸/侧边栏分区");
}
if (/id="accent-custom"/.test(settingsHtml) && /id="accent-value"/.test(settingsHtml) && /自定义主题色/.test(settingsHtml)) {
  ok("设置提供可发现的自定义主题色入口与当前值反馈");
} else {
  fail("设置缺少自定义主题色入口或值反馈");
}
const taskbarSource = read("src/main/taskbar.js");
const mainWindowSource = read("src/main/window.js");
if (
  /app\.setAppUserModelId/.test(read("src/main/index.js")) &&
  /CreateShortcut/.test(taskbarSource) &&
  /SHGetPropertyStoreFromParsingName/.test(taskbarSource) &&
  /taskbarpin/.test(taskbarSource) &&
  /app:taskbarPin/.test(ipcSource) &&
  /pinTaskbar: \(\) => ipcRenderer\.invoke\("app:taskbarPin"\)/.test(read("src/preload/settings.js")) &&
  /id="taskbar-pin"/.test(settingsHtml) &&
  /ctx\.pinTaskbar/.test(read("src/main/tray.js"))
) {
  ok("Windows 任务栏固定入口贯通设置页/托盘/主进程快捷方式");
} else {
  fail("Windows 任务栏固定链路不完整");
}
if (
  /setAppDetails\(\{/.test(mainWindowSource) &&
  /appIconPath/.test(mainWindowSource) &&
  /relaunchCommand/.test(mainWindowSource) &&
  /color: "#00000000"/.test(mainWindowSource)
) {
  ok("窗口任务栏身份同步且原生标题栏按钮覆盖层透明");
} else {
  fail("窗口任务栏身份或透明标题栏覆盖层契约失败");
}

const designFile = path.join(ROOT, "..", "design.md");
if (fs.existsSync(designFile) && fs.statSync(designFile).size > 6000) ok("design.md 存在且有实质内容");
else fail("design.md 缺失或过短");

  /* 后续段落复用的中间变量 */
  Object.assign(store, { configSource, luoguSource, sectionsSource, settingsHtml, shellHtml, themeSource, viewsSource });
};
