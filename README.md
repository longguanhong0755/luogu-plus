# LuoguLab（洛谷编程工作台）

面向编程的洛谷（luogu.com.cn）桌面工作台。Electron 39 免安装绿色版：
双击即开、多标签浏览（可拖拽排序 + 分组 + 左右分屏）、地址栏三合一（网址/题号/映射词）、
内置 IDE 标签与分屏编辑器、命令面板、历史/下载/清理、阅读模式与翻译、账号一键切换、
黑白线条风的 5 套配色预设 + 细粒度外观调校、持久登录。
v3.16.5 起界面尺寸与间距按 `design.md` 的像素级规范收敛，并有静态 + 运行时双重守卫。
v3.16.6 起面板类界面（命令面板 / F1 / 标签搜索 / 查找条）改走弹层覆盖层，键盘焦点可跨视图路由。

## 目录结构

```
D:\workspace\luogu++\repo\     # 源码根（仓库 luogu-plus；package.json name 仍为 luogu-glass）
├── main.js               # 主进程：标签/布局/注入调度/账号隔离会话/历史-下载-清理/
│                         #   菜单快捷键/自测钩子/自动登录(验证码辅助)
├── design.md             # 像素级设计规范（4px 网格/间距/圆角/控件/字号/焦点环/动效/层级）
├── preload-chrome.js     # 外壳层 contextBridge（onTabs/onUser/onConfig/onDownloads + 动作）
├── preload-config.js     # 设置页与历史页 contextBridge
├── src/
│   ├── material.css      # 材质单一来源（面/边框/内块/壁纸配方 + 设计令牌 + 选择器登记表）
│   ├── inject.css        # 美化注入层 + IDE 页专属适配（选择器来自真实 DOM 实扒）
│   ├── common.css        # 站外页通用能力样式（阅读/翻译/代码复制/视口裁剪）
│   ├── icons.js          # 四页共享图标（window.LGIcons）
│   ├── inject.js         # 注入运行时内核 + 装载器（v3.16.4：2521 → 627 行）
│   ├── inject/           # 注入能力模块 ×8（viewrect/wallpaper/material/reader/
│   │                     #   translate/selection/luogu-list/luogu-page）
│   ├── config-schema.json # 配置 schema（自动生成，启动时校验）
│   ├── types/            # tsconfig 的全局声明（window.lgChrome/lgConfig/lgApp/…）
│   ├── chrome/           # 应用外壳：垂直标签栏 + 工具行 + 坞渲染源 + 下拉 + 命令面板
│   ├── dock/             # 坞覆盖视图（R36：悬浮在页面之上，页面内容从它底下穿过）
│   ├── popup/            # 弹出层（菜单/命令面板/地址栏联想/悬停浮层/提示条）
│   ├── settings/         # 设置页（配色预设/视觉细节/布局/功能开关/账号/地址栏映射）
│   ├── history/          # 本地页：浏览历史 / 下载
│   ├── home/             # 应用首页（时钟/搜索/倒计时/快捷入口）
│   └── config/           # 旧版独立配置窗（保留）
├── assets/icon.ico       # 纯 Node 生成的单色图标（墨色方块 + 白 `</>`）
└── scripts/              # check-all.sh（9 步静态门禁）/ run-all-probes.sh（6 探针）/
                          #   lint-*.{js,cjs} / probe-*.cjs / sync-dev.sh / typecheck.sh
```

## 功能一览

- **外壳**：Edge 式垂直标签栏（默认收起；悬停=整条展开浮出，与"点箭头常驻展开"逐像素同一条——整高贴边、方角、盖住窄条、头尾按钮同位置，悬停不挤压页面、常驻展开才挤压；宽度可拖、可放左侧或右侧）/ 顶部标签条二选一；
  Edge 式标签分组（组头行 + 连续组色线 + 多选建组 + 就地改名 + **拖动合并**：
  拖到标签上建组/并组、拖到组头加入（折叠组也行）、拖出即移出、整组拖动排序）与
   左右两格分屏（v3.12.0 起只做左右并排：两格自动排到相邻、不许插到两格中间、右键可
   关左/关右/反转位置；上下/网格/主次/聚焦已按用户要求删除）；
   悬停浮层/右键菜单/命令面板都能整理标签页（排序/去重/自动建组，可撤销）；
  垂直模式顶栏两行（标题行：图标 + 网页描述居中，右端窗口三键；工具行：前进后退 + 网址 + 账号）；
  侧坞是悬浮栏（设置里选上/下/左/右，页面内容从它底下穿过、不再让位；方向跟着
  位置走：左/右 = 一竖列、上/下 = 一横条；网页自己进入全屏、题目页进入自带
  IDE 模式、或打开分屏编辑器时自动收起；坞项是**书签语义**（v3.13.0 起：普通点
  把当前页换成目标页，Ctrl+点击 / 中键才新标签打开）；悬停展开与窄条交接零
  闪烁（浮层画好才收窄条、收回也先画回侧栏再撤浮层）；缩放比例在窗口右上角实时
  显示（标签上不写比例）；
  下载面板；账号芯片下拉；命令面板（Ctrl+Shift+P）；快捷键总览（F1）
- **页面美化**：三态（原色/亮色/暗色整页重绘）× 5 套中性预设（墨白/宣纸/青灰/柔雾/高对比）；
  强调色、圆角、卡片不透明度、毛玻璃模糊、外壳不透明度、边框强度、动效开关；
  缩放页面时背景不缩放（壁纸层按缩放系数反向补偿，永远是"窗口几何的固定画"）
- **功能开关**（全部可单独关闭）：隐藏广告（页面规则 + 请求级拦截：题解页右栏
  推广卡的取数口 `/qiafan/` 与常见第三方广告域在加载层被掐断）、页面精简、快捷搜索、
  恢复上次标签、列表页快捷操作、代码块一键复制、难度徽章灰阶、IDE 保持原生
  （分屏编辑器不再挂题目页工具条，从命令面板或 Ctrl+Alt+I 开，打开时坞自动隐藏）
- **账号**：多账号独立会话分区，验证成功才保存，芯片下拉一键全局切换；
  图形验证码由本机 ddddocr 自动识别（最多自动 3 次，没过才转人工输入）
- **浏览器能力**：页面缩放、标签拖拽排序/分组/分屏、标签与网页两级右键菜单、
  历史（Ctrl+H，按日分组 + 单条删除）、下载接管（暂停/继续/取消/重试/另存为，记录持久化）、
  清除浏览数据（缓存/Cookie/历史/下载记录）、停止加载、搜索引擎可切换、
  地址栏联想、整页截图、画中画、阅读模式、划词/整页翻译
- **设计系统（v3.16.5）**：间距/圆角/字号/控件高度按 `design.md` 的像素规范与
  `material.css` 令牌实现（4px 网格、嵌套圆角 = 外层 − 间距），按钮只有 28/32/40
  三档；本地页 CSS/JS 走 `lgasset://`，升级后样式立即刷新，不受 `file://` 缓存影响
- **核心手感（v3.16.6）**：命令面板 / F1 快捷键表 / 标签搜索 / 页内查找条全部改走
  弹层覆盖层（浮在网页之上，不再被标签页盖住），↑↓/Home/End/Tab 选、Enter/Space 执行、
  Esc 关闭；焦点按"外壳 ↔ 弹层 ↔ 活动标签"路由（Ctrl+L 回地址栏、关面板回网页、
  切标签进标签），账号菜单重绘保验证码输入的值/光标/焦点；界面缩放 80%~140% 时
  页面与弹层几何按同一系数换算

## 架构要点

- **外壳与内容分离**：窗口自身页面 = 本地 chrome 层（标签/工具行/侧坞），
  内容区 = 多个 WebContentsView 标签页（洛谷页面 + 注入美化层）
- **omnibox 解析**（chrome.js `resolveOmnibox`，纯函数可测）：映射词 > 完整URL >
  luogu 域名省写 > 站内路径 > 题号 > UID > 站内搜索；站外地址在应用内新标签打开，
  该标签不锁域名（普通标签仍锁 luogu.com.cn）
- **pushUser**：洛谷新栈已移除 `_feInjection`，改为 DOM 探测
  （`img[src*="usericon"]` 提取 uid + 欢迎语文本提取用户名）
- **注入时序**：嗅探原生明暗（`window.__lgNativeTheme`，**在 insertCSS 之前**跑、
  只认不透明底色、认不出返回 `unknown` 不参与判定）→ `insertCSS` →
  `executeJavaScript(inject.js)` → `apply(cfg)`；全部 CSS 变量内联到 `<html>`
- **题目页自带 IDE 模式**（R38）：inject.js 判定（`/problem/` + 编辑器容器可见 +
  「退出 IDE 模式」文案）→ `data-lg-ide="1"`（与 /ide 页同一套原生规则）+
  `lgApp.ideMode` 上报 → 主进程让该标签视图铺满整窗（外壳与坞让位 = 真·全屏）
- **注入层模块化**（v3.16.4）：`src/inject.js` 627 行内核 + `src/inject/` 8 个能力
  模块，按依赖顺序拼成一段脚本一次 `executeJavaScript` 注入；缺模块整层不注入
- **设计系统单源**（v3.16.5）：`design.md` 写规范，`material.css` 是唯一实现；
  `scripts/lint-design-tokens.cjs` 静态守 9 项（含同规则重复 `border-radius`），
  `scripts/probe-design.cjs` 量运行时真实高度/圆角/字号
- **工程门禁**：`scripts/check-all.sh` 9 步（材质 / 契约 / 设计令牌 / 死代码 /
  静默失败 / 语法 / 类型基线 / 行尾 / JSON）；`scripts/run-all-probes.sh`
  6 个 CDP 探针 239 断言（隐藏隔离实例）
- **持久化地基**（R42）：`readJsonSafe` / `writeTextAtomic(Sync)` 一处收口六份数据
  （配置 / 账号 / 标签 / 窗口 / 历史 / 下载）。读坏先备份 `.corrupt-<时间>` 再回退；
  写走 `<file>.tmp-<pid>` + rename 原子替换；失败（ENOSPC / EACCES）记
  `lastWriteFailure` 并在外壳 toast 一次（60s 冷却）。新增持久化点不许再自己写
  `fs.writeFileSync`。

## 开发

```bash
npm install                 # electron@^39 + @electron/packager（走 npmmirror）
npm start                   # 开发运行
npm run dist                # 打包免安装绿色版
npm run gen:icon            # 重新生成图标
```

提交前门禁：

```bash
bash scripts/check-all.sh        # 9 步静态检查（材质/契约/设计令牌/死代码/静默失败/语法/类型/行尾/JSON）
bash scripts/run-all-probes.sh   # 6 个 CDP 探针 239 断言（隔离实例、隐藏窗口）
node scripts/lint-design-tokens.cjs   # 设计令牌守卫（--fix 自动收敛，--fix-strict 更激进）
```

开发调试用 `D:\workspace\luogu++\dev`（`edist\electron.exe` + `scripts/dev-hot.sh` 热应用）。
注意：不要把 exe 放进 ZCode 工作区（`~/.zcode/workspace/`）目录树内运行——该树内任何 exe 都会段错误。

## 自测钩子（打包产物同样支持）

```bash
LuoguLab.exe --lg-selftest=out                  # 首页→注入→断言→截图（+page.png / .json）
LuoguLab.exe --lg-url=<url> --lg-selftest=out   # 指定起始页
LuoguLab.exe --lg-selftest=out --lg-tabtest     # 标签交互：首页→IDE→新标签→切回
LuoguLab.exe --lg-selftest=out --lg-configtest  # 配置面板 + IPC 全链路断言
LuoguLab.exe --lg-selftest=out --lg-dump-ide    # IDE 页 DOM 结构/配色探针
LuoguLab.exe --lg-selftest=out --lg-dump-tokens # 题目页代码块 token / 难度徽章探针
LuoguLab.exe --lg-selftest=out --lg-pagetest    # 列表页与题目页的功能块挂载验证
LuoguLab.exe --lg-selftest=out --lg-dump-promo  # 推广卡 DOM dump（调试）
LuoguLab.exe --lg-hidden --lg-v36test --lg-url=about:blank   # 隔离隐藏实例全量回归
LuoguLab.exe --lg-hidden --lg-v310test --lg-url=https://www.luogu.com.cn/  # v3.10.0 全量
LuoguLab.exe --lg-hidden --lg-v313test --lg-url=https://www.luogu.com.cn/  # v3.13.0 全量
              # 题目页 IDE 真全屏（真站选择器 + 反例不误判）/ 窄条 ⌄ 交接菜单活下来 /
              # 坞=书签语义（普通点换当前页、newTab 才新开）/ 题单广场搜索条已删 /
              # 中键点链接 = 后台新标签
LuoguLab.exe --lg-hidden --lg-v315test   # R42 可靠性：坏 JSON 先备份再回退 /
              # 六份数据原子写（tmp + rename，失败可见、ENOSPC 有文案）/
              # 默认值对齐 / 探针僵尸字段清零 / 投影软约束基线
              # （23 项断言，逐条真跑；--lg-selftest= 仍必填）
LuoguLab.exe --lg-hidden --lg-perftest   # R41 性能基线/验收：冷启动分段耗时 /
              # 按进程内存 / 6 标签内存曲线 / 休眠差值与唤醒耗时 / 后台节流落位
              # （cfg.bgThrottle 存在才断言：活动关/后台开）
LuoguLab.exe --lg-hidden --lg-v312test --lg-url=https://www.luogu.com.cn/  # v3.12.0 全量
              # 地址栏体验（输入法回车/回车确定性/localhost/联想跟手）/ 坞首页开洛谷首页 /
              # 账号菜单跑位 / 背景自愈 / 分组手感（迟滞·预览·动画·折叠展开）/ 左右两格分屏
LuoguLab.exe --lg-hidden --lg-v311test --lg-url=https://www.luogu.com.cn/problem/P1002
              # v3.11.0：坞方向四位置 / 悬停卡片已删 / 题目页 IDE 真全屏 / 分组拖动
              # 隐藏 = 全程不亮窗不抢前台（--lg-hidden / LG_HIDDEN=1）
LuoguLab.exe --lg-autologin --lg-user=… --lg-pass=…   # 自动登录（验证码人工辅助：
              # 抓图落盘 autologin-captcha.png → 把答案写入 %APPDATA%/LuoguLab/captcha-answer.txt）
```

断言结果在 `<out>.json`：页面层注入/主题/洁净模式/配色预设变量 + 外壳层元素存在性 +
omnibox 解析 5 形态 + tabs 快照（含 canBack/canFwd/muted/zoom）+ 配色预设往返 +
浏览器能力（缩放/重排/右键菜单）+ 历史下载 + 命令面板。

设计令牌运行时探针不占 app 参数，走 CDP：
`node scripts/probe-design.cjs <CDP端口> [输出json]`（量按钮高度/圆角/字号并断言资源全走 `lgasset://`）。

## 部署状态（2026-10-22）

- 部署产物：`D:\workspace\luogu++\app\LuoguLab.exe`
  （exe 壳打包于 v2.0.0；应用代码走 `resources/app` 松散文件热应用，当前 **v3.16.6**）
- 源码仓库：`D:\workspace\luogu++\repo`（git 远端 `longguanhong0755/luogu-plus`）；
  开发运行目录 `D:\workspace\luogu++\dev`
- 用户数据：`%APPDATA%\LuoguLab\`（由 LuoguGlass 迁移，含登录会话与映射配置）
- 测试账号已登录（UID 2286752），会话持久化
- 设计迭代史见 `design-log.md`（R1~R49，全部有探针/截图证据）

## 已知环境注意事项

- **`ELECTRON_RUN_AS_NODE=1` 会让探针静默空跑**：某些宿主（IDE / AI 会话 /
  启动器）会注入这个变量，Electron 二进制整个退化成 Node，所有 `--lg-*`
  都会被当成 node CLI 选项、直接报 `bad option` 退出。`scripts/run-probe.sh`
  已在调用前 `unset`；手跑单个探针时也要自己清掉。
- **Electron 44 在本机崩溃（0xc0000005）**，39.8.10 正常 —— 已固定 39.x
- 硬杀进程（taskkill/timeout 打断）可能弄脏 cookie 库导致会话被重置；正常关窗不受影响
- 配置面板改「无边框窗口」后需重启生效
