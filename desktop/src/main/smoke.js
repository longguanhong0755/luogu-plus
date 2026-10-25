/* 仅测试用：不可见冒烟启动、截图、皮肤/深色审计；以及演示数据。
   生产路径不会加载这里的逻辑（只有 --smoke / LG_DEMO 时调用）。 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { STATUS_TEXT } = require("./luogu");

/* ---------- 真实账号登录测试（LG_SMOKE_LOGIN=<账号文件>）---------- */

function firstAccount(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const idx = line.indexOf("----");
    if (idx <= 0) continue;
    const user = line.slice(0, idx).trim();
    const pass = line.slice(idx + 4).trim();
    if (user && pass) return { user, pass };
  }
  return null;
}

async function pollLoginState(ctx, wait, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await ctx.luogu.loginState();
    if (state.loggedIn) return state;
    await wait(1000);
  }
  return null;
}

function findRecord(root, depth = 0) {
  if (!root || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findRecord(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof root === "object") {
    if ("status" in root && "score" in root) return root;
    for (const key of Object.keys(root)) {
      const hit = findRecord(root[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function loginFlow(ctx, wait, outDir) {
  const file = process.env.LG_SMOKE_LOGIN;
  let accounts = [];
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;
      const parts = line.split("----");
      if (parts.length < 2) continue;
      const user = parts[0].trim();
      const pass = parts[1].trim(); // 第三段（如有）是其他字段，不是密码
      if (user && pass) accounts.push({ user, pass });
    }
  } catch (err) {
    console.log("LGTEST_FAIL 账号文件读取失败 " + err.message);
    return;
  }
  const maxAccounts = Number(process.env.LG_SMOKE_LOGIN_MAX || 5);
  accounts = accounts.slice(0, maxAccounts);
  if (!accounts.length) {
    console.log("LGTEST_FAIL 账号文件里没有可用行");
    return;
  }
  console.log("LGTEST 候选账号 " + accounts.length + " 个");

  // 测试期间不弹系统通知
  ctx.cfg.setNotify({ judge: false, contest: false });

  if (process.env.LG_SMOKE_FORCE_LOGIN === "1") {
    try {
      await ctx.luogu.logout();
      console.log("LGTEST 已清除旧会话");
    } catch {
      /* ignore */
    }
  }
  const existing = await ctx.luogu.loginState();
  if (existing.loggedIn) {
    console.log("LGTEST profile 已有登录态 uid=" + existing.uid);
  } else {
    const fillAndSubmit = (body) =>
      `(() => {
        const setVal = (el, v) => {
          const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          d.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        ${body}
      })()`;

    const captchaInfo = (wc) =>
      wc.executeJavaScript(
        `(() => {
          const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
          const input = [...document.querySelectorAll("input")].find((i) => /captcha|验证码/i.test(i.placeholder || ""));
          const iframe = [...document.querySelectorAll("iframe")].find((f) => /captcha|geetest|verify/i.test(f.src || ""));
          return { img: img ? String(img.src).slice(0, 140) : "", input: input ? input.placeholder : "", iframe: iframe ? String(iframe.src).slice(0, 140) : "" };
        })()`
      );

    const saveCaptcha = async (wc) => {
      const data = await wc.executeJavaScript(
        `(async () => {
          const img = [...document.querySelectorAll("img")].find((i) => /captcha|verify|geetest/i.test(i.src || ""));
          if (!img) return null;
          const src = img.src;
          if (src.startsWith("data:")) return src;
          try {
            const r = await fetch(src, { credentials: "include" });
            const b = await r.blob();
            return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
          } catch (e) { return null; }
        })()`
      );
      if (!data) return false;
      fs.writeFileSync(path.join(outDir, "login-captcha.png"), Buffer.from(String(data).split(",").pop(), "base64"));
      console.log("LGTEST_CAPTCHA " + path.join(outDir, "login-captcha.png"));
      return true;
    };

    const waitAnswer = async (seconds) => {
      const answerFile = path.join(outDir, "captcha-answer.txt");
      fs.rmSync(answerFile, { force: true });
      console.log("LGTEST 等待验证码答案：写入 " + answerFile);
      for (let i = 0; i < seconds; i++) {
        if (fs.existsSync(answerFile)) return fs.readFileSync(answerFile, "utf8").trim();
        await wait(1000);
      }
      return null;
    };

    const readError = (wc) =>
      wc.executeJavaScript(
        `(() => {
          const nodes = [...document.querySelectorAll(".swal2-toast, .swal2-container, [class*=error], [class*=alert], [class*=toast]")];
          return nodes.map((n) => (n.innerText || "")).join(" | ").replace(/\s+/g, " ").slice(0, 300);
        })()`
      );

    let loggedInState = null;
    let accountIndex = 0;
    const MAX_ATTEMPTS = 12;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !loggedInState; attempt++) {
      if (accountIndex >= accounts.length) break;
      const account = accounts[accountIndex];
      console.log("LGTEST account#" + (accountIndex + 1) + "=" + account.user.slice(0, 3) + "***");

      ctx.views.openLogin();
      const wc = ctx.views.currentWebContents();
      if (!wc) {
        console.log("LGTEST_FAIL 登录视图未创建");
        return;
      }
      await wc.loadURL("https://www.luogu.com.cn/auth/login").catch(() => {});
      for (let i = 0; i < 60 && wc.isLoading(); i++) await wait(500);
      await wait(1000);

      let step1 = null;
      for (let i = 0; i < 10; i++) {
        step1 = await wc.executeJavaScript(
          fillAndSubmit(`
          const inputs = [...document.querySelectorAll("input")].filter(
            (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && !i.disabled && i.offsetParent
          );
          const input = inputs[0];
          if (!input) return { ok: false, reason: "no-account-input" };
          setVal(input, ${JSON.stringify(account.user)});
          const btn = [...document.querySelectorAll("button")].find((b) => /下一步|登录/.test(b.textContent || ""));
          if (!btn) return { ok: false, reason: "no-next-btn" };
          btn.click();
          return { ok: true };`)
        );
        if (step1 && step1.ok) break;
        await wait(700);
      }
      if (!step1 || !step1.ok) {
        console.log("LGTEST_FAIL 找不到登录输入框/按钮");
        return;
      }

      let sawPassword = false;
      for (let i = 0; i < 24 && !sawPassword; i++) {
        sawPassword = await wc.executeJavaScript(
          `(() => { const el = document.querySelector("input[type=password]"); return !!(el && el.offsetParent); })()`
        );
        if (!sawPassword) await wait(500);
      }
      if (!sawPassword) {
        console.log("LGTEST_FAIL 没有出现密码输入框");
        return;
      }

      let captcha = null;
      for (let i = 0; i < 10 && !captcha; i++) {
        captcha = await captchaInfo(wc);
        if (captcha && (captcha.img || captcha.input || captcha.iframe)) break;
        captcha = null;
        await wait(500);
      }

      await wc.executeJavaScript(
        fillAndSubmit(`
        const input = document.querySelector("input[type=password]");
        if (!input) return { ok: false };
        setVal(input, ${JSON.stringify(account.pass)});
        return { ok: true };`)
      );

      if (captcha && (captcha.img || captcha.input)) {
        const saved = await saveCaptcha(wc);
        if (!saved) {
          console.log("LGTEST_FAIL 验证码图获取失败");
          return;
        }
        const answer = await waitAnswer(240);
        if (!answer) {
          console.log("LGTEST_FAIL 等待验证码答案超时");
          return;
        }
        console.log("LGTEST captcha answered (attempt " + attempt + ")");
        await wc.executeJavaScript(
          fillAndSubmit(`
          const inputs = [...document.querySelectorAll("input")].filter(
            (i) => !["checkbox", "radio", "hidden", "password"].includes(i.type) && i.offsetParent
          );
          const input = inputs.find((i) => /captcha|验证码/i.test(i.placeholder || "")) || inputs[inputs.length - 1];
          if (!input) return { ok: false };
          setVal(input, ${JSON.stringify(answer)});
          return { ok: true };`)
        );
      }

      await wc.executeJavaScript(
        fillAndSubmit(`
        const btn = [...document.querySelectorAll("button")].find((b) => /^登录$/.test((b.textContent || "").trim())) ||
          [...document.querySelectorAll("button")].find((b) => /登录/.test(b.textContent || ""));
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true };`)
      );

      for (let i = 0; i < 10; i++) {
        await wait(1000);
        const st = await ctx.luogu.loginState();
        if (st.loggedIn) {
          loggedInState = st;
          break;
        }
      }
      if (loggedInState) break;

      const error = await readError(wc);
      console.log("LGTEST account#" + (accountIndex + 1) + " failed, error=" + JSON.stringify(error));
      if (/用户名或密码/.test(error)) {
        accountIndex++;
        continue;
      }
      if (/验证码/.test(error)) {
        continue; // 同一账号换一张验证码重试
      }
      if (/频繁|稍后|尝试/.test(error)) {
        await wait(30000);
        continue;
      }
      break;
    }

    if (!loggedInState) {
      console.log("LGTEST_FAIL 所有尝试均未登录成功");
      return;
    }
  }

  const state = await ctx.luogu.loginState();
  if (!state || !state.loggedIn) {
    console.log("LGTEST_FAIL 登录未完成");
    return;
  }
  console.log("LGTEST logged-in uid=" + state.uid);

  const diag = await ctx.luogu.exec(`(async () => {
    const out = {};
    const paths = ["/contest/list", "/user/${state.uid}", "/record/list?user=${state.uid}"];
    for (const p of paths) {
      try {
        const r = await fetch("https://www.luogu.com.cn" + p, { credentials: "include" });
        const t = await r.text();
        out[p] = {
          status: r.status,
          url: String(r.url).slice(0, 100),
          len: t.length,
          hasCtx: t.indexOf("lentille-context") !== -1,
          hasUid: t.indexOf("${state.uid}") !== -1,
          head: t.slice(0, 90)
        };
      } catch (e) {
        out[p] = { error: String(e).slice(0, 120) };
      }
    }
    out.pageHref = location.href.slice(0, 100);
    out.cookieHasUid = document.cookie.indexOf("_uid") !== -1;
    return out;
  })()`);
  console.log("LGTEST_DIAG " + JSON.stringify(diag));

  // 隐藏窗口在登录前加载过首页，刷新一次让打卡按钮出现
  try {
    ctx.luogu.reloadHidden();
  } catch {
    /* ignore */
  }
  await wait(2600);

  ctx.views.showHome();
  const refreshState = await ctx.luogu.refresh(true);
  const home = (refreshState && refreshState.home) || {};
  console.log(
    "LGTEST user=" +
      JSON.stringify({ uid: ctx.luogu.user.uid, name: ctx.luogu.user.name, avatar: !!ctx.luogu.user.avatar })
  );
  console.log(
    "LGTEST home=" +
      JSON.stringify({
        punched: home.punched,
        streak: home.streak,
        heatDays: (home.heat || []).filter((d) => d.count > 0).length,
        recent: (home.recent || []).length,
        contest: home.contest ? home.contest.name : null,
        error: home.error || "",
      })
  );

  const records = await ctx.luogu.fetchLibrary("record", { page: 1, force: true });
  console.log(
    "LGTEST records=" +
      JSON.stringify({
        items: (records.items || []).length,
        needLogin: records.needLogin,
        error: records.error || "",
        first: records.items && records.items[0] ? { pid: records.items[0].pid, status: records.items[0].statusText } : null,
      })
  );

  const punch = await ctx.luogu.checkin();
  console.log("LGTEST checkin=" + JSON.stringify({ ok: punch.ok, already: punch.already, message: punch.message || "" }));
  if (!punch.ok) {
    const pageDbg = await ctx.luogu.exec(`(() => ({
      title: document.title,
      href: location.href.slice(0, 100),
      buttons: document.querySelectorAll("button").length,
      anchors: document.querySelectorAll("a").length,
      punchTextCount: ((document.body.innerText || "").match(/打卡|签到/g) || []).length,
      punchEl: (() => {
        const el = [...document.querySelectorAll("*")].find((n) => n.childElementCount === 0 && /打卡|签到/.test(n.textContent || ""));
        return el ? el.tagName + "." + String(el.className).slice(0, 40) : "";
      })(),
      csrfMeta: (document.querySelector('meta[name="csrf-token"]') || {}).content || "",
      csrfGlobals: Object.keys(window).filter((k) => /csrf|token/i.test(k)).slice(0, 10),
      csrfWin: typeof window._FeCSRFToken !== "undefined" ? String(window._FeCSRFToken).slice(0, 8) : "",
      cookieNames: document.cookie.split(";").map((x) => x.trim().split("=")[0]).slice(0, 10)
    }))()`);
    console.log("LGTEST_PAGE " + JSON.stringify(pageDbg));
  }

  if (process.env.LG_SMOKE_SUBMIT !== "0") {
    // 打开真实提交弹窗，看验证码图的真实端点
    await ctx.luogu.exec(`(async () => { location.href = "https://www.luogu.com.cn/problem/P1001"; })()`);
    await wait(4000);
    const dlgClick = await ctx.luogu.exec(`(() => {
      const btn = [...document.querySelectorAll("button, a")].find((b) => /提交代码/.test(b.textContent || ""));
      if (btn) { btn.click(); return "clicked"; }
      return "no-btn";
    })()`);
    await wait(2500);
    const dlgInfo = await ctx.luogu.exec(`(() => {
      const imgs = [...document.querySelectorAll("img")].map((i) => String(i.src).slice(0, 110)).filter((s) => /captcha|verify/i.test(s));
      const inputs = [...document.querySelectorAll("input")].map((i) => i.placeholder || i.type).slice(0, 14);
      const ta = !!document.querySelector("textarea");
      return { imgs, inputs, ta };
    })()`);
    console.log("LGTEST_DIALOG " + JSON.stringify({ dlgClick, dlgInfo }));
    const code = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}";
    let result = await ctx.luogu.submit("P1001", code, "C++14");
    if (result.captchaRequired) {
      const data = await ctx.luogu.exec(
        `(async () => {
          const r = await fetch("/lg4/captcha?_t=" + Date.now(), { credentials: "include" });
          const b = await r.blob();
          return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        })()`
      );
      if (data) {
        const capFile = path.join(outDir, "submit-captcha.png");
        fs.writeFileSync(capFile, Buffer.from(String(data).split(",").pop(), "base64"));
        console.log("LGTEST_SUBMIT_CAPTCHA " + capFile);
        const answerFile = path.join(outDir, "submit-captcha-answer.txt");
        fs.rmSync(answerFile, { force: true });
        let answer = null;
        for (let i = 0; i < 150; i++) {
          if (fs.existsSync(answerFile)) {
            answer = fs.readFileSync(answerFile, "utf8").trim();
            break;
          }
          await wait(1000);
        }
        if (answer) {
          console.log("LGTEST submit captcha answered");
          result = await ctx.luogu.submit("P1001", code, "C++14", answer);
        }
      }
    }
    console.log(
      "LGTEST submit=" +
        JSON.stringify({
          ok: result.ok,
          rid: result.rid,
          fallback: result.fallback,
          message: result.message || "",
          status: result.status || 0,
          detail: String(result.detail || "").slice(0, 200),
        })
    );
    if (result.ok && result.rid) {
      let finalRecord = null;
      for (let i = 0; i < 40; i++) {
        await wait(2000);
        const recordCtx = await ctx.luogu.fetchContext("/record/" + result.rid);
        const record = findRecord(recordCtx);
        if (!record) continue;
        const status = Number(record.status);
        if (status === 0 || status === 1) continue;
        finalRecord = { status, statusText: STATUS_TEXT[status] || String(status), score: Number(record.score) || 0 };
        break;
      }
      console.log("LGTEST judge=" + JSON.stringify(finalRecord));
    }
  }

  // 结构探针：登录态下的比赛列表与题目页语言表
  const contestCtx = await ctx.luogu.fetchContext("/contest/list");
  console.log(
    "LGTEST_CONTEST " +
      JSON.stringify(
        contestCtx
          ? {
              dataKeys: Object.keys(contestCtx.data || {}),
              first: contestCtx.data && contestCtx.data.contests && contestCtx.data.contests.result
                ? JSON.stringify(contestCtx.data.contests.result[0]).slice(0, 240)
                : null,
            }
          : null
      )
  );
  const parsedContests = ctx.luogu.parseContests(contestCtx);
  console.log(
    "LGTEST_PICK " +
      JSON.stringify({ parsedLen: parsedContests.length, picked: ctx.luogu.pickContest(parsedContests) })
  );
  const problemCtx = await ctx.luogu.fetchContext("/problem/P1001");
  console.log(
    "LGTEST_LANGS " +
      JSON.stringify(
        problemCtx
          ? {
              lastLanguage: problemCtx.data ? problemCtx.data.lastLanguage : null,
              lastCodeLen: problemCtx.data && problemCtx.data.lastCode ? String(problemCtx.data.lastCode).length : 0,
              acceptLanguages: problemCtx.data && problemCtx.data.problem ? problemCtx.data.problem.acceptLanguages : null,
            }
          : null
      )
  );

  const refreshState2 = await ctx.luogu.refresh(true);
  const home2 = (refreshState2 && refreshState2.home) || {};
  console.log(
    "LGTEST home2=" +
      JSON.stringify({
        heatDays: (home2.heat || []).filter((d) => d.count > 0).length,
        recent: (home2.recent || []).length,
        contest: home2.contest ? home2.contest.name : null,
        error: home2.error || "",
      })
  );
}

async function runSmoke(ctx) {
  const out = process.env.LG_SMOKE_OUT || path.join(app.getPath("userData"), "smoke.png");
  const outDir = path.dirname(out);
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name, target) => {
    const win = target || ctx.win;
    let image = await win.capturePage();
    for (let attempt = 0; attempt < 3 && image.isEmpty(); attempt++) {
      await wait(700);
      image = await win.capturePage();
    }
    const file = path.join(outDir, `smoke-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log("SMOKE_SHOT " + name + " " + file);
    return file;
  };

  const capture = async () => {
    try {
      if (process.env.LG_SMOKE_LOGIN) {
        await loginFlow(ctx, wait, outDir);
      }
      if (process.env.LG_SMOKE_THEME === "light" || process.env.LG_SMOKE_THEME === "dark") {
        ctx.cfg.setAppearance({ mode: process.env.LG_SMOKE_THEME });
        await ctx.refreshAppearance();
        await wait(700);
      }
      if (process.env.LG_SMOKE_FOLDER) {
        ctx.cfg.setAppearance({
          wallpaper: "folder",
          wallpaperDir: process.env.LG_SMOKE_FOLDER,
          wallpaperInterval: 15,
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(500);
        console.log("SMOKE_WALL_FOLDER " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
        await ctx.nextWallpaper();
        console.log("SMOKE_WALL_NEXT " + JSON.stringify({ label: ctx.wallpaper.label, count: ctx.wallpaper.count }));
      }
      if (process.env.LG_SMOKE_WE) {
        const items = ctx.scanWe(process.env.LG_SMOKE_WE);
        const first = process.env.LG_SMOKE_WE_ID
          ? items.find((item) => item.id === process.env.LG_SMOKE_WE_ID) || items[0]
          : items.find((item) => item.playable) || items[0];
        ctx.cfg.setAppearance({
          wallpaper: "we",
          weRoot: process.env.LG_SMOKE_WE,
          weId: first ? first.id : "",
          wallpaperIndex: 0,
        });
        await ctx.refreshAppearance();
        await wait(600);
        console.log("SMOKE_WALL_WE " + JSON.stringify({ count: items.length, items: items.slice(0, 3), label: ctx.wallpaper.label, video: ctx.wallpaper.video }));
      }
      ctx.win.setOpacity(0);
      ctx.win.showInactive();
      await wait(process.env.LG_SMOKE_NET === "1" ? 9000 : 1400);
      const homeShot = await shot("home");
      console.log("SMOKE_OK " + homeShot);

      if (process.env.LG_SMOKE_LIB === "1") {
        const libKinds = String(process.env.LG_SMOKE_LIB_ONLY || "problems,contest,article,discuss,training,record")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        for (const kind of libKinds) {
          ctx.views.showLibrary(kind);
          await wait(process.env.LG_SMOKE_NET === "1" ? 2600 : 700);
          await shot("lib-" + kind);
        }
        ctx.views.showHome();
        await wait(400);
      }

      if (process.env.LG_SMOKE_LUOGU === "1") {
        ctx.views.openProblem("P1001");
        await wait(8000);
        await shot("problem");
        const entry = ctx.views.currentEntry();
        if (entry) {
          console.log(
            "SMOKE_VIEW url=" +
              entry.view.webContents.getURL() +
              " bounds=" +
              JSON.stringify(entry.view.getBounds())
          );
          let viewImage = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              viewImage = await entry.view.webContents.capturePage();
              if (!viewImage.isEmpty()) break;
            } catch (err) {
              viewImage = null;
            }
            await wait(900);
          }
          if (viewImage && !viewImage.isEmpty()) {
            fs.writeFileSync(path.join(outDir, "smoke-problem-view.png"), viewImage.toPNG());
            console.log("SMOKE_SHOT problem-view");
          } else {
            console.log("SMOKE_SHOT problem-view SKIPPED（隐藏窗口取帧不稳定，非产品问题）");
          }
          try {
            const skin = await entry.view.webContents.executeJavaScript(`(() => {
              const probe = getComputedStyle(document.body, "::before");
              return {
                bgImage: probe.backgroundImage.slice(0, 160),
                bgSize: probe.backgroundSize,
                scrim: getComputedStyle(document.documentElement).getPropertyValue("--lg-scrim").trim(),
                backdrop: probe.transform,
                bodyBg: getComputedStyle(document.body).backgroundColor,
                htmlBg: getComputedStyle(document.documentElement).backgroundColor
              };
            })()`);
            console.log("SMOKE_SKIN " + JSON.stringify(skin));
          } catch (err) {
            console.log("SMOKE_SKIN probe failed: " + err.message);
          }
        }
      }

      if (process.env.LG_SMOKE_AUDIT === "1") {
        await runAudit(ctx, outDir, wait);
      }

      ctx.openSettings();
      await wait(1400);
      if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
        ctx.settingsWin.setOpacity(0);
        await shot("settings", ctx.settingsWin);
        if (process.env.LG_SMOKE_DEBUG === "1") {
          const dbg = await ctx.settingsWin.webContents.executeJavaScript(`(() => {
            const box = document.getElementById("wallpaper");
            const layers = box ? [...box.querySelectorAll(".wall-layer")] : [];
            return {
              hasBox: !!box,
              layers: layers.length,
              opacity: layers.map((l) => getComputedStyle(l).opacity),
              bg: layers.map((l) => getComputedStyle(l).backgroundImage.slice(0, 100)),
              htmlBg: getComputedStyle(document.documentElement).backgroundColor,
              bodyBg: getComputedStyle(document.body).backgroundColor,
              appBg: getComputedStyle(document.getElementById("app")).backgroundColor,
              paneBg: getComputedStyle(document.querySelector(".set-pane")).backgroundColor,
              rect: box ? JSON.stringify(box.getBoundingClientRect()) : ""
            };
          })()`);
          console.log("SMOKE_SETTINGS " + JSON.stringify(dbg));
        }
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="wallpaper"]').click()`
        );
        await wait(900);
        const wallShown = await ctx.settingsWin.webContents.executeJavaScript(
          `!document.querySelector('[data-panel="wallpaper"]').hidden`
        );
        console.log("SMOKE_SETTINGS_SECTION " + wallShown);
        await shot("settings-wallpaper", ctx.settingsWin);
        await ctx.settingsWin.webContents.executeJavaScript(
          `document.querySelector('.snav[data-sec="rail"]').click()`
        );
        await wait(400);
        await shot("settings-rail", ctx.settingsWin);

        if (process.env.LG_SMOKE_RAIL === "1") {
          const before = ctx.cfg.get().rail.order.slice();
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelectorAll('#rail-list .rail-mini')[1] && document.querySelectorAll('#rail-list .rail-mini')[1].click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `document.querySelector('#rail-list .rail-eye') && document.querySelector('#rail-list .rail-eye').click()`
          );
          await wait(350);
          await ctx.settingsWin.webContents.executeJavaScript(
            `(() => { const f = document.getElementById('rail-add'); document.getElementById('rail-add-label').value = 'GitHub'; document.getElementById('rail-add-url').value = 'https://github.com'; f.requestSubmit(); })()`
          );
          await wait(450);
          const railState = ctx.cfg.get().rail;
          const railDom = await ctx.win.webContents.executeJavaScript(
            `[...document.querySelectorAll('#rail-top .rail-btn')].map((b) => ({ id: b.dataset.id, title: b.title }))`
          );
          console.log("SMOKE_RAIL " + JSON.stringify({ before, order: railState.order, hidden: railState.hidden, custom: railState.custom, dom: railDom }));
          await shot("settings-rail-after", ctx.settingsWin);
          ctx.cfg.resetRail();
          ctx.broadcastState();
        }
      }
    } catch (err) {
      console.error("SMOKE_FAIL " + (err && err.stack ? err.stack : err.message));
    }
    app.quitting = true;
    app.quit();
  };

  if (ctx.win.webContents.isLoading()) ctx.win.webContents.once("did-finish-load", capture);
  else capture();
}

async function loadAndWait(ctx, url, title) {
  ctx.views.openDetail(url, title, "audit");
  const wc = ctx.views.currentWebContents();
  if (!wc) return null;
  for (let i = 0; i < 80; i++) {
    if (!wc.isLoading()) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 900));
  return wc;
}

async function runAudit(ctx, outDir, wait) {
  const only = String(process.env.LG_AUDIT_ONLY || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pages = [
    ["problem", "https://www.luogu.com.cn/problem/P1001"],
    ["article", "https://www.luogu.com.cn/article"],
    ["discuss", "https://www.luogu.com.cn/discuss"],
    ["training", "https://www.luogu.com.cn/training/100"],
    ["user", "https://www.luogu.com.cn/user/1"],
    ["login", "https://www.luogu.com.cn/auth/login"],
  ].filter(([name]) => !only.length || only.includes(name));
  const report = {};
  for (const [name, url] of pages) {
    const wc = await loadAndWait(ctx, url, name);
    if (!wc) continue;
    try {
      const data = await wc.executeJavaScript(`(() => {
        const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
        const parse = (c) => {
          const s = String(c || "").trim();
          let m = s.match(/^#([0-9a-f]{6})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
          }
          m = s.match(/^#([0-9a-f]{3})$/i);
          if (m) {
            const h = m[1];
            return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
          }
          m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
          m = s.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
          if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
          return null;
        };
        const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
        const pathOf = (el) => {
          const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
          return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
        };
        const themeBg = parse(getComputedStyle(document.documentElement).getPropertyValue("--lg-bg").trim()) || { r: 27, g: 28, b: 32, a: 1 };
        const effectiveBg = (el) => {
          let node = el;
          while (node) {
            const bg = parse(getComputedStyle(node).backgroundColor);
            if (bg && bg.a > 0.5) return bg;
            node = node.parentElement;
          }
          return themeBg;
        };
        const contrast = (a, b) => {
          const L = (c) => {
            const f = (v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
          };
          const l1 = L(a);
          const l2 = L(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const light = new Map();
        const darkText = new Map();
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.height < 8) continue;
          if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          const bg = parse(cs.backgroundColor);
          if (isDark && bg && bg.a > 0.5 && lum(bg) > 0.55) {
            const key = pathOf(el);
            const item = light.get(key);
            const area = Math.round(r.width * r.height);
            if (!item || item.area < area) light.set(key, {
              path: key,
              bg: cs.backgroundColor,
              color: cs.color,
              area,
              chain: [el.parentElement, el.parentElement && el.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
              html: el.outerHTML.slice(0, 220),
              text: (el.textContent || "").trim().slice(0, 40)
            });
          }
          const text = (el.textContent || "").trim();
          if (text && el.childElementCount === 0) {
            const fg = parse(cs.color);
            if (fg && fg.a > 0.5) {
              const ratio = contrast(fg, effectiveBg(el));
              if (ratio < 3.0) {
                const key = pathOf(el);
                darkText.set(key, {
                  path: key,
                  color: cs.color,
                  fontSize: cs.fontSize,
                  ratio: Math.round(ratio * 100) / 100,
                  chain: [el.parentElement, el.parentElement && el.parentElement.parentElement, el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement].map((n) => (n ? pathOf(n) : "")).join(" < "),
                  html: el.outerHTML.slice(0, 220),
                  text: text.slice(0, 40)
                });
              }
            }
          }
        }
        const vars = {};
        const cs = getComputedStyle(document.documentElement);
        for (const name of ["--theme-body-back","--theme-body-color","--theme-body-image","--theme-card-background","--theme-navi-back","--theme-dropdown","--theme-tooltip"]) {
          vars[name] = cs.getPropertyValue(name).trim().slice(0, 80);
        }
        return {
          isDark,
          passkeyGuard: window.__lgPasskeyGuard === true,
          light: [...light.values()].sort((a, b) => b.area - a.area).slice(0, 35),
          darkText: [...darkText.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 30),
          vars
        };
      })()`);
      report[name] = data;
      if (name === "login" || name === "user" || name === "article") {
        try {
          const image = await wc.capturePage();
          fs.writeFileSync(path.join(outDir, `audit-${name}.png`), image.toPNG());
          console.log("SMOKE_SHOT audit-" + name);
        } catch {
          /* ignore */
        }
      }
      console.log("AUDIT_" + name.toUpperCase() + " light=" + data.light.length + " darkText=" + data.darkText.length + " passkey=" + data.passkeyGuard);
      console.log("AUDIT_LIGHT_" + name.toUpperCase() + " " + JSON.stringify(data.light.slice(0, 6)));
      if (data.darkText.length) console.log("AUDIT_DARKTEXT_" + name.toUpperCase() + " " + JSON.stringify(data.darkText.slice(0, 8)));
    } catch (err) {
      console.log("AUDIT_FAIL_" + name + " " + err.message);
    }
    await wait(300);
  }
  fs.writeFileSync(path.join(outDir, "audit-dark.json"), JSON.stringify(report, null, 2));
  console.log("SMOKE_AUDIT " + path.join(outDir, "audit-dark.json"));
}

/* 演示数据：只给截图用，不代表真实账号。 */
function seedDemo(ctx) {
  const now = new Date();
  const heat = [];
  for (let i = 139; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key =
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const v = (i * 7 + Math.floor(i / 9) * 3) % 11;
    heat.push({ date: key, count: v < 3 ? 0 : (v % 5) + 1 });
  }
  ctx.luogu.user = { loggedIn: true, uid: 1, name: "示例用户", avatar: "" };
  ctx.luogu.home = {
    quote: "把每一道题，都当成一次新的开始。",
    heat,
    contest: {
      id: 1,
      name: "CSP-S 模拟赛 #12",
      start: Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000 + 36000,
      end: Date.now() + 5 * 3600 * 1000,
      live: false,
    },
    recent: [
      { pid: "P1001", title: "A+B Problem", status: 12, statusText: "AC", score: 100, time: Date.now() - 2 * 60 * 1000 },
      { pid: "P1048", title: "采药", status: 6, statusText: "WA", score: 0, time: Date.now() - 60 * 60 * 1000 },
      { pid: "P1216", title: "数字三角形", status: 12, statusText: "AC", score: 100, time: Date.now() - 26 * 3600 * 1000 },
      { pid: "P1002", title: "过河卒", status: 5, statusText: "TLE", score: 60, time: Date.now() - 30 * 3600 * 1000 },
    ],
    punched: true,
    streak: 7,
    updatedAt: Date.now(),
    error: "",
  };
}

module.exports = { runSmoke, seedDemo };
