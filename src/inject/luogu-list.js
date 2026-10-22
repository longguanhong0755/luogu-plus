/* ============================================================
   Luogu++ — 注入层能力模块：列表页工具（筛选行增强 / 快速筛选 / 问题搜索 / 随机跳题）
   难度表（内置 ∪ 页面自学习）、原生筛选行只补"输入即筛 + 计数徽章"、首页问题搜索改造。
   由内核 src/inject.js 装载：模块拿 window.__lgInjectCtx，把入口登记到
   ctx.features[id]，自己不再造共享状态。拆分是纯搬移——逻辑、选择器、时序
   与拆分前逐条一致。
   ============================================================ */
(function (ctx) {
  if (!ctx) return;

  var state = ctx.state;

  /* ============================================================
     功能一：列表页快捷工具（难度 / 状态 / 排序 / 题号跳转）
     ============================================================ */
  /* 难度表不能写死：洛谷 2025 年改过一轮（新增青色「提高」一级、全级别改名、
     顶级升为 NOI/NOI+/CTSC，id 5 的名字从「提高+/省选−」变成「提高」）。
     策略：内置表按当前实况兜底 + 运行时从页面徽章自学习——
     当前 URL 带 difficulty=N 时，本页行的难度徽章就是 id N 的名字；
     学到的名字存 localStorage，洛谷以后再改难度也能自动跟上。 */
  var DIFF_BUILTIN = [
    [1, "入门"], [2, "普及−"], [3, "普及"], [4, "普及+/提高−"],
    [5, "提高"], [6, "提高+/省选−"], [7, "省选/NOI−"], [8, "NOI/NOI+/CTSC"],
  ];
  function diffMapGet() {
    try {
      return JSON.parse(localStorage.getItem("lg-diff-map") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function diffMapLearn(name, id) {
    if (!name || typeof name !== "string") return;
    var m = diffMapGet();
    if (m[name] === id) return;
    m[name] = id;
    try {
      localStorage.setItem("lg-diff-map", JSON.stringify(m));
    } catch (e) {}
  }
  /* 全表（内置 ∪ 学习），按 id 升序；同 id 以页面实况（学习值）为准 */
  function diffTable() {
    var byId = {};
    var i;
    for (i = 0; i < DIFF_BUILTIN.length; i++) byId[DIFF_BUILTIN[i][0]] = DIFF_BUILTIN[i][1];
    var learned = diffMapGet();
    for (var name in learned) {
      // 含空白的一定是早年误学的来源标签（「NOIP 提高组」之类），永久忽略
      if (/\s/.test(name)) continue;
      if (learned[name] >= 1) byId[learned[name]] = name;
    }
    var rows = [];
    for (var id in byId) rows.push([Number(id), byId[id]]);
    rows.sort(function (a, b) { return a[0] - b[0]; });
    // 还没学到 id 的新名字（在非筛选页见过徽章）：附在表尾，筛选与匹配照常用
    for (var n in learned) {
      if (/\s/.test(n)) continue;
      if (!(learned[n] >= 1)) rows.push([99, n]);
    }
    return rows;
  }
  /* 从列表行里学难度：URL 带 difficulty=N 时，本页行徽章就是 id N 的名字。
     徽章特征：行内短文本 span + 实心底色（洛谷难度标签的渲染形态），
     不依赖写死的名字清单——这就是"洛谷加了新难度能自动匹配"的那条路。 */
  function learnDiffs(rows) {
    var m = location.search.match(/[?&]difficulty=(\d+)/);
    var fid = m ? Number(m[1]) : 0;
    if (!(fid >= 1)) return;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var spans = rows[i].querySelectorAll("span");
      for (var j = 0; j < spans.length; j++) {
        var s = spans[j];
        if (s.childElementCount !== 0) continue;
        var t = (s.textContent || "").trim();
        if (t.length < 2 || t.length > 12) continue;
        // 难度名字是单 Token：含空白的必属「NOIP 提高组」这类来源标签
        if (/\s/.test(t)) continue;
        // 来源/年份标签都是链接（a[href*=tag=]），难度徽章是链接外的 span
        if (s.closest("a")) continue;
        var bg = "";
        try {
          bg = getComputedStyle(s).backgroundColor;
        } catch (e) {}
        if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
        diffMapLearn(t, fid);
        break; // 每行第一个实心底色短文本就是难度徽章
      }
    }
  }
  var listUI = null;

  function rowText(r) { return (r.textContent || "").replace(/\s+/g, " ").trim(); }

  function findListRows() {
    /* 洛谷新前端的"表格"不是 table：列头是 .header-wrap，
       数据行是 .list-wrap .row-wrap > .row（50 条/页）。
       不拦这一档，下面的启发式会把行里的单元格当行抓（256 个格子），
       筛选时半个格子消失、行布局直接烂掉 */
    var rowWrap = document.querySelector(".list-wrap .row-wrap");
    if (rowWrap) {
      var rrows = rowWrap.querySelectorAll(":scope > .row");
      if (rrows.length >= 3) return { kind: "list", rows: Array.prototype.slice.call(rrows), box: rowWrap };
    }
    var tables = document.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var trs = tables[i].querySelectorAll("tbody tr");
      if (trs.length >= 5) return { kind: "table", rows: Array.prototype.slice.call(trs), box: tables[i] };
    }
    // 非表格：找"同类兄弟节点 >= 5"的最长一组
    var best = null;
    var kids = document.querySelectorAll("div, li, article");
    var groups = {};
    for (var j = 0; j < kids.length; j++) {
      var el = kids[j];
      var p = el.parentNode;
      if (!p || !el.className || typeof el.className !== "string") continue;
      var key = "";
      var cur = el;
      var depth = 0;
      while (cur && depth < 6) { key = ">" + cur.tagName + "." + String(cur.className); cur = cur.parentNode; depth++; }
      (groups[key] = groups[key] || []).push(el);
    }
    for (var k in groups) {
      var g = groups[k];
      if (g.length >= 5 && (!best || g.length > best.rows.length)) best = { kind: "list", rows: g, box: g[0].parentNode };
    }
    return best;
  }

  /* 筛选关键字来自原生筛选行的搜索框（合并后只有这一个搜索框）；
     没有原生搜索框的页面退回旧的快速筛选框 */
  function quickQuery() {
    var e = document.querySelector("input.search-text");
    if (e) return (e.value || "").trim().toLowerCase();
    var l = document.querySelector("#lg-quicksearch input");
    return l ? l.value.trim().toLowerCase() : "";
  }
  /* 原生搜索框 → 统一筛选：输入时实时筛当前列表（回车仍是洛谷自己的全站搜索，
     一个框两种行为，不再是上下两个搜索栏） */
  var nativeSearchHooked = false;
  function hookNativeSearch() {
    if (nativeSearchHooked) return;
    nativeSearchHooked = true;
    document.addEventListener(
      "input",
      function (e) {
        if (e.target && e.target.matches && e.target.matches("input.search-text") && listUI) {
          applyListFilter();
        }
      },
      true
    );
  }

  /* 原生筛选行只补一个能力：搜索框输入即筛当前列表（原生要回车走服务器），
     并在行尾挂一枚计数徽章 */
  function applyListFilter() {
    if (!listUI) return;
    var rows = listUI.rows;
    var q = quickQuery();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var t = rowText(rows[i]);
      var ok = !q || t.toLowerCase().indexOf(q) >= 0;
      rows[i].style.display = ok ? "" : "none";
      if (ok) shown++;
    }
    var c2 = document.getElementById("lg-listtools-count");
    if (c2) c2.textContent = q ? "筛选 " + shown + " / " + rows.length : "本页 " + rows.length + " 条";
  }

  /* 原生筛选行（题目难度范围 / 算法来源状态 / 关键词搜索那一排）：
     用户要求——原生已有的（难度、状态、排序、搜索）一个都不许重复造，
     我们的增强只补原生没有的能力：① 输入即筛当前列表（原生要回车走服务器）
     ② 一枚计数徽章。没有原生筛选行的列表页（题单/比赛/记录等）什么都不造——
     曾经在没有原生筛选行的页面造一条独立的难度/状态/排序/跳题号工具条，
     被用户否决（"在题单页面要这个功能干什么"），那里不挂任何控件。 */
  function nativeFilterHost() {
    return document.querySelector(".block.filter-tags");
  }
  function setupListTools() {
    if (document.documentElement.getAttribute("data-lg-listtools") !== "1") return;
    var host = nativeFilterHost();
    if (!host) return;
    hookNativeSearch();
    var probe0 = findListRows();
    if (probe0) {
      if (!listUI || probe0.rows.length !== listUI.rows.length) listUI = probe0;
      learnDiffs(probe0.rows);
    }
    // 计数徽章：贴在筛选行末尾（SPA 重建筛选行后要跟着挪回去）
    var cnt = document.getElementById("lg-listtools-count");
    if (!cnt) {
      cnt = document.createElement("span");
      cnt.id = "lg-listtools-count";
    }
    if (cnt.parentNode !== host) host.appendChild(cnt);
    applyListFilter();
  }
  function teardownListTools() {
    var c = document.getElementById("lg-listtools-count");
    if (c) c.remove();
    listUI = null;
  }

  /* ============================================================
     功能二：列表页快速搜索
     有原生搜索框（input.search-text）的页面不再单独造框——用户要求
     "上方不能有两个搜索栏"：原生框输入时实时筛当前列表（见 hookNativeSearch），
     回车仍是洛谷自己的全站搜索。没有原生框的页面才退回独立筛选框。
     ============================================================ */
  function setupQuickSearch() {
    if (document.documentElement.getAttribute("data-lg-quicksearch") !== "1") return;
    if (document.querySelector("input.search-text")) {
      hookNativeSearch();
      return;
    }
    if (document.getElementById("lg-quicksearch")) return;
    if (!findListRows()) return;
    var box = document.createElement("div");
    box.id = "lg-quicksearch";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>';
    var inp = document.createElement("input");
    inp.type = "search";
    // 占位符按页面类型来：题单/比赛/记录列表里没有"题号"可筛
    inp.placeholder = /\/problem/.test(location.pathname)
      ? "快速筛选当前列表（题号 / 标题 / 关键词）"
      : "快速筛选当前列表（标题 / 关键词）";
    box.appendChild(svg);
    box.appendChild(inp);
    var host = document.querySelector(".columba-content-wrap .main, .main-container main, main") || document.body;
    try { host.insertBefore(box, host.firstChild); } catch (e) { document.body.insertBefore(box, document.body.firstChild); }
    inp.addEventListener("input", function () {
      if (listUI) { applyListFilter(); return; } // 筛选行增强在场 → 走统一筛选
      var q = inp.value.trim().toLowerCase();
      var found = findListRows();
      if (!found) return;
      for (var i = 0; i < found.rows.length; i++) {
        var t = rowText(found.rows[i]).toLowerCase();
        found.rows[i].style.display = !q || t.indexOf(q) >= 0 ? "" : "none";
      }
    });
  }
  function teardownQuickSearch() {
    var el = document.getElementById("lg-quicksearch");
    if (el) el.remove();
  }

  /* ---------- 问题搜索优化 ----------
     照抄 Luogu-Plus 的 betterSearch：首页那个「问题跳转」盒子改成
     「问题搜索」，回车/点击都走同一套题号判定：
       4 位以上纯数字  → P<数字>
       数字+字母       → CF<数字><字母>
       已知前缀的题号  → 原样
       其余            → 全文搜索 /problem/list?keyword=…
     题号走新标签页打开（外壳接管），关键词搜索在原地跳转。 */
  function searchTarget(raw) {
    var t = String(raw || "").trim();
    if (!t) return "";
    var u = t.toUpperCase();
    if (/^[1-9]\d{3,}$/.test(t)) return "P" + t;
    if (/^\d{1,4}[A-Z]\d?$/.test(u)) return "CF" + u;
    // 与 extractPids 同款修正：洛谷的 AtCoder 题号全小写（AT_abc300_a），
    // 大写开过去是 404——这里漏了这条，划词识别有、搜索框没有
    if (/^AT_/.test(u)) u = "AT_" + u.slice(3).toLowerCase();
    if (ctx.features.selection.isPid(u)) return u;
    return "";
  }
  function runSearch(raw) {
    var t = String(raw || "").trim();
    if (!t) return;
    var pid = searchTarget(t);
    if (pid) ctx.features.selection.openProblem(pid);
    else location.href = "/problem/list?keyword=" + encodeURIComponent(t) + "&content=true";
  }
  var RANDOM_RATINGS = ["3"];
  var RANDOM_SOURCES = ["P"];
  /* 难度选项跟 diffTable() 走（内置 ∪ 页面自学习）：洛谷 2025 年把 id 5
     改名为「提高」并新增顶级，写死的旧表已经对不上了 */
  function randomDifficulties() {
    var rows = [["0", "暂无评定"]];
    var t = diffTable();
    for (var i = 0; i < t.length; i++) {
      if (t[i][0] >= 1 && t[i][0] < 99) rows.push([String(t[i][0]), t[i][1]]);
    }
    return rows;
  }
  var SOURCES = [["P", "洛谷题库"], ["CF", "CodeForces"], ["SP", "SPOJ"], ["AT", "AtCoder"], ["UVA", "UVa"]];

  // 洛谷题库列表接口把数据塞在 #lentille-context 里（扩展也是这么解析的）
  function lentilleJson(html) {
    var m = String(html).match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }
  /* 兼容两种返回：_contentOnly 有时直接回 JSON，有时回包着
     #lentille-context 的 HTML——两种都试，别赌一种。 */
  function parseListPayload(html) {
    var d = null;
    try { d = JSON.parse(html); } catch (e) {}
    if (!d) d = lentilleJson(html);
    return d;
  }
  function jumpToRandomProblem(ratings, sources, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "加载中…"; }
    /* 多选 = 逗号分隔（洛谷列表接口原生支持 difficulty=2,3&type=P,CF，
       实测 P+CF+AT × 难度 1~3 → 1172 条）；一组一个都没选 = 该组不限 */
    var q = [];
    if (ratings && ratings.length) q.push("difficulty=" + ratings.join(","));
    if (sources && sources.length) q.push("type=" + sources.join(","));
    var base = "/problem/list?" + (q.length ? q.join("&") + "&" : "") + "page=";
    fetch(base + "1&_contentOnly=1", { credentials: "include" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = parseListPayload(html);
        var pr = d && d.data && d.data.problems;
        if (!pr || !pr.count) throw new Error("no count");
        var pages = Math.max(1, Math.ceil(pr.count / 50));
        var page = Math.floor(Math.random() * pages) + 1;
        return fetch(base + page + "&_contentOnly=1", { credentials: "include" }).then(function (r) { return r.text(); });
      })
      .then(function (html) {
        var d = parseListPayload(html);
        var list = (d && d.data && d.data.problems && d.data.problems.result) || [];
        if (!list.length) throw new Error("empty list");
        var pid = list[Math.floor(Math.random() * list.length)].pid;
        // 这里在 fetch 回调里，既没有用户手势（window.open 会被当弹窗拦掉），
        // 也不能用 location.href 走 luogu-glass://（该 scheme 没注册成 privileged，
        // Chromium 直接掐掉导航，连 will-navigate 都不发）。唯一可靠的是 preload
        // 暴露的 IPC 桥。
        if (pid) {
          ctx.features.selection.openProblem(pid);
          // 题目在新标签打开了，选择框该收掉：不然回本标签后蒙层还在、
          // 按钮永远卡在"加载中…"（复位原来只写在失败分支里）
          hideRandomPicker();
          if (btn) { btn.disabled = false; btn.textContent = "跳转"; }
        } else if (btn) { btn.disabled = false; btn.textContent = "跳转"; }
      })
      .catch(function () {
        // 接口形态变了就退回洛谷自带的随机跳题，至少不会点了没反应
        location.href = "/problem/random";
      });
  }
  function hideRandomPicker() {
    var m = document.getElementById("lg-random");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function showRandomPicker() {
    hideRandomPicker();
    var mask = document.createElement("div");
    mask.id = "lg-random";
    var card = document.createElement("div");
    card.className = "lg-random-card";
    var h = document.createElement("div");
    h.className = "lg-random-title";
    h.textContent = "按难度随机跳题";
    card.appendChild(h);

    /* 难度/来源都可多选（用户要求）：点一下选中、再点取消，可同时选多个；
       一组一个都不选 = 该组不限 */
    var mkRow = function (label, items, getSel, toggle) {
      var row = document.createElement("div");
      row.className = "lg-random-row";
      var lb = document.createElement("div");
      lb.className = "lg-random-label";
      lb.textContent = label;
      row.appendChild(lb);
      var wrap = document.createElement("div");
      wrap.className = "lg-random-opts";
      for (var i = 0; i < items.length; i++) {
        (function (val, text) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "lg-random-opt" + (getSel().indexOf(val) >= 0 ? " on" : "");
          b.textContent = text;
          b.setAttribute("data-v", val);
          b.addEventListener("click", function (e) {
            e.preventDefault();
            toggle(val);
            b.classList.toggle("on", getSel().indexOf(val) >= 0);
          });
          wrap.appendChild(b);
        })(items[i][0], items[i][1]);
      }
      row.appendChild(wrap);
      return row;
    };
    card.appendChild(mkRow("难度", randomDifficulties(), function () { return RANDOM_RATINGS; }, function (v) {
      var i = RANDOM_RATINGS.indexOf(v);
      if (i >= 0) RANDOM_RATINGS.splice(i, 1); else RANDOM_RATINGS.push(v);
    }));
    card.appendChild(mkRow("来源", SOURCES, function () { return RANDOM_SOURCES; }, function (v) {
      var i = RANDOM_SOURCES.indexOf(v);
      if (i >= 0) RANDOM_SOURCES.splice(i, 1); else RANDOM_SOURCES.push(v);
    }));
    var hint = document.createElement("div");
    hint.className = "lg-random-hint";
    hint.textContent = "都能多选；一组都不选 = 不限";
    card.appendChild(hint);

    var acts = document.createElement("div");
    acts.className = "lg-random-acts";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "lg-random-btn";
    cancel.textContent = "取消";
    cancel.addEventListener("click", hideRandomPicker);
    var go = document.createElement("button");
    go.type = "button";
    go.className = "lg-random-btn primary";
    go.textContent = "跳转";
    go.addEventListener("click", function () {
      jumpToRandomProblem(RANDOM_RATINGS, RANDOM_SOURCES, go);
    });
    acts.appendChild(cancel);
    acts.appendChild(go);
    card.appendChild(acts);

    mask.appendChild(card);
    mask.addEventListener("click", function (e) { if (e.target === mask) hideRandomPicker(); });
    document.body.appendChild(mask);
  }

  function sweepBetterSearch() {
    var on = state.cfg.betterSearch !== false;
    var box = document.querySelector(".lg-article.lg-index-stat");
    if (!box) return;
    var input = box.querySelector('input[name="toproblem"]') || box.querySelector(".am-form-field");
    var goBtn = box.querySelector('button[name="goto"]');
    var randBtn = box.querySelector('button[name="gotorandom"]');
    var title = box.querySelector("h2");
    if (!on) {
      if (box.getAttribute("data-lg-search") === "1") {
        // 监听器必须真的摘掉：只删属性的话，捕获阶段的 kill/fire 还在拦截
        // 原生按钮（功能实际关不掉），而且再开启时会在旧监听器上再叠一套，
        // 点一次搜索跳两次。引用存在 box 上，摘的时候按原样 removeEventListener。
        var bound = box._lgBound;
        if (bound) {
          if (bound.goBtn) bound.goBtn.removeEventListener("click", bound.fire, true);
          if (bound.randBtn) bound.randBtn.removeEventListener("click", bound.randFire, true);
          if (bound.input) {
            bound.input.removeEventListener("keydown", bound.kd, true);
            bound.input.removeEventListener("keyup", bound.ku, true);
          }
          box._lgBound = null;
        }
        if (input && input.getAttribute("data-lg-ph")) input.placeholder = input.getAttribute("data-lg-ph");
        if (title && title.getAttribute("data-lg-tt")) title.textContent = title.getAttribute("data-lg-tt");
        if (goBtn && goBtn.getAttribute("data-lg-gt") != null) goBtn.textContent = goBtn.getAttribute("data-lg-gt");
        if (goBtn && goBtn.getAttribute("data-lg-gc") != null) goBtn.className = goBtn.getAttribute("data-lg-gc");
        if (randBtn && randBtn.getAttribute("data-lg-rt") != null) randBtn.textContent = randBtn.getAttribute("data-lg-rt");
        if (randBtn && randBtn.getAttribute("data-lg-rc") != null) randBtn.className = randBtn.getAttribute("data-lg-rc");
        box.removeAttribute("data-lg-search");
        box.removeAttribute("data-lg-bound");
      }
      return;
    }
    if (!input) return;
    if (box.getAttribute("data-lg-search") !== "1") {
      box.setAttribute("data-lg-search", "1");
      if (title) { title.setAttribute("data-lg-tt", title.textContent); title.textContent = "问题搜索"; }
      if (input) {
        input.setAttribute("data-lg-ph", input.placeholder || "");
        input.placeholder = "输入题号或题目名";
      }
      // 原文与类名留档，关闭功能时要原样还回去
      if (goBtn) {
        goBtn.setAttribute("data-lg-gt", goBtn.textContent);
        goBtn.setAttribute("data-lg-gc", goBtn.className);
        goBtn.textContent = "搜索";
        goBtn.classList.remove("am-btn-danger");
        goBtn.classList.add("lg-search-go");
      }
      if (randBtn) {
        randBtn.setAttribute("data-lg-rt", randBtn.textContent);
        randBtn.setAttribute("data-lg-rc", randBtn.className);
        randBtn.textContent = "随机跳题";
        randBtn.classList.remove("am-btn-primary");
        randBtn.classList.add("lg-search-rand");
      }
    }
    // 事件只挂一次：洛谷是整页刷新，这里用属性做幂等标记
    if (box.getAttribute("data-lg-bound") !== "1") {
      box.setAttribute("data-lg-bound", "1");
      // 必须用捕获阶段 + stopImmediatePropagation：洛谷自己的按钮处理器是
      // addEventListener 挂的，onclick 赋值和 stopPropagation 都拦不住它——
      // 结果"随机跳题"的选择框刚弹出，洛谷的原生跳转同时把页面跳走，
      // 表现就是"还没等我选择就跳了"。捕获阶段先于所有冒泡监听器执行，
      // stopImmediatePropagation 再掐掉同元素上的后续监听器。
      var kill = function (e) {
        if (!e) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      };
      var fire = function (e) {
        kill(e);
        runSearch(input.value);
      };
      var randFire = function (e) {
        kill(e);
        showRandomPicker();
      };
      var kd = function (e) {
        if (e.key === "Enter" || e.keyCode === 13) fire(e);
      };
      var ku = function (e) {
        if (e.key === "Enter" || e.keyCode === 13) kill(e);
      };
      if (goBtn) {
        goBtn.onclick = null; // 清掉可能残留的旧处理器，避免叠加
        goBtn.addEventListener("click", fire, true);
      }
      if (randBtn) {
        randBtn.onclick = null;
        randBtn.addEventListener("click", randFire, true);
      }
      input.addEventListener("keydown", kd, true);
      input.addEventListener("keyup", ku, true);
      // 引用留档：关闭功能时按原样摘除（见 !on 分支）
      box._lgBound = { fire: fire, kill: kill, randFire: randFire, kd: kd, ku: ku, goBtn: goBtn, randBtn: randBtn, input: input };
    }
  }
  ctx.register("luoguList", {
    findListRows: findListRows,
    applyListFilter: applyListFilter,
    setupListTools: setupListTools,
    teardownListTools: teardownListTools,
    setupQuickSearch: setupQuickSearch,
    teardownQuickSearch: teardownQuickSearch,
    sweepBetterSearch: sweepBetterSearch,
  });
})(window.__lgInjectCtx);
