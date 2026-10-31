# Parity 矩阵（首批 6 旅程 × 鼠标/键盘/离线）

ROADMAP 硬规则 2 承诺的「12 条核心旅程 × 3 种模式（鼠标/键盘/离线）」状态表。
首批交付 6 条旅程，每格给状态与证据指针（探针日志在 `repo/.lg-dev/r7x/`，
门禁为 `npm run check` + `npm run smoke`）。
状态：✅ 实测通过 · ⚠️ 部分覆盖 · ⏳ 首批未覆盖（v0.8 清偿）。

| # | 核心旅程 | 鼠标 | 键盘 | 离线 |
|---|---|---|---|---|
| 1 | 浏览题目：列表→详情→返回 | ✅ `SMOKE_LIST_CLICK`（真实点击进详情/返回列表） | ✅ `SMOKE_KEYS`（Ctrl+W 关页面/Alt+← 后退，合成键盘事件） | ✅ `SMOKE_OFFLINE`（lgoff 快照打开/队列重放） |
| 2 | 题号跳转/命令面板（含 AT_ 题号） | ✅ 侧栏跳转框鼠标输入+跳转（RAIL 探针覆盖） | ✅ `SMOKE_PALETTE atOk`（`at_abc123_a`→`AT_abc123_a` 规范化 + P1001 直达） | ✅ 面板为壳层能力，离线可用（DRAFT 探针离线段面板可见） |
| 3 | 查找与缩放（Ctrl+F / Ctrl+±） | —（键盘能力，无鼠标等价物） | ✅ `SMOKE_FIND`（真实 Ctrl+F 开条+聚焦、HUD pointer-events:none、Ctrl+= 生效、Esc 收条；found-in-page 回传腿=Electron 无焦点隐藏窗口限制，留档） | ⚠️ 离线快照页查找未单独探针（同一管线，v0.8 补） |
| 4 | 提交与草稿（草稿按题→提交→队列重放） | ✅ `SMOKE_DRAFT_UI`（切题草稿隔离+语言继承） | —（提交经页面按钮/面板，键盘链路未单独探针） | ✅ `SMOKE_OFFLINE` 队列重放+验证码语义分类 |
| 5 | 侧栏导航（折叠/悬停抽屉/钉住/自定义） | ✅ `SMOKE_RAIL`（抽屉中途采样+终态几何）+ `SMOKE_RAIL_BOUNDS ok:true`（钉住 56→208→56 view 同步） | ✅ `SMOKE_KEYS`（Alt+←/→ 与关页面即侧栏导航语义） | ✅ 折叠态为壳层能力，离线可用（OFFLINE 探针离线导航段） |
| 6 | 设置与材质（外观档位/壁纸透出/侧栏定制） | ✅ `SMOKE_SETTINGS_METRICS`（设置窗几何）+ 设置截图全量 | ✅ 设置面板快捷键 `Ctrl+,`（chrome.js 键表+VISUAL 探针在场验证） | ✅ 材质为壳层能力，离线可用（GLASS ok:true 不依赖网络） |
