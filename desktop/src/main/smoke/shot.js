/* 截图工具：落盘 + manifest 记录（sha256/尺寸/URL），以及页面视图截图。 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { captureWC } = require("./capture");

function createShotTools(ctx, outDir, wait) {
  const shots = [];
  const shot = async (name, target) => {
    const surface = target || ctx.win;
    const wc = surface.webContents || surface;
    const image = await captureWC(wc, wait);
    if (!image || image.isEmpty()) throw new Error("截图失败: " + name);
    const file = path.join(outDir, `smoke-${name}.png`);
    const png = image.toPNG();
    fs.writeFileSync(file, png);
    const size = image.getSize();
    shots.push({
      name,
      file,
      kind: surface.webContents ? "shell-window" : "page-view",
      url: typeof wc.getURL === "function" ? wc.getURL() : "",
      title: typeof wc.getTitle === "function" ? wc.getTitle() : "",
      theme: process.env.LG_SMOKE_THEME || "default",
      viewport: process.env.LG_SMOKE_SIZE || "default",
      width: size.width,
      height: size.height,
      bytes: png.length,
      sha256: crypto.createHash("sha256").update(png).digest("hex"),
    });
    console.log("SMOKE_SHOT " + name + " " + file);
    return file;
  };
  const shotView = async (name, entry) => {
    if (process.env.LG_SMOKE_VIEW_CAPTURE !== "1") {
      console.log("SMOKE_NOTE " + name + " 页面视图截图需 LG_SMOKE_VIEW_CAPTURE=1");
      return null;
    }
    const current = entry || ctx.views.currentEntry();
    if (!current || !current.view || current.view.webContents.isDestroyed()) {
      console.log("SMOKE_FAIL screenshot target missing: " + name);
      return null;
    }
    try {
      return await shot(name, current.view.webContents);
    } catch (err) {
      console.log("SMOKE_NOTE " + name + " 页面视图截图不可用: " + err.message);
      return null;
    }
  };
  const writeManifest = () => {
    const file = path.join(outDir, "smoke-manifest-" + (process.env.LG_SMOKE_RUN_ID || Date.now()) + ".json");
    const payload = {
      runId: process.env.LG_SMOKE_RUN_ID || "",
      generatedAt: new Date().toISOString(),
      theme: process.env.LG_SMOKE_THEME || "default",
      viewport: process.env.LG_SMOKE_SIZE || "default",
      modes: {
        visual: process.env.LG_SMOKE_VISUAL === "1",
        library: process.env.LG_SMOKE_LIB === "1",
        luogu: process.env.LG_SMOKE_LUOGU === "1",
        enhance: process.env.LG_SMOKE_ENHANCE === "1",
        skinAudit: process.env.LG_SMOKE_SKIN_AUDIT === "1",
        performance: process.env.LG_SMOKE_PERF === "1",
      },
      shots,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    console.log("SMOKE_MANIFEST " + file);
  };

  return { shots, shot, shotView, writeManifest };
}

module.exports = { createShotTools };
