# 性能与体积报告

> 测量日期：2026-11-01。测量对象为本机 `Luogu Desktop 0.7.15 / Electron 39.8.10`。
> “内存”同时记录 Windows 工作集与私有内存；“体积”同时记录压缩交付物与解压后文件总量。

## 1. 当前结果

| 项目 | 优化前 | 当前 | 目标 | 结果 |
|---|---:|---:|---:|---|
| Electron 进程树私有内存 | 672.5 MB | 289.4–391.6 MB | < 100 MB | FAIL |
| Electron 进程树工作集 | 565.7 MB | 约 523 MB | < 100 MB | FAIL |
| 便携压缩包 | 130.7 MB zip | 73.4 MB 7z / 73.6 MB SFX | < 100 MB | PASS |
| 解压后文件总量 | 约 326 MB | 约 284 MB | < 100 MB | FAIL |

说明：私有内存会随当前页面、壁纸、GPU 驱动和缩放比例波动；上表是热加载完成后的本机稳态采样。

## 2. Electron 硬下限

使用同一 Electron 运行时启动一个只有空白 `BrowserWindow` 的最小程序，隐藏窗口、无业务页面，实测：

- 私有内存：**119.4 MB**
- 工作集：**446.1 MB**
- 进程：main + GPU + network utility + 一个空白 renderer

因此，在当前 Electron 架构下，“整个应用进程树私有内存 < 100MB”在业务代码启动前就已经不可能满足。继续压缩 CSS、关闭动画或减少页面数量只能降低增量，不能突破运行时下限。

## 3. 本轮已完成的优化

- 页面 `WebContentsView` 不再复制壁纸；壁纸只在外壳解码一次。
- 高分辨率静态壁纸按窗口尺寸生成压缩显示缓存，避免原图反复缩放。
- 壁纸动画从 JS `requestAnimationFrame` 每帧写 CSS 变量改为 GPU 合成器 CSS 动画。
- 失焦、最小化、滚动、性能模式和 reduced-motion 下暂停壁纸/视频。
- 所有隐藏页面静音并启用后台节流。
- 页面 LRU 收紧为：题目 3、详情 5、总页面 8。
- 关闭 Chromium 整页 BFCache，避免隐藏页面长期保留完整渲染树。
- 大表面取消实时 `backdrop-filter`，改用高不透明主题底板；这同时修复动态壁纸下文字不可读的问题。
- 壁纸透出 100% 时仍保留外壳 86% / 纱层 90% / 卡片 88% / 浮层 94% 的可读下限。

## 4. 若要真正达到 < 100MB 内存

必须更换运行时，不能继续在 Electron 内微调：

1. **Tauri 2 + WebView2**：安装包通常可控制在 10–30MB；单 WebView2 进程的私有内存需要实测，目标有现实可能，但多页面/多 WebView 同样会上升。
2. **WinUI 3 + WebView2**：原生侧栏 + 单个 WebView2，使用系统 Edge 运行时；预计是最有机会稳定压到 100MB 的方案，但需要重写窗口、下载、托盘、通知、离线缓存和页面注入桥。
3. **继续 Electron**：合理目标是压缩包 <100MB、私有内存争取 200–300MB；无法承诺 <100MB。

## 5. 复测命令

```powershell
cd D:\workspace\luogu++\repo\desktop
npm run memory
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pack-portable.ps1
```

`npm run memory` 在私有内存达到 <100MB 时返回 0，否则返回 2；报告写入 `repo/.lg-dev/memory-report.json`。