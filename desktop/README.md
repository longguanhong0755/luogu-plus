# Luogu Desktop（洛谷桌面版）

为 Windows 打造的洛谷客户端。Electron 39，`WebContentsView` 每页一视图、壁纸复刻层玻璃皮肤、原生折叠侧栏、离线题库、IDE 分栏。产品设计与像素规范见 [`../design.md`](../design.md)，迭代路线见 [`../ROADMAP.md`](../ROADMAP.md)。

## 运行

```bash
npm install
npm start        # electron .（开发/日常均可）
```

桌面快捷方式 `Luogu++.lnk` 直接以本目录为参数启动 electron（即始终运行最新源码）。关闭窗口默认最小化到托盘，退出请用托盘菜单「退出」。

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

## 安全边界

- 全部窗口 `contextIsolation: true`、`nodeIntegration: false`；权限请求默认拒绝。
- 站外链接唯一出口 `src/main/external.js`：仅放行 http/https。
- 主进程未捕获异常落盘 `logs/crash.log`（userData 标准日志目录）。
