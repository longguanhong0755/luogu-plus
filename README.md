# 洛谷桌面版（Luogu Desktop）

为 Windows 打造的洛谷客户端，v0.7.15。**不是网页套壳**：

- **题库 / 训练 / 比赛 / 记录 / 讨论 / 文章是原生列表**——搜索、筛选、翻页都不加载整页，
  **鼠标点行直接打开**（键盘 Enter/方向键同样可用）；点进详情「后退」即回来源列表。
- **提交是对的**：语言表实时对齐洛谷 `/_lfe/config`（C++17→12、C++20→27、Python 3→7…），
  **O2 开关**只对支持的语言可勾；不认识的语言拒绝静默替换，转页面内提交辅助。
- **草稿按题目隔离**：A 题的代码不会出现在 B 题的编辑器里；语言/O2 作为全局偏好沿用。
- **导航像浏览器**：`F5`/`Ctrl+R` 刷新、`Alt+←/→` 后退前进、`Ctrl+W` 关页面
  （进最近关闭栈，`Ctrl+Shift+T` 找回）、页面右键菜单、下载自动落「下载」文件夹。
- **反馈看得见**：提交/签到等轻提示在页面上也会出现（不再被阅读面盖住）；
  签到失败会写明原因；比赛开始前按设置的提前量弹系统通知。
- **4.0 视觉重构**：GitHub Primer / Linear / VS Code / Windows 11 Fluent 的尺寸与状态规则；
  40px 标题栏、44px 工具条、1080px 内容列，13/14px 阅读字号，2px 焦点环。
- **侧栏默认为 64px 图标栏**：悬停只显示原生提示，不改变布局；用钉子或 `Ctrl+B`
  可固定展开到 208px。当前栏目有唯一高亮，图标栏与页面视图共享同一宽度状态。
- **壁纸透出可调**：设置 → 外观 →「壁纸透出」0–100，拉到 100 时内容面完全透明，
  壁纸原样透出；中间档位按可读下限兜底，不会出现文字压不住背景。
- **广告拦截可关**：设置 → 通用 →「拦截广告」，默认开启，切换后当场生效
  （不重启、不刷新已开页面）。
- 左侧导航可**排序、显隐、加自定义链接**（设置 → 侧边栏）。
- **洛谷 Plus 兼容增强**：随机跳题（8 难度 × 5 题库）、纯数字/CF 简写补全、
  划词识别题号、用户搜索、他人介绍（Markdown/公式/B 站）、练习页难度显色、动态内容检测与“逆天改运”。
- **主页与设置可配置**：主页板块显隐、全部增强开关、设置导入/导出/恢复默认。
- **性能优先开关 + 动态降载**：失焦、最小化、滚动、切页时自动暂停壁纸与页面动效；
  设置 → 通用可关闭全部模糊与动画。
- 壁纸支持**文件夹轮换与 Wallpaper Engine 导入**（视频壁纸可播，场景壁纸以预览图呈现）。
- 登录页**不会自动弹 Windows 安全窗口**；只有点击“通过通行密钥登录”才会唤起。
- 窗口/托盘使用**洛谷官方图标**。

像素级设计规范见 [design.md](design.md)：全部尺寸、颜色、透明度公式、对比度与动效曲线。
逐页面/逐功能四维质量门禁见 [docs/QUALITY-MATRIX.md](docs/QUALITY-MATRIX.md)；内存与交付体积见 [docs/PERFORMANCE.md](docs/PERFORMANCE.md)。
迭代路线、每轮范围与验收标准见 [ROADMAP.md](ROADMAP.md)（0.6.0 R54–R63、0.7.0 R64 皮肤收敛、0.7.1 R69 丝滑打磨、0.7.2 R70 同层透出·主页融合·侧栏抽屉、0.7.3 R71 生产加固（openExternal 协议白名单/崩溃落盘/自述文档）、0.7.4–0.7.15 R72–R83 评审加固与 parity 增量，以及 0.7.15 R84 登录态补证均已交付）。

## 目录结构

```
desktop/   当前应用（Electron 39）
  src/main/      主进程，按领域拆分：
                 index / config / theme / wallpaper / sections /
                 views / passkey-guard / luogu / tray / notify / ipc / smoke
  src/preload/   shell / settings / page 隔离桥
  src/renderer/  shell（标题栏/折叠侧栏/主页/原生列表/命令面板/IDE）
                 settings（七分区设置窗）
                 skin（洛谷页面皮肤 + 页面壁纸复刻层）
legacy/    3.17.0 旧版 LuoguLab 完整归档（git 历史保留，可作参考/回退）
```

## 开发

```bash
cd desktop
npm install
npm start          # 热加载开发启动（渲染层原地刷新，主进程/预加载自动重启）
npm run start:plain # 无文件监听的 Electron 启动
npm run check      # 静态检查：语法、必需文件、HTML 引用、IPC 双向、产品关键约束
npm run smoke      # 不可见启动 + 截图到 ../.lg-dev/（隔离 userData）
npm run gen:icons  # 自绘应用/托盘/角标图标（蓝底白洛字；已入库的官方标不会被覆盖，强制重生成加 -Force）
```

**便携包**（无需 Node 工具链，解压双击 electron.exe 即用）：

```bash
cd desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-portable.ps1
# 产物：.lg-dev/dist/luogu-desktop-<版本>-portable.7z / -portable.exe（低于 100MB；自签为终态）
#
# 自签信任说明：包内 electron.exe 带 CN=Luogu Desktop (self-signed dev) 代码
# 签名，证书公钥同目录导出（luogu-desktop-selfsigned.cer）。SmartScreen 对
# 自签名仍会提示「仍要运行」；如需校验，安装 .cer 到「受信任的发布者」后
# 签名状态变为「有效」。（自签为 owner 拍板的终态发布形态；不再采购正式证书）
```

调试用冒烟开关（都走隔离 userData、窗口 opacity=0）：

```bash
LG_SMOKE_NET=1  npm run smoke            # 允许真实网络
LG_SMOKE_LIB=1  npm run smoke            # 逐个截图原生列表
LG_SMOKE_LUOGU=1 npm run smoke           # 打开 P1001 并截图阅读面
LG_SMOKE_FIND=1 npm run smoke            # R76：Ctrl+F 查找条/缩放 HUD 行为探针（真实键鼠链）
LG_SMOKE_SEC=1 npm run smoke             # R77：安全注入探针（window.open/跨源导航断言全拒）
LG_SMOKE_AUDIT=1 npm run smoke           # 深色/浅色对比度审计 → ../.lg-dev/audit-dark.json
LG_SMOKE_THEME=light npm run smoke       # 以浅色模式跑同一套
npm run smoke                           # 默认必跑 64↔208、active、键盘、滚动与页面视图同步
LG_SMOKE_PERF=1 npm run smoke            # 性能模式：模糊归零 + 失焦冻结/聚焦恢复
LG_SMOKE_FOLDER=<dir> / LG_SMOKE_WE=<dir> npm run smoke   # 壁纸文件夹 / Wallpaper Engine
LG_SMOKE_CAPTCHA_MANUAL=1 npm run smoke   # 验证码不自动识别，等人工写答案文件（默认自动 ddddocr）
LG_SMOKE_OFFLINE=1 npm run smoke          # 断网链路：缓存列表/lgoff 快照页/离线队列/联网重放（全程不联网）
LG_SMOKE_VISUAL=1 npm run smoke           # 额外截图命令面板/切换器并输出布局度量
LG_SMOKE_IDE=1 LG_SMOKE_LUOGU=1 npm run smoke   # 额外打开 IDE 并输出分栏/行号度量
LG_SMOKE_SIZE=1000x640 npm run smoke      # 按指定窗口尺寸跑同一套截图（最小布局验收）
LG_SMOKE_LIST_CLICK=1 npm run smoke       # R54：列表行鼠标点击打开题目
LG_SMOKE_LANG=1 npm run smoke             # R54：语言表映射（联网时对照 /_lfe/config 漂移）
LG_SMOKE_GLASS=1 npm run smoke            # R55：壁纸透出滑杆实际改变三层透明度
LG_SMOKE_DRAFT=1 npm run smoke            # R56：草稿按题隔离（IPC + 切题 UI 双断言）
LG_SMOKE_HISTORY=1 npm run smoke          # R57：详情返回列表 + 最近关闭恢复
LG_SMOKE_TOAST=1 npm run smoke            # R58：页面在场时 toast 双侧可见
LG_SMOKE_KEYS=1 npm run smoke             # R60：Ctrl+W 关页面 / Alt+← 后退（合成键盘事件）
LG_SMOKE_PALETTE=1 npm run smoke          # R61：命令面板题目/页面/恢复三类结果
```

**验证码**（可选能力 + 明确边界）：本机装有 Python + `pip install ddddocr` 时，
**图片验证码**自动识别填写（登录冒烟已实测一次通过）；提交代码遇到的是洛谷反自动化的
**易盾交互式滑块**，应用不做绕过——转为页面内提交辅助：自动打开题目提交区、把代码填进
洛谷编辑器，用户完成滑块后自己点“提交评测”。（洛谷在接口响应中声明：评测接口仅供个人
练习，自动化/商业用途应走其开放平台 docs.lgapi.cn/open。）

## 断网可用

应用不是网页套壳：核心数据先落盘、再上屏，断网时大部分功能仍然可用。

- **秒开**：列表与主页启动时先回填上次的数据快照（`userData/store/`），后台再刷新，
  第一帧就是内容，不等网络。
- **离线可看**：打开过的题目自动保存已渲染的题面快照（保留洛谷渲染的公式与代码高亮），
  断网时通过本地 `lgoff://` 协议打开；列表/主页/打卡/最近提交读缓存并标注「离线数据」。
- **离线可写**：IDE 草稿防抖落盘，重启恢复；断网点提交会进入**离线队列**
  （主页可见），联网后自动重放——走与手动提交完全相同的管线（含验证码自动识别），
  结果以通知告知。遇到验证码/滑块的条目会标出来，点行到题目页手动完成。
- **不白等**：页面 fetch 9 秒超时；OS 级断网被在线轮询 + 页面反馈双重感知后，
  所有请求立即走缓存，不再重试轰炸。

## 设计速览

- **三层模型**：驾驶舱（原生列表 + 主页 + 设置）· 阅读面（洛谷网页 + 统一皮肤）·
  工作台（IDE / 提交 / 评测通知 / 托盘）。
- **主页**：两栏仪表盘——打卡热力图（14px 格子、图例、月份/星期）+ 最近提交，
  右栏签到、学习概览、比赛倒计时、离线队列。
- **设计令牌**：字号 11/12/13/14/16/20/24；间距 4/8/12/16/24/32；
  圆角 4/6/8/12/999；控件 28/32/36/44；行高 44/56；动效 100/160/220ms。
- **材质公式**（滑杆 m 0–100 + 壁纸透出 g 0–100）：外壳 `94−0.2m−0.25g`%、
  页面纱层 `97−0.06m−0.42g`%、卡片 `99−0.08m−0.32g`%、模糊 `6+0.24m` px；
  可读下限：外壳 58 / 纱层 50 / 卡片 55。
- **对比度**：正文 ≥ 4.5:1，焦点环 2px 强调色；主按钮文字按 `--accent-fill` 计算，
  自定义强调色另有 `--accent-text` 保证文字可读。
- **快捷键**：`Ctrl+K` 面板 · `Ctrl+L` 题号/随机跳题 · `Ctrl+U` 用户搜索 ·
  `Alt+L` 题库 · `Ctrl+B` 固定/收起侧栏 · `F6` 聚焦侧栏 ·
  `Shift+F6` 返回页面 · `Ctrl+Tab` 切换器 · `Ctrl+,` 设置 ·
  `F5`/`Ctrl+R` 刷新 · `Alt+←/→` 后退/前进 · `Ctrl+W` 关页面 ·
  `Ctrl+Shift+T` 恢复关闭 · `Ctrl+F` 页内查找 · `Ctrl+=`/`Ctrl+-`/`Ctrl+0` 阅读缩放 ·
  `F11` 全屏 · `F12` 开发者工具（自动临时卸下通行密钥守卫）。
- **无标签**：板块单例常驻、题目/详情 LRU、`Ctrl+Tab` 找回；rail 是唯一导航。
- **站外链接**一律交给系统默认浏览器；应用内只渲染 `*.luogu.com.cn` / `*.luogu.org`。
- 不记忆会话：每次启动回到主页；托盘常驻，关窗默认收托盘，单实例聚焦。

## 壁纸

| 来源 | 说明 |
| --- | --- |
| 跟随桌面 | 读注册表当前壁纸 |
| 内置 | 随强调色生成的渐变 |
| 每日一图 | Bing，按天缓存 |
| 单张图片 | 图片或视频文件 |
| 文件夹轮换 | 递归 3 层，间隔 15 分钟–每天，随机顺序 |
| Wallpaper Engine | 扫描 `431960` 工坊目录或 Steam 库；视频可播，场景/网页以预览图呈现 |

外壳与洛谷页面用同一个 `Date.now()` 相位公式做漂浮/缩放，两侧边缘始终对齐；
系统开启“减少动态效果”时自动停用。

## 边界

- 只读写应用自己的 `userData`；测试用 `LG_USERDATA` 指向隔离目录。
- 测试窗口全程不可见（`opacity=0` + `showInactive`），不抢焦点。
- 登录态 = `__client_id` + 非零 `_uid`（游客 `_uid=0` 不算登录）。
- 记录列表需要登录；未登录显示登录引导而不是空列表。

## 说明

洛谷页面的数据在 `#lentille-context` 的 JSON 里；皮肤通过改写 `--theme-*` 变量实现，
并借助系统主题源让站点走官方深色主题，避免逐类覆盖导致语义色丢失。
通行密钥守卫通过 CDP `Page.addScriptToEvaluateOnNewDocument` 注入主世界
（`contextIsolation` 下 preload 只作用于隔离世界）。
