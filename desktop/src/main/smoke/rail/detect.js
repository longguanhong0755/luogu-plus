/* 侧栏冒烟：划词识别 P1001/CF13A / 运势改写开关可还原。 */

async function runDetectCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  ctx.views.openProblem("P1001");
  await waitFor(() => {
    const wc = ctx.views.currentWebContents();
    return !!wc && !wc.isDestroyed() && !wc.isLoading();
  }, 12000);
  ctx.cfg.setFeatures({ dynamicDetection: true, problemDetect: true });
  ctx.views.applyFeatures();
  await wait(350);
  const detectWc = ctx.views.currentWebContents();
  if (detectWc && !detectWc.isDestroyed()) {
    await detectWc.executeJavaScript(`(() => {
      document.querySelectorAll("#lg-smoke-detect").forEach((n) => n.remove());
      const node = document.createElement("div");
      node.id = "lg-smoke-detect";
      node.textContent = "P1001 CF13A";
      document.body.appendChild(node);
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return { selected: selection.toString(), body: !!document.body };
    })()`);
    let detectDom = { exists: false, buttons: [] };
    for (let attempt = 0; attempt < 15; attempt++) {
      await wait(200);
      detectDom = await detectWc.executeJavaScript(`(() => ({
        exists: !!document.getElementById("lg-problem-detect"),
        buttons: [...document.querySelectorAll("#lg-problem-detect button")].map((b) => b.textContent)
      }))()`);
      if (detectDom.exists) break;
    }
    addCase(
      "selected-problem-detect",
      { detectDom },
      {
        popup: detectDom.exists,
        twoProblems: detectDom.buttons.includes("P1001") && detectDom.buttons.includes("CF13A"),
      }
    );
    await detectWc.executeJavaScript(`(() => { document.getElementById("lg-smoke-detect")?.remove(); document.getElementById("lg-problem-detect")?.remove(); return true; })()`);

    await detectWc.executeJavaScript(`(() => {
      const punch = document.createElement("div");
      punch.id = "lg-smoke-punch";
      punch.className = "lg-punch";
      punch.innerHTML = '<div class="lg-punch-result">§ 小吉 §</div><div class="am-u-sm-6">宜：吃饭</div><div class="am-u-sm-6">忌：熬夜</div>';
      document.body.appendChild(punch);
      return true;
    })()`);
    ctx.cfg.setFeatures({ changeFortune: true, dynamicDetection: true });
    ctx.views.applyFeatures();
    await wait(320);
    const fortuneOn = await detectWc.executeJavaScript(`(() => ({
      result: document.querySelector("#lg-smoke-punch .lg-punch-result")?.textContent || "",
      advice: [...document.querySelectorAll("#lg-smoke-punch .am-u-sm-6")].map((n) => n.textContent)
    }))()`);
    ctx.cfg.setFeatures({ changeFortune: false });
    ctx.views.applyFeatures();
    await wait(180);
    const fortuneOff = await detectWc.executeJavaScript(`(() => ({
      result: document.querySelector("#lg-smoke-punch .lg-punch-result")?.textContent || "",
      advice: [...document.querySelectorAll("#lg-smoke-punch .am-u-sm-6")].map((n) => n.textContent)
    }))()`);
    addCase(
      "fortune-toggle-restore",
      { fortuneOn, fortuneOff },
      {
        overridden: fortuneOn.result === "§ 大吉 §" && fortuneOn.advice.every((text) => text === "万事皆宜"),
        restored: fortuneOff.result === "§ 小吉 §" && fortuneOff.advice.includes("宜：吃饭") && fortuneOff.advice.includes("忌：熬夜"),
      }
    );
    await detectWc.executeJavaScript(`document.getElementById("lg-smoke-punch")?.remove(); true`);
  }
}

module.exports = { runDetectCases };
