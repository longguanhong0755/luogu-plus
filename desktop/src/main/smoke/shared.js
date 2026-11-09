/* 仅测试用：不可见冒烟启动、截图、皮肤/深色审计；以及演示数据。
   生产路径不会加载这里的逻辑（只有 --smoke / LG_DEMO 时调用）。 */
const fs = require("node:fs");

/* ---------- 真实账号登录测试（LG_SMOKE_LOGIN=<账号文件>）---------- */

function firstAccount(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const idx = line.indexOf("----");
    if (idx <= 0) continue;
    const user = line.slice(0, idx).trim();
    const pass = line.slice(idx + 4).trim();
    if (user && pass) return { user, pass };
  }
  return null;
}

async function pollLoginState(ctx, wait, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await ctx.luogu.loginState();
    if (state.loggedIn) return state;
    await wait(1000);
  }
  return null;
}

function findRecord(root, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findRecord(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    if ("status" in root && "score" in root) return root;
    for (const key of Object.keys(root)) {
      const hit = findRecord(root[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

module.exports = { firstAccount, pollLoginState, findRecord };
