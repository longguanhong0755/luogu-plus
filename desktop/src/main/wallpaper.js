/* 壁纸解析：桌面 / 内置 / 每日一图 / 单张 / 文件夹轮换 / Wallpaper Engine。
   解析结果同时服务两个渲染层：
   - 外壳：真实 wallpaper 层（图片或视频）；
   - 洛谷页面：同坐标的静态复刻层（backdrop），保证玻璃面板后面透出同一张图。
   Wallpaper Engine 的 scene/web 壁纸无法在本应用内运行，退化为其预览图并标注。

   实现按域拆在 ./wallpaper/ 目录，公开 API 与拆分前一致：
   - constants.js：扩展名白名单与 we 扫描缓存
   - files.js：系统桌面壁纸路径、扩展名判定、file:// URL、CSS url()、日期键、文件夹清单
   - cache.js：显示预算、缩放落盘缓存（display-cache）、Bing 每日一图
   - wengine.js：project.json 解析、创意工坊目录发现、scanWe
   - resolve.js：各来源解析、计数、兜底渐变 */
const { builtinBackdrop, videoFallback, resolve, count } = require("./wallpaper/resolve");
const { scanWe } = require("./wallpaper/wengine");
const { listFolder, desktopWallpaperPath, isImage, isVideo } = require("./wallpaper/files");

module.exports = {
  resolve,
  count,
  scanWe,
  listFolder,
  desktopWallpaperPath,
  isImage,
  isVideo,
  builtinBackdrop,
  videoFallback,
};
