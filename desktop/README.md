# Luogu Desktop（洛谷桌面版）

为 Windows 打造的洛谷客户端。Electron 39，`WebContentsView` 每页一视图、壁纸复刻层玻璃皮肤、原生 64px 图标侧栏、离线题库、IDE 分栏。产品设计与像素规范见 [`../design.md`](../design.md)，迭代路线见 [`../ROADMAP.md`](../ROADMAP.md)。

## 运行

```bash
npm install
npm start        # 热加载开发模式
npm run start:plain # electron .（无文件监听）
```

`npm start` 会监听 `src/main`、`src/preload`、`src/renderer`、`src/assets` 与
`package.json`：外壳/设置/皮肤改动原地刷新，主进程或预加载改动自动重启 Electron。
可自建桌面快捷方式指向 electron 并以本目录为参数启动（无热加载）。关闭窗口默认最小化到托盘，退出请用托盘菜单「退出」。

## 验证

```bash
npm run check    # 静态检查：语法/资源/IPC 双向对齐/安全出口/版本一致性（不联网、不启动 Electron）
npm run smoke    # 隔离 profile 冒烟：隐藏窗口跑探针矩阵与皮肤审计（绝不弹窗、不碰用户数据）
```

标题栏提供题号/随机跳题入口，侧栏底部提供用户搜索。设置 → 增强集中管理
划词题号、Markdown/B 站介绍、练习显色、动态检测、逆天改运、主页板块、快捷键录制、更新检查与设置备份。

冒烟探针使用隔离环境变量（`LG_USERDATA`/`LG_SMOKE_PROFILE` 等）与隐藏窗口；正式数据目录 `%APPDATA%\Luogu Desktop` 只在正常使用中被读写。

## 结构

- `src/main/` — 主进程：窗口/视图管理、材质档位（`material.js`）、皮肤注入、离线快照、托盘、冒烟与审计。
- `src/renderer/` — 外壳（含唯一侧栏实例）、原生列表、设置、皮肤 CSS。
- `scripts/check.js` — 静态门禁（CI 与本地共用）；`scripts/smoke.js` — 探针/审计运行器。

## 打包与分发

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-portable.ps1
```

产物为低于 100MB 的 7z / 自解压 exe（electron 运行时 + resources/app，随附自签 .cer），解压双击 Luogu Desktop.exe 即用；
自签为终态；将 .cer 装入「受信任的发布者」即可消除本机验证警告。正式 CA 证书、NSIS 安装器与自动更新不再接入。

## 已知行为披露

- 自动重交队列会用本地 OCR（ddddocr 模型）识别图形验证码后自动重放提交；
  易盾交互式滑块不会被自动化，会转成页面内辅助由用户手动完成。
  这是针对洛谷既有验证码体系的自动化，账号存在被平台风控的理论风险。

## 安全边界

- 全部窗口 `contextIsolation: true`、`nodeIntegration: false`；权限请求默认拒绝。
- 站外链接唯一出口 `src/main/external.js`：仅放行 http/https。
- 主进程未捕获异常落盘 `logs/crash.log`（userData 标准日志目录）。
