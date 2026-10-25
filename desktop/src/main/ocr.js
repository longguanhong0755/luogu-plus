/* 可选功能：调用本机 ddddocr（Python）识别洛谷图形验证码。
   环境里没有 python + ddddocr 时 recognize 返回 {ok:false}，
   调用方必须回退到人工流程，不能因此阻塞主功能。 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "captcha-ocr.py");
let cachedPython = null; // "" 表示探测过且不可用

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(null);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(out));
  });
}

async function detectPython() {
  if (cachedPython !== null) return cachedPython;
  for (const cmd of ["python", "py"]) {
    const probe = cmd === "py" ? ["-3", "-X", "utf8", "-c", "import ddddocr"] : ["-X", "utf8", "-c", "import ddddocr"];
    if ((await run(cmd, probe, 20000)) !== null) {
      cachedPython = cmd;
      return cmd;
    }
  }
  cachedPython = "";
  return "";
}

/* image: Buffer（PNG/JPG 均可，ddddocr 自己识别格式） */
async function recognize(image) {
  const python = await detectPython();
  if (!python) return { ok: false, reason: "no-python-ddddocr" };
  const file = path.join(os.tmpdir(), `lgpp-captcha-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(file, image);
  try {
    const prefix = python === "py" ? ["-3"] : [];
    const out = await run(python, [...prefix, "-X", "utf8", SCRIPT, file], 30000);
    const line = String(out || "")
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean) || "";
    if (line.startsWith("ERR")) return { ok: false, reason: line.slice(0, 140) };
    const text = line.replace(/[^0-9a-zA-Z]/g, "");
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

module.exports = { recognize, detectPython };
