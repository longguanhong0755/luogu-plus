# 更新日志

所有显著变更按版本记录于此。日期为交付日。

## 未发布 — R89 侧栏重构与 Luogu Plus v1.1.5 全量对齐

- 删除独立 rail WebContentsView/preload/renderer，侧栏收敛为外壳内唯一 DOM。
- 折叠态 64px、固定态 208px；悬停不再展开或抢焦点，钉子/`Ctrl+B` 显式切换。
- 主进程单一 `rail:layout` 宽度源同步外壳与页面视图；性能模式/reduced-motion 瞬切。
- 新增路由 active/`aria-current`、keyed DOM 滚动保持、`F6`/方向键/`Esc` 键盘链。
- 题号跳转改为 `Ctrl+L` 全局面板模式，关闭后恢复页面焦点。
- 新增开发态热加载：`npm start/dev` 监听源码；渲染层原地刷新，主进程/预加载自动重启；
  `npm run start:plain` 保留无监听启动。check 421→425。
- 新增 Luogu Plus 功能对齐：随机跳题（8 难度×5 题库）、纯数字/CF 简写、
  用户搜索、划词题号、他人介绍、练习显色、动态内容检测、逆天改运、主页板块、
  设置导入/导出/恢复默认。
- 侧栏视觉收敛：题号搜索移至标题栏，展开按钮改用面板图标，active 降至 7% 背景，
  折叠态使用原生 title 提示，自定义链接改用区分化字母/编号图标。check 449。
- 补齐 Luogu Plus 公开能力：广告默认开启、主页美化/圆滑/板块总控、公告/任务/链接/讨论、
  Markdown/公式/B 站介绍、练习色缓存、更新检查、公告致谢、使用声明、快捷键录制。
- 截图改为直接抓取 WebContents，新增 SHA-256 manifest 门禁；真实用户搜索与随机跳题纳入联网冒烟。

## v0.7.15 (2026-11-01) — R83 parity 增量（9/12 旅程）

- docs/PARITY.md 首批扩至 9 旅程（+历史导航与恢复关闭/断网队列管理/
  性能外观切换，逐格挂既有探针证据，零新产品代码）；12×3 全量余 3 旅程
  按既有节奏迭代。**交付后补证（R84）**：owner 拍板自签为终态（不做正式
  证书/安装包/自动更新），并授权用桌面账号文件首账号做隔离登录实测；
  取得记录/通知/提交三页页面级证据（截图+DOM，见 design.md §15.16.4），
  提交仍按设计不绕易盾滑块。check 430 项、登录实测启动器 PASS。

## v0.7.14 (2026-11-01) — R82 v0.8 票提前清偿（溢出转正/首启引导）

- **user 页轮播溢出收敛**（v0.8 票清偿）：审计新增 over 元素 DOM 侦察
  （LG_AUDIT_OVER_DUMP，节点侧插值——曾误把 process.env 写进页面脚本致
  注入即炸，已修），按真实标记（Vue 作用域滑件 a[data-v-12b24cc3]）出皮肤
  规则收敛到容器宽度；实测 user 页 overCount:0/overAllowed:0（白名单转正）。
- **首启引导卡**（v0.8 票清偿）：general.firstRunSeen 首次启动在主页右栏
  显示三行要点（托盘退出/快捷键/离线快照），「知道了」置位不再出现；
  VISUAL 探针 firstRunCard 指标实测 true，并修复探针主页等待时序
  （显式 showHome+等 .home-wrap）。
- **修复本轮自伤**：buildFirstRun 的 for 循环缺闭合大括号导致后续大括号
  错位、home.js 模块解析炸掉（外壳 boot 失败、home 全空）——新增冒烟模式
  渲染端 console 中继（console-message → 主进程日志）抓到并修复；
  该中继保留为常驻可观测性。
- check 420→421。

## v0.7.13 (2026-11-01) — R81 证据归档收口（评审 R2/R3 点名项）

- 签名结果（thumbprint+UTC 时间戳）随 pack-smoke.log 落盘，SIGN-OK 可复核。
- r80 补 batch1 归档 + 暗亮审计四半（GATE bad:0）——本轮回归证据全量在案。
- CHANGELOG「四批/首次单轮全量」表述更正为与目录证据一致。

## v0.7.12 (2026-11-01) — R80 九轮收官（自签过渡/回归补全/parity 增量）

- **自签过渡**（评审终态路径）：pack 管线新增 5.5 步——创建/复用
  CN=Luogu Desktop (self-signed dev) 代码签名证书，签主执行体并导出公钥
  （dist/luogu-desktop-selfsigned.cer）；README 补自签信任说明。正式证书
  采购后替换（ROADMAP v1.0）。
- **回归补全**：r80 batch2/3/ide 本轮新跑 + batch1 于收官补档（src 未变更
  期间跨轮沿用 r79 证据合法）+ FIND/SEC 随出包门禁以当前代码再验证——
  14 探针覆盖事实上齐，证据全部落盘 .lg-dev/r80/。
- **parity 增量**：docs/PARITY.md 首批扩至 6 旅程（+侧栏导航/设置材质，
  逐格挂探针证据）。
- **已知噪声记录**：pack/r79+ 冒烟日志的 `[views] 快照抓取失败 Script
  failed to execute` 为隐藏窗切页竞态（重试机制吸收、不进门禁裁决），
  已在 design.md 记成因。
- check 417→420（v0.7.13 交付时实测，含守卫运行时单测）。

## v0.7.11 (2026-11-01) — R79 八轮评审整改（出包裁决洞 #3/SEC 环境感知）

- **出包裁决洞 #3 修复**（v0.7.10 曾带红出厂）：pack 冒烟步进改走带真裁决的
  node 启动器（SMOKE_FAIL/审计超零/exit code 全算数，日志直落 UTF-8），
  $LASTEXITCODE ≠ 0 即 throw 拒绝出包——「SMOKE_OK 不过则拒绝出包」承诺
  首次在出厂路径上语义完整。
- **SEC 探针环境感知**：hiddenOpen 腿先 ensureWindow 尝试建窗，仍不可用记
  skipped 并从裁决剔除（腿不可达 ≠ 防护失效；dev 全量断言不变）。
- 超时失败归档补上下文行（TIMEOUT after Nms，不再 10 字节空壳）。
- 剥离清单补 smoke-guard.js（模块抽取时未同步，v0.7.10 zip 曾残留 1 项）；
  SEC hiddenOpen 腿导航竞态重试一次。
- CHANGELOG v0.7.10 演练叙事更正（exit=0/null，非 exit 1）；design.md R78
  措辞同步。

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
- **fails/ 归档演练实证**：人为触发失败 → 两份时间戳归档落盘（演练运行 exit=0/null——超时档当时仅 10 字节空壳，v0.7.11 已补超时上下文行）。
- design.md §15.16.1 补 R77 索引；check 406→412。
- **披露**：本版出包门禁存在裁决洞 #3（只查启动期 SMOKE_OK 标记），
  pack-smoke.log 实录 SEC hiddenOpen:null → ok:false 后 zip 照常出厂；
  v0.7.11 修复门禁语义并重新出包，勿使用 v0.7.10 便携包。

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
