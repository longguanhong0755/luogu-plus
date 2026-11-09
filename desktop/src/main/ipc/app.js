/* app 域 IPC：状态、在线标记、存储统计、缓存清理、任务栏固定、版本与更新。 */
const { app, ipcMain } = require("electron");
const { state } = require("./state");

function register(ctx) {
  ipcMain.handle("app:getState", () => state(ctx));

  ipcMain.on("app:online", (_event, online) => {
    if (ctx.luogu && ctx.luogu.setOnline) ctx.luogu.setOnline(!!online);
  });

  ipcMain.handle("app:storageStats", async () => {
    let webCacheBytes = 0;
    try {
      if (ctx.session) webCacheBytes = await ctx.session.getCacheSize();
    } catch {
      webCacheBytes = 0;
    }
    return {
      store: ctx.store ? ctx.store.stats() : null,
      webCacheBytes,
      views: ctx.views && ctx.views.viewStats ? ctx.views.viewStats() : null,
      luogu: ctx.luogu && ctx.luogu.contextDiagnostics ? ctx.luogu.contextDiagnostics() : null,
    };
  });

  ipcMain.handle("app:clearWebCache", async () => {
    if (!ctx.maintainWebCache) return { ok: false, message: "缓存维护尚未就绪。" };
    const result = await ctx.maintainWebCache("manual", true);
    return Object.assign({}, result, { message: result.ok ? "网页缓存已清理，登录状态和离线数据已保留。" : "清理失败：" + result.reason });
  });

  ipcMain.handle("app:taskbarPin", () => {
    if (!ctx.pinTaskbar) return { ok: false, supported: false, message: "任务栏固定尚未就绪。" };
    return ctx.pinTaskbar();
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle("app:checkUpdate", async () => {
    const current = app.getVersion();
    const response = await fetch("https://api.github.com/repos/longguanhong0755/luogu-plus/releases?per_page=1", {
      headers: { "User-Agent": "Luogu-Desktop/" + current, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error("发布页返回 HTTP " + response.status);
    const releases = await response.json();
    const release = Array.isArray(releases) ? releases[0] : null;
    if (!release) return { ok: true, current, latest: current, newer: false, notes: "项目尚未发布 Release。" };
    const normalize = (value) => String(value || "").replace(/^v/i, "").split(/[.-]/).map((part) => Number(part) || 0);
    const a = normalize(current);
    const b = normalize(release.tag_name);
    let newer = false;
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if ((b[index] || 0) === (a[index] || 0)) continue;
      newer = (b[index] || 0) > (a[index] || 0);
      break;
    }
    return {
      ok: true,
      current,
      latest: release.tag_name || "",
      newer,
      url: release.html_url || "",
      notes: String(release.body || "").slice(0, 4000),
      prerelease: !!release.prerelease,
    };
  });
}

module.exports = { register };
