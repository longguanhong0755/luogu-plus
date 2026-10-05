/* Luogu++ — 历史 / 下载 页逻辑。
   桥接走 preload-config.js（与设置页同一个 lgConfig 对象）。 */
const $ = (id) => document.getElementById(id);
let pane = "history";

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return hh + ":" + mm;
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hh + ":" + mm;
}
function row(children, extra) {
  const el = document.createElement("div");
  el.className = "h-row" + (extra ? " " + extra : "");
  for (const c of children) el.appendChild(c);
  return el;
}
function button(cls, text, title, onClick) {
  const b = document.createElement("button");
  b.className = cls;
  /* R41：改 innerHTML——图标钮传 icons.js 的 svg() 字符串，文字钮不受影响 */
  b.innerHTML = text;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}
function empty(text) {
  const e = document.createElement("div");
  e.className = "empty-state";
  e.textContent = text;
  return e;
}
function openUrl(url) {
  if (url) window.lgConfig.openUrl(url);
}

/* ---------- 历史 ---------- */
const dayKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
};
function dayLabel(ts) {
  const now = new Date();
  const k = dayKey(ts);
  if (k === dayKey(now.getTime())) return "今天";
  if (k === dayKey(now.getTime() - 86400000)) return "昨天";
  const d = new Date(ts);
  return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日" + (d.getFullYear() !== now.getFullYear() ? " · " + d.getFullYear() + " 年" : "");
}
async function renderHistory() {
  const r = await window.lgConfig.historyList($("h-q").value);
  const list = $("h-list");
  list.textContent = "";
  const entries = (r && r.entries) || [];
  // 计数要在 early return 之前写：清空/搜索无结果时不能停在旧数字上
  $("h-count").textContent = String(entries.length);
  if (!entries.length) {
    list.appendChild(empty($("h-q").value ? "没有匹配的记录。" : "还没有浏览记录。"));
    return;
  }
  let lastDay = null;
  for (const e of entries) {
    // 按日期分组（今天 / 昨天 / 日期）——长列表里"哪天的"比秒级时间更重要
    const k = dayKey(e.ts || Date.now());
    if (k !== lastDay) {
      lastDay = k;
      const h = document.createElement("div");
      h.className = "h-day";
      h.textContent = dayLabel(e.ts || Date.now());
      list.appendChild(h);
    }
    const main = document.createElement("button");
    main.className = "h-main";
    const t = document.createElement("div");
    t.className = "h-title";
    t.textContent = e.title || e.url;
    const u = document.createElement("div");
    u.className = "h-url";
    u.textContent = e.url;
    main.appendChild(t);
    main.appendChild(u);
    main.addEventListener("click", () => openUrl(e.url));
    const time = document.createElement("span");
    time.className = "h-time";
    time.textContent = fmtTime(e.ts);
    const del = button("h-del", window.LGIcons.svg("winClose"), "删除这条记录", async () => {
      await window.lgConfig.historyRemove({ url: e.url, ts: e.ts });
      renderHistory();
    });
    list.appendChild(row([main, time, del]));
  }
}

/* ---------- 下载 ---------- */
async function renderDownloads() {
  const r = await window.lgConfig.downloadList();
  const list = $("d-list");
  list.textContent = "";
  const items = (r && r.downloads) || [];
  const dir = items.find((d) => d.savePath);
  $("d-dir").textContent = dir
    ? "文件保存在：" + dir.savePath.replace(/[\\/][^\\/]*$/, "")
    : "下载会统一存到「下载/Luogu++」文件夹。";
  if (!items.length) {
    list.appendChild(empty("暂无下载记录。"));
    return;
  }
  for (const d of items.slice().reverse()) {
    const main = document.createElement("div");
    main.className = "h-main";
    const t = document.createElement("div");
    t.className = "h-title";
    t.textContent = d.filename;
    const u = document.createElement("div");
    u.className = "h-url";
    if (d.state === "progressing") {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : null;
      u.textContent = pct == null ? fmtBytes(d.received) : pct + "% · " + fmtBytes(d.received) + " / " + fmtBytes(d.total);
    } else if (d.state === "completed") {
      u.textContent = "已完成 · " + fmtBytes(d.received);
    } else if (d.state === "cancelled") {
      u.textContent = "已取消";
    } else if (d.state === "paused") {
      u.textContent = "已暂停 · " + fmtBytes(d.received);
    } else {
      u.textContent = "已中断";
    }
    main.appendChild(t);
    main.appendChild(u);
    if ((d.state === "progressing" || d.state === "paused") && d.total) {
      const bar = document.createElement("div");
      bar.className = "dl-bar";
      const i = document.createElement("i");
      i.style.width = Math.round((d.received / d.total) * 100) + "%";
      bar.appendChild(i);
      main.appendChild(bar);
    }
    const time = document.createElement("span");
    time.className = "h-time";
    time.textContent = fmtTime(d.startedAt);
    const cells = [main, time];
    /* 与外壳下载面板同一套动作语义（这里用文字按钮） */
    const act = (label, title, fn) => button("h-del h-act", label, title, async () => {
      await fn();
      renderDownloads();
    });
    if (d.state === "progressing" && d.canPause) {
      cells.push(act("暂停", "暂停下载", () => window.lgConfig.downloadPause(d.id)));
      cells.push(act("取消", "取消下载", () => window.lgConfig.downloadCancel(d.id)));
    } else if (d.state === "paused") {
      cells.push(act("继续", "继续下载", () => window.lgConfig.downloadResume(d.id)));
      cells.push(act("取消", "取消下载", () => window.lgConfig.downloadCancel(d.id)));
    } else if (d.state === "completed") {
      cells.push(button("h-del", "↗", "在文件夹中显示", async () => { await window.lgConfig.downloadReveal(d.id); }));
      if (d.canSaveAs) cells.push(act("另存为", "把文件另存到别处", () => window.lgConfig.downloadSaveAs(d.id)));
    } else if (d.state === "interrupted" || d.state === "cancelled") {
      cells.push(act("重试", "重新下载", () => window.lgConfig.downloadRetry(d.id)));
      cells.push(act("移除", "从列表移除记录", () => window.lgConfig.downloadRemove(d.id)));
    } else {
      cells.push(act("移除", "从列表移除记录", () => window.lgConfig.downloadRemove(d.id)));
    }
    list.appendChild(row(cells));
  }
}

/* ---------- 页签切换 ---------- */
function showPane(p) {
  pane = p;
  document.querySelectorAll("#h-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.v === p));
  $("pane-history").hidden = p !== "history";
  $("pane-downloads").hidden = p !== "downloads";
  if (p === "history") renderHistory();
  else renderDownloads();
}

(async function init() {
  if (!window.lgConfig) {
    document.body.innerHTML =
      '<div class="lg-err">历史页桥接失败：preload-config.js 未加载</div>';
    return;
  }
  // 与设置页同一套基色。外壳明暗切换已按需求移除，固定浅色。
  let cfg = {};
  try {
    cfg = (await window.lgConfig.get()) || {};
  } catch {}
  // 明暗与外壳同源：主进程 resolvedTheme 随 lg-config:get 下发
  const dark = cfg.resolvedTheme === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try {
    const pr = await window.lgConfig.presets();
    // 用主进程算好的派生色（含自定义预设现算）：预设清单里的 custom 项
    // 没有 tint/border，直接读会写出 rgb(undefined)
    const v = dark ? (pr && pr.derivedDark) : (pr && pr.derivedLight);
    if (v) {
      const st = document.documentElement.style;
      st.setProperty("--surface", "rgb(" + v.tint + ")");
      st.setProperty("--bg", v.bgBase);
      st.setProperty("--ink", v.ink);
      st.setProperty("--hairline", v.border);
    }
  } catch {}

  document.querySelectorAll("#h-tabs button").forEach((b) => {
    b.addEventListener("click", () => showPane(b.dataset.v));
  });
  let qt = null;
  $("h-q").addEventListener("input", () => {
    clearTimeout(qt);
    qt = setTimeout(renderHistory, 180);
  });
  $("h-clear").addEventListener("click", async () => {
    await window.lgConfig.historyClear();
    renderHistory();
  });
  $("d-clear").addEventListener("click", async () => {
    await window.lgConfig.downloadClear();
    renderDownloads();
  });
  showPane("history");
  // 下载进度实时刷新（只在下载页时轮询）
  setInterval(() => {
    if (pane === "downloads") renderDownloads();
  }, 1500);
})();
