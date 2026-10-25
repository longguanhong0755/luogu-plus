/* 轻量 JSON 落盘：userData/store/<key>.json。
   断网可用的地基——列表/主页快照、题目快照、代码草稿、离线提交队列都走这里。
   设计约束：
   - 不依赖 electron，check.js 可以直接单测；
   - 原子写（tmp + rename），进程被杀也不会留下半截 JSON；
   - set 默认防抖合并（打字保存草稿这类高频写不刷盘风暴）；
   - 单条快照体积有上限，超限直接拒收（题目快照截断在调用侧做）。 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_VALUE_BYTES = 1.5 * 1024 * 1024;
const MAX_FILES = 200;

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
    this.timers = new Map();
  }

  init() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error("[store] init failed:", err.message);
    }
    return this;
  }

  fileOf(key) {
    return path.join(this.dir, safeName(key) + ".json");
  }

  get(key, fallback = null) {
    if (this.mem.has(key)) {
      const cached = this.mem.get(key);
      return cached === undefined ? fallback : cached;
    }
    try {
      const value = JSON.parse(fs.readFileSync(this.fileOf(key), "utf8"));
      this.mem.set(key, value);
      return value;
    } catch {
      return fallback;
    }
  }

  set(key, value, delayMs = 400) {
    if (value === undefined) return;
    try {
      const encoded = JSON.stringify(value);
      if (Buffer.byteLength(encoded, "utf8") > MAX_VALUE_BYTES) {
        console.error("[store] 拒收过大快照", key, Math.round(encoded.length / 1024) + "KB");
        return;
      }
    } catch (err) {
      console.error("[store] 不可序列化", key, err.message);
      return;
    }
    this.mem.set(key, value);
    if (this.timers.has(key)) clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flush(key), delayMs));
  }

  delete(key) {
    this.mem.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    try {
      fs.rmSync(this.fileOf(key), { force: true });
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
      const tmp = file + "." + process.pid + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.mem.get(key)));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error("[store] write failed", key, err.message);
    }
  }

  flushAll() {
    for (const key of [...this.mem.keys()]) this.flush(key);
  }

  /* 前缀枚举：key 存在 payload 里（文件名可能被转义），所以从文件内容读回 key。
     快照类缓存量级在几十条，全量解析可接受。 */
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
    let names = [];
    try {
      names = fs.readdirSync(this.dir).filter((name) => name.endsWith(".json"));
    } catch {
      names = [];
    }
    for (const name of names) {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
        const key = value && typeof value.key === "string" ? value.key : "";
        if (!key || seen.has(key)) continue;
        push(key, value, (value && value.savedAt) || (value && value.at) || 0);
      } catch {
        /* 损坏文件跳过 */
      }
    }
    return out;
  }

  /* 按前缀保留最新 keep 条（按 payload 里的 savedAt/at 排序），其余删除。 */
  evict(prefix, keep) {
    const list = this.entries(prefix).sort((a, b) => b.at - a.at);
    for (let i = keep; i < list.length; i++) this.delete(list[i].key);
    const overflow = this.entries("").length - MAX_FILES;
    if (overflow > 0) {
      const oldest = this.entries("").filter((item) => item.key.startsWith(prefix)).sort((a, b) => a.at - b.at);
      for (let i = 0; i < Math.min(overflow, oldest.length); i++) this.delete(oldest[i].key);
    }
    return list.length;
  }
}

module.exports = { Store, safeName };
