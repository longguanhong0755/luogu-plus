# 更新日志

所有显著变更按版本记录于此。日期为交付日。

## v0.7.4 (2026-11-01) — R72 评审团整改

首次评审团锐评（73/79/77 分）后的问题整改轮：

- **安全**：全部渲染宿主改 `sandbox:true`（Electron 清单条款）；主壳/设置窗补齐
  will-navigate / window-open / webview 三重导航防护；lgoff 离线页加 CSP
  （default-src 'none'）+ 快照捕获剥 on* 属性与 javascript: 链接（深度防御）；
  下载文件名 basename 收敛；权限检查对洛谷来源放行 clipboard-sanitized-write
  （站内代码块复制按钮恢复可用）。
- **功能**：新 Ctrl+F 页内查找条（findInPage 驱动，Esc 清除高亮）与
  Ctrl+= / Ctrl+- / Ctrl+0 阅读缩放（页面内 HUD 提示）——补上 ROADMAP 自点名
  的 P1 基础能力缺口；渲染进程崩溃重载设上限（3 次后停，用户可见提示）；
  主进程未捕获异常除落盘外增加用户可见 toast。
- **分发**：新 `scripts/pack-portable.ps1` 一键产出便携 zip
  （electron 运行时 + resources/app，冒烟验证可启动）；根目录补 LICENSE (MIT)；
  gen:icons 加覆盖守卫（-Force 才重生成）；README 修正 gen:icons 措辞。
- **工程**：smoke 调试器改为惰性 require（不再无条件进生产主进程）；
  CHANGELOG 建立；版本 tag 体系建立（v0.5.0 → v0.7.4）。
- check 369 项全绿；三批探针 + IDE 探针 PASS；18 页 × 亮暗审计全零。

## v0.7.3 (2026-11-01) — R71 生产加固

- 安全出口单源：新 `src/main/external.js`（仅放行 http/https），views 六处 +
  window 一处收口，全仓 `shell.openExternal` 唯一出口；离线态「在浏览器打开」
  不再误交系统协议处理器。
- 崩溃可观测性：主进程未捕获异常 JSON 行落盘 `logs/crash.log`。
- 新 `desktop/README.md`；check 353→358；TOAST 探针改真实路径重试
  （隐藏窗口导航期 send 丢弃窗口已实测二分定位）。

## v0.7.2 (2026-10-31) — R70 同层透出 · 主页融合 · 侧栏抽屉

- 同层透明档位重构：新 raiseAlpha/codeAlpha 档位收编全部承载面孤岛，
  滑杆 100% 全透承诺保持；审计新增 tiers 同层指标。
- 主页原生融合：抓官方旧版首页倒计时/欢迎/运势 + 比赛日历列表，重排两栏。
- 侧栏抽屉化：宽度补间、近实心面板消叠染、钉住 @property 轨道宽过渡；
  删侧栏 luogu 标志。
- check 353；18 页 × 亮暗审计全零（含官方主页）。

## v0.7.1 (2026-10-31) — R69 丝滑与清瑕

- 皮肤状态反馈补全（过渡/hover/选中/焦点去重）、代码高亮跟应用主题、
  boot-accent 首帧；补覆盖盲区；外壳浮层/侧栏/IDE 动效；fatal 错误卡等。
- check 330；17 页双主题审计全零。

## v0.7.0 (2026-10-31) — R64/R65 皮肤收敛与官方化

- 皮肤只改色不改布局；100% 壁纸透出；广告开关；56px 官方几何侧栏；
  题库/比赛筛选分页白岛修复等。

## v0.6.0 (2026-10-29) — R54–R63 十轮深度迭代

- 列表鼠标点击/语言表金数据/壁纸透出滑杆/草稿按题/返回+恢复关闭/toast 入页/
  F5 等浏览器键/面板切换/比赛提醒真调度/下载落盘；check 241。

## v0.5.0 (2026-10-27) — 折叠侧栏 + 性能轮

- 56px 默认折叠侧栏/悬停浮层/钉子常驻；去内容区模糊 + 30fps + 性能模式。
