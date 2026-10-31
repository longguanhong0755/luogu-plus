# 更新日志

所有显著变更按版本记录于此。日期为交付日。

## v0.7.10 (2026-11-01) — R78 七轮评审整改（守卫单测/SEC 五宿主/出包行为门禁）

- **守卫抽纯模块 + 真·单测**：冒烟裁决守卫迁入 `src/main/smoke-guard.js`
  （guardIpcMain，纯函数），check.js 用假 ipcMain 做运行时单测——异常打
  `SMOKE_FAIL ipc:<频道>` + 禁用态恒等直通，全部可复验；handle 与 on 型
  通道统一入守卫。
- **SEC 探针补 settings 宿主**（第五宿主，开-测-关，冒烟下 opacity 0）：
  五宿主 window.open 注入断言全拒，实测 ok:true。
- **出包门禁携带行为探针**：pack-portable.ps1 冒烟步进挂
  LG_SMOKE_SEC=1/LG_SMOKE_FIND=1，出厂自检不再是基础冒烟。
- **fullscreen 判源修 frame 粒度**（连续四轮在案）：request handler 改用
  `details.requestingUrl`。SEC 曾试图断言 fullscreen 权限拒绝向量，实测
  Electron 39 HTML5 全屏不经权限处理器，按事实撤下该向量并留档。
- **fails/ 归档演练实证**：人为触发失败 → exit 1 + 两份时间戳归档落盘。
- design.md §15.16.1 补 R77 索引；check 406→411。

## v0.7.9 (2026-11-01) — R77 六轮评审整改（裁决洞 #2/安全行为探针/证据纪律）

- **裁决洞 #2 修复**：冒烟模式给 `ipcMain.handle` 包守卫——handler 抛错即打
  `SMOKE_FAIL ipc:<频道>`（Electron 内部「Error occurred in handler」日志不带
  标记，启动器扫不到，r76/batch3 的 saveDraft TypeError 因此假 PASS；该 bug
  本体已在 v0.7.8 修复，本条修的是「抓到后仍判 PASS」的裁决完整性）。频道名
  字面量不动，check.js 通道对齐扫描不受影响。
- **SEC 安全行为探针**（LG_SMOKE_SEC=1）：向外壳/页面/隐藏窗三宿主注入
  `lg-sec://` window.open 与跨源导航攻击并断言全拒（自定义 scheme 会被安全
  出口静默丢弃，探针零外部副作用）；实测 shellOpen/pageOpen/hiddenOpen 全
  true、URL 未被劫持。
- 审计 GATE 汇总拆 `{checked, gated, bad}` 三元（authGated 页单列不虚增）。
- 失败证据纪律：启动器失败时按时间戳归档 stdout+stderr 到 .lg-dev/fails/。
- over 白名单双锚（parent=div.right + LGR-/月赛文本特征），站点改版失效即
  GATE 拦截为 FAIL（安全失败模式）。
- 便携包剥离 harness 后的 LG_DEMO/--smoke 路径加 try/catch 守卫（模块缺失
  静默跳过，不再可能启动降级）；README 探针旗标表补 FIND/SEC。
- CHANGELOG v0.7.8 计数笔误更正（393→400）。

## v0.7.8 (2026-11-01) — R76 量化路径兑现（AT 题号/行为探针/parity 首批/harness 剥离）

- **AT 下划线题号清偿**：`sections.js` 新增 `canonicalPid` 单源——P/CF/UVA 等大写、
  AT_ 系规范为「AT_+小写」的洛谷规范形；views（pidFromUrl/openProblem）、ipc
  （palette/problemAction/submit/saveDraft/getDraft）六处接入；渲染层（跳转框/
  页内链接）正则接受下划线并把原文交主进程规范化。PALETTE 探针新增
  `at_abc123_a → AT_abc123_a` 行为断言（实测 atOk:true）。
- **FIND 行为探针**（LG_SMOKE_FIND=1）：真实 Ctrl+F 开条+聚焦、查询驱动
  防抖→invoke→findInPage 链、Ctrl+= 缩放生效+HUD pointer-events:none 实测、
  Esc 收条。found-in-page 回传腿在无焦点隐藏窗口探针下不触发（Electron
  findInPage 限制，真实会话有焦点正常），留档为已知限制。
- **docs/PARITY.md 首批**：4 条核心旅程 × 鼠标/键盘/离线状态表，逐格挂探针
  证据指针（12×3 全量按 ROADMAP 节奏迭代）。
- **便携包剥离探针 harness**：打包管线改为「暂存目录冒烟 → 剥离
  src/main/smoke.js → 压缩」，产物 134 项零 smoke 残留（zip 实测），
  --smoke 触发路径随包清零。
- check 393→400。

## v0.7.7 (2026-11-01) — R75 四轮评审整改

- 冒烟裁决洞修复：启动器合并扫描 stdout+stderr 的 SMOKE_FAIL（异常路径不再假 PASS）。
- 皮肤审计零阈值真门禁：实测页 dark/dim/over/light 任一超零即 SMOKE_FAIL，
  汇总行 SMOKE_SKIN_AUDIT_GATE 落日志（overAllowed 白名单不计入）。
- over 白名单锚定 parent=div.right（防未来其它 <a> 溢出误豁免），豁免明细
  保留在 overAllowedItems 字段随 skin-audit.json 落盘。
- 隐藏窗导航白名单补 luogu.org / *.luogu.org（与 views isLuoguHost 同口径）。
- CHANGELOG 重构：严格倒序 + v0.7.2/v0.7.4 历史条目恢复原文，更正统一见本条；
  口径总注：历史条目中「N 页全零」按 2026-11-01 更正口径应为「实测全零页 +
  user 页 1 处 overAllowed（月赛轮播）+ 4 页 authGated」。
- design.md §15.16 改题为「评审团打磨链（R72–R75）」并新增 §15.16.1 各轮索引
  （commit/分数轨迹/缓期清单）；--smoke 触发路径表述收紧。

## v0.7.6 (2026-11-01) — R74 三轮评审整改

- 审计器新增 over 显式白名单：user 页右栏月赛轮播（洛谷自带横向轮播）移入
  overAllowed 计数并在日志留名，不再虚报「全零」；溢出收敛排期 v0.8。
- LICENSE 按 GitHub Licenses API/SPDX 官方换行重排；README 门面版本与
  package.json 同步并纳入 check 门禁；pack-portable.ps1 重存为纯 UTF-8 BOM。
- rail 悬停浮层补 will-navigate 防护（特权桥最后一面）；请求 handler 洛谷源
  正则加尾边界；隐藏窗导航白名单扩到 *.luogu.com.cn 子域；快照抓取瞬时错误
  2.5s 重试（复用 round 上限）。
- 口径更正注：v0.7.2 条目原文「18 页全零」按 2026-11-01 更正口径应为
  「14 页实测 + 4 authGated，user 页 1 处轮播溢出」。

## v0.7.5 (2026-11-01) — R73 二轮评审整改

- 隐藏数据窗补齐三重导航防护（will-navigate 站内白名单 / window-open 拒绝 /
  webview 拒绝），并加 app 级 web-contents-created 全局兜底（window-open 与
  webview 默认全拒，具体宿主自己的 handler 后注册覆盖）。
- 设置窗补 will-attach-webview（整改记录与代码对齐）；check 门禁改按窗口计数。
- 缩放 HUD 加 pointer-events:none 并淡出后移除（修复 HUD 隐形截留页面点击）；
  Esc 全局关闭查找条；查找清空输入即 stopFindInPage 清高亮。
- 权限请求对洛谷源放行 fullscreen（站内视频全屏恢复）；下载文件名补 Windows
  非法字符清洗与 ".." 穿透防护；崩溃重载计数在加载成功后清零（真「连续」语义）；
  缩放范围放宽至 53%–173%；快照消毒扩展到 href/src/formaction/action/xlink:href
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
- check 369 项全绿；三批探针 + IDE 探针 PASS；18 页 × 亮暗审计全零。（口径更正见 v0.7.7 总注）

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
- check 353；18 页 × 亮/暗审计全零（含官方主页）。（口径更正见 v0.7.7 总注）

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
