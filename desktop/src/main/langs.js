/* 洛谷评测语言表。来源：https://www.luogu.com.cn/_lfe/config 的 CodeLanguage
   （2026-10-26 实测抓取，按 UI 下拉的 order 排序）。
   id 是提交接口 lang 字段的数字值（2026-10 新评测机：旧 id 5 已改为「提交答案」，
   提交会报 record.invalid_language_type）；o2 对应站点的 canO2。
   校验方式：LG_SMOKE_LANG=1 会拿真实 /_lfe/config 对照这张表，漂移即 FAIL。 */
const LANGS = [
  { id: 1, name: "Pascal", o2: true },
  { id: 2, name: "C", o2: true },
  { id: 28, name: "C++14 (GCC 9)", o2: true },
  { id: 3, name: "C++98", o2: true },
  { id: 4, name: "C++11", o2: true },
  { id: 11, name: "C++14", o2: true },
  { id: 12, name: "C++17", o2: true },
  { id: 27, name: "C++20", o2: true },
  { id: 34, name: "C++23", o2: true },
  { id: 7, name: "Python 3", o2: false },
  { id: 25, name: "PyPy 3", o2: false },
  { id: 8, name: "Java 8", o2: false },
  { id: 33, name: "Java 21", o2: false },
  { id: 15, name: "Rust", o2: true },
  { id: 14, name: "Go", o2: false },
  { id: 19, name: "Haskell", o2: true },
  { id: 30, name: "OCaml", o2: true },
  { id: 21, name: "Kotlin/JVM", o2: false },
  { id: 17, name: "C# Mono", o2: false },
  { id: 9, name: "Node.js LTS", o2: false },
  { id: 16, name: "PHP", o2: false },
  { id: 13, name: "Ruby", o2: false },
];

/* 常见别名（记录列表/旧草稿里的写法）。键一律小写。 */
const ALIAS = {
  "c++": 28,
  python3: 7,
  python: 7,
  pypy3: 25,
  "node.js": 9,
  nodejs: 9,
  "c#": 17,
  "g++": 28,
};

const BY_NAME = new Map(LANGS.map((lang) => [lang.name.toLowerCase(), lang]));
const BY_ID = new Map(LANGS.map((lang) => [lang.id, lang]));

/* 不认识的名字返回 null——调用方必须把 null 当「不支持」处理，
   绝不允许回落到某个默认语言（那会悄悄改语言提交）。 */
function resolveLangId(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  const direct = BY_NAME.get(key);
  if (direct) return direct;
  const alias = ALIAS[key];
  return alias ? BY_ID.get(alias) || null : null;
}

module.exports = { LANGS, resolveLangId };
