/* persist:luogu 分区会话：UA、缓存维护、权限白名单、广告拦截与下载落盘。 */
const { app, session } = require("electron");
const adblock = require("../adblock");
const { maintainWebCache } = require("./cache");
const { UA, WEB_CACHE_SOFT_LIMIT } = require("./constants");

function setupSession(ctx) {
  ctx.session = session.fromPartition("persist:luogu");
  ctx.session.setUserAgent(UA);
  ctx.cacheMaintenance = { softLimitBytes: WEB_CACHE_SOFT_LIMIT, last: null };
  ctx.maintainWebCache = (reason, force) => maintainWebCache(ctx, reason, force).then((result) => {
    ctx.cacheMaintenance.last = Object.assign({ at: Date.now() }, result);
    return result;
  });
  ctx.session.setPermissionRequestHandler((_wc, permission, details, callback) => {
    // 仅放行洛谷来源的 fullscreen；判源用 requestingUrl（frame 粒度，修顶层 URL 局限）
    const origin = String((details && details.requestingUrl) || (_wc && _wc.getURL && _wc.getURL()) || "");
    const isLuogu = /^https?:\/\/([a-z0-9-]+\.)*luogu\.com\.cn(:\d+)?(\/|$)/i.test(origin);
    callback(permission === "fullscreen" && isLuogu);
  });
  // 站内代码块复制按钮走 clipboard API；站内视频全屏走 fullscreen——
  // 仅对洛谷来源放行这两项，其余权限一律拒绝
  ctx.session.setPermissionCheckHandler((_wc, permission, origin) => {
    const isLuogu = /^https?:\/\/([a-z0-9-]+\.)*luogu\.com\.cn(:\d+)?$/i.test(String(origin || ""));
    if (isLuogu && permission === "clipboard-sanitized-write") return true;
    return isLuogu && permission === "fullscreen";
  });
  // 广告拦截只在这个会话上挂一次；开关状态由回调实时读取。
  adblock.wire(ctx.session, () => ctx.cfg.get().general.adBlock);
  // 页面里的下载（附件/素材）自动落到系统「下载」文件夹，完成后 toast，不弹另存为
  ctx.session.on("will-download", (_event, item) => {
    try {
      const dir = app.getPath("downloads");
      // basename 收敛 + Windows 非法字符清洗 + 防 ".." 穿透
      let filename = require("node:path").basename(item.getFilename() || "download");
      filename = filename.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "").trim() || "download";
      let savePath = require("node:path").join(dir, filename);
      const dot = filename.lastIndexOf(".");
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : "";
      for (let i = 1; i < 100; i++) {
        if (!require("node:fs").existsSync(savePath)) break;
        savePath = require("node:path").join(dir, `${stem}(${i})${ext}`);
      }
      item.setSavePath(savePath);
      item.once("done", (_e, state) => {
        if (state === "completed") ctx.toast("下载完成", `${filename} 已保存到「下载」文件夹。`);
        else if (state === "interrupted") ctx.toast("下载失败", filename);
      });
    } catch (err) {
      console.error("[download]", err.message);
    }
  });
}

module.exports = { setupSession };
