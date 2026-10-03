/* ============================================================
   Luogu++ — 应用首页逻辑
   数据来源：lgConfig.get()（映射词 / dockItems）、historyList()（最近访问）。
   跳转统一走 openUrl：首页是本地标签，主进程会自动开新站点标签。
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  let mappings = {};

  /* ---------- 首页板块偏好（设置页「应用首页」卡片可改） ----------
     默认值与主进程 DEFAULT_CONFIG.homePrefs 保持一致：配置还没拉到时
     首页先按全显示渲染，拿到配置再收敛。 */
  let prefs = {
    clock: true, seconds: false, clockFont: "mono", clockSize: 58,
    date: true, search: true, countdowns: true, links: true,
    recent: true, contests: true, footer: true,
  };
  function applyPrefs(p) {
    prefs = Object.assign({}, prefs, p || {});
    const show = (id, on) => {
      const el = $(id);
      if (el) el.style.display = on === false ? "none" : "";
    };
    show("clock", prefs.clock);
    show("date", prefs.date);
    show("sec-search", prefs.search);
    show("resolve", prefs.search);
    show("sec-countdowns", prefs.countdowns);
    show("links", prefs.links);
    show("sec-recent", prefs.recent);
    show("sec-contests", prefs.contests);
    show("sec-foot", prefs.footer);
    const clock = $("clock");
    const font = ["mono", "sans", "serif"].includes(prefs.clockFont) ? prefs.clockFont : "mono";
    clock.classList.remove("f-mono", "f-sans", "f-serif");
    clock.classList.add("f-" + font);
    const size = Math.min(96, Math.max(40, Number(prefs.clockSize) || 58));
    clock.style.fontSize = size + "px";
    tick(); // 字号/秒显立刻生效，不等下一秒
  }

  /* ---------- 解析：与 omnibox 同一套语义 ----------
     映射词 > 完整 URL > 洛谷域名 > 站内路径 > 题号 > UID > 站内搜索 */
  function resolve(raw) {
    const s = (raw || "").trim();
    if (!s) return null;
    // hasOwnProperty 防护：constructor / toString 这类原型键会"命中"原型成员
    if (Object.prototype.hasOwnProperty.call(mappings, s) && mappings[s]) return { label: "映射词 " + s, url: mappings[s] };
    if (/^https?:\/\//i.test(s)) return { label: s, url: s };
    if (/^(www\.)?luogu\.com\.cn(\/|$)/i.test(s)) return { label: "洛谷 · " + s, url: "https://" + s };
    if (s.startsWith("/")) return { label: "站内 " + s, url: "https://www.luogu.com.cn" + s };
    /* 裸域名（chat.deepseek.com）：没有 scheme 但长得像域名，直接按 https 打开 */
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(:\d+)?(\/\S*)?$/i.test(s)) {
      return { label: "网址 " + s, url: "https://" + s };
    }
    /* localhost / 内网主机名（R39，与地址栏同一套）：单段主机名（没有点）
       以前一律当搜索词，localhost:3000 / my-server:8080 这类明确的地址意图
       被搜掉。本机与内网默认按 http 试（Chrome 同款），带 scheme 的不受影响。 */
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/\S*)?$/i.test(s) ||
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:\d+(\/\S*)?$/i.test(s)) {
      return { label: "网址 " + s, url: "http://" + s };
    }
    if (/^[a-z]\d+$/i.test(s)) return { label: "题目 " + s.toUpperCase(), url: "https://www.luogu.com.cn/problem/" + s.toUpperCase() };
    if (/^\d+$/.test(s)) return { label: "用户 UID " + s, url: "https://www.luogu.com.cn/user/" + s };
    /* 搜索回退吃主进程下发的搜索引擎模板（与地址栏同一家；inject.js 的
       searchUrl 是同一份配置的读取口），拿不到才退回洛谷站内搜索 */
    const url =
      window.__lgGlass && window.__lgGlass.searchUrl
        ? window.__lgGlass.searchUrl(s)
        : "https://www.luogu.com.cn/search?keyword=" + encodeURIComponent(s);
    return { label: "搜索 “" + s + "”", url };
  }

  function go() {
    const r = resolve($("q").value);
    if (!r) return;
    $("q").value = "";
    $("resolve").textContent = "";
    window.lgConfig.openUrl(r.url);
  }

  /* ---------- 时钟 ---------- */
  function tick() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    $("clock").textContent =
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + (prefs.seconds ? ":" + pad(d.getSeconds()) : "");
    const week = "日一二三四五六"[d.getDay()];
    $("date").textContent = d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 · 星期" + week;
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- 图标（与外壳层 chrome.js 的 ICONS 同一份线稿） ---------- */
  const ICONS = {
    home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 17a2 2 0 0 1 2-2h11"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 3"/>',
    code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>',
    sliders: '<path d="M5 20V13M5 9V4M12 20v-9M12 7V4M19 20v-5M19 11V4"/><path d="M3 11h4M10 9h4M17 13h4"/>',
    star: '<path d="m12 4 2.35 4.9 5.4.72-3.95 3.78.98 5.35L12 16.2l-4.78 2.55.98-5.35L4.25 9.62l5.4-.72z"/>',
    download: '<path d="M12 3v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
    page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  };
  const svg = (n) => '<svg viewBox="0 0 24 24">' + (ICONS[n] || ICONS.page) + "</svg>";

  /* ---------- 快捷入口（与左侧坞同一份数据；首页自身不出现） ---------- */
  function renderLinks(items) {
    const box = $("links");
    box.textContent = "";
    for (const it of items || []) {
      if (!it || !it.href || it.href === "@home") continue;
      const a = document.createElement("a");
      a.href = "#";
      a.innerHTML = svg(it.icon);
      const label = document.createElement("span");
      label.textContent = it.title || it.href;
      a.appendChild(label);
      a.title = it.title || it.href;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        let url = it.href;
        // @ide 是外壳 dock 的特判项（开 IDE 标签），不是网址——原先漏了这步，
        // 被拼成 luogu.com.cn/@ide 跳出一个 404
        if (url === "@ide") { window.lgConfig.ide(); return; }
        if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
          url = (Object.prototype.hasOwnProperty.call(mappings, url) && mappings[url]) ||
            ("https://www.luogu.com.cn/" + url.replace(/^\/+/, ""));
        }
        if (url.startsWith("/")) url = "https://www.luogu.com.cn" + url;
        window.lgConfig.openUrl(url);
      });
      box.appendChild(a);
    }
  }

  /* ---------- 最近访问 ---------- */
  function fmtWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return (d.getMonth() + 1) + "/" + d.getDate();
  }
  async function renderRecent() {
    const box = $("recent");
    box.textContent = "";
    let entries = [];
    try {
      const r = await window.lgConfig.historyList();
      entries = (r && r.entries) || [];
    } catch (e) { /* 空态兜底 */ }
    // 同 URL 只留最近一次
    const seen = new Set();
    const rows = [];
    for (const it of entries) {
      if (!it || !it.url || seen.has(it.url)) continue;
      if (/\/src\/(home|settings|history)\//.test(it.url)) continue;
      seen.add(it.url);
      rows.push(it);
      if (rows.length >= 8) break;
    }
    if (!rows.length) {
      const e = document.createElement("div");
      e.className = "h-empty";
      e.textContent = "还没有访问记录。";
      box.appendChild(e);
      return;
    }
    for (const it of rows) {
      const a = document.createElement("a");
      a.href = "#";
      a.title = it.title ? it.title + " · " + it.url : it.url;
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = it.title || it.url;
      const h = document.createElement("span");
      h.className = "h";
      // 历史记录的时间字段是 ts（主进程 recordHistory 写入），at/time 都不存在
      h.textContent = fmtWhen(it.ts || Date.now());
      a.appendChild(t);
      a.appendChild(h);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        window.lgConfig.openUrl(it.url);
      });
      box.appendChild(a);
    }
  }

  /* ---------- 绑定 ---------- */
  $("go").addEventListener("click", go);
  $("q").addEventListener("keydown", (e) => {
    /* 输入法组字中的回车 = 确认候选词，不是提交（R39）。keyCode 229 是
       部分输入法在组字期间对按键的统一编码，两个条件都要挡。 */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") go();
  });
  $("q").addEventListener("input", () => {
    const r = resolve($("q").value);
    $("resolve").textContent = r ? "→ " + r.label : "";
  });
  $("open-history").addEventListener("click", () => window.lgConfig.openHistory());

  /* ---------- 近期比赛（主进程定时抓洛谷，失败显示空态） ---------- */
  let contestsRetry = 0;
  async function renderContests(pre) {
    const box = $("contests");
    if (!box) return;
    box.textContent = "";
    let list = (pre && pre.list) || [];
    if (!list.length) {
      try {
        const r = await window.lgConfig.contests();
        list = (r && r.list) || [];
      } catch (e) { /* 空态 */ }
    }
    const now = Date.now();
    const upcoming = list.filter((c) => c.startTime > now).slice(0, 3);
    if (!upcoming.length) {
      const e = document.createElement("div");
      e.className = "h-empty";
      e.textContent = "暂时读不到近期比赛。";
      box.appendChild(e);
      // 主进程 15 秒后才开始抓，首帧多半还没数据；空态时补几次重试，
      // 拿到就换成正片（成功推送也会走这里）。
      if (contestsRetry < 4) {
        contestsRetry++;
        setTimeout(() => { if (!box.childElementCount || box.querySelector(".h-empty")) renderContests(); }, contestsRetry * 6000);
      }
      return;
    }
    contestsRetry = 99;
    for (const c of upcoming) {
      const a = document.createElement("a");
      a.href = "#";
      a.title = c.name;
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = c.name;
      const h = document.createElement("span");
      h.className = "h";
      // 24 小时内的直接标"今天"；Math.ceil 对任何正数都 ≥1，"今天"分支
      // 在旧写法里永远走不到
      const ms = c.startTime - now;
      h.textContent = ms < 86400000 ? "今天" : "D-" + Math.ceil(ms / 86400000);
      a.appendChild(t);
      a.appendChild(h);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        window.lgConfig.openUrl("https://www.luogu.com.cn/contest/list");
      });
      box.appendChild(a);
    }
  }

  /* ---------- 考试倒计时（自定义，存 cfg.countdowns） ---------- */
  let countdowns = [];
  function renderCountdowns() {
    const box = $("countdowns");
    if (!box) return;
    box.textContent = "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = countdowns
      .filter((c) => c && c.name && c.date)
      // ref 留着原对象：删除按钮要按引用从 countdowns 里剔掉——用展开拷贝的话
      // filter(d => d !== c) 永远匹配不到（拷贝不在数组里），× 点了等于没点
      .map((c) => ({ ref: c, name: c.name, date: c.date, days: Math.round((new Date(c.date + "T00:00:00") - today) / 86400000) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);
    if (!rows.length) {
      const e = document.createElement("div");
      e.className = "h-empty";
      e.textContent = "还没有倒计时。点右上「+ 添加」。";
      box.appendChild(e);
      return;
    }
    for (const c of rows) {
      const a = document.createElement("a");
      a.href = "#";
      a.title = c.name + " · " + c.date;
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = c.name;
      const h = document.createElement("span");
      h.className = "h" + (c.days < 0 ? " past" : c.days <= 7 ? " soon" : "");
      h.textContent = c.days === 0 ? "就是今天" : c.days > 0 ? "D-" + c.days : "已过 " + -c.days + " 天";
      a.appendChild(t);
      a.appendChild(h);
      const x = document.createElement("button");
      x.className = "h-del";
      x.textContent = "×";
      x.title = "删除此倒计时";
      x.addEventListener("click", async (e) => {
        e.stopPropagation();
        countdowns = countdowns.filter((d) => d !== c.ref);
        await window.lgConfig.set({ countdowns });
        renderCountdowns();
      });
      a.appendChild(x);
      a.addEventListener("click", (e) => e.preventDefault());
      box.appendChild(a);
    }
  }
  function bindCountdownForm() {
    const form = $("cd-form");
    if (!form) return;
    $("open-contests").addEventListener("click", () => {
      window.lgConfig.openUrl("https://www.luogu.com.cn/contest/list");
    });
    $("cd-add").addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) $("cd-name").focus();
    });
    const save = async () => {
      const name = $("cd-name").value.trim();
      const date = $("cd-date").value;
      if (!name || !date) return;
      countdowns.push({ name, date });
      await window.lgConfig.set({ countdowns });
      $("cd-name").value = "";
      $("cd-date").value = "";
      form.hidden = true;
      renderCountdowns();
    };
    $("cd-save").addEventListener("click", save);
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") form.hidden = true;
    });
  }

  /* ---------- 初始化 ---------- */
  (async () => {
    try {
      const c = await window.lgConfig.get();
      mappings = (c && c.mappings) || {};
      countdowns = (c && c.countdowns) || [];
      applyPrefs((c && c.homePrefs) || {});
      renderLinks((c && c.dockItems) || []);
    } catch (e) { /* 空态兜底 */ }
    renderRecent();
    if (window.lgConfig && window.lgConfig.onContests) {
      window.lgConfig.onContests((d) => renderContests(d));
    }
    renderContests();
    renderCountdowns();
    bindCountdownForm();
  })();

  /* 设置改了立刻跟上：inject.js 每次 apply 都在本地页广播 lg-config
     （板块开关 / 时钟样式 / 快捷入口 / 倒计时都顺势重读） */
  document.addEventListener("lg-config", (e) => {
    const c = (e && e.detail) || {};
    if (c.mappings) mappings = c.mappings;
    if (c.homePrefs) applyPrefs(c.homePrefs);
    if (c.dockItems) renderLinks(c.dockItems);
    if (Array.isArray(c.countdowns)) {
      countdowns = c.countdowns;
      renderCountdowns();
    }
  });
})();
