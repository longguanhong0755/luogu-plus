/* 草稿隔离（IPC + UI）与页面顶层 toast。 */

async function runDraftProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_DRAFT === "1") {
    // R56 回归：草稿按题目隔离，A 题的代码绝不漏进 B 题的编辑器
    await ctx.win.webContents.executeJavaScript(
      `window.lg.saveDraft({ pid: "P1001", code: "DRAFT_A_MARKER", lang: "C++17", o2: true })`
    );
    const draftA = await ctx.win.webContents.executeJavaScript(`window.lg.getDraft({ pid: "P1001" })`);
    const draftB = await ctx.win.webContents.executeJavaScript(`window.lg.getDraft({ pid: "P1002" })`);
    const ipcOk =
      draftA.code === "DRAFT_A_MARKER" &&
      draftA.lang === "C++17" &&
      draftA.o2 === true &&
      draftB.code === "" &&
      draftB.lang === "C++17"; // 无草稿的题只继承语言偏好
    console.log(
      "SMOKE_DRAFT_IPC " +
        JSON.stringify({
          a: { code: draftA.code, lang: draftA.lang, o2: draftA.o2 },
          bEmpty: draftB.code === "",
          bLang: draftB.lang,
          ok: ipcOk,
        })
    );
    if (!ipcOk) console.log("SMOKE_FAIL 草稿 IPC 隔离失败");

    // UI 级：P1001 的 IDE 里输入 → 切到 P1002 → 编辑器必须是默认模板
    ctx.views.openProblem("P1001");
    await wait(1500);
    ctx.views.setIde(true);
    await wait(500);
    await ctx.win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector("#ide-pane .ide-code");
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, "UI_DRAFT_A_MARKER");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return "typed";
    })()`);
    await wait(1300); // 防抖 800ms + 落盘
    // 矩阵里 IDE 探针可能先打开过本题，编辑器内存里仍是默认语言；
    // 这里显式设一次偏好，验证「切题继承全局语言」而不是依赖前序状态。
    await ctx.win.webContents.executeJavaScript(`(() => {
      const langSel = document.querySelector("#ide-pane .ide-lang");
      langSel.value = "C++17";
      langSel.dispatchEvent(new Event("change", { bubbles: true }));
      return langSel.value;
    })()`);
    await wait(1200);
    ctx.views.openProblem("P1002");
    await wait(1500);
    ctx.views.setIde(true);
    await wait(900);
    const draftUi = await ctx.win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector("#ide-pane .ide-code");
      const langSel = document.querySelector("#ide-pane .ide-lang");
      return {
        leaked: ta.value.indexOf("DRAFT_A_MARKER") !== -1,
        isDefault: ta.value.indexOf("int a, b;") !== -1,
        lang: langSel ? langSel.value : "",
      };
    })()`);
    console.log("SMOKE_DRAFT_UI " + JSON.stringify(draftUi));
    const draftUiOk = !draftUi.leaked && draftUi.isDefault && draftUi.lang === "C++17";
    if (!draftUiOk) console.log("SMOKE_FAIL 切题后编辑器没有换成本题草稿/默认模板，或没继承语言偏好");
    ctx.views.setIde(false);
    ctx.views.showHome();
    await wait(300);
  }
}

async function runToastProbe({ ctx, wait, shot, shotView, outDir }) {
  if (process.env.LG_SMOKE_TOAST === "1") {
    // R58 回归：页面视图盖住外壳时，toast 必须同步画在页面顶层
    ctx.views.openProblem("P1001");
    await wait(1500);
    const toastPageKind = ctx.views.currentInfo().kind;
    // 页面刚装载完的 ~2s 内，隐藏窗口对 webContents.send 的投递可能被丢弃
    //（ctx.toast 直发稳定丢失、同 wc 稍后直发必达——已实测二分定位）。
    // 探针按真实路径重试一次，验证的是「管道通」，不是极限时序。
    const toastRead = async () => {
      try {
        return await ctx.views.currentWebContents().executeJavaScript(`(() => {
          const host = document.getElementById("lg-page-toast");
          return host ? { text: (host.innerText || "").slice(0, 60), visible: getComputedStyle(host).opacity === "1" } : null;
        })()`);
      } catch {
        return null;
      }
    };
    ctx.toast("提交", "已提交 P1001，评测完成后会通知你。");
    let pageToast = null;
    for (let i = 0; i < 3 && !pageToast; i++) {
      await wait(400);
      pageToast = await toastRead();
    }
    if (!pageToast) {
      ctx.toast("提交", "已提交 P1001，评测完成后会通知你。");
      for (let i = 0; i < 3 && !pageToast; i++) {
        await wait(400);
        pageToast = await toastRead();
      }
    }
    const shellToast = await ctx.win.webContents.executeJavaScript(`!!document.querySelector("#toasts .toast")`);
    const toastOk = !!shellToast && !!pageToast && pageToast.visible === true && /提交/.test(pageToast.text || "");
    console.log("SMOKE_TOAST " + JSON.stringify({ pageKind: toastPageKind, shellToast, pageToast, ok: toastOk }));
    if (!toastOk) console.log("SMOKE_FAIL 页面在场时 toast 不可见");
    ctx.views.showHome();
    await wait(300);
  }
}

module.exports = { runDraftProbe, runToastProbe };
