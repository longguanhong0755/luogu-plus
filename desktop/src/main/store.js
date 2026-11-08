/* 轻量 JSON 落盘：userData/store/<key>.json。
   断网可用的地基——列表/主页快照、题目快照、代码草稿、离线提交队列都走这里。
   设计约束：
   - 不依赖 electron，check.js 可以直接单测；
   - 原子写（tmp + rename），进程被杀也不会留下半截 JSON；
   - set 默认防抖合并（打字保存草稿这类高频写不刷盘风暴）；
   - 单条快照与内存/磁盘总量都有硬上限，冷数据按 LRU 淘汰。 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_VALUE_BYTES = 1.5 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_MEM_BYTES = 32 * 1024 * 1024;
const MAX_MEM_ENTRIES = 120;
const PROTECTED_KEYS = new Set([
  "home",
  "user",
  "editorPrefs",
  "queue",
  "libtags",
  "cacheEpoch",
  "randomJumpGuard",
  "userSearchGuard",
]);
const PROTECTED_FILES = new Set([...PROTECTED_KEYS].map((key) => safeName(key) + ".json"));

function safeName(key) {
  return (
    String(key)
      .replace(/[^a-zA-Z0-9._-]+/g, (m) => "~" + Buffer.from(m, "utf8").toString("hex") + "~")
      .slice(0, 120) || "_"
  );
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.mem = new Map();
    this.memSizes = new Map();
    this.memBytes = 0;
    this.timers = new Map();
    /* 磁盘文件索引：文件名 → { mtimeMs, size, key, at }。
       evict/entries 是列表保存的热路径，只有新写/变化的文件才重新解析。 */
    this.index = new Map();
  }

  init() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.pruneDisk();
    } catch (err) {
      console.error("[store] init failed:", err.message);
    }
    return this;
  }

  fileOf(key) {
    return path.join(this.dir, safeName(key) + ".json");
  }

  dropMemory(key) {
    if (!this.mem.has(key)) return;
    this.memBytes -= this.memSizes.get(key) || 0;
    this.mem.delete(key);
    this.memSizes.delete(key);
    if (this.memBytes < 0) this.memBytes = 0;
  }

  trimMemory() {
    while (this.mem.size > MAX_MEM_ENTRIES || this.memBytes > MAX_MEM_BYTES) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.dropMemory(oldest);
    }
  }

  remember(key, value, bytes) {
    this.dropMemory(key);
    this.mem.set(key, value);
    this.memSizes.set(key, bytes);
    this.memBytes += bytes;
    this.trimMemory();
  }

  touchMemory(key) {
    if (!this.mem.has(key)) return;
    const value = this.mem.get(key);
    this.mem.delete(key);
    this.mem.set(key, value);
  }

  get(key, fallback = null) {
    if (this.mem.has(key)) {
      this.touchMemory(key);
      const cached = this.mem.get(key);
      return cached === undefined ? fallback : cached;
    }
    try {
      const raw = fs.readFileSync(this.fileOf(key), "utf8");
      const value = JSON.parse(raw);
      this.remember(key, value, Buffer.byteLength(raw, "utf8"));
      return value;
    } catch {
      return fallback;
    }
  }

  set(key, value, delayMs = 400) {
    if (value === undefined) return;
    let bytes = 0;
    try {
      const encoded = JSON.stringify(value);
      bytes = Buffer.byteLength(encoded, "utf8");
      if (bytes > MAX_VALUE_BYTES) {
        console.error("[store] 拒收过大快照", key, Math.round(bytes / 1024) + "KB");
        return;
      }
    } catch (err) {
      console.error("[store] 不可序列化", key, err.message);
      return;
    }
    this.remember(key, value, bytes);
    if (this.timers.has(key)) clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flush(key), delayMs));
  }

  delete(key) {
    this.dropMemory(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    const name = safeName(key) + ".json";
    try {
      fs.rmSync(this.fileOf(key), { force: true });
      this.index.delete(name);
    } catch {
      /* ignore */
    }
  }

  flush(key) {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    if (!this.mem.has(key)) return;
    const file = this.fileOf(key);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const encoded = JSON.stringify(this.mem.get(key));
      const tmp = file + "." + process.pid + ".tmp";
      fs.writeFileSync(tmp, encoded);
      fs.renameSync(tmp, file);
      const stat = fs.statSync(file);
      this.index.set(path.basename(file), {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        key: String(key),
        at: (this.mem.get(key) && (this.mem.get(key).savedAt || this.mem.get(key).at)) || 0,
      });
      this.pruneDisk();
    } catch (err) {
      console.error("[store] write failed", key, err.message);
    }
  }

  flushAll() {
    for (const key of [...this.mem.keys()]) this.flush(key);
  }

  /* 刷新磁盘索引：只为 mtime/size 变化的文件付出一次解析成本。 */
  refreshIndex() {
    let names = [];
    try {
      names = fs.readdirSync(this.dir).filter((name) => name.endsWith(".json"));
    } catch {
      names = [];
    }
    const live = new Set();
    for (const name of names) {
      live.add(name);
      const file = path.join(this.dir, name);
      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const cached = this.index.get(name);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;
      try {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        this.index.set(name, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          key: value && typeof value.key === "string" ? value.key : "",
          at: (value && value.savedAt) || (value && value.at) || 0,
        });
      } catch {
        this.index.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, key: "", at: 0 });
      }
    }
    for (const name of [...this.index.keys()]) {
      if (!live.has(name)) this.index.delete(name);
    }
  }

  /* 前缀枚举：mem 优先，磁盘走 mtime 索引（不解析全量 JSON）。
     磁盘独有条目的 value 为 undefined——现有调用方（淘汰/清理）只用 key/at。 */
  entries(prefix) {
    const out = [];
    const seen = new Set();
    const push = (key, value, at) => {
      if (!key.startsWith(prefix) || seen.has(key)) return;
      seen.add(key);
      out.push({ key, value, at: at || 0 });
    };
    for (const [key, value] of this.mem) {
      if (key.startsWith(prefix)) push(key, value, (value && value.savedAt) || (value && value.at) || 0);
    }
    this.refreshIndex();
    for (const info of this.index.values()) {
      if (!info.key || seen.has(info.key)) continue;
      push(info.key, undefined, info.at);
    }
    return out;
  }

  pruneDisk() {
    this.refreshIndex();
    let totalBytes = 0;
    for (const info of this.index.values()) totalBytes += info.size || 0;
    if (this.index.size <= MAX_FILES && totalBytes <= MAX_TOTAL_BYTES) return { files: this.index.size, bytes: totalBytes, removed: 0 };
    const rows = [...this.index.entries()]
      .map(([name, info]) => ({ name, info }))
      .sort((a, b) => (a.info.at || 0) - (b.info.at || 0));
    let removed = 0;
    while (rows.length && (this.index.size > MAX_FILES || totalBytes > MAX_TOTAL_BYTES)) {
      const row = rows.shift();
      if (!row) break;
      if (PROTECTED_FILES.has(row.name) || PROTECTED_KEYS.has(row.info.key)) continue;
      try {
        fs.rmSync(path.join(this.dir, row.name), { force: true });
        this.index.delete(row.name);
        totalBytes -= row.info.size || 0;
        if (row.info.key) this.dropMemory(row.info.key);
        removed += 1;
      } catch {
        /* ignore and let the next maintenance pass retry */
      }
    }
    return { files: this.index.size, bytes: Math.max(0, totalBytes), removed };
  }

  /* 按前缀保留最新 keep 条（按 payload 里的 savedAt/at 排序），其余删除。 */
  evict(prefix, keep) {
    const list = this.entries(prefix).sort((a, b) => b.at - a.at);
    for (let i = keep; i < list.length; i++) this.delete(list[i].key);
    this.pruneDisk();
    return list.length;
  }

  stats() {
    this.refreshIndex();
    let bytes = 0;
    for (const info of this.index.values()) bytes += info.size || 0;
    return {
      entries: this.index.size,
      diskBytes: bytes,
      memoryEntries: this.mem.size,
      memoryBytes: this.memBytes,
      limits: {
        files: MAX_FILES,
        diskBytes: MAX_TOTAL_BYTES,
        memoryEntries: MAX_MEM_ENTRIES,
        memoryBytes: MAX_MEM_BYTES,
        valueBytes: MAX_VALUE_BYTES,
      },
    };
  }
}

module.exports = { Store, safeName };
