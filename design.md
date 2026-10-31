# 洛谷桌面版 · 设计规范

> 版本 0.7.0 · Windows 11 · 2026-10-28
>
> 本文是实现规范，不是概念稿。文中所有尺寸、颜色、透明度与动画曲线都能在
> `desktop/src/` 里找到对应代码；`desktop/src/main/theme.js` 是颜色与状态令牌的
> 唯一来源，`desktop/src/renderer/shared/tokens.css` 是尺寸/字号/圆角/动效令牌的
> 唯一来源，`desktop/src/renderer/shell/shell.css` 是外壳布局的唯一来源。
>
> **注意**：第 4–12 节是 3.x 的历史像素规格；当前实现以第 15 节「4.0 视觉重构」为准，
> 其中 15.10 是 0.5.0 的折叠侧栏与性能增量，15.11 是 0.6.0 的题库筛选与侧栏分组增量，
> 15.12 是 0.7.0 的皮肤收敛、100% 透明、广告开关与侧栏官方化。

---

## 1. 产品定位：从“套壳”到客户端

浏览器套壳的定义是：一个窗口包住洛谷网页，最多加一条标题栏。它的三个症状是
导航依赖网页、列表每次整页加载、站点自己的顶栏/侧栏/页脚仍然占据画面。

洛谷桌面版把界面拆成三层：

| 层 | 内容 | 实现 | 为什么 |
| --- | --- | --- | --- |
| **驾驶舱** | 主页、题库、训练、比赛、记录、讨论、文章、设置、命令面板 | 原生 DOM，主进程解析 `lentille-context` | 高频浏览必须零整页加载，搜索/筛选在本地完成 |
| **阅读面** | 题目、题解、文章正文、讨论帖、比赛/题单详情、个人主页、聊天、通知、登录 | `WebContentsView` + 统一皮肤 | 数学公式、代码高亮、评论交互必须保持洛谷原样 |
| **工作台** | 内置 IDE、提交、评测通知、托盘 | 原生 + 主进程 | 把“打开题 → 写代码 → 提交 → 等结果”收进一个窗口 |

六条“不像套壳”的硬规则：

1. **隐藏站点外壳**：`#app > .top-bar`、`#app > nav.sidebar`、页脚全部不显示。
2. **列表原生**：题库/训练/比赛/记录/讨论/文章不再加载整页；点击行直接开阅读面。
3. **壁纸穿过内容**：洛谷页面里有一层与窗口同坐标、同运动相位的壁纸复刻；
   卡片、输入框、表格按材质半透明，而不是只在外壳两侧露一条壁纸。
4. **同一套令牌**：外壳与洛谷页面共用颜色、圆角、边框、模糊和强调色。
5. **应用自己的工具条**：后退/前进/刷新、提交记录、题解、IDE、浏览器都在应用工具条里。
6. **站外链接离开应用**：`shell.openExternal` 是唯一出口。

没有标签条。板块是单例，题目/详情是 LRU 页面，`Ctrl+Tab` 切换器负责找回。

---

## 2. 参考的 GitHub 项目

| 项目 | 借了什么 | 没借什么 |
| --- | --- | --- |
| [microsoft/fluentui](https://github.com/microsoft/fluentui) | Fluent 2 的 4px 网格、字号阶梯、Acrylic 材质的“颜色 + 模糊 + 噪声”分层思路 | 不使用 React 组件库；不引入 Fluent 的圆角和阴影默认值 |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 工作台布局：固定活动栏 + 单内容区 + 命令面板；工具条 44px 的密度 | 不做标签页；不做可拖拽面板 |
| [zen-browser/desktop](https://github.com/zen-browser/desktop) | 窄侧栏 + 内容区沉浸的产品姿态；侧栏项 40px 的点击密度 | 不引入浏览器数据模型 |
| [spacedriveapp/spacedrive](https://github.com/spacedriveapp/spacedrive) | 深色玻璃、壁纸与内容共存的视觉；设置页左侧导航 + 右侧滚动面板 | 不照搬其高饱和渐变 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | CSS 变量命名法（`--surface`、`--text-2`、`--radius`）；用变量而不是散落硬编码 | 不使用 Tailwind/React |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | 浮层的焦点管理、`focus-visible` 而非 `:focus`、菜单/对话框的键盘语义 | 不使用其组件实现 |
| [electron/electron](https://github.com/electron/electron) | `titleBarStyle: hidden` + `titleBarOverlay` 保留 Snap/双击最大化；`WebContentsView`；`nativeTheme`；CDP 主世界注入 | 不使用 `BrowserView`（已过时） |
| [microsoft/microsoft-ui-xaml](https://github.com/microsoft/microsoft-ui-xaml) | Windows 11 的 Mica/Acrylic 观感、系统强调色、深色模式跟随 | 不使用 WinUI 控件 |
| [Eugeny/tabby](https://github.com/Eugeny/tabby) | 桌面客户端的设置组织方式：左侧分区、即时生效、无保存按钮 | 不做多标签终端模型 |

洛谷自己的 Lentille/Columba 前端用 `--theme-*` CSS 变量组织配色，这一点是
页面皮肤能保持“原汁原味”的前提；皮肤只改变量值和少数结构选择器，不重写组件。

---

## 3. 设计原则

1. **即时**：没有页面切换动画、没有骨架屏、没有 300ms 以上的等待。数据没到就显示
   一行“正在加载…”，到了直接替换。
2. **4px 网格**：所有间距是 4 的倍数，允许 2px 用于发丝线/图标光学对齐。
3. **一层玻璃**：内容卡片是半透明的，外壳是更厚的半透明；不在玻璃上再叠玻璃。
4. **一个强调色**：选中、链接、主按钮、计数强调都只用一个 accent；语义色只用于状态。
5. **文字优先**：任何装饰都不能降低正文对比度；深色正文 ≥ 4.5:1。
6. **键盘可达**：所有高频动作都有快捷键；焦点环是 1px 强调色，不是黑色外框。
7. **内容保真**：题面、公式、代码、评论保持洛谷原样；只换皮肤，不改语义。

---

## 4. 像素规格

### 4.1 窗口

| 项 | 值 |
| --- | --- |
| 默认窗口 | 1280 × 820 |
| 最小窗口 | 1000 × 640 |
| 设置窗口 | 780 × 620（最小 680 × 520） |
| 标题栏高度 | 40px |
| 左侧栏宽度 | 72px |
| 工具条高度 | 44px |
| 窗口按钮 | Windows 原生 `titleBarOverlay`，高 40px；内容右侧预留 148px |
| 内容区起点 | x = 72，y = 84（40 + 44） |
| 页面视图 | 宽 = 窗口宽 − 72；高 = 窗口高 − 84 |
| IDE 分栏 | 内容区左右各 50% |

### 4.2 标题栏

```
padding: 0 148px 0 13px
gap: 9px
logo: 21 × 21
应用名: 12px / 400 / --text-2
分隔线: 1 × 14 / --border
页面标题: 12.5px / 500 / --text
头像: 26 × 26 / 50% / margin-left:auto
```

玻璃：`--title` 以 `--panel-alpha` 透明，`blur(--blur) saturate(1.15)`，
底边 1px `--border`，顶部 1px 内侧高光 `rgba(255,255,255,.07)`。

### 4.3 左侧栏

```
padding: 8px 0 9px
顶部组: gap 3px
导航项: 40 × 40 / radius 10
图标: 20 × 20，24 网格，stroke 1.8
项间距: 3px
激活底色: --accent-soft
激活文字: --accent
激活指示条: 2 × 16 / left −9 / radius 1
底部组: 上边框 1px，宽 44，padding-top 6
题号跳转: 54 × 28 / radius 8 / padding 0 7
跳转图标: 12 × 12；输入 10.5px
```

栏宽 72 是“图标 + 左右各 16”的结果：40px 项居中后两侧各 16px 留白。
顶部 8 项在 640px 高窗口下仍放得下：8 × 40 + 7 × 3 + 8 + 9 = 351px。

### 4.4 工具条

```
height: 44px
padding: 0 12px
gap: 4px
图标按钮: 30 × 30 / radius 7 / svg 16
文字按钮: 28px 高 / padding 0 9 / radius 7 / 12px / gap 5
分隔线: 1 × 16
面包屑: 12.5px / flex:1 / 省略号
```

### 4.5 主页

```
外层: max-width 900 / padding 0 32
上下: 22px 0 32px
卡片间距: 16px
日期: 19px / 600 / letter-spacing .2
寄语: 12.5px / padding 4px 11px / radius 999 / 玻璃 56%
刷新: 28 × 28 / radius 7 / 玻璃 48%
卡片: radius 10 / padding 13 16 / 玻璃 --card-alpha
打卡网格: 20 列 × 7 行 / gap 2 / 单元 aspect-ratio 1 / radius 2
比赛倒计时: 18px / Cascadia Code / tabular-nums
最近提交行: padding 9 16 / 12.5px
```

### 4.6 原生列表

```
外层: max-width 1020 / padding 0 28 46
吸顶头: top 0 / padding 18 0 10
标题: 19px / 600
计数: 11.5px / --text-3
搜索: 218 × 30 / radius 8 / 图标 14
刷新: 30 × 30 / radius 8
网页版: 30px 高 / padding 0 11 / radius 8 / 11.5px
筛选条: padding-top 11 / gap 6
筛选片: 25px 高 / padding 0 10 / radius 999 / 11.5px
列表容器: radius 11 / 1px 边框 / 玻璃 --card-alpha
行: min-height 46 / padding 8 12 / gap 12
题号: 56px / Cascadia Code 12px
标题: 13px / 1.5 / 单行省略
元信息: 11px / --text-3
状态片: 宽 46 / 10.5px / 600 / radius 5
右侧统计: 62px / 数值 12.5 / 标签 10
加载更多: 30px 高 / padding 0 16 / radius 8
```

列表行不画卡片，只画 1px 分隔线；悬停是 5% 文字色，不改变行高。

### 4.7 设置窗口

```
标题栏: 40px，同主窗
左侧导航: 150px，padding 12 9，项 7px 12 / radius 7
右侧面板: padding 20 24 30，overflow-y auto
分区: gap 24
源卡片网格: 3 列 / gap 8 / 最小高 58 / padding 10 12 / radius 9
预览: 148px 高 / radius 10；底部渐变 rgba(0,0,0,.62)
Wallpaper Engine 网格: 3 列 / gap 8 / 最大高 260 / 16:9 缩略图
侧边栏行: min-height 38 / padding 4 8 4 12
上移/下移: 24 × 24 / radius 6
显隐: 44 × 24 / radius 6
自定义链接表单: 110px + 1fr + auto / gap 8
```

### 4.8 命令面板与切换器

```
遮罩: rgba(0,0,0,.30)
面板: radius 12 / 玻璃 --overlay-alpha / 边框 1px / 阴影 0 18 50 rgba(0,0,0,.35)
命令面板: min(620px, 88%) / margin-top 11vh
输入行: padding 12 14 / 13.5px
列表: max-height 320
行: padding 9 14 / gap 10 / 12.5px
快捷键提示: 10.5px
切换器: min(420px, 86%) / margin-top 16vh
```

### 4.9 IDE

```
宽度: 50%
头部: 38px / padding 0 12
语言选择: 12px / radius 6
编辑区: padding 12 14 / 12.5px / line-height 1.7 / tab-size 4
底部: padding 8 12 / gap 10
主按钮: padding 6 14 / radius 7 / 12.5px / 500
```

### 4.10 提示

```
toast: max-width 360 / padding 10 14 / radius 8 / 玻璃 --overlay-alpha
标题 12.5 / 正文 12
默认 4.2s 后消失
```

---

## 5. 设计令牌

### 5.1 颜色

| 令牌 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#1b1c20` | `#f2f3f6` | 页面底色、纱层 |
| `--rail` | `#17181c` | `#e9eaef` | 左侧栏 |
| `--title` | `#191a1e` | `#eef0f4` | 标题栏、工具条 |
| `--surface` | `#25262c` | `#ffffff` | 卡片、面板 |
| `--surface-2` | `#2b2c33` | `#f6f7f9` | 输入框、次级面 |
| `--editor` | `#18191d` | `#ffffff` | IDE |
| `--border` | `rgba(255,255,255,.09)` | `rgba(22,24,31,.10)` | 发丝线 |
| `--text` | `#ededf2` | `#1b1c21` | 正文 |
| `--text-2` | `#a7a8b3` | `#5c5f69` | 次要 |
| `--text-3` | `#8b8c98` | `#6b6e78` | 提示、占位 |
| `--accent` | `#5b8cff` | `#3360e0` | 链接、选中 |
| `--accent-fill` | `#4a71cc` | `#3360e0` | 实心主按钮 |
| `--on-accent` | `#fff` | `#fff` | 主按钮文字 |
| `--green` | `#46d39a` | `#0f7a51` | AC / 成功 |
| `--red` | `#f4707b` | `#a52f3b` | WA / 错误 |
| `--orange` | `#f2ad4a` | `#8f5a0f` | 等待 / 提醒 |

`--accent-fill` 不是把强调色直接铺在按钮上：深色模式下把 accent 与 `#101218`
按 78% 混合，保证白字 ≥ 4.64:1；浅色模式沿用 accent（白字 5.40:1）。
自定义强调色会自动计算 `onAccent`：白字对比度不足时改用深色字。

### 5.2 材质公式

材质滑杆 `m ∈ [0,100]`：

```
panel-alpha = 92 − m × 0.35      // 57% … 92%
card-alpha  = 98 − m × 0.38      // 60% … 98%
page-scrim  = 96 − m × 0.50      // 46% … 96%
overlay     = min(97, panel + 9)
blur        = 2 + m × 0.16       // 2px … 18px
wall-scrim  = 1 − m / 100        // 外壳壁纸上的底色纱层
```

默认 `m = 55` → 面板 73%、卡片 77%、页面纱层 69%、模糊 10.8px。
玻璃面统一 `backdrop-filter: blur(var(--blur)) saturate(1.15~1.18)`；
底部 1px 边框，顶部 1px 内侧高光。

### 5.3 对比度

| 组合 | 深色 | 浅色 |
| --- | --- | --- |
| text / bg | 14.59 | 15.33 |
| text-2 / bg | 7.21 | 5.74 |
| text-3 / bg | 5.11 | 4.59 |
| accent / bg | 5.38 | 4.87 |
| text / surface | 12.93 | 17.01 |
| accent-fill 上的白字 | 4.64 | 5.40 |

洛谷用户名颜色（橙、紫等）是站点语义，不在皮肤里改写；审计里保留这一项例外。

### 5.4 字号

```
10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 18 / 19
```

- 正文 13，列表标题 13，页面标题 19，设置字段 12.5。
- 行高：正文 1.65；列表标题 1.5；设置 1.7（说明文字）。
- 数字：`font-variant-numeric: tabular-nums`；代码/题号用 `Cascadia Code, Consolas`。
- 字族：`"Segoe UI", "Microsoft YaHei", system-ui`。

### 5.5 间距

```
2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32 / 40 / 46
```

### 5.6 圆角

```
4（小标签） / 5（状态片） / 6（输入、图标按钮） / 7（工具条按钮、设置按钮）
8（搜索、跳转） / 9（源卡片、小组件） / 10（导航项、主页卡片）
11（列表容器） / 12（命令面板） / 999（胶囊、头像）
```

### 5.7 阴影与描边

```
面板:  inset 0 1px 0 rgba(255,255,255,.05)
卡片:  0 8px 30px rgba(0,0,0,.12)
浮层:  0 18px 50px rgba(0,0,0,.35)
列表:  1px --border
焦点:  1px --accent-line（1px 内环用于列表行）
```

### 5.8 图标

- 24 × 24 视图框，线性，`stroke-width: 1.8`，圆头圆角。
- 导航 20px，工具条 16px，行内 14px。
- 官方洛谷标志用于窗口、托盘、标题栏；应用内功能图标不使用品牌标志。

### 5.9 动效

- 页面/板块切换：**0ms**。不做淡入、不做滑动、不做骨架屏。
- 悬停/选中：120–160ms，`cubic-bezier(.2,0,0,1)`。
- 壁纸切换：600ms 透明度交叉；系统开启“减少动态效果”时取消。
- 壁纸漂浮：`x = sin(t/11000) × 6px`，`y = cos(t/15000) × 4px`；
  缩放 `1.055 + sin(t/19000) × 0.012`。
  外壳与洛谷页面用同一个 `Date.now()` 公式，所以两侧边缘始终对齐。

---

## 6. 组件规格

### 6.1 左侧导航项

| 状态 | 底色 | 文字/图标 |
| --- | --- | --- |
| 默认 | 透明 | `--text-2` |
| 悬停 | text 7% | `--text` |
| 选中 | `--accent-soft` | `--accent` |
| 键盘焦点 | 透明 | 内环 1px `--accent-line` |
| 禁用 | 透明 | 35% 不透明度 |

### 6.2 题号跳转

- 输入正则：`^[A-Za-z]{1,4}\d+[A-Za-z0-9]*$`，允许 `P1001`、`CF1234A`、`AT_abc123_a`。
- 回车：大写后打开题目；输入框清空并失焦。
- 非法：1px 红边框 900ms，选中文本；不弹提示。
- `Esc`：清空并失焦。
- `Ctrl+L` 从任何页面聚焦；在网页视图里由 `before-input-event` 转发到外壳。

### 6.3 列表行

| 类型 | 左 | 中 | 右 |
| --- | --- | --- | --- |
| 题目 | 题号 56px | 标题 + 难度点/难度名/提供者 | 通过率 62px |
| 训练 | — | 标题 + 提供者/题数/收藏 | 创建时间 |
| 比赛 | 状态片 46px | 标题 + 主办方/时间 | 题数 + rated |
| 记录 | 状态片 46px | 题号 + 标题 + 语言/分数 | 时间 |
| 讨论 | — | 置顶标记 + 标题 + 版块/作者/时间 | 回复数 |
| 文章 | — | 标题 + 摘要 + 作者/时间 | 点赞数 |

悬停 5% 文字色；键盘 `Enter/Space` 等同点击；`focus-visible` 内环 1px。

### 6.4 筛选片

- 25px 高，padding 0 10，圆角 999。
- 默认透明 + `--text-2`；悬停 6% 文字色；选中 `--accent-soft` + accent + 1px accent-line。
- 题库 9 个难度片；比赛 4 个状态片；记录 3 个结果片。

### 6.5 状态片

- 宽 46，10.5px，600，圆角 5。
- AC：green 14% 底；非 AC：red 14%；等待：orange 14%；中性：text 6%。

### 6.6 壁纸预览

- 148px 高，圆角 10，1px 边框。
- 图片 `cover`；视频静音循环；底部 20px 渐变到 `rgba(0,0,0,.62)`。
- 左下名称 12px 白字，右下类型 10.5px 75% 白。

### 6.7 Wallpaper Engine 项

- 3 列网格，16:9 缩略图，圆角 5，外框 1px。
- 名称 11.5px 单行；类型 10px。
- 选中：1px accent 边框 + inset 1px。
- 场景/网页/程序类型显示预览图，并在 tooltip 里说明。

### 6.8 侧边栏编辑器

- 行 38px：名称 + 上移/下移 + 显隐。
- 隐藏行整体 50% 不透明度。
- 自定义链接行：名称 + URL（省略）+ 删除。
- 添加表单：名称 110px、URL 1fr、添加按钮；URL 非 `http(s)` 时红框。

### 6.9 共享玻璃面板

```css
background: color-mix(in srgb, var(--surface) var(--card-alpha), transparent);
backdrop-filter: blur(var(--blur)) saturate(1.15);
border: 1px solid var(--border);
box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
```

同一个配方用于主页卡片、列表容器、设置源卡片、登录卡片和洛谷页面卡片。
洛谷页面用 `--lg-card-alpha` 等变量，值与外壳完全同源。

---

## 7. 页面设计

### 7.1 主页

- 日期 + 每日寄语 + 刷新（玻璃胶囊）。
- 未登录：一张登录卡片，说明登录后会出现签到/打卡/比赛/最近提交。
- 已登录：签到状态或签到按钮、连续天数；近 20 周打卡网格；下一场比赛倒计时；
  最近 5 次提交。
- 比赛卡可点击进入比赛列表；提交行可点击打开题目。
- 数据来自主进程，渲染层不做业务判断；无骨架屏，失败显示一行错误。

### 7.2 题库

- 吸顶标题 + 总数 + 服务端搜索（320ms 防抖）+ 刷新 + 网页版。
- 难度筛选片；行显示题号、标题、难度点、提供者、通过率。
- 点击题目打开题目阅读面；从题库进入时，工具条“后退”在没有历史时回到题库。

### 7.3 训练 / 比赛 / 记录 / 讨论 / 文章

- 训练：标题、提供者、题数、收藏数、创建时间；点击进题单详情。
- 比赛：进行中/即将开始/已结束状态片；主办方、时间、题数、rated；点击进比赛详情。
- 记录：需要登录；未登录显示登录卡片而不是空列表；登录后按状态筛选。
- 讨论：版块、置顶、作者、回复数；点击进帖子。
- 文章：标题、摘要（去掉 Markdown 图片/链接）、作者、时间、点赞；点击进正文。
- 任何列表失败都有“重试”和“网页版”两个出口。

### 7.4 题目阅读面

- 站点顶栏、侧栏、页脚隐藏；题面卡片直接开始。
- 工具条：后退/前进/刷新、提交记录、题解、IDE、浏览器。
- IDE 开启时右侧 50% 是原生编辑器；默认 C++14，可切语言，提交走后端接口，
  失败则复制代码并跳到题面提交区。
- 页面里铺同坐标壁纸；题面卡片、侧栏卡片、表格、代码块、输入框全部玻璃化。
- 题目内链接仍由洛谷页面处理；题号链接由 preload 转成独立题目视图。

### 7.5 文章 / 讨论 / 个人主页

- 保留洛谷的正文排版与交互，只换皮肤。
- 文章卡片标题/摘要、合集侧栏、讨论版块名都显式改色，避免站点硬编码的 `#333`。
- 个人主页的 `lcolor-*` 容器透明；头部条、统计条玻璃化；热力图浅灰格子改为强调色梯度。
- 登录页 `main-wrapper` 透明；登录卡片玻璃化；通行密钥按钮保留原样。

### 7.6 聊天 / 通知

- `/chat`、`/user/notification` 仍是网页视图（这些页面依赖
  洛谷自己的实时组件）；工具条和皮肤与外层一致。
- 站内域名白名单覆盖 `*.luogu.com.cn` 与 `*.luogu.org`；其他域名一律系统浏览器。

### 7.7 登录与通行密钥

- 登录页加载时**不会**自动唤起 Windows 安全窗口。
- 主进程通过 CDP 在文档创建前注入主世界守卫：只有点击含“密钥/通行/passkey”的
  按钮后 15 秒内，或正处于用户手势中，才允许 `navigator.credentials.get/create`。
- 自动调用被静默挂起（不 reject），避免站点弹出错误 toast。
- 用户点击“通过通行密钥登录”时走真实的 WebAuthn 流程。

### 7.8 设置

- 七个分区：外观、壁纸、侧边栏、通用、通知、账号、关于。
- 改动即时生效，没有保存按钮。
- 外观：明暗三段、材质滑杆、强调色（洛谷蓝/系统色/自定义）。
- 壁纸：来源六选一、预览、下一张、轮换间隔、随机、漂浮/缩放/淡入、
  Wallpaper Engine 目录与列表。
- 侧边栏：排序、显隐、自定义链接、恢复默认。
- 通用：关窗行为、开机自启；通知：评测/比赛；账号：登录/退出；关于：版本。

---

## 8. 壁纸系统

### 8.1 来源

| 来源 | 解析 | 轮换 |
| --- | --- | --- |
| 跟随桌面 | 注册表 `HKCU\Control Panel\Desktop\Wallpaper` | 否 |
| 内置 | 强调色 + 背景色的两层渐变 | 否 |
| 每日一图 | Bing HPImageArchive，按天缓存到 userData | 每天 |
| 单张图片 | 用户选择图片或视频 | 否 |
| 文件夹 | 递归 3 层，图片/视频，最多 400 个 | 是 |
| Wallpaper Engine | 扫描 `431960` 工坊目录或 Steam 库根目录 | 是 |

### 8.2 Wallpaper Engine 支持矩阵

| project.json type | 行为 |
| --- | --- |
| `video` | 视频壁纸，静音循环，支持视差容器 |
| `image` | 图片壁纸 |
| `scene` | 不能运行 `.pkg`，用 `preview` 预览图静态呈现，并在 UI 标注 |
| `web` | 不能运行网页壁纸，用预览图静态呈现 |
| `application` | 用预览图静态呈现 |

扫描规则：最多 200 个条目、3000 个目录；结果缓存 30 秒；优先选可播放条目作为默认。

### 8.3 页面复刻层

```css
body::before {
  position: fixed;
  left: var(--lg-wall-left);   /* = -72px */
  top: var(--lg-wall-top);     /* = -84px */
  width: var(--lg-wall-w);     /* = 窗口宽 */
  height: var(--lg-wall-h);    /* = 窗口高 */
  background-image: linear-gradient(主题色纱层), var(--lg-wall-image);
  background-size: 100% 100%, cover;
  transform: translate3d(--lg-pan-x, --lg-pan-y, 0) scale(--lg-zoom);
  transform-origin: 窗口中心;
}
```

因为层尺寸等于窗口、偏移等于视图位置、变换原点等于窗口中心，所以它与外壳
`#wallpaper` 逐像素对齐。视频壁纸在页面里用预览图/渐变替代，避免两路视频解码。

### 8.4 交互

- 设置里“下一张”立即换；托盘菜单也有“换一张壁纸”。
- 文件夹/WE 按间隔轮换；随机顺序用 Fisher 之外的“避免重复当前项”随机。
- 切换时 600ms 交叉淡入；系统“减少动态效果”时直接切换。
- 壁纸运动与页面相位一致；没有鼠标视差，避免指针跨过 72px 栏时接缝错位。

---

## 9. 交互与键盘

| 快捷键 | 动作 |
| --- | --- |
| `Ctrl+K` | 命令面板（题号、板块、签到、设置） |
| `Ctrl+L` | 聚焦题号跳转 |
| `Ctrl+Tab` | 打开页面切换器 |
| `Ctrl+,` | 设置 |
| `F11` | 全屏 |
| `F12` | 开发者工具（自动临时卸下通行密钥守卫，关闭后重装） |
| `Esc` | 关闭浮层/清空跳转 |

- 命令面板输入 `P1001` 直接出现“打开题目 P1001”；中文标签也可匹配。
- 切换器列出当前板块、网页页面、题目、个人主页；题目/详情按最近使用排序。
- 站外链接在系统浏览器打开；不新开应用内窗口。
- 关闭窗口默认收进托盘；托盘左键显隐；托盘菜单：打开洛谷、题库、今日签到、换壁纸、设置、退出。
- 登录态用 cookie `__client_id` + 非零 `_uid` 判断；游客的 `_uid=0` 不算登录。

---

## 10. 明暗与可访问性

- 跟随系统/强制浅色/强制深色；`nativeTheme.themeSource` 同时驱动洛谷页面的
  `prefers-color-scheme`，所以站点原生深色主题与皮肤一致。
- 深色审计结果（2026-10-25）：题面、文章、训练、用户、登录页
  `light=0 / darkText=0`；讨论页只剩洛谷用户名橙色徽章（语义色）。
- 浅色审计结果：同样只剩语义色用户名；“浅色卡片”不被判为问题。
- 焦点环：`1px --accent-line`；不使用黑色 `outline`。
- 系统“减少动态效果”时关闭壁纸漂浮/缩放与切换淡入。
- 主按钮文字对比度 ≥ 4.5:1；正文/次要文字 ≥ 4.5:1。

---

## 11. 侧边栏定制模型

```json
{
  "rail": {
    "order": ["home", "problems", "training", "contest", "record", "discuss", "article"],
    "hidden": [],
    "custom": [{ "id": "custom:abc123", "label": "GitHub", "url": "https://github.com" }],
    "pinned": false
  }
}
```

- `order` 只允许内置 id；新增版本追加的新板块会自动补到末尾。课程入口已移除。
- `hidden` 控制显隐；设置页提供上移/下移/隐藏/显示。
- 自定义链接最多 8 个，名称 ≤ 24 字，URL 必须 `http(s)`；显示在顶部组末尾。
- `pinned` 控制侧栏是否常驻展开；默认 `false`（56px 图标栏，悬停展开）。
- 底部固定：题号跳转、聊天、通知、设置。
- 所有变更即时广播，主窗口的 rail 重建，不重启。

---

## 12. 验收

- `desktop/scripts/check.js`：语法、必需文件、HTML 引用、IPC 双向、默认值、
  通行密钥守卫、登录态 uid、阅读面注入。
- `desktop/scripts/smoke.js`：隐形窗口启动，主页/列表/题面/设置截图全部 > 5KB。
- 深色/浅色审计：`LG_SMOKE_AUDIT=1`，排除屏幕外元素，输出
  `.lg-dev/audit-dark.json`。
- 人工走查：题库搜索、难度筛选、比赛状态、文章/讨论跳转、题号跳转、侧边栏排序、
  壁纸文件夹轮换、WE 视频/场景、登录页无自动弹窗、托盘菜单。
- 像素抽检：标题栏 40、栏 72、工具条 44、列表行 46、设置导航 150、
  命令面板 620、卡片圆角 10/11、焦点环 1px。

---

## 13. 文件地图

```
desktop/src/main/
  index.js          生命周期与装配
  config.js         配置与 rail/wallpaper 默认值
  theme.js          颜色、材质公式、对比度
  wallpaper.js      桌面/每日/文件夹/Wallpaper Engine 解析
  sections.js       板块与 rail 定义
  views.js          原生列表状态 + WebContentsView + 皮肤注入
  passkey-guard.js  主世界通行密钥守卫
  luogu.js          登录态、列表解析、签到、提交、评测监听
  ipc.js            IPC 契约
  window.js         主窗/设置窗/标题栏 overlay
  tray.js           托盘
  notify.js         toast/评测通知/角标
  smoke.js          隐形冒烟与深色/浅色审计
desktop/src/preload/
  shell.js / rail.js / settings.js / page.js
desktop/src/renderer/
  shell/            标题栏、折叠侧栏、主页、原生列表、命令面板、IDE
  rail/             悬停展开的 208px 侧栏浮层（壁纸对齐、钉子、跳转）
  settings/         七分区设置
  skin/             洛谷页面皮肤与壁纸复刻层
desktop/src/assets/ 官方图标、托盘、AC/WA 角标
```

---

## 14. 设计决策记录

- **为什么不用透明 WebContentsView**：Electron 在 Windows 上对子视图透明合成
  没有稳定保证；用页面内同坐标复刻层可以在任何显卡/缩放下得到确定结果。
- **为什么列表原生、详情网页**：列表需要即时筛选和键盘操作；题面/评论需要
  数学公式、代码高亮和站点交互，重写会失真。
- **为什么没有标签页**：产品定位是“客户端”不是浏览器；板块单例 + 详情 LRU +
  `Ctrl+Tab` 已经覆盖切换需求，同时让 rail 成为唯一导航。
- **为什么通行密钥用 CDP 注入**：`contextIsolation` 下 preload 的修改只作用于
  隔离世界；必须在主世界文档创建前注入。CDP 的
  `Page.addScriptToEvaluateOnNewDocument` 是 Electron 39 里可靠的做法。
- **为什么壁纸不做鼠标视差**：页面复刻层与外壳在指针跨过 rail 时无法共享同一个
  指针位置，会产生 72px 边界接缝；漂浮 + 缩放 + 轮换已经提供“活着”的感觉。
- **为什么提交验证码只自动识别“图片类”**：登录等场景是图片验证码，ddddocr 可靠
  识别（实测命中）；提交接口返回的是网易易盾交互式滑块（`errorData.interactive.type=YIDUN`，
  带行为分析），这是洛谷反自动化提交的明确设计——其响应原文声明评测接口仅供个人练习、
  自动化用途应走开放平台。应用不绕过易盾：原生提交遇到交互式挑战时转为“页面内提交
  辅助”（自动打开提交区并把代码填进洛谷的 CodeMirror 编辑器，用户完成滑块后自己提交）。
- **为什么语言 id 表只保留实测条目**：洛谷 2026 新评测机改了语言表——旧 `C++14=5`
  已失效（400 `record.invalid_language_type`），真实提交 UI 默认发 `lang:28`
  （C++14 (GCC 9)）与 `enableO2:1`。未逐一确认的名字一律回落 28，其余语言走页面内
  提交辅助由用户在真实下拉里自选。
- **为什么题面快照存“已渲染 DOM”而不是 markdown 源文本**：lentille-context 里
  的题面是 markdown，离线重放就得自己实现 KaTeX + 代码高亮 + 洛谷排版，必然失真；
  存洛谷渲染后的 DOM（脚本已剔除）则离线页零渲染成本、公式高亮原样保留。代价是
  单条几百 KB，用「40 条 LRU + 600KB 截断 + 1.5MB 拒收」约束住。
- **为什么离线队列重放走与手动提交同一条管线**：队列不是绕过验证的旁路——每条
  重放都经过 `submit()` 的完整语义（图片验证码 ddddocr 自动识别、易盾交互式
  转页面辅助）。所以结果分类只有四种：成功/需要验证码（标出等用户处理）/
  网络未就绪（90 秒退避重试）/服务器明确拒绝（停止重试，保留可查）。
- **为什么 lgoff:// 要同时注册默认 session 和 persist:luogu 分区**：页面视图
  全部跑在 `persist:luogu` 自定义分区上，`protocol.handle` 默认只挂默认 session
  ——漏挂分区的症状是 `ERR_FAILED (-2)` 且页面停在 about:blank（冒烟实测）。
  `registerSchemesAsPrivileged` 在 ready 之前全局生效，handle 则要两边都挂。
- **为什么在线状态用「主窗口 navigator.onLine 轮询 + 页面 fetch 失败反馈」双通道**：
  单靠轮询有 10 秒盲区，断网瞬间列表还会去撞五次重试；fetchContext 每次把页面
  上下文里的 `navigator.onLine` 顺手带回，能在第一个失败请求就把状态翻成离线，
  后续请求立即走缓存不再等。恢复在线由轮询翻转触发刷新 + 队列重放。

---

## 15. 4.0 视觉重构（当前实现）

### 15.1 目标与参考

目标：**GitHub 的安静 + Linear 的侧栏与密度 + VS Code 的面板效率 + Windows 11 的材质规矩**。
不是“再加一层玻璃”，而是把材质、排版、状态和阅读面重新分层。

### 15.2 布局骨架

| 项目 | 值 |
| --- | --- |
| 标题栏 | 40px，单行当前页标题 + 28px 头像；不再重复应用名 |
| 侧栏 | 默认 56px 图标栏；悬停展开 208px 浮层（页面不回流）；展开态图标 20px + 文字 13/20，右上角线条钉子常驻；任何页面都不高亮 |
| 工具条 | 44px，图标按钮 28px，文字按钮 32px |
| 内容列 | 最大 1080px，页边距 32px；首页与题库共用同一条中线 |
| 设置窗 | 860×640，导航 200px，内容列最大 640px，页边距 32px |
| 命令面板 | 宽 640px，头 44px，行 36px，列表最大 440px，圆角 12px |
| 提示 | 窗口级右上角，宽 360px，不遮挡 IDE 提交按钮 |

### 15.3 字号与排版

- 字号只允许 **11/12/13/14/16/20/24**；11px 仅用于英文、数字、快捷键。
- 中文只用 400/600，不用 500（YaHei UI 只有 Regular/Bold，500 会合成）。
- 默认 UI 13/20；正文 14/22（阅读面 14/1.8）；卡片标题 16/24；页面标题 20/28；大数字 24/32。
- 中文不加 letter-spacing；数字统一 `font-variant-numeric: tabular-nums`。
- 字体栈：`Segoe UI Variable Text → Segoe UI → Microsoft YaHei UI → system-ui`；
  代码：`Cascadia Mono → Cascadia Code → Consolas`；`font-synthesis: none`。

### 15.4 间距、圆角、控件

| 令牌 | 值 |
| --- | --- |
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 |
| 圆角 | 4（小徽标）/ 6（按钮、输入框）/ 8（小卡片）/ 12（卡片、弹层）/ 999（胶囊） |
| 控件高度 | 28（图标）/ 32（默认）/ 36（大）/ 44（工具条） |
| 行高 | 列表 56、紧凑行 44、设置行 52 |
| 图标 | 16/20/24 三档，`vector-effect: non-scaling-stroke` 保证 1.6px 视觉线宽 |

### 15.5 颜色、材质与状态

- 深色：`bg #16181d`、`surface #1d2027`、`text #f2f3f6`、`text-2 #a8adb8`、`text-3 #8b909c`。
- 浅色：`bg #f5f6f8`、`surface #ffffff`、`text #1b1f26`、`text-2 #59606b`、`text-3 #6b7280`。
- 强调色仍默认洛谷蓝；`accentFill` 用于按钮填充，`accentText` 保证在 bg/surface 上 ≥4.5:1。
- 材质公式（m 0–100）：外壳 `94−0.2m`%、页面纱层 `97−0.06m`%、卡片 `99−0.08m`%、
  模糊 `6+0.24m` px；默认 55。**内容面最低 91%**，正文不放在模糊上。
- 状态：hover 6%、pressed 10%、列表/筛选 selected accent-soft + 2–3px 强调色条；
  侧栏导航项**不设选中态**；焦点 2px 强调色、offset 2；行内元素用内环。
- 阴影：`--shadow-color` 分深浅两套，卡片 L1、浮层 L2、弹窗 L3；浅色不再共用深色重阴影。
- 玻璃只用于标题栏/侧栏/工具条/浮层；卡片只保留 1px 边框 + L1 阴影，不再嵌套 blur。

### 15.6 页面规格

- **首页**：两栏仪表盘；右栏 320px。热力图 14×14px、gap 2、20 周，含星期/月份标签与 5 级图例；
  卡片内边距 20；最近提交行 44；状态胶囊高 20、自动宽度。
- **列表**：吸顶头 95% 背景 + 16px 模糊 + 底部分隔线；行高 56；统一网格列
  （题号 64 / 标题 1fr / 数据 80 / 时间 80）；骨架屏延迟 150ms 出现；错误保留旧数据并显示内联错误条。
- **设置**：分区标题 20/28 + 说明 12/18；分组卡片圆角 12、行高 52；
  range/checkbox/radio/select 全部自绘；退出登录使用危险色。
- **IDE**：头/脚 44px；行号槽 48px；代码 13/22；分栏可拖拽（0.35–0.7，双击回 0.5）；
  提交按钮六态（idle/submitting/success/queued/error/disabled）。
- **阅读面**：正文 14/1.8、段落最大 74ch；卡片圆角 12、表面 95%；
  表格头 38 / 单元格 42；按钮与表单 32px；焦点 2px。皮肤对准 `.lfe-marked`、
  `.l-button`/`.solid`、`.cute-table`/`.mtable`、`.cm-editor`、`.user-header-top`。
- **离线页**：复用同一套字体、卡片、代码、表格和焦点规则，不再单独一套排版。

### 15.7 可访问性

- 中文最小 12px；所有可聚焦元素有 2px 焦点环，行内用内环。
- 导航栏**不设 `aria-current`，也不高亮**——当前页面只由标题栏标题表达；
  原生列表/筛选用 `aria-selected`，切换器/命令面板用 listbox + `aria-activedescendant`，
  对话框有 `role="dialog"`/`aria-modal`，通知用 `aria-live`。
- 键盘：列表 ↑↓/Home/End/Enter；命令面板 ↑↓/Enter/Esc；设置 Esc 关闭、↑↓ 切分区；
  IDE Tab 缩进、Ctrl+Enter 提交。
- `prefers-reduced-motion` 下关闭动画、壁纸漂浮/缩放停止 rAF。

### 15.8 验收基线（冒烟实测）

- `SMOKE_VISUAL_METRICS`：折叠侧栏 56、标题栏 40、内容列 1080、热力图格 14、
  卡片圆角 12、body 13px、5 张首页卡片。
- `SMOKE_RAIL`：浮层 208×780、10 个标签、3 个分组、钉子可见、`jumpFocused=true`；
  账户卡在末位；固定后页面视图让位 208；导航点击后浮层关闭且回到主页；钉子点击后 `pinned=true`。
- `SMOKE_RAIL_BOUNDS`：真实题面在场时页面视图 x 依次为 56 → 208 → 56。
- `SMOKE_PERF`：`body.perf`、`--blur:0px`、标题/侧栏/内容 blur 全为 `none`；
  `SMOKE_LAZY` 失焦冻结、聚焦恢复均为 true。
- `LGTEST_PROFILE`：头像打开独立 `profile:<uid>` 页面；侧栏 active/aria-current 计数为 0。
- `npm run check`：265 项静态契约（含字号/圆角/阴影扫描、令牌存在性、折叠侧栏/钉子/
  不高亮/性能模式契约、题库筛选参数/标签桥/分组标题、阅读面真实类、快照水合前不保存裸
  markdown，且要求正文类已出现）。

### 15.9 4.0 决策记录

- **为什么内容面必须 ≥91% 不透明**：Windows Acrylic 规范把模糊限定在外壳/临时浮层；
  正文放在模糊上会让对比度随壁纸变化，无法验收。壁纸只保留在标题栏、侧栏、卡片缝隙。
- **为什么侧栏从 72px 改成 208px**：13 个图标在窄条里无法辨认，且选中条会被 overflow
  裁掉；文字侧栏同时解决可发现性、溢出和分组问题。
- **为什么中文最小 12px、只用 400/600**：YaHei UI 只有 Regular/Bold，500 会合成；
  11px 只留给英文快捷键和数字。
- **为什么阅读面 14/1.8、74ch**：中文题面需要比 UI 更松的行高；74ch 把长段落控制在
  适合扫读的宽度，同时保留公式/表格的横向空间。
- **为什么题面快照要等水合**：站点在水合前会把 markdown 源文本直接放进 DOM；
  抓早了离线页就是满屏 `**` 和 `$`。现在要求 `.lfe-marked` 出现、正文足够长且不是
  裸 markdown 才落盘，最多重试 5 次。

### 15.10 0.5.0 折叠侧栏与性能

- **折叠侧栏**：默认 56px 图标栏；鼠标移入后由独立的 `WebContentsView` 浮层展示
  208px 完整导航。浮层覆盖在页面上方、不改变页面视图 bounds，因此展开/收起不会触发
  页面重排。展开态右上角是线条 `pinOff/pin`：点击后侧栏常驻（页面视图让位到 208），
  再点回到折叠；`Ctrl+B` 等价于点钉子。
- **不高亮**：所有侧栏项目（含头像/个人主页、登录、详情页）一律没有选中底色、
  指示条或 `aria-current`；当前页面只由标题栏标题表达。个人主页是独立的
  `profile:<uid>` 页面，不再被归入“主页”栏目。
- **动态降载**：窗口失焦、最小化、隐藏、页面滚动时暂停壁纸 rAF 与页面动效，
  恢复后自动继续；滚动停止 140ms 后恢复。壁纸与页面运动统一 30fps。
- **性能模式**：设置 → 通用 → 性能优先。开启后 `--blur:0px`，外壳/设置/页面
  `backdrop-filter` 全部关闭，壁纸停止漂浮与缩放；内容面同时提高不透明度。
- **卡顿根因**：内容区 `#content` 曾对整块正文做 `backdrop-filter`，切页/滚动时
  每帧都要重新模糊整个窗口；现在内容面改为高不透明度画布，模糊只留标题栏、
  折叠侧栏和浮层。主题/皮肤变量注入也加了签名缓存，避免每次切换重复插入 CSS。

### 15.11 0.6.0 题库筛选对齐与侧栏分组

- **所属题库**：与网页版一致的 7 个入口——洛谷（主题库 + 入门与面试）、主题库、
  入门与面试、Codeforces、SPOJ、AtCoder、UVa。
- **难度区间**：网页版是一个“题目难度范围”下拉，勾选覆盖连续区间；客户端复刻为
  下拉面板，未选时显示“题目难度范围”，单级显示级别名，区间显示“普及 ~ 提高”。
  点区间外扩展、点区间内从更近一端收缩、等距时收高端；点端点收成单级，再点取消。
- **标签筛选**：弹窗分算法/来源/时间/区域/特殊题目五类；“搜索全部标签”跨分类搜索；
  已选标签（n）实时汇总；URL 编码保持网页口径——组内逗号=或，组间竖线=与。
- **题面搜索与行内标签**：“搜索题面”把关键字扩展到题面正文；“显示算法”控制题目行
  是否显示算法/特殊题目标签，选择写入 `lg.lib.showTags`。
- **标签目录**：公开端点 `/_lfe/tags`；内存 6 小时、落盘 24 小时，过期先用旧目录并
  后台刷新；离线时优先使用已落盘目录。
- **循环缓存**：无筛选时 cache key 仍是 `problems|1||`，旧缓存和冒烟打桩可继续命中；
  带筛选时追加 `t:`/`g:`/`c:` 片段，例如 `problems|1||3|5|t:P|g:1|c:1`。
- **侧栏分组**：浏览 / 社区 / 工具 / 自定义；展开态显示分组标题，折叠态只留发丝分隔线。
  账户卡固定在侧栏最底部：未登录点击登录，已登录点击个人主页；折叠态只留头像。
  悬停有 70ms 意图延迟，所有侧栏项目仍然不高亮。
- **验收**：`SMOKE_LIB_FILTER` 17 项全过（类型、区间规则、标签弹窗、真实参数）；
  真实网络组合筛选实测 484 条，首条 P1007；`SMOKE_RAIL_COLLAPSED` 断言分组标签隐藏、
  账户卡在末位；`npm run check` 265 项静态契约。

### 15.12 0.7.0 皮肤收敛、100% 透明、广告开关与侧栏官方化

- **皮肤降爆炸半径**：删掉对官方主容器宽度/外边距、按钮/输入框高度/行高、
  表格固定高度的改写。只保留颜色、承载面、圆角、焦点与滚动条。官方顶栏隐藏后
  遗留的 `margin-top: 56px` 单独清零，再补 20px 顶部空隙；实测题面首卡从 y=100
  回到 y=44，右侧不再被吃掉 10px。
- **按钮居中**：链接型 `.l-button` 才加 `inline-flex + center`；原生 `button.l-button`
  保持官方几何，不再出现文字偏上或贴右被裁。
- **卡片白名单**：承载面只收 `.l-card / .lfe-card / .card / .lg-article`；
  `.side / .list / .box / .panel / .comment` 等布局壳不再被涂成卡片。
  用户页头图 `.user-header-top` 只补边框与圆角，不碰站点 banner 的底色/背景图。
- **100% 壁纸透出**：`material.js` 把 70→100 的尾部区间线性映射到 0：
  `panel / pageScrim / cardAlpha` 在 100 时为 0，浮层保留 60% 可读下限；
  卡片透明度 ≤30% 时正文自动加 1px 投影。默认 45 的观感与 0.6.0 完全一致。
- **广告开关**：设置 → 通用 → 拦截广告与推广，默认关闭。开启后
  `session.webRequest.onBeforeRequest` 取消 `qiafan / googlesyndication /
  doubleclick / googleadservices / adsserver` 请求，页面同时拿到
  `data-lg-adblock=1` 用于隐藏推广卡与空广告位；开关实时生效，新文档由 preload
  参数带入。
- **侧栏官方化**：几何按洛谷官方侧栏（64px / 内边距 20×12 / 40×30 热区 /
  20px 图标 / 8px 间距）等比缩到 56px：内边距 12×8、按钮 40×30、上下外边距 4、
  图标 20、账户 32×32 纯头像、收起隐藏题号跳转框；折叠态不再画分组标签和分隔线。
  悬停展开去掉了浮层投影，视觉上是同一根侧栏变宽。
- **主页收口**：两栏改为 `2fr / 1fr`、间距 16、卡片内边距 16；“学习概览”并进
  打卡卡片右半区，消除热力图右侧的大片空白；每日寄语去胶囊化。
- **真实页面修复**：文章详情作者自定义白底（内联 `background-color`）在深色下
  强制透明；文章操作条的灰字、讨论列表的 `span.name` 统一走主题色。
- **R65 追加（同版实测）**：
  - 用户页 banner 被 `background` 简写清掉的 bug 修复，暗/亮都能看到站点题图；
    底部关注/粉丝统计条单独铺表面色。
  - 题库/比赛筛选条整体主题化：标题、灰色说明（`lcolor--grey-3`）、下拉框、
    标签按钮、底部悬浮分页条与页码按钮，不再出现白底黑字或亮色色块。
  - 登录页「通过通行密钥登录」的 `#595959` 字色改为 `--lg-text-3`（暗色卡片上
    从 1.5:1 提到 4.9:1）；亮色代码块注释 `#a0a1a7` 同样加亮。
  - 评论区每条回复的浅灰头带（`.reply-item .meta`）透明化，深色下不再是亮带。
  - 页面还没加载完就被切走时 Chromium 的 `ERR_ABORTED` 不再弹「页面打开失败」。
  - 皮肤审计升级为双主题通用：按实际对比度记录 `dark / dim / light / over`，
    亮色下也能发现 2.4:1 的灰字；装饰图/品牌色徽标不计入。
- **验收**：`npm run check` 297 项；`SMOKE_GLASS` 断言 100% 时三层归零且浮层 ≥60；
  `SMOKE_ADBLOCK` 默认关闭、开启后请求被 cancel；`SMOKE_RAIL_COLLAPSED` 断言
  40×30/20px/32×32；`SMOKE_SKIN_AUDIT` 覆盖 9 页 × 亮/暗，逐页检查深底深字、
  低对比文字、横向溢出与浅色面板（R65 后 9 页全部为 0）。

### 15.13 0.7.1 丝滑与清瑕（R69）

方向（用户定版）：动效=轻量克制，页面/分区切换保持 0ms；页面覆盖=全部补齐。
不做新功能，ROADMAP 交互工单继续顺延。

- **皮肤状态反馈**：按钮过渡补 `color/opacity`，主按钮悬停从 `brightness(1.07)`
  滤镜改为 `--lg-accent-hover` token（滤镜不在过渡列表里会突变）；链接、表格行、
  下拉项补 `color/background` 过渡（`--lg-dur/--lg-ease`）。分页条/页码按钮/筛选
  chips 补 `:hover`（此前深色下悬停露出原生白）与 `.selected` 选中态反馈。
- **原生控件**：`checkbox/radio/range/progress` 补 `accent-color: var(--lg-accent)`。
- **焦点去重**：文本输入的 `:focus-visible` 连鼠标聚焦也恒匹配，叠 outline 就是
  双环——输入框焦点只留 border+ring；全局 `:focus-visible` 环保留。
- **代码高亮跟应用主题**：Prism 条件从跟随 OS 的媒体查询改为
  `html[data-lg-mode]`（`--lg-boot-mode` 由 page preload 在 document-start 置位、
  主题切换时刷新）。修掉「应用强制亮色 + 系统深色时代码区仍是深色」的真 bug。
- **首帧链接色**：`--lg-boot-accent` 在 document-start 预置
  `--lg-accent/--lg-accent-text`，慢页水合时链接不再「官方灰扫成主题色」。
- **补覆盖（只改色不改布局）**：讨论帖详情（回复头 `.author` 亮带、`.casket`
  富文本编辑器、`.cs-footer`、CodeMirror 行号槽、右下「编辑回复」悬浮钮）、
  旧版布局页（`main.mobile-body` 内联浅底、`.wrapper .background` 白卡、提示卡
  文字）、题库标签列 `<col>` 灰带（矩形 0×0，审计盲区）、筛选下拉占位字
  `#404040`。审计 URL 列表扩到 17 页，讨论帖/比赛详情/记录列表详情从列表页
  动态取 ID，游客跳登录的页面标记 `authGated` 跳过。
- **外壳动效**：命令面板/切换器补 160ms 退场（`.closing` + `lg-pop-out`，遮罩
  同步淡出）；标签弹层/难度菜单补进场；`.pal-row/.sw-row/.snav/指示条` 选中态
  过渡；toast 超限先淡出再移除；侧栏悬停浮层 120ms 淡入淡出
  （`html.rail-revealed`，hide 与 reveal 用序号作废避免竞态）；IDE 面板进场淡入；
  「切换时淡入」开关修好语义（`body.wall-fade` 挂过渡，此前两条路径都在动画）。
- **清瑕**：渲染层四处裸 `textContent` 错误屏换成 `shared/fatal.js` 主题化错误卡
  + 重试按钮；`.page` 加 `scrollbar-gutter: stable`（列表变长内容不再跳 ~12px）；
  截断文本补原生 tooltip（`el()` 助手按类名统一补）；侧栏自定义链接区恢复
  6px 细滚动条（此前直接裁掉）；一批 `:active` 按压反馈；URL 校验错误即输即清、
  空名称也标红；设置页「✓」字符换 CSS 勾线；「动态降载」行改正常文案；关于页补
  仓库/反馈链接（设置窗加 `setWindowOpenHandler` 走系统浏览器）；删除
  `#rail.empty-top`/`#tb-avatar.active`/`.rail-spacer` 死代码。
- **token 收敛**：rail 按钮圆角、热力图小格归 `--r-sm/--r-xs` 刻度；
  `--blur-lg/--blur-sm` 从 `--blur` 派生（性能模式归零联动）；遮罩色 token 化
  （`--scrim`）；焦点环 `--focus-w`；皮肤侧 `--lg-scrollbar-w/--lg-focus-w/
  --lg-gutter-top` 补定义（此前永远走 fallback）；`accentLine` 从 theme.js 接进
  blockquote；新增 `accentHover`。
- **审计基建**：每页独立 entry（跨页导航的旧文档状态会污染度量）、等
  `--lg-text` 可解析再度量、审计页冻结过渡/动画（链接过渡的水合中间态会读出
  官方灰——`darkCount:54` 假阳性的根因）、隐藏窗口截图 `capturePage` 拿不到
  合成层时用 CDP `Page.captureScreenshot` 兜底、`LG_SURVEY_DUMP=1` 转储
  表头/固定元素/模式探针。
- **验收**：`npm run check` 330 项；14 个冒烟探针 3 批全 PASS；
  `SMOKE_SKIN_AUDIT` 17 页 × 亮/暗（游客可见 13 页全零，其余 authGated 标记）。

### 15.14 0.7.2（R70）同层透出 · 主页融合 · 侧栏抽屉

**用户三问**：题库页半白半透（截图实锤：筛选卡 80% 白 + 列表行全透 +
chips/输入框各自写死 92%/84%/95%/70%，同屏多深度）；侧栏开合闪烁缩放不自然
+ 删左上角 luogu 标志；主页与官方主页融合（两问均由用户拍板：透明=全员同
层、主页=原生融合）。

- **同层透出**：material.js 新档位 `raiseAlpha`（承载面统一浮起档，默认
  11%，随 glass 归零）与 `codeAlpha`（代码块例外层 = 浮起档+55，下限 55%）；
  `cardAlpha` 保留但仅外壳原生卡片使用。皮肤孤岛全部收编：卡片白名单/
  筛选 chips/输入框/搜索框/分页条/分页按钮/bottom-wrap/文章操作条/按钮底
  → `var(--lg-raise)`；`--lg-card-alpha` 从皮肤移除。dark-only 三条
  （col 灰带、mobile-body、wrapper background）改亮暗通用。正文投影保护
  改挂 `pageScrim <= 40`。glass=100 时 raise/scrim 真 0（100% 透出承诺保持），
  代码块保 55%、浮层保 60%。
- **主页融合**：官方主页实为 2015 旧版 `#app-old`（lentille-context 只有
  彩蛋注释），数据走 DOM 抓取：`fetchOfficialHome()` 在隐藏窗口抓日历块
  倒计时（`距X还剩N天`）与欢迎/运势文本（`.lg-punch`），容错独立、失败保
  留上轮 partial；`buildContests()` 把 /contest/list 扩成 5 场列表。主页
  重排：头部「你好，name」+ 日期/寄语；右栏 官方问候卡（缺席隐藏）→ 比赛
  日历卡（官方倒计时+近期比赛列表+进行中剩余时间钟）→ 签到 → 离线队列；
  左栏不变（热力图/最近提交）。homeKey 加入 contests/official 摘要。
- **侧栏抽屉**：`animateRailDrawer()` 宽度补间 56→208（170ms）/208→56
  （150ms）ease-out，token 作废可折返反向；关闭在补间完成才 setVisible，
  替换 executeJavaScript+固定 130ms 腰斩链路；浮层面板近实心 96% +
  内容 90ms 淡入（消双层叠染/图标重影）；`#rail-mark` 两处删除，钉子
  margin-left:auto。钉住/取消：`@property --rail-current-w` 注册为
  <length> 使外壳 grid-template-columns 可过渡 + `animateRailLayout()`
  页面 view 同步 180ms 补间（layout()/resize 作废并落定；perf 模式瞬切）。
  **计划偏离说明**：浮层 y 保持 TITLE_H 未上移到工具条下（保钉子在浮层
  头部可用、避免浮层与壳层头条错位拼接；工具条左段覆盖为既有行为，近实心
  面板后无闪烁）。
- **旧版首页补覆盖**（审计扩到 18 页后暴露）：`#app main` 内联
  rgb(239,239,239)、`.am-panel` 系列白底、`#lg-slider`、日历深绿字、
  倒计时深灰字、比赛状态徽标深蓝/暗红、页脚栏目灰字、黄/绿徽标白字
  （1.66:1）—— 全部只清色；审计 over 指标排除 `.am-slider` 轮播轨道
  （按设计横向溢出）。
- **验收**：check 353 项；探针 PERF/RAIL/VISUAL/GLASS/PALETTE/TOAST/
  LIST_CLICK/LANG/DRAFT/KEYS/HISTORY/IDE/OFFLINE/ADBLOCK 全 PASS；
  `SMOKE_SKIN_AUDIT` 18 页 × 亮/暗全零；审计 tiers 同层指标
  （承载面 alpha min=max=0.11、spread 0）。
- **坑**：executeJavaScript 注入脚本的模板字符串里 `\n`/`\s` 会被 JS
  转义成真实换行/丢反斜杠，注入即语法错误——源码里必须写双反斜杠
  `\\n`/`\\s`（本轮 fetchOfficialHome 首跑即栽）。审计 tiers 指标可量化
  「同层」验收。

## 15.15 R71（v0.7.3）生产加固 — heymegabyte/agent-skills 教义落地

2026-11-01。目标：按 agent-skills（07 质量验证 / security-hardening / slop-detection /
production-observability / evidence-collection）把桌面版打到生产级。

- **slop 扫描**（TODO/FIXME/lorem/coming soon/写死 placeholder）：src+scripts 零命中
  （仅合法 input placeholder / CSS / 探针引用）。`npm audit --omit=dev` 零漏洞。
- **安全出口单源**：新 `src/main/external.js` 导出 `safeOpenExternal(raw)`——URL 解析
  后仅放行 `https:`/`http:`，其余 scheme（file://、smb://、lgoff://、自定义协议）
  静默丢弃；解析失败同样丢弃。views.js 六处（openDetail 非洛谷分支、openCustom、
  openExternal() 方法、setWindowOpenHandler else、右键「在浏览器打开此页」、
  will-navigate else）+ window.js 设置窗一处全部收口；`shell` 从两文件的 electron
  解构中移除，全仓 `shell.openExternal` 仅剩 external.js 内一处。落地 Electron
  安全清单「openExternal 必须验证协议」条款。
- **崩溃可观测性**：index.js `persistCrash()` 把未捕获异常 JSON 行追加到
  `logs/crash.log`（app.getPath("logs")，userData 标准 logs 目录；隔离测试实例落
  自己的 profile）。仅追加、失败静默——崩溃路径上不允许二次抛出。
- **自述文档**：新增 `desktop/README.md`（运行/验证/结构/安全边界）。
- **check 353 → 358**：external.js 协议白名单、views/window 接入、裸调用清零、
  六处收口计数、crash.log、版本 0.7.3 共 6 项新断言；旧断言「views.js 站外链接
  出口」同步改为 safeOpenExternal 口径。
- **证据**（evidence-collection 教义）：`.lg-dev/` 保留审计 JSON、截图与探针日志。

## 15.16 R72（v0.7.4）评审团整改 — sandbox/导航防护/查找缩放/便携包

2026-11-01。首轮评审团 73/79/77 分后的整改轮，P0/P1 全修。

- **sandbox:true ×4**：shell/rail/page/settings 四个 preload 只用
  ipcRenderer/contextBridge/process.argv（沙箱全兼容），四个渲染宿主全部
  `sandbox:true`（Electron 清单条款 1）。探针矩阵回归确认 argv 旗标链路
  （boot-bg/adblock/motion）不受影响。
- **主壳/设置窗导航防护**：两个 BrowserWindow 补 will-navigate 一律
  preventDefault、window-open 一律 deny、will-attach-webview 拒绝——被拖入
  页面不再能继承 shell preload 的 window.lg 特权桥。
- **离线页 CSP**：lgoff 模板加 `default-src 'none'`（script 全禁）+ 快照
  捕获侧剥 on* 事件属性与 javascript: 链接（深度防御双闸）。
- **Ctrl+F 页内查找**：主进程 before-input-event 截键 → `app:find-open` 发
  页面 preload → 查找条（输入/计数/上下翻/Esc）→ `app:find` invoke → 主进程
  `findInPage`/`stopFindInPage` → found-in-page → `app:find-result` 回传。
  查找条与页面同生命周期， Esc 清除高亮。
- **Ctrl+=/-/0 阅读缩放**：before-input-event 直接 setZoomLevel（entry.zoom
  会话内随视图保持），页面内 `app:zoom-hud` HUD 提示百分比，900ms 淡出。
- **其他**：渲染崩溃重载上限（3 次后停+提示）；下载文件名 basename 收敛；
  权限检查放行洛谷源 clipboard-sanitized-write（站内代码块复制恢复）；
  uncaughtException 加用户可见 toast；smoke 惰性 require；
  pack-portable.ps1 便携包（冒烟验证 SMOKE_OK）；LICENSE(MIT)；CHANGELOG；
  版本 tag；gen:icons 覆盖守卫（-Force 才重生成）；README gen:icons 措辞修正。
- **明确缓期**（二次评审需知）：NSIS/签名/自动更新（v1.0，ROADMAP 排期）、
  AT 下划线题号（pid 大小写规范化涉及 store/快照键位，v0.8）、check.js
  grep 型断言升级为行为断言（已有 ~25 条行为断言，升级按增量做）、
  登录态皮肤审计（需要真实账号登录态，见 §15.14 已知限制）。
- check 358 → 369。
