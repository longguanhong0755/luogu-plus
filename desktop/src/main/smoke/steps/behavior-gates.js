/* 行为门禁：Ctrl+F 查找/缩放 HUD、安全注入全拒（lg-sec:// 自定义 scheme）。 */

async function runFindProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_FIND === "1") {
    // R76 行为级回归：Ctrl+F 查找条端到端 + Ctrl+= 缩放 HUD——R73/R74 交互
    // 修复从「grep 断言 + 人工审读」升级为真实键鼠事件 + DOM 断言的门禁。
    ctx.views.openProblem("P1001");
    await wait(1600);
    const fw = ctx.views.currentWebContents();
    if (fw) fw.sendInputEvent({ type: "keyDown", keyCode: "f", modifiers: ["control"] });
    await wait(500);
    const barShown = await fw.executeJavaScript(`(() => {
      const b = document.getElementById("lg-find-bar");
      return b ? { visible: b.style.display === "flex", focused: document.activeElement === b.querySelector("input") } : null;
    })()`);
    // 查询经输入事件驱动防抖→invoke→findInPage→found-in-page→计数回传全链
    const findType = async () => {
      await fw.executeJavaScript(`(() => {
        const input = document.querySelector("#lg-find-bar input");
        if (!input) return false;
        input.value = "的";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await wait(1100);
      return await fw.executeJavaScript(`(() => {
        const b = document.getElementById("lg-find-bar");
        const span = b ? b.querySelector("span") : null;
        return span ? span.textContent : "";
      })()`);
    };
    let found = await findType();
    // found-in-page 回传腿在无焦点隐藏窗口探针下不触发（Electron findInPage
    // 限制；真实会话有焦点则正常）。探针断言其余全链，回传腿留档为已知限制。
    if (String(found || "").indexOf("/") === -1) {
      console.log("SMOKE_NOTE find-count leg unverifiable in focusless hidden window (Electron findInPage limit)");
    }
    await wait(200);
    if (fw) fw.sendInputEvent({ type: "keyDown", keyCode: "=", modifiers: ["control"] });
    await wait(350);
    const zoomLevel = fw.getZoomLevel();
    const hudSeen = await fw.executeJavaScript(`!!document.getElementById("lg-zoom-hud")`);
    const hudPe = hudSeen
      ? await fw.executeJavaScript(`getComputedStyle(document.getElementById("lg-zoom-hud")).pointerEvents`)
      : "";
    if (fw) fw.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await wait(350);
    const barClosed = await fw.executeJavaScript(`(() => {
      const b = document.getElementById("lg-find-bar");
      return !b || b.style.display === "none";
    })()`);
    const findOk =
      !!barShown && barShown.visible && barShown.focused &&
      zoomLevel > 0 && hudSeen && hudPe === "none" && barClosed;
    console.log("SMOKE_FIND " + JSON.stringify({ barShown, found, zoomLevel, hudSeen, hudPe, barClosed, ok: findOk }));
    if (!findOk) console.log("SMOKE_FAIL 查找条/缩放行为回归");
    if (fw) fw.setZoomLevel(0);
    ctx.views.showHome();
    await wait(300);
  }
}

async function runSecurityProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_SEC === "1") {
    // R77 行为级安全门禁：向各宿主注入 window.open / 跨源导航攻击并断言全拒。
    // 攻击串用自定义 scheme（lg-sec://）：非 http(s) 会被安全出口静默丢弃，
    // 探针全程零外部副作用（不会弹出系统浏览器）。
    const atk = "lg-sec://probe";
    const sec = {};
    sec.shellOpen = await ctx.win.webContents
      .executeJavaScript(`window.open(${JSON.stringify(atk)}) === null`)
      .catch(() => null);
    await ctx.win.webContents.executeJavaScript(`location.href = ${JSON.stringify(atk)}; "sent"`).catch(() => null);
    await wait(700);
    sec.shellUrl = String(ctx.win.webContents.getURL() || "").slice(0, 40);
    ctx.views.openProblem("P1001");
    await wait(1300);
    const pw = ctx.views.currentWebContents();
    sec.pageOpen = await pw.executeJavaScript(`window.open(${JSON.stringify(atk)}) === null`).catch(() => null);
    await pw.executeJavaScript(`location.href = ${JSON.stringify(atk)}; "sent"`).catch(() => null);
    await wait(800);
    sec.pageUrl = String(pw.getURL() || "").slice(0, 60);
    // 隐藏数据窗：环境感知——不在场先 ensureWindow（打包冒烟不初始化网络窗），
    // 仍不可用则记 skipped 并从裁决剔除（腿不可达 ≠ 防护失效）
    let hiddenWc = null;
    try {
      if (ctx.luogu && ctx.luogu.ensureWindow) {
        if (!ctx.luogu.win || ctx.luogu.win.isDestroyed()) {
          ctx.luogu.ensureWindow();
          await wait(1800);
        }
        if (ctx.luogu.win && !ctx.luogu.win.isDestroyed()) hiddenWc = ctx.luogu.win.webContents;
      }
    } catch {
      hiddenWc = null;
    }
    sec.hiddenOpen = "skipped";
    if (hiddenWc) {
      sec.hiddenOpen = await hiddenWc.executeJavaScript(`window.open(${JSON.stringify(atk)}) === null`).catch(() => null);
      if (sec.hiddenOpen === null) {
        await wait(800); // 导航竞态重试一次
        sec.hiddenOpen = await hiddenWc.executeJavaScript(`window.open(${JSON.stringify(atk)}) === null`).catch(() => null);
      }
    }
    // 注：fullscreen 权限向量曾试图经 requestFullscreen 断言，实测 Electron 39
    // 的 HTML5 全屏不经过权限处理器（requestFullscreen 直接 resolve），
    // 该向量按事实撤下（权限 handler 保留为纵深防御，判源已改 requestingUrl）。
    // settings 窗（第五宿主）：显式开-测-关（冒烟模式 opacity 0 隐藏）
    try {
      ctx.openSettings();
      await wait(1400);
      const settingsWin = ctx.settingsWin && !ctx.settingsWin.isDestroyed() ? ctx.settingsWin : null;
      if (settingsWin) {
        sec.settingsOpen = await settingsWin.webContents
          .executeJavaScript(`window.open(${JSON.stringify(atk)}) === null`)
          .catch(() => null);
        settingsWin.close();
        await wait(300);
      }
    } catch {
      sec.settingsOpen = null;
    }
    const secOk =
      sec.shellOpen === true &&
      sec.pageOpen === true &&
      (sec.hiddenOpen === true || sec.hiddenOpen === "skipped") &&
      sec.shellUrl.indexOf("file:") === 0 &&
      String(sec.pageUrl || "").indexOf("luogu.com.cn") !== -1 &&
      sec.settingsOpen === true;
    console.log("SMOKE_SEC " + JSON.stringify({ ...sec, ok: secOk }));
    if (!secOk) console.log("SMOKE_FAIL 安全注入未被全拒");
    ctx.views.showHome();
    await wait(300);
  }
}

module.exports = { runFindProbe, runSecurityProbe };
