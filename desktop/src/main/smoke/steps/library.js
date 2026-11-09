/* 题库探针：各分区截图 + 筛选面板行为（难度区间/标签弹窗/参数透传）。 */
const { runLibFilterProbe } = require("./lib-filter");

async function runLibraryStep(tools) {
  const { ctx, wait, shot, shotView, outDir } = tools;
  if (process.env.LG_SMOKE_LIB === "1") {
    const libKinds = String(process.env.LG_SMOKE_LIB_ONLY || "problems,contest,article,discuss,training,record")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const filterProbe = process.env.LG_SMOKE_LIB_FILTER === "1" && libKinds.includes("problems");
    const fakeTags = {
      tags: [
        { id: 2, name: "模拟", type: 2, parent: 0 },
        { id: 3, name: "枚举", type: 2, parent: 0 },
        { id: 4, name: "NOIP", type: 3, parent: 0 },
        { id: 5, name: "中国", type: 1, parent: 0 },
      ],
      types: [],
    };
    const originalTags = filterProbe ? ctx.luogu.fetchTags : null;
    if (filterProbe) ctx.luogu.fetchTags = async () => fakeTags;
    for (const kind of libKinds) {
      ctx.views.showLibrary(kind);
      await wait(process.env.LG_SMOKE_NET === "1" ? 12000 : 700);
      await shot("lib-" + kind);
      if (process.env.LG_SMOKE_VISUAL === "1" && kind === "problems") {
        await ctx.win.webContents.executeJavaScript(`(() => { const p = document.getElementById("library"); p.scrollTop = p.scrollHeight; return p.scrollTop; })()`);
        await wait(180);
        await shot("lib-problems-pagination");
        await ctx.win.webContents.executeJavaScript(`document.getElementById("library").scrollTop = 0; true`);
      }
    }
    await runLibFilterProbe(tools, filterProbe, originalTags);
    ctx.views.showHome();
    await wait(400);
  }
}

module.exports = { runLibraryStep };
