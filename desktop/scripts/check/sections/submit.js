/* R54 提交语言正确性、R69 丝滑与清瑕（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function submit(ctx) {
  const { ok, fail, read, ROOT, path } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { ipcSource, luoguSource, shellCss } = store;
/* ---------- R54 提交语言正确性 + 列表鼠标点击 ---------- */

try {
  const { LANGS, resolveLangId } = require(path.join(ROOT, "src", "main", "langs.js"));
  const expect = {
    "C++14 (GCC 9)": 28,
    "C++14": 11,
    "C++17": 12,
    "C++20": 27,
    "C++23": 34,
    "C++11": 4,
    "C++98": 3,
    C: 2,
    "Python 3": 7,
    Pascal: 1,
    "Java 8": 8,
    "Java 21": 33,
    Rust: 15,
    Go: 14,
  };
  const bad = Object.entries(expect).filter(([name, id]) => {
    const got = resolveLangId(name);
    return !got || got.id !== id;
  });
  if (!bad.length && LANGS.length >= 20) ok(`语言表 ${LANGS.length} 项且关键映射正确（C++17→12、C++20→27、Python 3→7）`);
  else fail("语言表映射错误", JSON.stringify(bad));
  if (resolveLangId("Brainfuck") === null && resolveLangId("") === null) ok("未知语言返回 null（不允许静默回落默认语言）");
  else fail("未知语言没有返回 null");
  const o2Lang = resolveLangId("C++17");
  if (o2Lang && o2Lang.o2 === true && resolveLangId("Python 3").o2 === false) ok("O2 能力标记随语言表提供");
  else fail("语言表缺少 o2 能力标记");
} catch (err) {
  fail("langs.js 加载失败", String(err && err.message).slice(0, 120));
}

if (/resolveLangId/.test(luoguSource) && !/LANG_IDS\[lang\]\s*\|\|/.test(luoguSource)) ok("提交按语言表解析，无静默回落");
else fail("luogu.js 仍存在静默语言回落");

if (/enableO2:\s*\$\{/.test(luoguSource)) ok("enableO2 由提交参数决定（不再硬编码 0）");
else fail("enableO2 仍硬编码");
if (/enqueueSubmit\(pid, code, lang, reason, o2/.test(luoguSource)) ok("离线队列携带 O2 标记");
else fail("离线队列丢失 O2 标记");
if (/payload && payload\.o2/.test(ipcSource)) ok("app:submit 透传 O2 开关");
else fail("app:submit 未透传 O2");
const editorSource = read("src/renderer/shell/editor.js");
if (/ide-o2-box/.test(editorSource) && /O2_LANGS/.test(editorSource)) ok("编辑器提供 O2 开关并按语言置灰");
else fail("编辑器缺少 O2 开关");
if (/<option>C\+\+14 \(GCC 9\)<\/option>/.test(editorSource) && /<option>Python 3<\/option>/.test(editorSource)) ok("编辑器语言名与站内一致（含 C++14 (GCC 9)/Python 3）");
else fail("编辑器语言名与站点不一致");

const libraryClick = read("src/renderer/shell/library.js");
if (/row\.addEventListener\("click"/.test(libraryClick)) ok("列表行有鼠标点击打开处理器");
else fail("列表行仍不可鼠标点击");
if (/state\.hasMore/.test(libraryClick)) ok("列表支持 count 未知时的 hasMore 分页");
else fail("列表未接入 hasMore 分页");
if (/hasMore:\s*!countKnown && full/.test(luoguSource)) ok("记录列表在 count 未知时按整页推断 hasMore");
else fail("记录列表 total 仍写死 items.length");
if (/max-width:\s*960px/.test(shellCss) && /\.lib-page\.current/.test(shellCss) && !/\.lib-more/.test(shellCss)) {
  ok("题库按网页版阅读宽度与页码分页呈现，不再使用加载更多");
} else {
  fail("题库仍过宽或仍使用加载更多");
}
if (/aria-current/.test(libraryClick) && /lib-pages/.test(libraryClick) && /load\(state, page\)/.test(libraryClick)) {
  ok("页码按钮会替换当前页并标记 aria-current");
} else {
  fail("题库页码交互契约缺失");
}
if (/fmtExact/.test(libraryClick) && /通过率 \$\{rate\}%/.test(libraryClick) && /item\.accepted.*item\.submissions/s.test(libraryClick)) {
  ok("通过率同时显示完整通过/提交人数");
} else {
  fail("通过率未显示完整人数");
}

/* ---------- R69 丝滑与清瑕 ---------- */
const skin69 = read("src/renderer/skin/luogu-skin.css");
const skinNeedles = [
  ["原生控件 accent-color", /accent-color: var\(--lg-accent\)/],
  ["分页悬停态", /\.pagination > \*:hover:not\(\.active\)/],
  ["页码条悬停态", /\.page-bar button:hover/],
  ["筛选 chip 悬停态", /\.filter-section \.tag-button:hover/],
  ["筛选 chip 选中态", /\.tag-select-area \.selected/],
  ["表格行过渡", /#app tbody tr \{\s*transition: background-color/],
  ["链接过渡", /#app a \{[\s\S]*?transition: color/],
  ["按钮过渡含 color", /box-shadow var\(--lg-dur, 120ms\) var\(--lg-ease, ease\),\s*color var\(--lg-dur, 120ms\) var\(--lg-ease, ease\)/],
  ["主按钮悬停用 token", /--lg-accent-hover/],
  ["引用条用 accent-line", /border-left: 2px solid var\(--lg-accent-line/],
  ["代码高亮跟应用主题", /html\[data-lg-mode="dark"\] #app \.token\.comment/],
  ["不再跟随系统主题( Prism )", /^(?!.*@media \(prefers-color-scheme\))[\s\S]*$/],
  ["讨论回复头清色", /\.comment \.author,\s*#app \.reply-item \.author/],
  ["富文本编辑器主题化", /\.casket,\s*#app \.cs-main/],
  ["编辑器行号槽主题化", /\.casket \.cm-gutters/],
  ["悬浮回复按钮主题化", /\.btn-float-container \.btn-float-open/],
  ["题库标签列清带(0.7.2 起亮暗通用)", /^#app col \{[^}]*background: transparent/m],
  ["旧版错误页清底(0.7.2 起亮暗通用)", /^#app main\.wrapped\.lfe-body\.mobile-body \{/m],
  ["旧版提示卡文字色", /#app \.card\.message,/],
];
for (const [name, re] of skinNeedles) {
  if (re.test(skin69)) ok("皮肤 R69 " + name);
  else fail("皮肤缺少 R69 " + name);
}
const modePreload = read("src/preload/page.js");
const modeViews = read("src/main/views.js");
if (
  /--lg-boot-mode=/.test(modeViews) &&
  /--lg-boot-accent=/.test(modeViews) &&
  /dataset\.lgMode/.test(modePreload) &&
  /dataset\.lgMode/.test(modeViews) &&
  /--lg-boot-accent=/.test(modePreload) &&
  /--lg-accent-hover/.test(modeViews) &&
  /--lg-accent-line/.test(modeViews) &&
  /--lg-gutter-top:\d*\dpx/.test(modeViews)
) {
  ok("data-lg-mode 与 accent-hover/line 三处同步(views+preload)");
} else {
  fail("data-lg-mode/accent token 管线不齐");
}

const shell69 = read("src/renderer/shell/shell.css");
const shellNeedles = [
  ["遮罩过渡", /#scrim \{[\s\S]*?transition: opacity/],
  ["浮层退场动画", /#overlay\.closing \.overlay-card/],
  ["退场关键帧", /@keyframes lg-pop-out/],
  ["壁纸淡入开关", /body\.wall-fade \.wall-layer/],
  ["面板行选中过渡", /\.pal-row \{[\s\S]*?transition:/],
  ["内容区滚动槽稳定", /scrollbar-gutter: stable/],
  ["IDE 面板进场", /#ide-pane \{[\s\S]*?animation: lg-fade-in/],
  ["侧栏链接滚动可见", /#rail-top::-webkit-scrollbar \{\s*width: 6px/],
  ["按压反馈", /\.q-row:active/],
  ["模糊档位 token", /blur\(var\(--blur-lg\)\)/],
];
for (const [name, re] of shellNeedles) {
  if (re.test(shell69)) ok("外壳 R69 " + name);
  else fail("外壳缺少 R69 " + name);
}
const fatalSrc = read("src/renderer/shared/fatal.js");
const shellJs = read("src/renderer/shell/shell.js");
const settingsJs = read("src/renderer/settings/settings.js");
if (/export function fatal/.test(fatalSrc) && /fatal\("外壳初始化失败"/.test(shellJs) && /fatal\("设置初始化失败"/.test(settingsJs)) {
  ok("错误屏主题化(壳+设置共用 fatal 卡)");
} else {
  fail("错误屏仍是裸文本");
}
if (/\.add\("removing"\);[\s\S]*?setTimeout\(\(\) => old\.remove/.test(shellJs)) {
  ok("toast 溢出先淡出再移除");
} else {
  fail("toast 溢出仍直接删除");
}
const tokens69 = read("src/renderer/shared/tokens.css");
if (/--blur-lg:/.test(tokens69) && /--blur-sm:/.test(tokens69) && /--focus-w:/.test(tokens69)) {
  ok("tokens 增加 blur/focus 档位");
} else {
  fail("tokens 缺少 blur/focus 档位");
}
};
