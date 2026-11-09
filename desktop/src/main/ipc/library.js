/* 题库域 IPC：列表、标签目录、随机跳题与用户搜索。 */
const { ipcMain } = require("electron");
const { LIBRARY_IDS } = require("../sections");

function register(ctx) {
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

  ipcMain.handle("app:randomProblem", (_event, payload) => ctx.luogu.randomProblem(payload || {}));

  ipcMain.handle("app:searchUsers", (_event, keyword) => ctx.luogu.searchUsers(keyword));
}

module.exports = { register };
