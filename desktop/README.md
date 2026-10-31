# Luogu Desktop（洛谷桌面版）

为 Windows 打造的洛谷客户端。Electron 39，`WebContentsView` 每页一视图、壁纸复刻层玻璃皮肤、原生折叠侧栏、离线题库、IDE 分栏。产品设计与像素规范见 [`../design.md`](../design.md)，迭代路线见 [`../ROADMAP.md`](../ROADMAP.md)。

## 运行

```bash
npm install
npm start        # electron .（开发/日常均可）
```

可自建桌面快捷方式指向 electron 并以本目录为参数启动（始终运行最新源码）。关闭窗口默认最小化到托盘，退出请用托盘菜单「退出」。

## 验证

```bash
npm run check    # 静态检查：语法/资源/IPC 双向对齐/安全出口/版本一致性（不联网、不启动 Electron）
npm run smoke    # 隔离 profile 冒烟：隐藏窗口跑探针矩阵与皮肤审计（绝不弹窗、不碰用户数据）
```

冒烟探针使用隔离环境变量（`LG_USERDATA`/`LG_SMOKE_PROFILE` 等）与隐藏窗口；正式数据目录 `%APPDATA%\Luogu Desktop` 只在正常使用中被读写。

## 结构

- `src/main/` — 主进程：窗口/视图管理、材质档位（`material.js`）、皮肤注入、离线快照、托盘、冒烟与审计。
- `src/renderer/` — 外壳（shell）、折叠侧栏（rail）、原生列表、设置、皮肤 CSS。
- `scripts/check.js` — 静态门禁（CI 与本地共用）；`scripts/smoke.js` — 探针/审计运行器。

## 打包与分发

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-portable.ps1
```

产物为未签名便携 zip（electron 运行时 + resources/app），解压双击 electron.exe 即用；
NSIS 安装器/代码签名/自动更新按 ROADMAP 在 v1.0 接入 electron-builder。

## 已知行为披露

- 自动重交队列会用本地 OCR（ddddocr 模型）识别图形验证码后自动重放提交；
  易盾交互式滑块不会被自动化，会转成页面内辅助由用户手动完成。
  这是针对洛谷既有验证码体系的自动化，账号存在被平台风控的理论风险。

## 安全边界

- 全部窗口 `contextIsolation: true`、`nodeIntegration: false`；权限请求默认拒绝。
- 站外链接唯一出口 `src/main/external.js`：仅放行 http/https。
- 主进程未捕获异常落盘 `logs/crash.log`（userData 标准日志目录）。
