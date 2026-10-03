# LuoguLab（洛谷编程工作台）

面向编程的洛谷（luogu.com.cn）桌面工作台。Electron 39 免安装绿色版：
双击即开、多标签浏览（可拖拽排序 + 分组 + 四分屏）、地址栏三合一（网址/题号/映射词）、
内置 IDE 标签与分屏编辑器、命令面板、历史/下载/清理、阅读模式与翻译、账号一键切换、
黑白线条风的 5 套配色预设 + 细粒度外观调校、持久登录。

## 目录结构

```
luogu-glass/
├── main.js               # 主进程：标签/布局/注入调度/账号隔离会话/历史-下载-清理/
│                         #   菜单快捷键/自测钩子/自动登录(验证码辅助)
├── preload-chrome.js     # 外壳层 contextBridge（onTabs/onUser/onConfig/onDownloads + 动作）
├── preload-config.js     # 设置页与历史页 contextBridge
├── src/
│   ├── material.css      # 材质单一来源（面/边框/内块/壁纸配方 + 各层选择器登记表）
│   ├── inject.css        # 美化注入层 + IDE 页专属适配（选择器来自真实 DOM 实扒）
│   ├── inject.js         # 注入运行时：window.__lgGlass.apply(config)（含 --lg-* 全部变量）
│   ├── chrome/           # 应用外壳：垂直标签栏 + 工具行 + 坞渲染源 + 下拉 + 命令面板
│   ├── dock/             # 坞覆盖视图（R36：悬浮在页面之上，页面内容从它底下穿过）
│   ├── popup/            # 弹出层（菜单/命令面板/地址栏联想/悬停浮层/提示条）
│   ├── settings/         # 设置页（配色预设/视觉细节/布局/功能开关/账号/地址栏映射）
│   ├── history/          # 本地页：浏览历史 / 下载
│   ├── home/             # 应用首页（时钟/搜索/倒计时/快捷入口）
│   └── config/           # 旧版独立配置窗（保留）
├── assets/icon.ico       # 纯 Node 生成的单色图标（墨色方块 + 白 `</>`）
└── scripts/              # gen-icon.js（PNG/ICO 编码器）+ sync-dev.sh（同步到运行目录）
```

## 功能一览

- **外壳**：Edge 式垂直标签栏（默认收起；悬停=整条展开浮出，与"点箭头常驻展开"逐像素同一条——整高贴边、方角、盖住窄条、头尾按钮同位置，悬停不挤压页面、常驻展开才挤压；宽度可拖、可放左侧或右侧）/ 顶部标签条二选一；
  Edge 式标签分组（组头行 + 连续组色线 + 多选建组 + 就地改名）与 15 种拼合布局；悬停卡片（标题 + 网址）；悬停浮层/右键菜单/命令面板都能整理标签页（排序/去重/自动建组，可撤销）；
  垂直模式顶栏两行（标题行：图标 + 网页描述居中，右端窗口三键；工具行：前进后退 + 网址 + 账号）；
  侧坞是悬浮栏（设置里选上/下/左/右，页面内容从它底下穿过、不再让位；网页自己
  进入全屏、或打开分屏编辑器/题目页并排 IDE 时自动收起）；悬停展开与窄条交接零
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

## 开发

```bash
npm install                 # electron@^39 + @electron/packager（走 npmmirror）
npm start                   # 开发运行
npm run dist                # 打包免安装绿色版
npm run gen:icon            # 重新生成图标
```

注意：打包产物请放到 `~/.zcode/workspace/default/` 目录树之外运行
（该工作区树内任何 exe 都会段错误）。开发调试用 `C:\Users\Administrator\LuoguGlassDev`。

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
              # 隐藏 = 全程不亮窗不抢前台（--lg-hidden / LG_HIDDEN=1）
LuoguLab.exe --lg-autologin --lg-user=… --lg-pass=…   # 自动登录（验证码人工辅助：
              # 抓图落盘 autologin-captcha.png → 把答案写入 %APPDATA%/LuoguLab/captcha-answer.txt）
```

断言结果在 `<out>.json`：页面层注入/主题/洁净模式/配色预设变量 + 外壳层元素存在性 +
omnibox 解析 5 形态 + tabs 快照（含 canBack/canFwd/muted/zoom）+ 配色预设往返 +
浏览器能力（缩放/重排/右键菜单）+ 历史下载 + 命令面板。

## 部署状态（2026-10-01）

- 桌面交付：`C:\Users\Administrator\Desktop\LuoguLab\LuoguLab.exe`
  （exe 壳打包于 v2.0.0；应用代码走 `resources/app` 松散文件热应用，当前 v3.8.0）
- 用户数据：`%APPDATA%\LuoguLab\`（由 LuoguGlass 迁移，含登录会话与映射配置）
- 测试账号已登录（UID 2286752），会话持久化
- 设计迭代史见 `design-log.md`（R1~R33，全部有探针/截图证据）

## 已知环境注意事项

- **Electron 44 在本机崩溃（0xc0000005）**，39.8.10 正常 —— 已固定 39.x
- 硬杀进程（taskkill/timeout 打断）可能弄脏 cookie 库导致会话被重置；正常关窗不受影响
- 配置面板改「无边框窗口」后需重启生效
