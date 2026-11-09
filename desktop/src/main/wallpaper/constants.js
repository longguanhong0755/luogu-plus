/* 壁纸模块共享常量：扩展名白名单与 Wallpaper Engine 扫描缓存。 */
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv"]);

/* scanWe 的 30 秒内缓存：设置窗与外壳会连续多问几次，避免重复扫盘 */
const weCache = new Map();

module.exports = { IMAGE_EXT, VIDEO_EXT, weCache };
