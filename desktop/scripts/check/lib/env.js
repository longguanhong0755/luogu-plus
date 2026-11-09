/* 静态检查基础设施（R96 从 scripts/check.js 拆出）：
   ok/fail 记结果并打印，read() 负责把「薄入口 + 实现文件」拼成逻辑全文，
   walk()/ROOT 供各检查段复用。 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPTS_DIR = path.join(__dirname, "..", "..");
const ROOT = path.join(SCRIPTS_DIR, "..");

let failures = 0;
let checks = 0;

function ok(message) {
  checks++;
  console.log("  ok  " + message);
}

function fail(message, detail) {
  failures++;
  console.log("  FAIL " + message);
  if (detail) console.log("       " + detail);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* 源码拆分（R96）：一个逻辑文件可以拆成「薄入口 + 实现文件」。
   断言仍然针对逻辑文件的全文，因此 read() 在读到入口文件后，会把它的实现
   文件拼在后面：
     - 若 scripts/check.parts.d/*.json 里登记了该路径，按登记顺序拼接
       （每个拆分区块登记自己的 json，互不冲突）；
     - 否则若存在同名目录（去掉扩展名），按文件名排序拼接。 */
const PARTS_DIR = path.join(SCRIPTS_DIR, "check.parts.d");
let partsMap = null;
function loadPartsMap() {
  if (partsMap) return partsMap;
  partsMap = {};
  let names = [];
  try {
    names = fs.readdirSync(PARTS_DIR).filter((name) => name.endsWith(".json")).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, name), "utf8"));
      for (const [entry, parts] of Object.entries(raw)) {
        if (!Array.isArray(parts)) continue;
        const list = parts.filter((part) => typeof part === "string");
        partsMap[entry] = (partsMap[entry] || []).concat(list);
      }
    } catch {
      /* 单个登记文件损坏时跳过，不影响其它区块 */
    }
  }
  return partsMap;
}

function readPart(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function read(file) {
  const base = fs.readFileSync(path.join(ROOT, file), "utf8");
  const registered = loadPartsMap()[file];
  if (registered) return [base, ...registered.map(readPart)].join("\n");
  const autoDir = path.join(ROOT, file.replace(/\.[^./\\]+$/, ""));
  if (/\.js$/.test(file) && fs.existsSync(autoDir)) {
    try {
      if (fs.statSync(autoDir).isDirectory()) {
        const parts = walk(autoDir, [])
          .filter((full) => full.endsWith(".js"))
          .sort()
          .map((full) => fs.readFileSync(full, "utf8"));
        return [base, ...parts].join("\n");
      }
    } catch {
      /* 读不到实现目录时只用入口文件 */
    }
  }
  return base;
}

const store = {};

function counts() {
  return { checks, failures };
}

module.exports = { fs, path, spawnSync, walk, read, ok, fail, ROOT, SCRIPTS_DIR, store, counts };
