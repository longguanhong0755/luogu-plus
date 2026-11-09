/* 洛谷数据服务 · 纯函数工具（拆分自 src/main/luogu.js）。 */
const { QUOTES } = require("./consts");

/* 标签筛选编码：组内逗号=或，组间竖线=与（与网页版 URL 完全一致） */
function normalizeTagGroups(value) {
  const groups = [];
  for (const raw of Array.isArray(value) ? value : String(value || "").split("|")) {
    const ids = (Array.isArray(raw) ? raw : String(raw).split(","))
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    if (unique.length) groups.push(unique);
  }
  const seen = new Set();
  return groups.filter((group) => {
    const key = group.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tagQuery(groups) {
  return groups.map((group) => group.join(",")).join("|");
}

/* /_lfe/tags 精简：只保留前端需要的字段，避免把几百个无关字段带进渲染进程 */
function normalizeTagCatalog(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => ({
          id: Number(tag.id) || 0,
          name: String(tag.name || ""),
          type: Number(tag.type) || 0,
          parent: Number(tag.parent) || 0,
        }))
        .filter((tag) => tag.id && tag.name)
    : [];
  const types = Array.isArray(raw.types)
    ? raw.types
        .map((type) => ({
          id: Number(type.id) || 0,
          type: String(type.type || ""),
          name: String(type.name || ""),
          color: String(type.color || ""),
          order: Number(type.order) || 0,
        }))
        .filter((type) => type.id && type.name)
    : [];
  if (!tags.length) return null;
  return { tags, types };
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function quoteFor(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const index = Math.floor((date - start) / 86400000) % QUOTES.length;
  return QUOTES[index];
}

function findArray(root, predicate, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    if (root.length && root.every((item) => item && typeof item === "object") && predicate(root[0])) return root;
    for (const item of root) {
      const hit = findArray(item, predicate, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    for (const key of Object.keys(root)) {
      const hit = findArray(root[key], predicate, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findObject(root, predicate, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findObject(item, predicate, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    if (predicate(root)) return root;
    for (const key of Object.keys(root)) {
      const hit = findObject(root[key], predicate, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function toMillis(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

/* 列表摘要只保留纯文本：去掉公式、HTML 和 Markdown 记号，避免列表里直接露出
   $\sum...$ 之类源码（正文仍由页面完整渲染）。 */
function plainExcerpt(value, limit = 120) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\})?/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[#>*`_~{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function trimMap(map, limit) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
module.exports = {
  normalizeTagGroups,
  tagQuery,
  normalizeTagCatalog,
  delay,
  dayKey,
  quoteFor,
  findArray,
  findObject,
  toMillis,
  plainExcerpt,
  trimMap,
};
