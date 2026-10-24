/* 应用内所有路径的单一来源（相对 desktop/ 定位，不依赖 cwd）。 */
const path = require("node:path");
const { app } = require("electron");

const ROOT = path.join(__dirname, "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const PRELOAD = path.join(ROOT, "src", "preload");
const ASSETS = path.join(ROOT, "src", "assets");
const SKIN_DIR = path.join(RENDERER, "skin");

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

module.exports = { ROOT, RENDERER, PRELOAD, ASSETS, SKIN_DIR, userDataFile };
