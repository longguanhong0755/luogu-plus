/* Luogu++ — 设置页逻辑（应用内标签页版）
   结构：左侧按用途分组导航，右侧一次只显示一组卡片。
   配色：中性基色（预设）× 主题色种子，主进程算好派生色下发，这里只贴变量。 */
const $ = (id) => document.getElementById(id);
let cfg = {};
let saveTimer = null;
let acctState = { accounts: [], activeId: "" };
let pollTimer = null;
let presetInfo = null;   // lg-config:presets 的完整返回（含派生色）

// 快捷键表由主进程下发（与菜单 accelerator 同源），这里不再自己抄一份
let KEYS = [];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- 派生色：设置页自己也跟着主题色走 ---------- */
function derived(dark) {
  if (!presetInfo) return null;
  return (dark ? presetInfo.derivedDark : presetInfo.derivedLight) || null;
}

function paint() {
  // 明暗与外壳同源：主进程 resolvedTheme 随 lg-config:get 下发——以前设置页
  // 自己看系统深色、外壳看洛谷嗅探（lastNative），两边对不上就是这么来的。
  const dark = cfg.resolvedTheme === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

  // 只贴四个基色；--surface-2/--ink-dim/--ink-faint 由 CSS 的 color-mix 自动派生
  const v = derived(dark);
  if (v) {
    const st = document.documentElement.style;
    /* --surface / --surface-2 / --hairline 不再由这里写：它们是 material.css
       里指向 --lg-glass-* 的别名（与外壳、洛谷页、首页同一份材质）。设置页
       曾经自己贴一套不透明基色，就是"设置里的卡片与外壳两个质感"的来源。 */
    st.setProperty("--bg", v.bgBase);
    st.setProperty("--ink", v.ink);
    // 强调色与外壳同一套优先级：手填 > 主题色 > 墨色
    const seed = /^#[0-9a-f]{6}$/i.test(cfg.themeSeed || "") ? cfg.themeSeed : "";
    st.setProperty("--accent", cfg.accent || seed || v.ink);
  }

  // 页面配色三态 / 中性基色 / 强调色三个卡片已撤（v3.5.1，用户要求配色页
  // 只留主题色）：对应的 seg/swatches 元素不存在了，这里也不再涂它们。
  // pageTheme 的 native 旧值由主进程迁移成 auto，页面始终跟随统一主题。

  // 界面
  const us = Math.round((cfg.uiScale != null ? cfg.uiScale : 1) * 100);
  $("s-uiscale").value = us;
  $("o-uiscale").value = us + "%";

  // 主题色种子
  const seed = /^#[0-9a-f]{6}$/i.test(cfg.themeSeed || "") ? cfg.themeSeed : "";
  document.querySelectorAll("#seed-swatches .sw").forEach((b) => {
    b.classList.toggle("active", (b.dataset.v || "") === seed);
  });
  if ($("c-seed")) $("c-seed").value = seed || "#8b5cf6";
  const ss = Math.round(cfg.themeStrength != null ? cfg.themeStrength : 45);
  $("s-seedstrength").value = ss;
  $("o-seedstrength").value = ss + "%";
  $("s-seedstrength").disabled = !seed;
  renderSeedPreview();

  // 形状与线条
  const rd = Math.round(cfg.radius != null ? cfg.radius : 8);
  $("s-radius").value = rd;
  $("o-radius").value = rd + "px";
  const fa = Math.round((cfg.faceAlpha != null ? cfg.faceAlpha : 0.92) * 100);
  $("s-facealpha").value = fa;
  $("o-facealpha").value = fa + "%";
  const bl = Math.round(cfg.blur != null ? cfg.blur : 26);
  $("s-blur").value = bl;
  $("o-blur").value = bl + "px";
  const bs = Math.round((cfg.borderStrength != null ? cfg.borderStrength : 1) * 100);
  $("s-border").value = bs;
  $("o-border").value = bs + "%";
  $("ck-anim").checked = cfg.animations !== false;

  // 玻璃皮肤
  const gl = cfg.glass === "liquid" ? "liquid" : "flat";
  document.querySelectorAll("#seg-glass button").forEach((b) => b.classList.toggle("active", b.dataset.v === gl));

  // 关闭重复标签的保留策略（整理标签页）
  const dk = ["active", "first", "mru"].includes(cfg.dedupeKeep) ? cfg.dedupeKeep : "active";
  document.querySelectorAll("#seg-dedupe button").forEach((b) => b.classList.toggle("active", b.dataset.v === dk));

  // 侧栏位置（左/右，Edge 支持左右）
  const vside = cfg.vtabSide === "right" ? "right" : "left";
  document.querySelectorAll("#seg-vtabside button").forEach((b) => b.classList.toggle("active", b.dataset.v === vside));

  // 坞的位置（上/下/左/右；"跟随布局" = 水平左侧 / 垂直底部）
  const dpos = ["left", "right", "top", "bottom"].includes(cfg.dockPos) ? cfg.dockPos : "auto";
  document.querySelectorAll("#seg-dockpos button").forEach((b) => b.classList.toggle("active", b.dataset.v === dpos));

  // 搜索引擎（含自定义模板行只在选自定义时出现）
  const eng = ["luogu", "bing", "baidu", "google", "ddg"].includes(cfg.searchEngine) || cfg.searchEngine === "custom" ? cfg.searchEngine : "luogu";
  document.querySelectorAll("#seg-engine button").forEach((b) => b.classList.toggle("active", b.dataset.v === eng));
  $("in-engine-custom").value = cfg.searchCustom || "";
  $("row-engine-custom").hidden = eng !== "custom";

  // 翻译服务（自定义端点行只在选自定义时出现）
  const tr = cfg.translateProvider === "custom" ? "custom" : "bing";
  document.querySelectorAll("#seg-tr button").forEach((b) => b.classList.toggle("active", b.dataset.v === tr));
  $("in-tr-custom").value = cfg.translateCustom || "";
  $("row-tr-custom").hidden = tr !== "custom";

  // 壁纸集合：模式与自动轮换间隔
  document.querySelectorAll("#seg-wpmode button").forEach((b) => {
    b.classList.toggle("active", b.dataset.v === (cfg.wallpaperMode || "single"));
  });
  const wpMin = Number(cfg.wallpaperRotateMin) || 0;
  $("s-wprot").value = wpMin;
  $("o-wprot").value = wpMin === 0 ? "不自动" : wpMin + " 分钟";

  const gt = Math.round((cfg.glassTint != null ? cfg.glassTint : 0.12) * 100);
  $("s-glasstint").value = gt;
  $("o-glasstint").value = gt + "%";
  $("s-glasssat").value = cfg.glassSat != null ? cfg.glassSat : 180;
  $("o-glasssat").value = (cfg.glassSat != null ? cfg.glassSat : 180) + "%";
  $("ck-wpmute").checked = cfg.wallpaperMute !== false;
  if ($("ck-wppar")) $("ck-wppar").checked = cfg.wallpaperParallax !== false;

  // 壁纸
  const prev = $("wp-preview");
  prev.style.backgroundImage = cfg.wallpaper ? `url("file:///${encodeURI(String(cfg.wallpaper).replace(/\\/g, "/"))}")` : "none";
  prev.textContent = cfg.wallpaper ? "" : "未设置";
  $("s-dim").value = Math.round((cfg.wallpaperDim || 0) * 100);
  $("o-dim").value = Math.round((cfg.wallpaperDim || 0) * 100) + "%";
  $("s-wblur").value = cfg.wallpaperBlur || 0;
  $("o-wblur").value = (cfg.wallpaperBlur || 0) + "px";
  const sleepMin = cfg.tabSleepMinutes == null ? 30 : Number(cfg.tabSleepMinutes);
  $("s-tabsleep").value = sleepMin;
  $("o-tabsleep").value = sleepMin > 0 ? sleepMin + " 分钟" : "关闭";

  // 开关（默认值：ideNative/clean/quickSearch/restoreTabs/listTools 均默认开）
  $("ck-ide").checked = cfg.ideNative !== false;
  $("ck-clean").checked = cfg.clean !== false;
  $("ck-declutter").checked = !!cfg.declutter;
  $("ck-vtab").checked = !!cfg.verticalTabs;
  $("ck-quick").checked = cfg.quickSearch !== false;
  $("ck-restore").checked = cfg.restoreTabs !== false;
  $("ck-bgthrottle").checked = cfg.bgThrottle !== false;
  $("ck-memsleep").checked = cfg.memSleep !== false;
  $("ck-listtools").checked = cfg.listTools !== false;
  $("ck-codecopy").checked = cfg.codeCopy !== false;
  $("ck-diffmono").checked = !!cfg.diffMono;
  $("ck-hello").checked = cfg.homeHello !== false;
  $("ck-pid").checked = cfg.smartPid !== false;
  $("ck-lucky").checked = cfg.luckyDay === true;
  $("ck-bsearch").checked = cfg.betterSearch !== false;
  $("ck-dlask").checked = cfg.dlAsk === true;

  // 应用首页板块偏好（默认值与主进程 DEFAULT_CONFIG.homePrefs 一致）
  const hpv = Object.assign(
    { clock: true, seconds: false, clockFont: "mono", clockSize: 58, date: true, search: true, countdowns: true, links: true, recent: true, contests: true, footer: true },
    cfg.homePrefs || {}
  );
  for (const [id, key] of [
    ["ck-hp-clock", "clock"], ["ck-hp-seconds", "seconds"], ["ck-hp-date", "date"],
    ["ck-hp-search", "search"], ["ck-hp-countdowns", "countdowns"], ["ck-hp-links", "links"],
    ["ck-hp-recent", "recent"], ["ck-hp-contests", "contests"], ["ck-hp-footer", "footer"],
  ]) {
    if ($(id)) $(id).checked = hpv[key] !== false;
  }
  document.querySelectorAll("#seg-hp-font button").forEach((b) =>
    b.classList.toggle("active", b.dataset.v === (hpv.clockFont || "mono"))
  );
  const hpSize = Math.min(96, Math.max(40, Number(hpv.clockSize) || 58));
  if ($("s-hp-size")) { $("s-hp-size").value = hpSize; $("o-hp-size").value = hpSize + "px"; }
  // 自定义 CSS：只在内容真的变了时回写，否则每次 paint 都把正在输入的光标打回去
  const cssNow = typeof cfg.customCSS === "string" ? cfg.customCSS : "";
  if ($("ta-usercss") && $("ta-usercss").value !== cssNow) $("ta-usercss").value = cssNow;

  renderMappings();
  renderAccounts();
}

/* 主题色预览：把派生出来的四层色直接摆出来，选颜色时立刻看到结果 */
function renderSeedPreview() {
  const box = $("seed-preview");
  if (!box) return;
  box.textContent = "";
  if (!presetInfo) return;
  for (const [label, key] of [["亮色", "derivedLight"], ["暗色", "derivedDark"]]) {
    const v = presetInfo[key];
    if (!v) continue;
    const cell = document.createElement("div");
    cell.className = "sp-cell";
    cell.style.background = v.bgBase;
    const card = document.createElement("div");
    card.className = "sp-card";
    card.style.background = "rgb(" + v.tint + ")";
    card.style.borderColor = v.border;
    card.style.color = v.ink;
    card.textContent = "卡片 · 正文";
    cell.appendChild(card);
    const lb = document.createElement("span");
    lb.className = "sp-label";
    lb.style.color = v.ink;
    lb.textContent = label;
    cell.appendChild(lb);
    box.appendChild(cell);
  }
}

function set(patch, immediate) {
  cfg = { ...cfg, ...patch };
  const needsDerive = "themeSeed" in patch || "themeStrength" in patch || "preset" in patch;
  // 先按本地 cfg 涂一遍：选中态、强调色立刻跟手
  paint();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await window.lgConfig.set(patch);
    // 派生色是主进程按当前种子算的，必须等配置写进去之后再取。
    // 先取后写的话拿回来的是**上一次**的颜色，用户看到的就是
    // "点一下没变、再点一下才变"（同一个色点两次才凑巧对上）。
    if (needsDerive) { await refreshPresets(); paint(); }
    if (r && r.needRelaunch) toast("重启后生效");
  }, immediate ? 0 : 200);
}

/* ---------- 左侧导航 ---------- */
let navBuilt = false;
function buildNav() {
  if (navBuilt) return;
  navBuilt = true;
  const cards = [...document.querySelectorAll("#pane .card[data-nav]")];
  const groups = [];
  const byGroup = new Map();
  const byKey = new Map();   // 一个导航项对应"一组卡片"，不是一张
  cards.forEach((card, i) => {
    if (!card.id) card.id = "sec-" + i;
    const key = card.dataset.nav || "其他";
    const [g, item] = key.includes("/") ? key.split("/") : ["其他", key];
    if (!byGroup.has(g)) { byGroup.set(g, []); groups.push(g); }
    if (!byKey.has(key)) {
      byKey.set(key, { item, ids: [], title: card.dataset.title || item, sub: card.dataset.sub || "" });
      byGroup.get(g).push(key);
    }
    const e = byKey.get(key);
    e.ids.push(card.id);
    if (!e.sub && card.dataset.sub) e.sub = card.dataset.sub;
  });
  const list = $("nav-list");
  list.textContent = "";
  const all = [];
  for (const g of groups) {
    const gl = document.createElement("div");
    gl.className = "nav-group";
    gl.textContent = g;
    list.appendChild(gl);
    for (const key of byGroup.get(g)) {
      const it = byKey.get(key);
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.key = key;
      b.textContent = it.item;
      b.addEventListener("click", () => showSection(key));
      list.appendChild(b);
      all.push({ ...it, key, btn: b });
    }
  }
  list._all = all;
  const hash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  showSection(all.some((x) => x.key === hash) ? hash : all[0].key);
}

function showSection(key) {
  const all = $("nav-list")._all || [];
  for (const it of all) {
    const on = it.key === key;
    it.btn.classList.toggle("active", on);
    for (const id of it.ids) {
      const card = document.getElementById(id);
      if (card) card.hidden = !on;
    }
    if (on) {
      $("pane-title").textContent = it.title;
      $("pane-sub").textContent = it.sub || "改动即时生效，无需重启";
    }
  }
  try { history.replaceState(null, "", "#" + encodeURIComponent(key)); } catch {}
  $("pane").scrollTop = 0;
  window.scrollTo(0, 0);
}

/* ---------- 账号 ---------- */
function renderAccounts() {
  const list = $("acct-list");
  list.textContent = "";
  if (!acctState.accounts.length) {
    const e = document.createElement("div");
    e.className = "acct-empty";
    e.textContent = "还没有保存的账号。";
    list.appendChild(e);
    return;
  }
  for (const a of acctState.accounts) {
    const row = document.createElement("div");
    row.className = "acct-row" + (a.id === acctState.activeId ? " active" : "");
    const av = document.createElement("div");
    av.className = "a-avatar";
    av.textContent = (a.name || a.email).slice(0, 1).toUpperCase();
    row.appendChild(av);
    const main = document.createElement("div");
    main.className = "a-main";
    const nm = document.createElement("div");
    nm.className = "a-name";
    nm.textContent = a.name || a.email.split("@")[0];
    const ml = document.createElement("div");
    ml.className = "a-mail";
    ml.textContent = a.email;
    main.appendChild(nm);
    main.appendChild(ml);
    row.appendChild(main);
    if (a.id === acctState.activeId) {
      const tag = document.createElement("span");
      tag.className = "a-tag";
      tag.textContent = "当前";
      row.appendChild(tag);
    }
    const sw = document.createElement("button");
    sw.className = "btn";
    sw.textContent = a.id === acctState.activeId ? "重新加载" : "切换";
    sw.addEventListener("click", async () => {
      toast("正在切换到 " + (a.name || a.email) + " …");
      const r = await window.lgConfig.accountSwitch(a.id);
      toast(r && r.ok ? "已切换，标签页重新加载中" : "切换失败");
      await refreshAccounts();
    });
    row.appendChild(sw);
    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      const r = await window.lgConfig.accountRemove(a.id);
      if (r && r.ok) {
        acctState.accounts = r.accounts;
        acctState.activeId = r.activeId;
        renderAccounts();
        toast("已删除");
      }
    });
    row.appendChild(del);
    list.appendChild(row);
  }
}

async function refreshAccounts() {
  const r = await window.lgConfig.accountList();
  if (r && r.ok) {
    acctState.accounts = r.accounts;
    acctState.activeId = r.activeId;
    renderAccounts();
  }
  return r;
}

function showFlow(stage) {
  $("acct-flow").hidden = false;
  const cap = $("flow-captcha");
  const row = $("flow-answer-row");
  if (!stage) return;
  $("flow-status").textContent = stage.message || stage.stage || "";
  if (stage.captcha) {
    cap.src = stage.captcha;
    cap.hidden = false;
    // 自动识别阶段（stage.auto）只把图亮出来看进度，不问用户；连续 3 次没过
    // 才转人工（主进程把 auto 摘掉），这时才要输入框和焦点
    row.hidden = !!stage.auto;
    if (!stage.auto) $("flow-answer").focus();
  } else {
    cap.hidden = true;
    row.hidden = true;
  }
}
function hideFlow() {
  $("acct-flow").hidden = true;
  $("flow-captcha").hidden = true;
  $("flow-answer-row").hidden = true;
  $("flow-answer").value = "";
  clearInterval(pollTimer);
  pollTimer = null;
}

async function addAccount() {
  const email = $("acct-email").value.trim();
  const pass = $("acct-pass").value;
  if (!email || !pass) { toast("请先填账号与密码"); return; }
  showFlow({ message: "正在打开登录页…" });
  $("btn-acct-add").disabled = true;
  // 轮询验证进度（验证码要人工读图，所以是异步任务）
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const s = await window.lgConfig.accountList();
    if (s && s.job) showFlow(s.job);
  }, 1200);
  const r = await window.lgConfig.accountAdd(email, pass);
  clearInterval(pollTimer);
  pollTimer = null;
  $("btn-acct-add").disabled = false;
  if (r && r.ok) {
    hideFlow();
    $("acct-pass").value = "";
    await refreshAccounts();
    toast("验证通过，账号已保存并切换");
  } else {
    const why = {
      "bad-input": "账号或密码为空",
      busy: "已有验证任务在进行",
      "captcha-timeout": "等待验证码超时（10 分钟）",
      "captcha-failed": "验证码连续答错，请重试",
      cancelled: "已取消",
      "home-load-failed": "打不开洛谷首页，检查网络",
      "no-account-input": "没找到登录表单，站点结构可能变了",
      step1: "账号一步提交失败，请检查账号是否正确",
    }[r && r.stage] || (r && (r.message || r.stage)) || "未知错误";
    showFlow({ message: "添加失败：" + why });
    setTimeout(hideFlow, 4000);
  }
}

/* ---------- 中性基色 / 主题色 ---------- */
/* 中性基色仍是黑白灰五套（产品基调），主题色才是那个"挑一个颜色"的入口，
   它由主进程按比例混进基色，任何色相都自动适配。 */
const SEED_SWATCHES = [
  { v: "", label: "中性（不混色）" },
  { v: "#8b5cf6", label: "紫" },
  { v: "#3b82f6", label: "蓝" },
  { v: "#06b6d4", label: "青" },
  { v: "#22c55e", label: "绿" },
  { v: "#f59e0b", label: "琥珀" },
  { v: "#ef4444", label: "红" },
  { v: "#ec4899", label: "玫红" },
];

let presetList = [];

async function refreshPresets() {
  const r = await window.lgConfig.presets();
  if (!r || !r.list) return;
  // 中性基色卡片已撤（配色页只留主题色）：这里不再建预设网格 DOM，
  // 但 presetInfo（派生色）必须照拿——设置页自己的配色与主题色预览靠它。
  presetInfo = r;
  presetList = r.list;
}

function renderSeedSwatches() {
  const box = $("seed-swatches");
  box.textContent = "";
  for (const s of SEED_SWATCHES) {
    const b = document.createElement("button");
    b.className = "sw" + (s.v ? "" : " sw-auto");
    b.dataset.v = s.v;
    b.title = s.label;
    if (s.v) b.style.background = s.v;
    else b.textContent = "中性";
    b.addEventListener("click", () => set({ themeSeed: s.v }, true));
    box.appendChild(b);
  }
}

function renderAccentSwatches() {
  /* 强调色卡片已撤（v3.5.1）：元素不存在，保留空函数免得 init 调用点炸 */
}

async function loadKeys() {
  try {
    const r = await window.lgConfig.shortcuts();
    // 新格式：{ rows: [{id,label,text,accel,def,overridden}] }（含自定义覆盖）
    if (r && Array.isArray(r.rows)) KEYS = r.rows;
  } catch {}
  renderKeys();
}
function renderKeys() {
  const box = $("keys-list");
  if (!box) return;
  box.textContent = "";
  for (const row of KEYS) {
    const r = document.createElement("div");
    r.className = "key-row";
    const kk = document.createElement("span");
    kk.className = "key-cap";
    kk.textContent = row.text;
    const dd = document.createElement("span");
    dd.className = "key-desc";
    dd.textContent = row.label + (row.overridden ? "（已自定义）" : "");
    const edit = document.createElement("button");
    edit.className = "key-btn";
    edit.textContent = "修改";
    edit.addEventListener("click", () => captureKey(row, kk));
    r.appendChild(kk);
    r.appendChild(dd);
    r.appendChild(edit);
    if (row.overridden) {
      const rst = document.createElement("button");
      rst.className = "key-btn";
      rst.textContent = "重置";
      rst.addEventListener("click", async () => {
        const next = { ...(cfg.shortcuts || {}) };
        delete next[row.id];
        await set({ shortcuts: next }, true);
        loadKeys();
      });
      r.appendChild(rst);
    }
    box.appendChild(r);
  }
}
/* 捕获下一次按键组合作为新绑定（Esc 取消；纯修饰键继续等）。
   与现有绑定撞车就拒绝并提示——两个动作同一个键位，菜单只会生效一个。 */
function captureKey(row, capEl) {
  const old = capEl.textContent;
  capEl.textContent = "按下新快捷键…";
  capEl.classList.add("listening");
  const done = () => {
    document.removeEventListener("keydown", onKey, true);
    capEl.classList.remove("listening");
  };
  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      done();
      capEl.textContent = old;
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // 纯修饰键继续等
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("CmdOrCtrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    let k = e.key;
    if (k === " ") k = "Space";
    else if (k === "+") k = "Plus";
    else if (k === "ArrowLeft") k = "Left";
    else if (k === "ArrowRight") k = "Right";
    else if (k === "ArrowUp") k = "Up";
    else if (k === "ArrowDown") k = "Down";
    else if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    const accel = parts.join("+");
    const clash = KEYS.find((x) => x.id !== row.id && x.accel === accel);
    done();
    if (clash) {
      capEl.textContent = old;
      toast("快捷键冲突：" + accel + " 已绑定「" + clash.label + "」");
      return;
    }
    const next = { ...(cfg.shortcuts || {}) };
    if (accel === row.def) delete next[row.id]; // 改回默认 = 清除覆盖
    else next[row.id] = accel;
    await set({ shortcuts: next }, true);
    loadKeys();
    toast("已更新：" + row.label + " → " + accel.replace(/CmdOrCtrl/g, "Ctrl"));
  };
  document.addEventListener("keydown", onKey, true);
}

/* ---------- 地址栏映射编辑器 ---------- */
function renderMappings() {
  const list = $("map-list");
  list.textContent = "";
  const m = cfg.mappings || {};
  for (const key of Object.keys(m)) list.appendChild(mapRow(key, m[key]));
}
function mapRow(key, url) {
  const row = document.createElement("div");
  row.className = "map-row";
  const k = document.createElement("input");
  k.placeholder = "映射词";
  k.value = key;
  const u = document.createElement("input");
  u.placeholder = "https://…";
  u.value = url || "";
  const del = document.createElement("button");
  del.className = "btn-del";
  del.innerHTML = svgIcon("winClose"); // R41：文本 × → 统一线稿
  del.title = "删除此映射";
  del.addEventListener("click", () => {
    row.remove();
    collectMappings();
  });
  k.addEventListener("input", collectMappings);
  u.addEventListener("input", collectMappings);
  row.appendChild(k);
  row.appendChild(u);
  row.appendChild(del);
  return row;
}
function collectMappings() {
  const obj = {};
  document.querySelectorAll("#map-list .map-row").forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const k = inputs[0].value.trim();
    const u = inputs[1].value.trim();
    if (k && u) obj[k] = u;
  });
  set({ mappings: obj });
}

/* ---------- 侧坞编辑器（cfg.dockItems） ---------- */
const DOCK_ICONS = ["home", "list", "book", "trophy", "chat", "clock", "code", "sliders", "star", "download", "page"];
/* 与外壳 chrome.js 的 ICONS 同一份线稿（R41 收口到 src/icons.js）：
   设置页要直接把图标画出来选——以前本地这份是另一套路径，预览与坞里实际
   渲染的不是同一个图标。 */
const svgIcon = (n) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  (window.LGIcons.PATHS[n] || window.LGIcons.PATHS.page) +
  "</svg>";
/* 可视化图标选择器：点当前图标弹出图面板（真实图标预览），替代生硬的下拉框 */
function iconPicker(current, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker";
  const cur = document.createElement("button");
  cur.type = "button";
  cur.className = "btn-mini icon-cur";
  cur.title = "选择图标";
  cur.innerHTML = svgIcon(current);
  const panel = document.createElement("div");
  panel.className = "icon-panel";
  panel.hidden = true;
  for (const k of DOCK_ICONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-opt" + (k === current ? " on" : "");
    b.title = k;
    b.innerHTML = svgIcon(k);
    b.addEventListener("click", () => {
      panel.hidden = true;
      cur.innerHTML = svgIcon(k);
      onPick(k);
    });
    panel.appendChild(b);
  }
  cur.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".icon-panel").forEach((p) => { if (p !== panel) p.hidden = true; });
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(cur);
  wrap.appendChild(panel);
  return wrap;
}
/* 链接默认写全（用户要求：https://www.luogu.com.cn/discuss 而不是 /discuss）；
   路径写法仍兼容（外壳 dockTarget 两种都认，洛谷全 URL 按站内导航处理） */
const DOCK_DEFAULT = [
  { icon: "home", title: "首页", href: "@home" },
  { icon: "list", title: "题库", href: "https://www.luogu.com.cn/problem/list" },
  { icon: "book", title: "题单", href: "https://www.luogu.com.cn/training/list" },
  { icon: "trophy", title: "比赛", href: "https://www.luogu.com.cn/contest/list" },
  { icon: "chat", title: "讨论", href: "https://www.luogu.com.cn/discuss" },
  { icon: "clock", title: "记录", href: "https://www.luogu.com.cn/record/list" },
  { icon: "code", title: "IDE", href: "@ide" },
];
function dockItemsNow() {
  const items = [];
  document.querySelectorAll("#dock-list .dock-row").forEach((row) => {
    // 图标存在行 dataset 上（dockRow 用的是图标面板，行内没有 <select>——
    // 原先 querySelector("select").value 直接抛 TypeError，整个侧坞编辑器写不进配置）
    const icon = row.dataset.icon || "page";
    const inputs = row.querySelectorAll("input");
    const title = inputs[0].value.trim();
    const href = inputs[1].value.trim();
    if (href) items.push({ icon, title: title || href, href });
  });
  return items;
}
function dockRow(item) {
  const row = document.createElement("div");
  row.className = "dock-row";
  row.dataset.icon = item.icon || "page"; // dockItemsNow 从这里读图标
  const picker = iconPicker(row.dataset.icon, (k) => {
    row.dataset.icon = k;
    set({ dockItems: dockItemsNow() });
  });
  const t = document.createElement("input");
  t.placeholder = "名称";
  t.value = item.title || "";
  const u = document.createElement("input");
  u.placeholder = "@home / /problem/list / 网址 / 映射词";
  u.value = item.href || "";
  const move = (d) => {
    if (d < 0 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    if (d > 0 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    set({ dockItems: dockItemsNow() });
  };
  const up = document.createElement("button");
  up.className = "btn-mini";
  up.innerHTML = svgIcon("arrowUp"); // R41：文本 ↑ → 统一线稿
  up.title = "上移";
  up.addEventListener("click", () => move(-1));
  const down = document.createElement("button");
  down.className = "btn-mini";
  down.innerHTML = svgIcon("arrowDown"); // R41：文本 ↓ → 统一线稿
  down.title = "下移";
  down.addEventListener("click", () => move(1));
  const del = document.createElement("button");
  del.className = "btn-del";
  del.innerHTML = svgIcon("winClose"); // R41：文本 × → 统一线稿
  del.title = "删除";
  del.addEventListener("click", () => {
    row.remove();
    set({ dockItems: dockItemsNow() });
  });
  t.addEventListener("input", () => set({ dockItems: dockItemsNow() }));
  u.addEventListener("input", () => set({ dockItems: dockItemsNow() }));
  row.appendChild(picker);
  row.appendChild(t);
  row.appendChild(u);
  row.appendChild(up);
  row.appendChild(down);
  row.appendChild(del);
  return row;
}
function renderDockItems() {
  const list = $("dock-list");
  list.textContent = "";
  for (const it of Array.isArray(cfg.dockItems) ? cfg.dockItems : DOCK_DEFAULT) {
    list.appendChild(dockRow(it || {}));
  }
}

/* ---------- 壁纸集合网格 ---------- */
async function renderWallpaperSet() {
  const grid = $("wp-grid");
  if (!grid) return;
  grid.textContent = "";
  let r;
  try { r = await window.lgConfig.wallList(); } catch (e) { return; }
  if (!r || !r.ok || !r.items.length) {
    const e = document.createElement("div");
    e.className = "hint inline";
    e.textContent = "集合还是空的。点上方「导入壁纸…」可以一次选多张。";
    grid.appendChild(e);
    return;
  }
  for (const it of r.items) {
    const cell = document.createElement("div");
    cell.className = "wp-cell" + (it.path === r.current ? " on" : "");
    cell.title = it.name;
    const url = "file:///" + encodeURI(String(it.path).replace(/\\/g, "/"));
    if (it.video) {
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      cell.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = url;
      img.loading = "lazy";
      cell.appendChild(img);
    }
    const del = document.createElement("button");
    del.className = "wp-del";
    del.innerHTML = svgIcon("winClose"); // R41：文本 × → 统一线稿
    del.title = "从集合删除";
    del.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await window.lgConfig.wallRemove(it.path);
      await renderWallpaperSet();
      paint();
    });
    cell.appendChild(del);
    cell.addEventListener("click", async () => {
      const rr = await window.lgConfig.wallSelect(it.path);
      if (rr && rr.ok) {
        cfg.wallpaper = rr.current;
        await renderWallpaperSet();
        paint();
      }
    });
    grid.appendChild(cell);
  }
}

/* ---------- 绑定 ---------- */
function bind() {
  document.querySelectorAll("#seg-glass button").forEach((b) => {
    b.addEventListener("click", () => set({ glass: b.dataset.v }, true));
  });
  document.querySelectorAll("#seg-dedupe button").forEach((b) => {
    b.addEventListener("click", () => set({ dedupeKeep: b.dataset.v }, true));
  });
  document.querySelectorAll("#seg-vtabside button").forEach((b) => {
    b.addEventListener("click", () => {
      set({ vtabSide: b.dataset.v }, true);
      document.querySelectorAll("#seg-vtabside button").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
  document.querySelectorAll("#seg-dockpos button").forEach((b) => {
    b.addEventListener("click", () => {
      set({ dockPos: b.dataset.v }, true);
      document.querySelectorAll("#seg-dockpos button").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
  document.querySelectorAll("#seg-engine button").forEach((b) => {
    b.addEventListener("click", () => {
      set({ searchEngine: b.dataset.v }, true);
      document.querySelectorAll("#seg-engine button").forEach((x) => x.classList.toggle("active", x === b));
      $("row-engine-custom").hidden = b.dataset.v !== "custom";
    });
  });
  $("in-engine-custom").addEventListener("change", (e) => {
    const v = String(e.target.value || "").trim();
    if (v && !v.includes("%s")) { toast("自定义模板必须含 %s 占位符"); return; }
    set({ searchCustom: v }, true);
  });
  document.querySelectorAll("#seg-tr button").forEach((b) => {
    b.addEventListener("click", () => {
      set({ translateProvider: b.dataset.v }, true);
      document.querySelectorAll("#seg-tr button").forEach((x) => x.classList.toggle("active", x === b));
      $("row-tr-custom").hidden = b.dataset.v !== "custom";
    });
  });
  $("in-tr-custom").addEventListener("change", (e) => {
    const v = String(e.target.value || "").trim();
    if (v && !v.includes("%s")) { toast("自定义翻译端点必须含 %s 占位符"); return; }
    set({ translateCustom: v }, true);
  });
  const bindSlider = (id, out, key, div, fmt) => {
    $(id).addEventListener("input", (e) => {
      const v = div ? Number(e.target.value) / div : Number(e.target.value);
      $(out).value = fmt(v);
      set({ [key]: v });
    });
  };
  bindSlider("s-uiscale", "o-uiscale", "uiScale", 100, (v) => Math.round(v * 100) + "%");
  bindSlider("s-dim", "o-dim", "wallpaperDim", 100, (v) => Math.round(v * 100) + "%");
  bindSlider("s-wblur", "o-wblur", "wallpaperBlur", 1, (v) => v + "px");
  bindSlider("s-tabsleep", "o-tabsleep", "tabSleepMinutes", 1, (v) => (v > 0 ? v + " 分钟" : "关闭"));
  bindSlider("s-radius", "o-radius", "radius", 1, (v) => v + "px");
  bindSlider("s-facealpha", "o-facealpha", "faceAlpha", 100, (v) => Math.round(v * 100) + "%");
  bindSlider("s-blur", "o-blur", "blur", 1, (v) => v + "px");
  bindSlider("s-border", "o-border", "borderStrength", 100, (v) => Math.round(v * 100) + "%");
  bindSlider("s-glasstint", "o-glasstint", "glassTint", 100, (v) => Math.round(v * 100) + "%");
  bindSlider("s-glasssat", "o-glasssat", "glassSat", 1, (v) => v + "%");
  bindSlider("s-seedstrength", "o-seedstrength", "themeStrength", 1, (v) => Math.round(v) + "%");

  $("c-seed").addEventListener("input", (e) => set({ themeSeed: e.target.value }, true));

  /* 应用首页板块偏好：整对象合并下发（set 是浅合并，homePrefs 必须给全量） */
  const setHp = (k, v) =>
    set({
      homePrefs: Object.assign(
        { clock: true, seconds: false, clockFont: "mono", clockSize: 58, date: true, search: true, countdowns: true, links: true, recent: true, contests: true, footer: true },
        cfg.homePrefs || {},
        { [k]: v }
      ),
    });
  for (const [id, key] of [
    ["ck-hp-clock", "clock"], ["ck-hp-seconds", "seconds"], ["ck-hp-date", "date"],
    ["ck-hp-search", "search"], ["ck-hp-countdowns", "countdowns"], ["ck-hp-links", "links"],
    ["ck-hp-recent", "recent"], ["ck-hp-contests", "contests"], ["ck-hp-footer", "footer"],
  ]) {
    $(id).addEventListener("change", (e) => setHp(key, e.target.checked));
  }
  document.querySelectorAll("#seg-hp-font button").forEach((b) => {
    b.addEventListener("click", () => setHp("clockFont", b.dataset.v));
  });
  $("s-hp-size").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    $("o-hp-size").value = v + "px";
    setHp("clockSize", v);
  });

  /* 自定义 CSS：输入即存（set 自带 200ms 防抖），inject.js 收到配置即时换样式表 */
  $("ta-usercss").addEventListener("input", (e) => set({ customCSS: e.target.value }));

  $("btn-wall-import").addEventListener("click", async () => {
    const r = await window.lgConfig.wallImport();
    if (r && r.ok) {
      await renderWallpaperSet();
      cfg.wallpaper = r.current || cfg.wallpaper;
      paint();
      toast(r.added ? `已导入 ${r.added} 张` + (r.skipped ? `，跳过重复 ${r.skipped} 张` : "") : "没有新壁纸（全部与集合里重复）");
    }
  });
  $("btn-wall-next").addEventListener("click", async () => {
    const r = await window.lgConfig.wallNext();
    if (r && r.ok) { cfg.wallpaper = r.current; paint(); toast("已换到下一张"); }
  });
  $("btn-wall-dedupe").addEventListener("click", async () => {
    const r = await window.lgConfig.wallDedupe();
    await renderWallpaperSet();
    toast(r && r.removed ? `已清理 ${r.removed} 张重复壁纸` : "没有发现重复壁纸");
  });
  $("btn-clear").addEventListener("click", async () => {
    await window.lgConfig.clearWallpaper();
    cfg.wallpaper = "";
    paint();
  });
  document.querySelectorAll("#seg-wpmode button").forEach((b) => {
    b.addEventListener("click", async () => {
      const r = await window.lgConfig.wallMode(b.dataset.v, Number($("s-wprot").value) || 0);
      if (r && r.ok) {
        cfg.wallpaperMode = r.mode;
        cfg.wallpaperRotateMin = r.rotateMin; // 不回写本地的话，下一次 paint 把滑杆打回旧值
        paint();
        toast(b.dataset.v === "single" ? "固定当前壁纸" : b.dataset.v === "shuffle" ? "随机轮换已开启" : "顺序循环已开启");
      }
    });
  });
  // 拖动会连发几十次 input：本地先记，IPC 防抖后只发最后一次
  let wprotTimer = null;
  $("s-wprot").addEventListener("input", (e) => {
    const v = Number(e.target.value) || 0;
    cfg.wallpaperRotateMin = v;
    $("o-wprot").value = v === 0 ? "不自动" : v + " 分钟";
    clearTimeout(wprotTimer);
    wprotTimer = setTimeout(() => window.lgConfig.wallMode(cfg.wallpaperMode || "single", v), 350);
  });

  const ck = (id, key) => {
    $(id).addEventListener("change", (e) => set({ [key]: e.target.checked }, true));
  };
  ck("ck-ide", "ideNative");
  ck("ck-clean", "clean");
  ck("ck-declutter", "declutter");
  ck("ck-vtab", "verticalTabs");
  ck("ck-quick", "quickSearch");
  ck("ck-restore", "restoreTabs");
  ck("ck-bgthrottle", "bgThrottle");
  ck("ck-memsleep", "memSleep");
  ck("ck-listtools", "listTools");
  ck("ck-codecopy", "codeCopy");
  ck("ck-diffmono", "diffMono");
  ck("ck-anim", "animations");
  ck("ck-wpmute", "wallpaperMute");
  ck("ck-wppar", "wallpaperParallax");
  ck("ck-hello", "homeHello");
  ck("ck-pid", "smartPid");
  ck("ck-lucky", "luckyDay");
  ck("ck-bsearch", "betterSearch");
  ck("ck-dlask", "dlAsk");

  /* 清除浏览数据：勾选项是一次性选择（不落配置），按钮读当前勾选执行 */
  $("btn-open-downloads").addEventListener("click", () => window.lgConfig.downloadReveal(0));
  $("btn-clear-data").addEventListener("click", async () => {
    const opts = {
      cache: $("ck-cl-cache").checked,
      cookies: $("ck-cl-cookies").checked,
      history: $("ck-cl-history").checked,
      downloads: $("ck-cl-downloads").checked,
    };
    if (!opts.cache && !opts.cookies && !opts.history && !opts.downloads) {
      toast("先勾选要清除的内容");
      return;
    }
    const r = await window.lgConfig.clearData(opts);
    const parts = [];
    if (opts.cache) parts.push("缓存");
    if (opts.cookies) parts.push("Cookie 与站点数据");
    if (opts.history) parts.push("历史");
    if (opts.downloads) parts.push("下载记录");
    toast(r && r.ok ? "已清除：" + parts.join(" / ") + (r.sessions ? "（" + r.sessions + " 个会话分区）" : "") : "清除失败");
    if (r && r.ok) {
      $("ck-cl-cache").checked = false;
      $("ck-cl-cookies").checked = false;
      $("ck-cl-history").checked = false;
      $("ck-cl-downloads").checked = false;
    }
  });

  $("btn-acct-add").addEventListener("click", addAccount);
  $("btn-flow-ok").addEventListener("click", async () => {
    const code = $("flow-answer").value.trim();
    if (!code) return;
    await window.lgConfig.accountAnswer(code);
    $("flow-answer").value = "";
    showFlow({ message: "已提交，等待验证…" });
  });
  $("flow-answer").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-flow-ok").click();
  });
  $("btn-flow-cancel").addEventListener("click", async () => {
    await window.lgConfig.accountCancel();
    hideFlow();
    $("btn-acct-add").disabled = false;
    toast("已取消");
  });

  $("btn-map-add").addEventListener("click", () => {
    $("map-list").appendChild(mapRow("", ""));
  });
  $("btn-dock-add").addEventListener("click", () => {
    $("dock-list").appendChild(dockRow({ icon: "page", title: "", href: "" }));
  });
  $("btn-dock-reset").addEventListener("click", () => {
    cfg = { ...cfg, dockItems: DOCK_DEFAULT.map((x) => ({ ...x })) };
    renderDockItems();
    set({ dockItems: cfg.dockItems });
    toast("侧坞已恢复默认");
  });
  $("btn-reset").addEventListener("click", async () => {
    await window.lgConfig.reset();
    cfg = await window.lgConfig.get();
    await refreshPresets();
    paint();
    toast("已恢复默认（含配色、布局、全部功能开关）");
  });
  $("btn-relaunch").addEventListener("click", () => window.lgConfig.relaunch());

  // 快捷键里显示的是外壳真实绑定，这里只做展示
  window.addEventListener("hashchange", () => {
    // showSection 写入时是 encodeURIComponent 过的（导航键带"/"），读回来要解码
    const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (id) showSection(id);
  });
}

(async function init() {
  if (!window.lgConfig) {
    document.body.innerHTML = '<div class="lg-err">设置桥接失败：preload-config.js 未加载</div>';
    return;
  }
  cfg = await window.lgConfig.get();
  bind();
  renderSeedSwatches();
  renderAccentSwatches();
  await loadKeys();
  buildNav();
  paint();
  await refreshPresets();
  paint();          // 派生色到位后重涂一遍（主题色要立刻反映到设置页自己）
  await refreshAccounts();
  renderDockItems();
  renderWallpaperSet();
})();
