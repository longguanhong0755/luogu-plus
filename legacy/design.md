# LuoguLab 设计规范（design.md）

> 本文件是**可执行**的设计规范：每条规则都有对应的 CSS token 与机器检查（见文末「守卫」）。
> 改了样式而违反本规范，`bash scripts/check-all.sh` 会红。
>
> 规范参照（均为各设计系统的官方公开刻度，不是拍脑袋）：
> - **GitHub Primer** —— 圆角/间距/按钮尺寸刻度、4/8px 网格原则、焦点环
> - **Microsoft Fluent 2** —— 控件高度与圆角、嵌套圆角"内层比外层小 2px"、控件规格表
> - **Apple HIG / Material Design 3** —— 嵌套圆角公式 `内层圆角 = 外层圆角 − 间距`
>   （Apple: "concentric shapes calculate their radius by subtracting padding from the parent's"；
>   Material 3: 48dp − 14dp = 34dp）

---

## 0. 三条不可违背的原则

| # | 原则 | 理由 |
|---|---|---|
| 1 | **一切长度用 token**，不写裸值 | 95 处硬编码 padding / 83 处硬编码 gap 就是"排版不统一"的根源 |
| 2 | **像素必须是整数**（字号、行高、边框、圆角） | 半像素（现有 `--fs-base: 12.5px`）在 1x 屏被像素对齐成 12 或 13，在 1.5x/2x 屏产生半像素模糊 |
| 3 | **4px 是网格基数**，其余刻度由它派生 | Primer 明确"we're trying to stick to a 4 or 8px grid for component sizes" |

---

## 1. 间距刻度（`--lg-space-*`）

基数 4px。允许半分档（6/10）用于紧凑控件内的微调——这是 Fluent 2 的做法。

| token | 值 | 用途 |
|---|---|---|
| `--lg-space-0` | 0px | 复位 |
| `--lg-space-1` | 2px | 图标与文字之间、1px 描边的补偿 |
| `--lg-space-2` | 4px | 紧凑控件内边距（如 20px 高的小按钮） |
| `--lg-space-3` | 6px | 控件内文字与边框的呼吸（Primer input 5px→本规范取 6px 整数档） |
| `--lg-space-4` | 8px | **默认控件内边距**、图标与文字的标准间距 |
| `--lg-space-5` | 10px | 半档，滑杆标签间距 |
| `--lg-space-6` | 12px | 卡片内边距（紧凑）、图标按钮内边距 |
| `--lg-space-8` | 16px | **默认卡片内边距**、按钮水平内边距 |
| `--lg-space-10` | 20px | 大按钮水平内边距、卡片之间 |
| `--lg-space-12` | 24px | 区块之间 |
| `--lg-space-16` | 32px | 大区块分隔 |

**规则**：`padding` / `gap` / `margin` 的值必须落在上表内（`0` 允许）。

---

## 2. 圆角（`--lg-radius-*`）

### 2.1 刻度

| token | 值 | 语义 | 适用范围 |
|---|---|---|---|
| `--lg-radius-none` | 0px | 技术、表格、终端 | 数据表、等宽代码块、贴边元素 |
| `--lg-radius-sm` | 4px | 低调、精确 | 小徽章、内层元素、复选框、嵌套内层 |
| `--lg-radius` | **8px** | 中性、现代 | **按钮、输入框、菜单项、开关**（跟随用户滑杆） |
| `--lg-radius-lg` | 12px | 友好 | 卡片、面板 |
| `--lg-radius-xl` | 16px | 柔和 | 弹层、对话框、悬浮大卡 |
| `--lg-radius-pill` | 999px | 胶囊 | 状态芯片、标签；**不是主按钮**（按钮用 8px） |

**语义依据**（业界共识）：0 = 技术/正式；2–4 = 企业/低调；6–12 = 现代消费应用（GitHub、Linear、Stripe、Notion 都在此区间）；16–24 = 消费级/柔和；9999 = 胶囊。本产品定位是**编程工作台**（信息密度高、长时间使用），因此主体落在 **8px**，不取 12/16 的大圆角。

### 2.2 圆角随尺寸变化（对数而非线性）

| 元素高度/尺寸 | 圆角 |
|---|---|
| 16–24px（徽章、小图标） | 4px |
| 28–40px（按钮、输入框） | 8px |
| 100–300px（卡片） | 12px |
| 全宽面板 / 弹层 | 16px |
| 正方形头像 / 圆点 | 50% |
| 胶囊 | 999px |

### 2.3 嵌套圆角公式（**硬规则**）

> **内层圆角 = max(0, 外层圆角 − 两者间距)**

同半径嵌套时，角上的间距会比边缘厚约 **41%**（√2 倍），肉眼即觉得"崩"。
Apple 与 Material 3 都用这条公式。

```css
.card { --r: 12px; --pad: 12px; border-radius: var(--r); padding: var(--pad); }
.card > .inner { border-radius: max(0px, var(--r) - var(--pad)); }  /* = 0 */
```

Fluent 2 的等价表述：**外层 8px → 内层 6px → 再内层 4px**（每层减 2px）。

**落地点**：卡片内的输入框（8px→4px）、弹层内的按钮（16px→8px）、侧栏内的列表项（12px→8px）。

---

## 3. 控件尺寸（`--lg-ctl-*`）

Primer 按钮规格是精确的，直接采用（Primer 官方文档值）：

### 3.1 按钮

| 档 | 高度 | 字号 | 水平内边距 | 圆角 | 字重 |
|---|---|---|---|---|---|
| `--lg-ctl-sm` | **28px** | 12px | 12px | 8px | 500 |
| `--lg-ctl-md`（默认） | **32px** | 13px | 16px | 8px | 500 |
| `--lg-ctl-lg` | **40px** | 14px | 20px | 8px | 500 |

Primer 用 12/14/14px 三档字号；本产品正文基线是 13px（比 Primer 大 1px 是因为中文字形在 14px 以下偏糊），故中档取 13px、大档取 14px。

### 3.2 其它控件

| 控件 | 规格 |
|---|---|
| 图标按钮 | 28×28（sm）/ 32×32（md），**正方形**、圆角 8px、图标 16px、描边 1.5px |
| 文字输入框 | 高 32px，水平内边距 12px，圆角 8px |
| 下拉 / 分段控件 | 高 32px，圆角 8px；分段控件选中项内缩 2px |
| 复选框 | 20×20，圆角 4px |
| 开关 | 38×21，圆角 999px（胶囊），滑块 15px 圆点 |
| 滑杆轨道 | 高 3px，圆角 999px；滑块 15px 圆点 |
| 最小可点击区 | **28×28**（桌面）；触屏 44×44 |

### 3.3 按钮排版规则

- 文字与图标之间固定 **8px**（`--lg-space-4`），图标 16px 与 13px 文字视觉对齐（基线对齐，不是居中）
- 按钮内**不允许**出现非整数像素的内边距
- 同一行按钮的**高度必须一致**（不同档位可以不同，但同行不能混）
- 文字按钮的最小宽度 = 文字宽 + 2×16px，保证短标签（"确定"）不显得局促
- 主按钮在一组里**最多一个**（其余为次要/幽灵按钮）

---

## 4. 排版刻度（`--lg-fs-*`）

| token | 字号 | 行高 | 用途 |
|---|---|---|---|
| `--lg-fs-micro` | 10px | 14px | 角标、计数徽章 |
| `--lg-fs-caption` | 11px | 16px | 辅助说明、提示文字（**现有 `--fs-sub` 的正确归属**） |
| `--lg-fs-small` | 12px | 16px | 表格、次要标签 |
| `--lg-fs-body` | **13px** | 20px | **正文默认**（现有 `--fs-base: 12.5px` 的整数化） |
| `--lg-fs-lead` | 14px | 20px | 按钮文字、输入框文字、强调 |
| `--lg-fs-h3` | 16px | 24px | 卡片标题 |
| `--lg-fs-h2` | 20px | 28px | 区块标题 |
| `--lg-fs-h1` | 24px | 32px | 页面标题 |

**规则**：禁止非整数字号（`12.5px`、`13.5px` 一律不许）；行高与字号的比例落 1.2–1.6，中文取 1.4–1.55 更舒服。

---

## 5. 焦点环（Focus ring）

键盘可见、鼠标不可见，是可达性的底线。

```css
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```

- 偏移 2px 而非 0：与 Primer 的 `0 0 0 3px rgba(...)` 等效，但用当前主题色，深浅主题都清晰
- 圆角元素的焦点环跟随自身圆角（`border-radius` 会被 outline 自动跟随）
- **禁止** `outline: none` 而不给替代样式

---

## 6. 动效

| token | 值 | 用途 |
|---|---|---|
| `--lg-dur-fast` | 80ms | hover 反馈、颜色变化（Primer fast） |
| `--lg-dur-base` | 120ms | 按钮按下、开关滑动 |
| `--lg-dur-slow` | 200ms | 面板展开、浮层淡入（Primer normal） |

缓动统一 `cubic-bezier(0.4, 0, 0.2, 1)`（Primer standard）。

`prefers-reduced-motion: reduce` 下，所有过渡降级为不透明度过渡。

---

## 7. 层级（Elevation）

玻璃材质下阴影要轻，重了会显脏。

| 级别 | 用途 | 配方 |
|---|---|---|
| 0 | 页面 | 无阴影 |
| 1 | 卡片、按钮 | `0 1px 2px rgba(0,0,0,.06)` |
| 2 | 下拉、菜单 | `0 4px 12px rgba(0,0,0,.10)` |
| 3 | 弹层 | `0 12px 32px rgba(0,0,0,.14)` |
| 4 | 对话框 | `0 24px 56px rgba(0,0,0,.18)` |

---

## 8. 落地：token 定义（`src/material.css`）

```css
:root {
  /* 间距 */
  --lg-space-0: 0px;  --lg-space-1: 2px;  --lg-space-2: 4px;  --lg-space-3: 6px;
  --lg-space-4: 8px;  --lg-space-5: 10px; --lg-space-6: 12px; --lg-space-8: 16px;
  --lg-space-10: 20px; --lg-space-12: 24px; --lg-space-16: 32px;

  /* 圆角 */
  --lg-radius-none: 0px; --lg-radius-sm: 4px; --lg-radius: 8px;
  --lg-radius-lg: 12px; --lg-radius-xl: 16px; --lg-radius-pill: 999px;

  /* 控件尺寸 */
  --lg-ctl-sm: 28px; --lg-ctl-md: 32px; --lg-ctl-lg: 40px;
  --lg-ctl-icon-sm: 28px; --lg-ctl-icon-md: 32px;

  /* 字号 */
  --lg-fs-micro: 10px; --lg-fs-caption: 11px; --lg-fs-small: 12px;
  --lg-fs-body: 13px;   --lg-fs-lead: 14px;   --lg-fs-h3: 16px;
  --lg-fs-h2: 20px;     --lg-fs-h1: 24px;

  /* 动效 */
  --lg-dur-fast: 80ms; --lg-dur-base: 120ms; --lg-dur-slow: 200ms;
  --lg-ease: cubic-bezier(0.4, 0, 0.2, 1);
}
```

兼容别名（历史代码已在用，逐步替换）：

| 旧名 | 新 token |
|---|---|
| `--fs-base`（12.5px） | `--lg-fs-body`（13px，整数化） |
| `--fs-sub`（11px） | `--lg-fs-caption` |
| `--surface` / `--surface-2` / `--hairline` | 保持（材质单源的别名，见 material.css 注释） |

---

## 9. 现状差距（2026-10-22 审计）

| 项 | 现状 | 规范 | 差距 |
|---|---|---|---|
| 硬编码 `padding` | **95 处** | 0 处 | 全部要 token 化 |
| 硬编码 `gap` | **83 处** | 0 处 | 同上 |
| 字号档位 | 4 种混用（11 / 12 / 12.5 / 14） | 7 档单一刻度 | `--fs-base` 12.5px 需整数化 |
| 按钮高度 | 30 / 28 / 24 / 40 混用 | 28 / 32 / 40 | 统一到三档 |
| 图标按钮 | 30×30 | 28 / 32 | 统一 |
| 圆角 | 已 token 化 90%，但档位语义未定义 | 见 §2 | 补语义映射 |
| 焦点环 | 15 条 `:focus-visible` | 统一 2px + offset 2px | 收敛为一条基线规则 |
| 动效 | 0.12s 散落 | 80/120/200 | token 化 |

---

## 10. 守卫（机器检查）

`scripts/lint-design-tokens.cjs` 逐条检查：

1. `padding` / `gap` / `margin` 的像素值必须落在 §1 刻度内
2. `border-radius` 的像素值必须落在 §2 刻度内（`50%` / `999px` / 内圆角 / ≤3px 发丝级除外）
3. `font-size` 的像素值必须落在 §4 刻度内，**且必须是整数**
4. 按钮类（`.btn` / `.icon-btn`）的高度必须落在 §3 控件尺寸内
5. 禁止 `outline: none` 出现在可聚焦元素上（除非同规则内给了 `:focus-visible` 替代）

规范改了 → 改 `design.md` + 改 `src/material.css` 的 token + 重新生成守卫的刻度表 → 一次性生效。

---

## 11. 引用

- Primer 设计令牌：https://primer.style/design/primitives/design-tokens
- Primer 按钮规格：https://primer.style/components/button
- Fluent 2 设计令牌：https://fluent2.microsoft.design/design-tokens
- Radix Themes 间距：https://www.radix-ui.com/themes/docs/theme/spacing
- 嵌套圆角公式（Apple/Material）：见 §2.3
