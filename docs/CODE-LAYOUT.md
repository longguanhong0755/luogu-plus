# 代码拆分与文件预算

> R96（2026-11-09）起生效。目的：单个文件不再堆到上千行，改一处不用滚三屏。

## 预算

| 文件类型 | 目标 | 硬上限 |
| --- | --- | --- |
| JS 模块 | ≤ 300 行 | 400 行 |
| CSS 模块 | ≤ 300 行 | 400 行 |
| 入口/薄封装（barrel） | — | 60 行 |

唯一豁免：`desktop/src/preload/page.js`（页面 preload）。三个渲染宿主都是
`sandbox: true`，沙箱 preload 的 `require` 只支持 electron/少量内置模块，
拆成「入口 + 相对路径 require」会在运行时整块报 module not found（静态检查查
不出来）。因此这一个文件保持单文件，行数预算对它不生效；要拆它只能引入打包
步骤，收益不抵风险。

`legacy/` 是冻结的历史存档（旧浏览器扩展原样留档，用来说明迁移来源），
**不参与拆分，也不受预算约束**；新代码不要写进 `legacy/`。

## 拆分方式：薄入口 + 实现目录

拆分**不改变任何既有路径与导入写法**，只把实现搬到入口旁边的同名目录里。

```
src/main/views.js          # 保留：薄入口，只做 require 与 module.exports
src/main/views/
    page.js                # 实现
    skin.js
    overlay.js
```

规则：

1. **入口文件必须保留**在原路径，内容只剩 `require` + `module.exports`
   （ES 模块入口同理，只剩 `import` + `export` 再导出）。
2. 实现文件放进「入口去掉扩展名」的同名目录：`views.js` → `views/`，
   `library.js` → `library/`。
3. **公开 API 一个不能少**：原来 `require("./views")` 拿到的方法名、签名、
   同步/异步语义、抛错行为全部保持不变；调用方不需要改一行代码。
4. 目录内按功能命名（`page.js`、`skin.js`…），不要 `part1/part2`；
   纯工具放 `utils.js`，常量放 `constants.js`。
5. CSS 拆分：`x.css` 只保留 `@import` 列表，实现拆到旁边的 `css/` 目录，
   `@import` 顺序必须与原文件顺序一致（层叠不能变）。
6. 循环依赖：实现文件之间用 `require` 互相引时，若出现循环，把公共部分下沉到
   `utils.js`/`constants.js`，不要靠「运行时才用到所以没问题」蒙混。
7. 新增/调整拆分后，把实现文件登记到 `scripts/check.parts.d/<区块>.json`：

```json
{
  "src/main/views.js": ["src/main/views/page.js", "src/main/views/skin.js"]
}
```

   登记的作用是让静态检查 `read("src/main/views.js")` 仍然能读到「逻辑文件全文」，
   顺序按原文件内容顺序排列（入口文件本身不要重复登记）。忘记登记时 `read()` 会
   退化成「按文件名排序拼接同名目录」——断言大多仍能命中，但遍历型断言的顺序可能
   变化，所以**新增拆分务必登记**。

## 预算门禁

`desktop/scripts/check/sections/budget.js` 会扫 `desktop/src/**` 与
`desktop/scripts/**` 下的所有 `.js` / `.css`（豁免 `src/preload/page.js`），
任何文件超过 400 行直接 FAIL，并打印当前最大文件的路径与行数。所以：

- 拆完不要把实现又堆回单文件；
- 新增 CSS 分片时注意 `@media` / `@keyframes` 不要被拆断（层叠与语义都会变）；
- 排序靠文件名前缀（`010-`、`10-`），改名字等于改加载顺序。

## 为什么这样拆

- 静态检查 `desktop/scripts/check.js` 有 500+ 条断言直接读源码文本，入口保留 +
  登记表拼接，让这些断言在拆分后语义不变，改造成本可控、回归可信。
- 路径不变意味着 Electron 的 `main`、preload 路径、`<script type="module">`
  引用、打包脚本的剥离清单都不用跟着改。

## 门禁

```powershell
cd desktop
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run check   # 517 项通过, 0 项失败
npm run smoke   # smoke: PASS
```
