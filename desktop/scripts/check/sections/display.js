/* R59 显示修复、R64 题库筛选、皮肤几何（R96 从 scripts/check.js 拆出，断言与文案原样保留）。 */
module.exports = function display(ctx) {
  const { ok, fail, read } = ctx;
  const store = ctx.store;
  /* 前序段落留下的共享中间变量 */
  const { homeSrc2, indexSrc, viewsSource } = store;
/* R59 显示修复 */
if (/actions\.openDetail\(\{ url: "\/contest\/" \+ contest\.id/.test(homeSrc2)) ok("主页比赛卡点击进比赛本身（而非列表）");
else fail("主页比赛卡仍跳比赛列表");
if (/openDetail: \(payload\) => window\.lg\.openDetail\(payload\)/.test(read("src/renderer/shell/shell.js"))) ok("主页动作具备 openDetail 通道");
else fail("homeActions 缺少 openDetail");

const librarySrc = read("src/renderer/shell/library.js");
for (const [name, needle] of [
  ["骨架屏", /skeletonRows/],
  ["错误保留旧数据", /lib-banner/],
  ["列表键盘导航", /aria-activedescendant/],
  ["roving 选中", /setActive\(/],
]) {
  if (needle.test(librarySrc)) ok("library.js " + name);
  else fail("library.js 缺少" + name);
}

/* R64 题库筛选对齐网页版 + 侧栏分组 */
const luoguFilterSrc = read("src/main/luogu.js");
const ipcFilterSrc = read("src/main/ipc.js");
const shellPreloadFilterSrc = read("src/preload/shell.js");
for (const [name, needle] of [
  ["标签目录公开端点", /_lfe\/tags/],
  ["标签目录缓存", /libtags/],
  ["标签分组编码", /function tagQuery/],
  ["题库类型白名单", /PROBLEM_TYPES/],
  ["题库 type 参数", /params\.set\("type"/],
  ["标签 tag 参数", /params\.set\("tag"/],
  ["题面搜索参数", /params\.set\("content"/],
]) {
  if (needle.test(luoguFilterSrc)) ok("luogu.js " + name);
  else fail("luogu.js 缺少" + name);
}
if (/app:libraryTags/.test(ipcFilterSrc) && /libraryTags: \(\) => ipcRenderer\.invoke\("app:libraryTags"\)/.test(shellPreloadFilterSrc)) {
  ok("标签目录桥三处同步（handler + preload）");
} else {
  fail("标签目录桥未三处同步");
}
for (const [name, needle] of [
  ["难度范围下拉", /lib-diff-menu/],
  ["难度区间编码", /function encodeDifficulty/],
  ["连续区间选择", /right <= left/],
  ["所属题库分组", /所属题库/],
  ["筛选条件分组", /筛选条件/],
  ["标签草稿多选", /state\.tagDraft\.add/],
  ["标签分类编码", /selectedTagGroups/],
  ["搜索结果跨分类", /catalog\.tags\.filter/],
  ["标签弹窗文案", /已选标签（/],
  ["清除筛选", /清除筛选/],
]) {
  if (needle.test(librarySrc)) ok("library.js " + name);
  else fail("library.js 缺少" + name);
}
if (/lib-diff-menu/.test(read("src/renderer/shell/shell.css"))) ok("题库难度下拉有样式");
else fail("题库难度下拉缺少样式");
const chromeRailSrc = read("src/renderer/shell/chrome.js");
if (
  /rail-group/.test(chromeRailSrc) &&
  /rail-group-label/.test(chromeRailSrc) &&
  /\.rail-group/.test(read("src/renderer/shell/shell.css")) &&
  /#rail-bottom \{[\s\S]*?flex: 0 0 auto;/.test(read("src/renderer/shell/shell.css")) &&
  /#rail-top \{[\s\S]*?overflow-y: auto;/.test(read("src/renderer/shell/shell.css"))
) {
  ok("侧栏分组标签与固定底部工具区");
} else {
  fail("侧栏分组/固定底部工具区契约缺失");
}
if (
  !/id="rail-user"/.test(read("src/renderer/shell/index.html")) &&
  /id="tb-avatar"/.test(read("src/renderer/shell/index.html")) &&
  /avatar\.addEventListener\("click", \(\) => actions\.profile\(\)\)/.test(chromeRailSrc)
) {
  ok("账户入口仅保留标题栏头像");
} else {
  fail("侧栏仍重复账户卡或标题栏头像入口缺失");
}
if (
  /tb-avatar-fallback/.test(read("src/renderer/shell/index.html") + chromeRailSrc + read("src/renderer/shell/shell.css")) &&
  /avatar\.classList\.add\("has-avatar-image"\)/.test(chromeRailSrc) &&
  /image\.addEventListener\("error"/.test(chromeRailSrc)
) {
  ok("标题栏头像有常驻字母底层与图片失败回退");
} else {
  fail("标题栏头像仍可能因图片加载失败而消失");
}
if (
  /id="rail-pin"/.test(read("src/renderer/shell/index.html")) &&
  /id="tb-jump"/.test(read("src/renderer/shell/index.html")) &&
  /\.rail-pin\.on/.test(read("src/renderer/shell/shell.css")) &&
  /\.tb-action \{/.test(read("src/renderer/shell/shell.css"))
) {
  ok("固定按钮和题号跳转入口始终存在");
} else {
  fail("固定按钮或题号跳转入口缺失");
}


if (/"r"\)\) command = "reload"/.test(viewsSource) && /"closepage"/.test(viewsSource) && /"ArrowLeft"\) command = "back"/.test(viewsSource)) ok("页面内 F5/Ctrl+R/Alt+方向键/Ctrl+W 浏览器基本键齐全");
else fail("views.js 缺少浏览器基本键绑定");
if (/closePage\(\)/.test(viewsSource) && /wc\.on\("context-menu"/.test(viewsSource)) ok("Ctrl+W 关页面（进最近关闭栈）+ 页面右键菜单存在");
else fail("缺少 closePage 或页面右键菜单");
if (/name === "closepage"/.test(indexSrc)) ok("主进程命令路由支持 closepage/back/forward/reload");
else fail("index.js 命令路由缺 closepage");
if (/quiet: true/.test(librarySrc) && /loadedAt/.test(librarySrc)) ok("列表回访超 3 分钟后台刷新且不重置滚动");
else fail("列表回访刷新缺失");

const editorSrc2 = read("src/renderer/shell/editor.js");
if (/ide-gutter/.test(editorSrc2) && /updateGutter/.test(editorSrc2) && /setIdeSplit/.test(editorSrc2)) {
  ok("IDE 行号槽 + 可拖拽分栏 + 状态栏");
} else {
  fail("IDE 缺少行号/分栏/状态栏");
}

const overlaysSrc = read("src/renderer/shell/overlays.js");
if (/updatePaletteSelection/.test(overlaysSrc) && /scrollIntoView/.test(overlaysSrc) && /aria-activedescendant/.test(overlaysSrc)) {
  ok("命令面板选择不重建 DOM 且自动滚入视野");
} else {
  fail("命令面板仍会在 hover 时重建/丢滚动");
}

const skinSrc = read("src/renderer/skin/luogu-skin.css");
for (const [name, needle] of [
  ["阅读正文", /\.lfe-marked/],
  ["真实按钮类", /\[class\*="l-button"\]/],
  ["表格组件", /\.cute-table/],
  ["编辑器", /\.cm-editor/],
  ["用户页头", /\.user-header-top/],
  ["阅读行高", /line-height: 1\.8/],
  ["2px 焦点环", /outline: var\(--lg-focus-w, 2px\) solid var\(--lg-accent\)/],
]) {
  if (needle.test(skinSrc)) ok("luogu-skin.css " + name);
  else fail("luogu-skin.css 缺少" + name);
}

/* R64：皮肤不能再改写官方主容器的宽度/外边距，也不能给官方按钮塞死高度 */
if (
  /#app > \.main-container \{[\s\S]*?padding-top: var\(--lg-gutter-top/.test(skinSrc) &&
  !/#app > \.main-container \{[\s\S]*?margin: 0 auto/.test(skinSrc) &&
  !/#app > \.main-container \{[\s\S]*?width: calc/.test(skinSrc)
) {
  ok("皮肤只补顶部空隙，不改写官方主容器几何");
} else {
  fail("皮肤仍在改写官方主容器宽度/外边距（右侧裁切/空白根因）");
}
if (/a\.l-button[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/.test(skinSrc)) {
  ok("链接型官方按钮用 inline-flex 真正居中");
} else {
  fail("官方按钮缺少 flex 居中（文字偏上根因）");
}
if (!/line-height: 20px/.test(skinSrc) && !/min-height: 32px/.test(skinSrc)) {
  ok("皮肤不再给官方按钮/输入框塞死行高与最小高度");
} else {
  fail("皮肤仍给官方控件塞死行高/最小高度（莫名空白根因）");
}
for (const selector of [".side", ".lfe-side", ".list", ".lfe-list", ".box", ".panel", ".comment"]) {
  const cardBlock = skinSrc.match(/#app \.l-card,[\s\S]*?\{/);
  if (!cardBlock || cardBlock[0].indexOf(selector) === -1) {
    ok("卡片选择器已排除布局容器 " + selector);
  } else {
    fail("卡片选择器仍包含布局容器 " + selector + "（大片空白根因）");
  }
}

/* R64：侧栏几何对齐官方 64px 图标栏 */
const railCss = read("src/renderer/shell/shell.css");
if (
  /#rail \{[\s\S]*?padding: 12px;/.test(railCss) &&
  /#rail-top,[\s\S]*?#rail-bottom \{[\s\S]*?width: 184px;[\s\S]*?min-width: 184px;/.test(railCss) &&
  /\.rail-btn \{[\s\S]*?height: 32px;[\s\S]*?margin: 4px 0;/.test(railCss) &&
  /\.rail-label,[\s\S]*?\.rail-group-label \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;/.test(railCss) &&
  /body\.rail-visual-wide \.rail-label,[\s\S]*?visibility: visible;/.test(railCss) &&
  /body:not\(\.rail-visual-wide\) \.rail-group \{[\s\S]*?border-top-color: var\(--border\);/.test(railCss)
) {
  ok("侧栏 64px 可见轨道、固定 184px 内部栅格与无重排展开");
} else {
  fail("侧栏固定栅格裁切展开契约缺失");
}
if (
  !/\.rail-overlay/.test(railCss) &&
  !/#rail-user/.test(railCss) &&
  /\.rail-btn\.active::before/.test(railCss) &&
  /width: 2px;/.test(railCss) &&
  /background: color-mix\(in srgb, var\(--accent\) 10%, transparent\)/.test(railCss) &&
  /\.rail-btn\.active \{\s*color: var\(--text\);[\s\S]*?color: var\(--accent-text\);/.test(railCss)
) {
  ok("侧栏无旧浮层/账户卡，active 使用 2px accent + 10% 背景与 accent 文字");
} else {
  fail("侧栏仍有旧浮层/账户卡，或 active 视觉契约缺失");
}

const viewsSrc3 = read("src/main/views.js");
if (/--lg-accent-text/.test(viewsSrc3) && /--lg-hover/.test(viewsSrc3) && /--lg-shadow/.test(viewsSrc3) && /--lg-border-strong/.test(viewsSrc3)) {
  ok("views.js 向阅读面注入 4.0 状态令牌");
} else {
  fail("views.js 缺少阅读面状态令牌");
}

const indexSrc2 = read("src/main/index.js");
if (/74ch/.test(indexSrc2) && /--accent-text/.test(indexSrc2) && /border-radius: 12px/.test(indexSrc2)) {
  ok("离线阅读页复用 4.0 排版与令牌");
} else {
  fail("离线阅读页未复用 4.0 排版");
}
};
