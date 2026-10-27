/* 所有 IPC 的登记处（主进程 handler + preload 暴露 + 本文件三处同步维护）。 */
const { app, ipcMain, dialog, clipboard } = require("electron");
const { LIBRARY_IDS, resolveRail } = require("./sections");

function publicWallpaper(wallpaper) {
  const out = Object.assign({}, wallpaper);
  out.items = [];
  return out;
}

function state(ctx) {
  const cfg = ctx.cfg.get();
  let bounds = { width: 1280, height: 820 };
  try {
    if (ctx.win && !ctx.win.isDestroyed()) bounds = ctx.win.getContentBounds();
  } catch {
    /* window 正在创建 */
  }
  return {
    version: app.getVersion(),
    appearance: cfg.appearance,
    general: cfg.general,
    notify: cfg.notify,
    rail: resolveRail(cfg),
    window: { width: bounds.width, height: bounds.height },
    theme: Object.assign({}, ctx.theme, { wallpaper: publicWallpaper(ctx.wallpaper) }),
    user: ctx.luogu.user,
    home: ctx.luogu.home,
    online: ctx.luogu.online !== false,
    queue: ctx.luogu.queueState(),
    page: ctx.views.currentInfo(),
    switcher: ctx.views.listOpen(),
  };
}

function broadcastState(ctx) {
  const payload = state(ctx);
  const targets = [ctx.win, ctx.settingsWin];
  for (const win of targets) {
    if (win && !win.isDestroyed()) win.webContents.send("app:state", payload);
  }
  const rail = ctx.views && ctx.views.railWebContents ? ctx.views.railWebContents() : null;
  if (rail && !rail.isDestroyed()) rail.send("app:state", payload);
}

const ACTIONS = [
  { type: "action", id: "home", label: "主页" },
  { type: "action", id: "problems", label: "题库" },
  { type: "action", id: "training", label: "训练" },
  { type: "action", id: "contest", label: "比赛" },
  { type: "action", id: "record", label: "记录" },
  { type: "action", id: "reopen", label: "恢复关闭的页面" },
  { type: "action", id: "discuss", label: "讨论" },
  { type: "action", id: "article", label: "文章" },
  { type: "action", id: "chat", label: "聊天" },
  { type: "action", id: "notification", label: "通知" },
  { type: "action", id: "checkin", label: "今日签到" },
  { type: "action", id: "login", label: "登录洛谷" },
  { type: "action", id: "settings", label: "设置" },
];

function palette(query, ctx) {
  const q = String(query || "").trim();
  const out = [];
  const pid = q.match(/^([A-Za-z]{1,4}\d+[A-Za-z0-9]*)/);
  if (pid) {
    out.push({ type: "problem", pid: pid[1].toUpperCase(), label: "打开题目 " + pid[1].toUpperCase() });
  }
  // 已经打开的页面可以直接切过去（Ctrl+K 也是页面间跳转的入口）
  if (ctx && ctx.views && ctx.views.listOpen) {
    for (const page of ctx.views.listOpen()) {
      if (q && !(page.title || "").includes(q) && !(page.key || "").toLowerCase().includes(q.toLowerCase())) continue;
      out.push({ type: "page", key: page.key, label: "切换到 " + (page.title || page.key) });
    }
  }
  for (const action of ACTIONS) {
    if (!q || action.label.includes(q) || action.id.includes(q.toLowerCase())) out.push(action);
  }
  return out.slice(0, 12);
}

function registerIpc(ctx) {
  ipcMain.handle("app:getState", () => state(ctx));

  ipcMain.handle("app:setAppearance", async (_event, patch) => {
    const appearance = ctx.cfg.setAppearance(patch);
    await ctx.refreshAppearance();
    ctx.scheduleWallpaperRotation();
    return { appearance, state: state(ctx) };
  });

  ipcMain.handle("app:setRail", (_event, patch) => {
    const next = patch || {};
    const rail = ctx.cfg.setRail(next);
    if (Object.prototype.hasOwnProperty.call(next, "pinned")) ctx.views.setRailPinned(!!rail.pinned);
    else broadcastState(ctx);
    return rail;
  });

  ipcMain.handle("app:railPin", (_event, pinned) => {
    ctx.views.setRailPinned(!!pinned);
    return ctx.cfg.get().rail;
  });

  ipcMain.handle("app:railHover", (_event, payload) => {
    const open = typeof payload === "object" && payload ? !!payload.open : !!payload;
    const focus = typeof payload === "object" && payload ? String(payload.focus || "") : "";
    const force = typeof payload === "object" && payload ? !!payload.force : false;
    ctx.views.setRailHover(open, focus, force);
  });

  ipcMain.handle("app:resetRail", () => {
    const rail = ctx.cfg.resetRail();
    broadcastState(ctx);
    return rail;
  });

  ipcMain.handle("app:setGeneral", (_event, patch) => {
    const next = patch || {};
    const general = ctx.cfg.setGeneral(next);
    ctx.applyAutoLaunch();
    if (Object.prototype.hasOwnProperty.call(next, "performanceMode")) {
      ctx.refreshAppearance({ reschedule: false }).catch(() => {});
    } else {
      broadcastState(ctx);
    }
    return general;
  });

  ipcMain.handle("app:setNotify", (_event, patch) => {
    const notify = ctx.cfg.setNotify(patch);
    broadcastState(ctx);
    return notify;
  });

  ipcMain.handle("app:pickWallpaper", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择壁纸",
      properties: ["openFile"],
      filters: [
        { name: "图片与视频", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif", "mp4", "webm", "ogv"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    ctx.cfg.setAppearance({ wallpaper: "custom", wallpaperFile: result.filePaths[0], wallpaperIndex: 0 });
    await ctx.refreshAppearance();
    return state(ctx);
  });

  ipcMain.handle("app:pickWallpaperDir", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择壁纸文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    ctx.cfg.setAppearance({ wallpaper: "folder", wallpaperDir: result.filePaths[0], wallpaperIndex: 0 });
    await ctx.refreshAppearance();
    ctx.scheduleWallpaperRotation();
    return state(ctx);
  });

  ipcMain.handle("app:pickWeRoot", async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: "选择 Wallpaper Engine 目录（创意工坊 431960 或 Steam 库）",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return state(ctx);
    const root = result.filePaths[0];
    const items = await Promise.resolve(ctx.scanWe(root));
    const first = items.find((item) => item.playable) || items[0];
    ctx.cfg.setAppearance({
      wallpaper: "we",
      weRoot: root,
      weId: first ? first.id : "",
      wallpaperIndex: 0,
    });
    await ctx.refreshAppearance();
    ctx.scheduleWallpaperRotation();
    return { state: state(ctx), items };
  });

  ipcMain.handle("app:scanWe", (_event, root) => {
    const dir = String(root || ctx.cfg.get().appearance.weRoot || "");
    return { root: dir, items: dir ? ctx.scanWe(dir) : [] };
  });

  ipcMain.handle("app:nextWallpaper", async () => {
    await ctx.nextWallpaper();
    return state(ctx);
  });

  ipcMain.handle("app:nav", (_event, target) => {
    ctx.views.setRailHover(false);
    if (target === "home") ctx.views.showHome();
    else if (target === "login") ctx.views.openLogin();
    else if (target === "profile") ctx.views.openProfile(ctx.luogu.user.uid);
    else if (target === "settings") ctx.openSettings();
    else if (LIBRARY_IDS.has(target) || target === "chat" || target === "notification") {
      ctx.views.openSection(target);
    }
    ctx.emitPage();
  });

  ipcMain.handle("app:library", async (_event, payload) => {
    const kind = String((payload && payload.kind) || "");
    if (!LIBRARY_IDS.has(kind)) return { items: [], error: "未知列表" };
    return ctx.luogu.fetchLibrary(kind, {
      page: payload.page,
      keyword: payload.keyword,
      difficulty: payload.difficulty,
      type: payload.type,
      tags: payload.tags,
      content: payload.content,
      force: payload.force,
    });
  });

  ipcMain.handle("app:libraryTags", async () => ctx.luogu.fetchTags());

  ipcMain.handle("app:openDetail", (_event, payload) => {
    ctx.views.hideRailOverlay();
    const url = String((payload && payload.url) || "");
    const title = String((payload && payload.title) || "");
    const key = payload && payload.key ? String(payload.key) : "";
    ctx.views.openDetail(url, title, key);
  });

  ipcMain.handle("app:openCustom", (_event, payload) => {
    ctx.views.hideRailOverlay();
    ctx.views.openCustom(payload && payload.url, payload && payload.label);
  });

  ipcMain.handle("app:openWebFallback", (_event, kind) => {
    ctx.views.hideRailOverlay();
    ctx.views.openWebFallback(String(kind || ""));
  });

  ipcMain.handle("app:openProblem", (_event, pid) => {
    ctx.views.hideRailOverlay();
    ctx.views.openProblem(pid);
  });

  ipcMain.handle("app:viewAction", (_event, action) => {
    if (action === "back") ctx.views.back();
    else if (action === "forward") ctx.views.forward();
    else if (action === "reload") ctx.views.reload();
    else if (action === "reopen") ctx.views.reopenClosed();
    else if (action === "external") ctx.views.openExternal();
  });

  ipcMain.handle("app:problemAction", (_event, payload) => {
    const pid = String((payload && payload.pid) || "").toUpperCase();
    const action = payload && payload.action;
    if (!/^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid)) return;
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

  ipcMain.handle("app:overlay", (_event, open) => {
    ctx.views.setOverlay(!!open);
  });

  ipcMain.handle("app:submit", async (_event, payload) => {
    const pid = String((payload && payload.pid) || "").toUpperCase();
    const code = String((payload && payload.code) || "");
    const lang = String((payload && payload.lang) || "C++14 (GCC 9)");
    const o2 = !!(payload && payload.o2);
    if (!/^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid) || !code.trim()) {
      return { ok: false, message: "题目编号或代码为空。" };
    }
    // 断网提交：不碰网络，进本地队列，联网后自动重放
    if (ctx.luogu.online === false) {
      const queued = await ctx.luogu.enqueueSubmit(pid, code, lang, "当前离线", o2);
      ctx.toast("提交", queued.message);
      return queued;
    }
    const result = await ctx.luogu.submit(pid, code, lang, "", o2);
    if (result.ok) {
      ctx.toast("提交", `已提交 ${pid}，评测完成后会通知你。`);
    } else if (Number(result.status) === 0) {
      // 网络层失败（在线状态还没跟上）：排进队列稍后自动重试
      const queued = await ctx.luogu.enqueueSubmit(pid, code, lang, "网络未就绪", o2);
      ctx.toast("提交", queued.message);
      return queued;
    } else {
      // 原生提交没走通（登录过期 / 需要验证码 / 易盾交互式挑战）：
      // 打开题目页提交区并自动填入代码，用户在页面里完成验证后提交。
      clipboard.writeText(code);
      const filled = await ctx.views.openSubmitAssist(pid, code);
      ctx.toast(
        "提交",
        filled
          ? "已在题目页填入代码，请完成页面里的验证后点“提交评测”。"
          : "代码已复制，请在题目页内提交。"
      );
    }
    return result;
  });

  ipcMain.handle("app:queueAction", async (_event, payload) => {
    const op = String((payload && payload.op) || "");
    const id = payload ? String(payload.id || "") : "";
    if (!["retry", "clear", "remove"].includes(op)) return ctx.luogu.queueState();
    if (op === "remove" && !id) return ctx.luogu.queueState();
    return ctx.luogu.queueAction(op, id);
  });

  ipcMain.handle("app:saveDraft", (_event, payload) => {
    if (!ctx.store) return { ok: false };
    const pid = String((payload && payload.pid) || "").toUpperCase();
    const code = String((payload && payload.code) || "");
    const lang = String((payload && payload.lang) || "C++14 (GCC 9)");
    const o2 = !!(payload && payload.o2);
    // 语言/O2 是全局偏好：下一道题沿用上一次的选择
    ctx.store.set("editorPrefs", { lang, o2, savedAt: Date.now() }, 0);
    // 草稿按题目隔离：A 题的代码永远不会出现在 B 题的编辑器里
    if (pid && /^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid)) {
      const key = "draft:" + pid;
      ctx.store.set(key, { key, pid, code: code.slice(0, 200000), lang, o2, savedAt: Date.now() }, 800);
    }
    return { ok: true };
  });

  ipcMain.handle("app:getDraft", (_event, payload) => {
    if (!ctx.store) return null;
    const pid = String((payload && payload.pid) || "").toUpperCase();
    if (pid && /^[A-Z]{1,4}\d+[A-Za-z0-9]*$/.test(pid)) {
      const draft = ctx.store.get("draft:" + pid);
      if (draft && typeof draft === "object") {
        return {
          pid,
          code: String(draft.code || ""),
          lang: String(draft.lang || "C++14 (GCC 9)"),
          o2: !!draft.o2,
          savedAt: Number(draft.savedAt) || 0,
        };
      }
    }
    // 本题还没有草稿：只带全局语言偏好，绝不带其他题的代码
    const prefs = ctx.store.get("editorPrefs");
    return {
      pid,
      code: "",
      lang: prefs && prefs.lang ? String(prefs.lang) : "C++14 (GCC 9)",
      o2: !!(prefs && prefs.o2),
      savedAt: 0,
    };
  });

  ipcMain.handle("app:checkin", async () => {
    const result = await ctx.luogu.checkin();
    if (result.ok) ctx.toast("签到", result.already ? "今天已经签过了。" : "签到成功。");
    else ctx.toast("签到没有成功", result.message || "没找到签到入口，稍后再试一次。");
    return result;
  });

  ipcMain.handle("app:refreshHome", async () => {
    const data = await ctx.luogu.refresh(true);
    broadcastState(ctx);
    return data;
  });

  ipcMain.handle("app:logout", async () => {
    await ctx.luogu.logout();
    ctx.views.showHome();
    return state(ctx);
  });

  ipcMain.handle("app:palette", (_event, query) => palette(query, ctx));

  ipcMain.handle("app:switcher", () => ctx.views.listOpen());

  ipcMain.handle("app:switchTo", (_event, key) => {
    ctx.views.switchTo(String(key || ""));
  });

  ipcMain.handle("app:openSettings", () => {
    ctx.views.hideRailOverlay();
    ctx.openSettings();
  });

  ipcMain.handle("app:command", (_event, name) => {
    ctx.command(String(name || ""));
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.on("page:open-problem", (_event, pid) => {
    ctx.views.openProblem(pid);
  });

  ctx.broadcastState = () => broadcastState(ctx);
}

module.exports = { registerIpc, broadcastState, state };
