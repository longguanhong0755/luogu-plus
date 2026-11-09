/* 页面域 IPC：详情/题面/个人页打开、视图动作、页内查找、题面动作与 IDE 布局。 */
const { ipcMain } = require("electron");
const { canonicalPid } = require("../sections");

function register(ctx) {
  ipcMain.handle("app:openDetail", (_event, payload) => {
    const url = String((payload && payload.url) || "");
    const title = String((payload && payload.title) || "");
    const key = payload && payload.key ? String(payload.key) : "";
    ctx.views.openDetail(url, title, key);
  });

  ipcMain.handle("app:openCustom", (_event, payload) => {
    ctx.views.openCustom(payload && payload.url, payload && payload.label, payload && payload.id);
  });

  ipcMain.handle("app:openWebFallback", (_event, kind) => {
    ctx.views.openWebFallback(String(kind || ""));
  });

  ipcMain.handle("app:openProblem", (_event, pid) => {
    ctx.views.openProblem(pid);
  });

  ipcMain.handle("app:openUser", (_event, uid) => {
    ctx.views.openProfile(Number(uid));
  });

  ipcMain.handle("app:viewAction", (_event, action) => {
    if (action === "back") ctx.views.back();
    else if (action === "forward") ctx.views.forward();
    else if (action === "reload") ctx.views.reload();
    else if (action === "reopen") ctx.views.reopenClosed();
    else if (action === "external") ctx.views.openExternal();
  });

  /* 页内查找（Ctrl+F）：查找条画在页面 preload 顶层，主进程驱动 findInPage */
  ipcMain.handle("app:find", (_event, payload) => {
    const action = String((payload && payload.action) || "");
    const query = String((payload && payload.query) || "").slice(0, 200);
    const entry = ctx.views.currentEntry();
    if (!entry || !entry.view || entry.view.webContents.isDestroyed()) return { ok: false };
    const wc = entry.view.webContents;
    try {
      if (action === "start" && query) {
        wc.findInPage(query, { findNext: false });
      } else if (action === "next" && query) {
        wc.findInPage(query, { forward: true, findNext: true });
      } else if (action === "prev" && query) {
        wc.findInPage(query, { forward: false, findNext: true });
      } else if (action === "close") {
        wc.stopFindInPage("clearSelection");
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("app:problemAction", (_event, payload) => {
    const pid = canonicalPid((payload && payload.pid) || "");
    const action = payload && payload.action;
    if (!pid) return;
    if (action === "records") ctx.views.openDetail(`/record/list?pid=${encodeURIComponent(pid)}`, "提交记录");
    else if (action === "solutions") ctx.views.openDetail(`/problem/solution/${encodeURIComponent(pid)}`, "题解");
    else if (action === "submit") ctx.views.navigate(`/problem/${encodeURIComponent(pid)}#submit`);
  });

  ipcMain.handle("app:setIde", (_event, on) => {
    ctx.views.setIde(!!on);
  });

  ipcMain.handle("app:setIdeSplit", (_event, ratio) => {
    ctx.views.setIdeSplit(Number(ratio));
  });

  ipcMain.handle("app:overlay", (_event, open) => ctx.views.setOverlay(!!open));

  ipcMain.on("page:open-problem", (_event, pid) => {
    ctx.views.openProblem(pid);
  });
}

module.exports = { register };
