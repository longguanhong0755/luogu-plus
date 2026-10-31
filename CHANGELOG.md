# 更新日志

所有显著变更按版本记录于此。日期为交付日。

## v0.7.5 (2026-11-01) — R73 二轮评审整改

- 隐藏数据窗补齐三重导航防护（will-navigate 站内白名单 / window-open 拒绝 /
  webview 拒绝），并加 app 级 web-contents-created 全局兜底（window-open 与
  webview 默认全拒，具体宿主自己的 handler 后注册覆盖）。
- 设置窗补 will-attach-webview（整改记录与代码对齐）；check 门禁改按窗口计数。
- 缩放 HUD 加 pointer-events:none 并淡出后移除（修复 HUD 隐形截留页面点击）；
  Esc 全局关闭查找条；查找清空输入即 stopFindInPage 清高亮。
- 权限请求对洛谷源放行 fullscreen（站内视频全屏恢复）；下载文件名补 Windows
  非法字符清洗与 ".." 穿透防护；崩溃重载计数在加载成功后清零（真「连续」语义）；
  缩放范围放宽至 42%–173%；快照消毒扩展到 href/src/formaction/action/xlink:href
  （data:image|font 放行）；离线 CSP style-src 收敛为 'unsafe-inline' data:。
- 打包脚本内建冒烟步骤（SMOKE_OK 不过拒绝出包）+ 证据落盘
  dist/pack-smoke.log；清理 dist 坏包；pack-ico.js 补覆盖守卫（ico/png/tray
  不再绕过 gen-icons 守卫）。
- 文档卫生：审计口径改为「14 页实测全零 + 4 页 authGated」；r70 profile
  会话过期实测留痕；parity 矩阵写入缓期清单；修复失效交叉引用；
  README 快捷键补 Ctrl+F / Ctrl+±缩放；package.json 补 author/repository。

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
- check 369 项全绿；三批探针 + IDE 探针 PASS；皮肤审计 14 页实测全零 + 4 页 authGated（登录跳转，见已知限制）。

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
- check 353；皮肤审计 14 页实测全零 + 4 页 authGated（含官方主页）。

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
