#!/usr/bin/env node
/* ============================================================
   Luogu++ — 存量 IPC 契约探针（外部 CDP 版）
   用法: node scripts/probe-ipc-contract.cjs <port> [输出json路径]
   前提: 已有一个实例在跑并开着 CDP 端口（scripts/run-all-probes.sh 起）。

   为什么要有这个：本项目 128 个 IPC 通道、186 个 preload 暴露方法，
   现有三个探针加起来只有 22 条断言，而且**没有一条在测"桥接方法本身"**——
   契约缺口全靠 lint-contracts.cjs 静态查（只查"preload 引的通道主进程有没有
   注册"），静态查不出的是运行期才暴露的那一类：
     · preload 把方法名拼错 / 暴露了但调用方按另一个名字调
     · handler 里对 undefined 取属性（参数缺失就崩）
     · handler 抛异常穿过 contextBridge 变成难懂的包装错误
     · invoke 型方法忘了 return（调用方永远拿到 undefined）
   这个探针把 preload 暴露的每个方法**真调一遍**（跳过有副作用的），
   按四类归档，把"通道存在"推进到"通道可被安全调用且返回值结构合理"。

   探针跑在**渲染进程**里（CDP Runtime.evaluate），所以只能调 preload 暴露的
   方法，碰不到主进程的 ipcMain —— 这正是我们要验的那一层。

   四类判定（在 Node 侧做，页面只负责"调 + 描述返回值形状"）：
     ok           调用成功，返回值是对象/数组/字符串/数字/布尔；
                  或 {ok:true} / {ok:false}（业务上拒绝是**正常响应**，不算失败）
     typeerror    抛 TypeError，或错误消息里含 TypeError /
                  "Cannot read properties of undefined" / "is not a function"
                  —— 主进程 handler 对缺失参数取属性，**这是真 bug**，判 FAIL
     other-error  抛其它 Error。多半是参数形态不对（handler 里 Number(x) 之类），
                  归为 NOTE，但要把通道名列出来
     no-return    调用成功但返回值是 undefined，而该方法本该有返回值 → 可疑，
                  列清单但不判失败
     timeout      主进程 handler 超过 6 秒不返回（额外一类，探超时风险）
     not-fn       暴露出来的成员不是函数（如 lgPopup.version 是字符串），
                  记一条提醒，防止把常量当成方法调
   退出码：出现 typeerror → 1；探针本身跑不起来 → 2；否则 0。
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 9309);
const OUT = process.argv[3] || "";
const ROOT = path.join(__dirname, "..");

/* ---------- 危险方法黑名单 ----------
   逐类列出，每条写清"为什么不能随便调"。判定原则：
     ① 不可逆 / 影响探针实例本身 → 调了就没法继续测
     ② 会改持久状态（配置、磁盘文件）→ 测完环境被污染，别的探针结论失真
     ③ 会改 UI 布局 / 浏览器状态（标签、导航、窗口）→ 后续探针的
        "当前有几个标签""设置页开没开"这类前置条件全变
     ④ 会发起网络请求或弹原生对话框 → 阻塞到超时，掩盖真实结论
   只调剩下的"读"方法 + 事件订阅方法。订阅方法（on*）不是无副作用：
   它们把回调注册到 ipcRenderer 上，参数传错（传 0 而不是函数）会在事件
   到来时抛"cb is not a function"，所以订阅方法统一传一个空函数。 */
const BLACKLIST = {
  /* ① 销毁 / 退出 / 重启：调了探针实例就没了，后面的方法一个都测不到 */
  "lgConfig.relaunch": "重启整个应用，探针直接失联",
  "lgChrome.winClose": "关掉应用窗口，探针直接失联",
  "lgChrome.closeTab": "关闭标签页，不可逆",
  "lgPopup.close": "关掉覆盖层弹窗：会连带把别的探针刚打开的弹层收走",

  /* ② 删除数据：磁盘上的东西没了就是没了 */
  "lgConfig.clearData": "清浏览数据（缓存/Cookie/历史/下载），不可逆",
  "lgConfig.reset": "配置恢复默认，把被测配置全清掉",
  "lgConfig.historyClear": "清空浏览历史，不可逆",
  "lgConfig.historyRemove": "删单条历史，不可逆",
  "lgConfig.downloadClear": "清空下载记录，不可逆",
  "lgConfig.downloadRemove": "删单条下载记录，不可逆",
  "lgChrome.downloadClear": "清空下载记录（同上，chrome 侧入口）",
  "lgChrome.downloadRemove": "删单条下载记录（同上，chrome 侧入口）",
  "lgConfig.wallRemove": "删除壁纸文件，不可逆",
  "lgConfig.wallDedupe": "去重会真删重复的壁纸文件，不可逆",
  "lgConfig.clearWallpaper": "清掉当前壁纸设置",
  "lgConfig.accountRemove": "删除已保存的账号",

  /* ③ 改变持久状态（配置 / 磁盘文件 / 下载任务） */
  "lgConfig.set": "写配置（lg-config:set），后续所有探针读到的配置都被改",
  "lgChrome.setConfig": "写配置（同一条通道的 chrome 侧入口）",
  "lgConfig.wallSelect": "改壁纸选中项，落盘",
  "lgConfig.wallMode": "改壁纸模式与轮换间隔，落盘",
  "lgChrome.setVtabWidth": "侧栏宽度主进程落盘并重算页面 inset",
  "lgConfig.wallImport": "导入壁纸：弹原生文件对话框 + 写磁盘",
  "lgConfig.pickWallpaper": "弹原生文件选择框，会阻塞到用户操作",
  "lgConfig.diagnosticsSave": "把诊断报告写到磁盘",
  /* 系统剪贴板是**实例之外**共享的状态：探针实例退出后内容还在，
     属于"污染了别人也在用的东西"，比改应用内状态更不该做。
     预加载层写的是 String(text || "")，无参调用会往剪贴板塞一个空串。 */
  "lgChrome.copyText": "写系统剪贴板：影响实例之外的环境，且无参调用会塞空串",
  "lgChrome.downloadPause": "暂停真实下载任务",
  "lgChrome.downloadResume": "恢复真实下载任务",
  "lgChrome.downloadCancel": "取消真实下载任务",
  "lgChrome.downloadRetry": "重试真实下载任务",
  "lgChrome.downloadSaveAs": "弹另存为原生对话框",
  "lgConfig.downloadPause": "暂停真实下载任务",
  "lgConfig.downloadResume": "恢复真实下载任务",
  "lgConfig.downloadCancel": "取消真实下载任务",
  "lgConfig.downloadRetry": "重试真实下载任务",
  "lgConfig.downloadSaveAs": "弹另存为原生对话框",
  "lgConfig.accountAdd": "加账号要发登录请求并落盘",
  "lgChrome.muteAll": "静音是每标签的持久会话状态，改了影响页面脚本",
  "lgChrome.organizeTabs": "整理标签（close-duplicates 分支会真关标签）",
  "lgChrome.organizeUndo": "撤销上一次整理，需要前一次整理存在，状态不可控",

  /* ④ 改变 UI 布局 / 标签 / 导航 / 窗口：后续探针的前置条件会被改坏 */
  "lgChrome.winMinimize": "最小化窗口：外壳不可见，尺寸类断言全落空",
  "lgChrome.winToggleMax": "最大化/还原窗口：视口尺寸变了",
  "lgChrome.toggleFullscreen": "全屏切换：视口尺寸变了",
  "lgChrome.toggleIde": "IDE 标签抽屉开关：外壳布局变了",
  "lgConfig.ide": "IDE 标签抽屉开关（同一条通道的本地页入口）",
  "lgChrome.toggleDrawer": "抽屉开关：外壳布局变了",
  "lgChrome.toggleVtab": "垂直标签开关：外壳布局变了",
  "lgChrome.splitTab": "开分屏：标签结构变了",
  "lgChrome.unsplitTab": "退分屏：标签结构变了",
  "lgChrome.splitCloseSide": "关分屏某一格：标签结构变了",
  "lgChrome.splitReverse": "反转分屏左右：标签结构变了",
  "lgChrome.splitRatio": "改分屏比例：几何变了",
  "lgChrome.glancePromote": "Glance 速览提升成真标签：标签结构变了",
  "lgChrome.glanceClose": "关掉 Glance 速览卡",
  "lgApp.glance": "打开 Glance 速览卡（对应需求里说的 openGlance）",
  "lgChrome.newTab": "新建标签：标签数变了",
  "lgChrome.openTab": "打开标签：标签数变了（对应需求里说的 openTab）",
  "lgChrome.navigate": "导航当前标签：页面被换掉，探针可能连不上",
  "lgChrome.openExternalTab": "开外部标签：标签数变了",
  "lgChrome.activateTab": "切换激活标签：当前页变了",
  "lgChrome.reopenTab": "重开最近关闭的标签：标签数变了",
  "lgChrome.back": "后退：页面被换掉",
  "lgChrome.forward": "前进：页面被换掉",
  "lgChrome.reload": "刷新当前页：页面状态被重置",
  "lgChrome.stop": "停止加载当前页",
  "lgChrome.closedOpen": "按栈位恢复最近关闭的标签：标签数变了",
  "lgChrome.openSettings": "打开设置页：会多出一个视图抢 CDP target",
  "lgChrome.openHome": "打开首页：会多出一个视图抢 CDP target",
  "lgChrome.openHistory": "打开历史页：会多出一个视图抢 CDP target",
  "lgConfig.openSettings": "打开设置页（本地页入口）",
  "lgConfig.openHome": "打开首页（本地页入口）",
  "lgConfig.openHistory": "打开历史页（本地页入口）",
  "lgConfig.openUrl": "打开任意 URL：标签/窗口状态不可控",
  "lgChrome.openExternal": "交给系统默认程序打开：拉起外部进程",
  "lgApp.openProblem": "打开题号：会新建标签",
  "lgApp.openPath": "打开洛谷内页路径：会新建标签",
  "lgApp.command": "应用动作分发器（drawer/ide/problem…）：动作不可控",
  "lgChrome.groupNew": "新建标签分组：标签结构变了",
  "lgChrome.groupNewTab": "在组内新建标签：标签数变了",
  "lgChrome.groupJoin": "把标签并入分组：标签结构变了",
  "lgChrome.groupLeave": "把标签移出分组：标签结构变了",
  "lgChrome.groupUpdate": "改分组（改名/改色/折叠）：标签结构变了",
  "lgChrome.groupUngroup": "取消分组：标签结构变了",
  "lgChrome.groupClose": "关闭整个分组：一次关掉多个标签",
  "lgChrome.groupDrop": "分组拖放落点：标签结构变了",
  "lgChrome.groupMove": "整组排序：标签顺序变了",
  "lgChrome.reorderTabs": "拖动排序标签：标签顺序变了",
  "lgChrome.sleepTab": "让标签休眠：webContents 被换掉",
  "lgChrome.sleepOthers": "让其它标签全部休眠",
  "lgChrome.reader": "阅读模式：当前页 DOM 被重排",
  "lgChrome.findStart": "打开页内查找条：DOM 变了",
  "lgChrome.find": "页内查找并高亮",
  "lgChrome.findStop": "关掉页内查找条：DOM 变了",
  "lgChrome.translatePage": "整页翻译：页面文本被替换",
  "lgChrome.popupShow": "显示覆盖层弹窗：会插入新视图抢 CDP target",
  "lgChrome.popupHide": "隐藏覆盖层弹窗：会把别的探针的弹层收走",
  "lgChrome.holdPopup": "挂住弹层（拖拽中）：影响弹层生命周期",
  "lgChrome.popupHiddenAck": "弹层关闭握手回执：打乱关闭时序",
  "lgChrome.dockSync": "往坞推内容：覆盖层 DOM 被换掉",
  "lgChrome.dockSize": "改坞视图尺寸：几何变了",
  "lgChrome.sugSel": "改联想选中行：DOM 类名变了",
  "lgChrome.tabContextMenu": "弹原生标签右键菜单：阻塞到用户操作",
  "lgChrome.zoom": "改标签缩放：页面布局变了",
  "lgApp.zoomBy": "改标签缩放（本地页入口）：页面布局变了",
  "lgApp.parallax": "壁纸视差：主进程会推事件，壁纸层被改写",
  "lgApp.ideMode": "IDE 模式：让标签铺满整窗，外壳与坞让位",
  "lgConfig.wallNext": "换下一张壁纸：可见外观变了",
  "lgChrome.wallNext": "换下一张壁纸（chrome 侧入口）：可见外观变了",
  "lgPopup.pick": "模拟点了弹层菜单项：等于替用户执行一个动作",
  "lgPopup.pickStay": "同上（不回隐的 pick）",
  "lgPopup.fit": "弹层按内容改尺寸：几何变了",
  "lgPopup.tabContext": "弹原生标签右键菜单：阻塞",
  "lgPopup.tabAux": "浮层行中键 = 关标签",
  "lgPopup.tabReorder": "浮层里拖动排序：标签顺序变了",
  "lgPopup.hold": "挂住浮层：影响弹层生命周期",
  "lgPopup.flyoutShown": "浮层交接回执：打乱收窄条时序",
  "lgPopup.sugHover": "改联想悬停行：DOM 类名变了",
  "lgPopup.groupDrop": "浮层里的分组拖放：标签结构变了",
  "lgPopup.groupJoin": "浮层里并组：标签结构变了",
  "lgPopup.groupLeave": "浮层里移出分组：标签结构变了",
  "lgPopup.groupMove": "浮层里整组排序：标签顺序变了",
  "lgDock.size": "改坞视图尺寸：几何变了",
  "lgDock.cmd": "坞项点击 = 一次导航/开标签",

  /* ④ 会发起网络请求或长时间阻塞：调了会挂在超时上，掩盖真实结论 */
  "lgChrome.screenshot": "抓当前窗口截图，出网/落盘链路长",
  "lgChrome.fullshot": "整页长截图：耗时长且吃内存",
  "lgChrome.pip": "画中画：拉起一个原生浮窗",
  "lgChrome.tabThumb": "抓页面缩略图（capturePage）：耗时长",
  "lgApp.translate": "翻译请求由主进程出网，等网络",
  "lgConfig.contests": "拉洛谷近期比赛：缓存空时会触发一次出网抓取",
  "lgConfig.accountSwitch": "切账号：要重新出网登录",
  "lgChrome.switchAccount": "切账号（chrome 侧入口）：要重新出网登录",
  "lgChrome.accountAnswer": "提交验证码：出网",
  "lgConfig.accountAnswer": "提交验证码（本地页入口）：出网",
  "lgChrome.userNudge": "催主进程刷新用户态：会触发一次出网抓昵称头像",
  "lgChrome.downloadReveal": "在文件管理器里定位下载文件：拉起外部进程",
  "lgConfig.downloadReveal": "在文件管理器里定位下载文件：拉起外部进程",
};

/* 订阅方法（on*）：不是 invoke，是 ipcRenderer.on 注册监听。
   参数必须是函数，否则事件到来时抛 "cb is not a function"——那不是被测方法的
   bug，是我们传错了参数。统一传空函数，顺带验"通道名非法时 ipcRenderer.on
   会不会同步抛"（拼错通道名是静态检查抓不到的契约缺口）。 */
const isSubscription = (m) => /^on[A-Z]/.test(m);

/* ---------- CDP ---------- */
function listTargets() {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 6000 }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("ws connect failed"));
  });
}
function mk(ws) {
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const j = JSON.parse(e.data);
    if (j.id && pend.has(j.id)) {
      const p = pend.get(j.id);
      pend.delete(j.id);
      j.error ? p.no(new Error(j.error.message)) : p.ok(j.result);
    }
  });
  return (method, params = {}) =>
    new Promise((ok, no) => {
      const i = ++id;
      pend.set(i, { ok, no });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); no(new Error("timeout " + method)); } }, 30000);
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 静态解析：preload 暴露了什么 ----------
   解析逻辑**照抄** lint-contracts.cjs 第 3 节（extractBalanced + topLevelKeys），
   不另写一套：非贪婪正则会在嵌套大括号处截断（onConfig 那种多行回调），
   第一版就是因此把 186 个方法只认出 6 个。
   本文件在此之上多解析出每个成员的值源码，用来判"这是 on / send / invoke
   还是个普通常量"——static 判断比按名字猜可靠，报告里也能带上通道名。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}
function extractBalanced(src, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    const c = src[k];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, k);
    }
  }
  return "";
}
function topLevelKeys(obj) {
  const out = [];
  let depth = 0;
  let key = "";
  for (let k = 0; k < obj.length; k++) {
    const c = obj[k];
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) { key += c; continue; }
    if (depth === 0 && key) {
      if (c === ":") out.push(key);
      key = "";
    }
  }
  return out;
}
/* 在 topLevelKeys 同一套深度语义上多取一步：成员值源码。
   额外处理字符串字面量与 // 行注释，免得 "a,b" 这种字符串里的逗号/花括号
   把深度数错（preload 的通道名里就有 ":"，值里也可能出现逗号）。 */
function topLevelEntries(obj) {
  const out = [];
  const n = obj.length;
  let depth = 0, key = "", i = 0;
  while (i < n) {
    const c = obj[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && obj[i] !== q) { if (obj[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (c === "/" && obj[i + 1] === "/") { while (i < n && obj[i] !== "\n") i++; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; i++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; i++; continue; }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) { key += c; i++; continue; }
    if (depth === 0 && key) {
      if (c !== ":") { key = ""; i++; continue; }
      let j = i + 1, d = 0;
      const start = j;
      while (j < n) {
        const e = obj[j];
        if (e === '"' || e === "'" || e === "`") {
          const q = e; j++;
          while (j < n && obj[j] !== q) { if (obj[j] === "\\") j++; j++; }
          j++; continue;
        }
        if (e === "/" && obj[j + 1] === "/") { while (j < n && obj[j] !== "\n") j++; continue; }
        if (e === "{" || e === "[" || e === "(") { d++; j++; continue; }
        if (e === "}" || e === "]" || e === ")") { if (d === 0) break; d--; j++; continue; }
        if (d === 0 && e === ",") break;
        j++;
      }
      out.push({ key, value: obj.slice(start, j) });
      key = ""; i = j + 1; continue;
    }
    i++;
  }
  return out;
}
const PRELOADS = ["preload-page.js", "preload-chrome.js", "preload-popup.js", "preload-dock.js", "preload-config.js"];
function parseExposed() {
  const exposed = new Map(); // 全局名 -> Map(方法名 -> { kind, channel, file })
  for (const file of PRELOADS) {
    let body = "";
    try { body = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch (e) { continue; }
    const clean = stripComments(body);
    const re = /exposeInMainWorld\(\s*["'`]([\w$]+)["'`]\s*,\s*\{/g;
    let m;
    while ((m = re.exec(clean))) {
      const g = m[1];
      const openIdx = clean.indexOf("{", m.index);
      const obj = extractBalanced(clean, openIdx);
      if (!exposed.has(g)) exposed.set(g, new Map());
      const inner = exposed.get(g);
      /* 两套解析互为交叉验证：key 集合不一致说明其中一个被源码形态骗了，
         这时候宁可两条都留在报告里让人看，也不静默采信一个。 */
      const byEntries = topLevelEntries(obj).map((e) => e.key);
      const byKeys = topLevelKeys(obj);
      for (const e of topLevelEntries(obj)) {
        if (inner.has(e.key)) continue;
        const kindM = /\.(invoke|send|on)\(\s*["'`]([\w:.$-]+)["'`]/.exec(e.value);
        inner.set(e.key, {
          kind: kindM ? kindM[1] : "value",
          channel: kindM ? kindM[2] : "",
          file,
        });
      }
      if (byEntries.join(",") !== byKeys.join(",")) {
        console.log(`  WARN  ${file}/${g}: 两种解析的键集合不一致，需人工核对`);
      }
    }
  }
  return exposed;
}

/* ---------- 页面侧：调一次并描述返回值形状 ----------
   只回传**形状摘要**，不回传真实值：lg-wall:image 这类通道返回的是整张壁纸的
   data URL（MB 级），原样回传会把 CDP 消息撑爆、还会把用户壁纸写进结果 JSON。 */
function callExpr(g, m, timeoutMs) {
  return `(async () => {
    const G = ${JSON.stringify(g)}, M = ${JSON.stringify(m)};
    function describe(v) {
      const t = typeof v;
      if (v === undefined) return "undefined";
      if (v === null) return "null";
      if (t === "string") return "string(len=" + v.length + ") " + JSON.stringify(v.slice(0, 60));
      if (t === "number" || t === "boolean") return t + " " + String(v);
      if (t === "function") return "function";
      if (Array.isArray(v)) return "array(len=" + v.length + ")";
      if (t === "object") {
        let k = [];
        try { k = Object.keys(v).slice(0, 10); } catch (e) {}
        let okf = "";
        try { if (typeof v.ok === "boolean") okf = " ok=" + v.ok; } catch (e) {}
        return "object(keys=" + k.length + ")" + okf + " " + k.join(",");
      }
      return t;
    }
    const Gp = window[G];
    if (!Gp) return { skip: "global-missing" };
    let fn;
    try { fn = Gp[M]; } catch (e) { return { thrown: { name: "GetterError", msg: String((e && e.message) || e) } }; }
    if (typeof fn !== "function") return { notFn: typeof fn };
    const argForm = ${JSON.stringify(isSubscription(m) ? "cb" : "noarg")};
    const args = argForm === "cb" ? [function () {}] : [];
    const t0 = Date.now();
    let thrown = null, timedOut = false, ret;
    try {
      ret = fn.apply(Gp, args);
      if (ret && typeof ret.then === "function") {
        ret = await Promise.race([
          ret,
          new Promise((_, rj) => setTimeout(function () { rj({ __probeTimeout: true }); }, ${timeoutMs})),
        ]);
      }
    } catch (e) {
      if (e && e.__probeTimeout) timedOut = true;
      else thrown = { name: (e && e.name) || "Error", msg: String((e && e.message) || e) };
    }
    return { argForm, thrown, timedOut, ret: describe(ret), ms: Date.now() - t0 };
  })()`;
}

const results = [];
function emit(tag, name, pass, detail, extra) {
  const row = Object.assign({ name, pass: !!pass, detail: detail == null ? "" : String(detail) }, extra || {});
  results.push(row);
  console.log(`  ${tag}  ${name}` + (detail != null ? "   " + detail : ""));
}

/* 主进程 handler 抛的异常穿过 IPC 后，Electron 会包一层：
   "Error invoking remote method 'x': TypeError: Cannot read properties of undefined"
   —— 名字会退化成 Error，所以必须同时看消息文本，否则真 bug 全被判成 other-error。 */
const TYPE_ERROR_RE = /TypeError|Cannot read propert|is not a function|of undefined \(reading|of null \(reading/;

(async () => {
  const exposed = parseExposed();
  const totalMethods = [...exposed.values()].reduce((n, m) => n + m.size, 0);
  console.log(`\n静态解析：${exposed.size} 个全局 / ${totalMethods} 个暴露成员`);
  for (const [g, inner] of exposed) console.log(`  ${g}: ${inner.size}`);
  console.log(`黑名单：${Object.keys(BLACKLIST).length} 个（见文件头分类说明）\n`);

  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  if (!pages.length) throw new Error("找不到任何页面视图");

  /* 不同 preload 只在特定视图里有：lgChrome 在外壳视图，lgPopup/lgDock 在各自
     的覆盖视图（没打开弹层/坞时压根不存在），lgApp/lgConfig 在本地页与站点页。
     所以逐个全局去找"第一个真的有它"的视图，找不到就记一条跳过而不是报错。 */
  const viewOf = new Map(); // 全局名 -> { ws, send, url }
  for (const g of exposed.keys()) {
    for (const t of pages) {
      let ws;
      try { ws = await connect(t.webSocketDebuggerUrl); } catch (e) { continue; }
      const send = mk(ws);
      let has = false;
      try {
        const r = await send("Runtime.evaluate", { expression: `typeof window[${JSON.stringify(g)}]`, returnByValue: true });
        has = r && r.result && r.result.value === "object";
      } catch (e) { has = false; }
      if (has) { viewOf.set(g, { ws, send, url: t.url }); break; }
      try { ws.close(); } catch (e) {}
    }
  }

  for (const [g, inner] of exposed) {
    const view = viewOf.get(g);
    if (!view) {
      emit("SKIP ", `${g}.*`, true, `当前没有视图暴露 ${g}（覆盖层视图未打开），本组全部跳过`);
      for (const [m, info] of inner) {
        results.push({ name: `${g}.${m}`, pass: true, detail: "no-view", outcome: "no-view", channel: info.channel, kind: info.kind });
      }
      continue;
    }
    console.log(`--- ${g}（视图 ${String(view.url).split("/").pop()}）---`);
    for (const [m, info] of inner) {
      const id = `${g}.${m}`;
      if (Object.prototype.hasOwnProperty.call(BLACKLIST, id)) {
        results.push({ name: id, pass: true, detail: BLACKLIST[id], outcome: "blacklisted", channel: info.channel, kind: info.kind });
        continue;
      }
      let r;
      try {
        const rr = await view.send("Runtime.evaluate", {
          expression: callExpr(g, m, 6000),
          returnByValue: true,
          awaitPromise: true,
        });
        if (rr && rr.exceptionDetails) throw new Error(rr.exceptionDetails.text || "eval error");
        r = rr.result.value;
      } catch (e) {
        emit("FAIL ", id, false, `CDP 调用失败: ${e.message}`, { outcome: "harness-error", channel: info.channel, kind: info.kind });
        continue;
      }
      const base = { channel: info.channel, kind: info.kind, argForm: r && r.argForm, ms: r && r.ms };
      if (r && r.skip) {
        emit("SKIP ", id, true, r.skip, Object.assign({ outcome: "skip" }, base));
      } else if (r && r.notFn) {
        emit("NOTE ", id, true, `暴露出来的是 ${r.notFn} 不是函数（常量，别当方法调）`, Object.assign({ outcome: "not-fn" }, base));
      } else if (r && r.timedOut) {
        emit("NOTE ", id, true, `主进程 6s 没返回（通道 ${info.channel}）`, Object.assign({ outcome: "timeout" }, base));
      } else if (r && r.thrown) {
        const isType = r.thrown.name === "TypeError" || TYPE_ERROR_RE.test(r.thrown.msg || "");
        emit(isType ? "FAIL " : "NOTE ", id, !isType,
          `${r.thrown.name}: ${String(r.thrown.msg).slice(0, 160)}`,
          Object.assign({ outcome: isType ? "typeerror" : "other-error", errName: r.thrown.name, errMsg: r.thrown.msg }, base));
      } else if (r && r.ret === "undefined") {
        /* send 型（单向推送）与订阅方法本来就返回 undefined，不算可疑；
           invoke 型忘了 return 才是缺陷 —— 这正是 no-return 这一类要抓的。 */
        const expected = info.kind === "invoke" && !isSubscription(m);
        emit(expected ? "NOTE " : "PASS ", id, true,
          expected ? `invoke 型却返回 undefined（通道 ${info.channel}）→ 调用方可能拿到空值` : `无返回值（${info.kind} 型，属预期）`,
          Object.assign({ outcome: expected ? "no-return" : "ok" }, base));
      } else {
        emit("PASS ", id, true, r.ret, Object.assign({ outcome: "ok" }, base));
      }
      await sleep(30);
    }
    console.log("");
  }

  const byOutcome = {};
  for (const r of results) byOutcome[r.outcome || (r.pass ? "ok" : "typeerror")] = (byOutcome[r.outcome || "ok"] || 0) + 1;
  const typeerrors = results.filter((r) => r.outcome === "typeerror");
  const noReturns = results.filter((r) => r.outcome === "no-return");
  const otherErrors = results.filter((r) => r.outcome === "other-error");
  const timeouts = results.filter((r) => r.outcome === "timeout");
  const notFns = results.filter((r) => r.outcome === "not-fn");
  const probed = results.filter((r) => r.outcome && r.outcome !== "blacklisted").length;

  console.log("=== 汇总 ===");
  console.log(`  暴露成员 ${totalMethods} 个：黑名单 ${byOutcome.blacklisted || 0}，实调 ${probed}`);
  console.log(`  ok ${byOutcome.ok || 0} / typeerror ${typeerrors.length} / other-error ${otherErrors.length} / no-return ${noReturns.length} / timeout ${timeouts.length} / not-fn ${notFns.length}`);
  if (typeerrors.length) {
    console.log("\n=== TypeError（真 bug：handler 对缺失参数取属性）===");
    for (const r of typeerrors) console.log(`  ${r.name}  [${r.channel}]  ${r.detail}`);
  }
  if (noReturns.length) {
    console.log("\n=== 可疑 no-return（invoke 型却返回 undefined）===");
    for (const r of noReturns) console.log(`  ${r.name}  [${r.channel}]`);
  }
  if (otherErrors.length) {
    console.log("\n=== other-error（多半是参数形态不对，列出通道名）===");
    for (const r of otherErrors) console.log(`  ${r.name}  [${r.channel}]  ${String(r.detail).slice(0, 110)}`);
  }
  if (timeouts.length) {
    console.log("\n=== timeout（handler 6s 未返回）===");
    for (const r of timeouts) console.log(`  ${r.name}  [${r.channel}]`);
  }
  console.log("");

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({
      at: new Date().toISOString(),
      port: PORT,
      summary: {
        globals: [...exposed.keys()],
        perGlobal: [...exposed].map(([g, m]) => [g, m.size]),
        totalExposed: totalMethods,
        blacklisted: byOutcome.blacklisted || 0,
        probed,
        byOutcome,
      },
      results,
    }, null, 2));
    console.log("已写入 " + OUT);
  }
  process.exit(typeerrors.length ? 1 : 0);
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(2);
});