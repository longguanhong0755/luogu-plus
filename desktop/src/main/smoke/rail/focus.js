/* 侧栏冒烟：Ctrl+B 收起 / F6 焦点链 / Ctrl+L 跳转 / Esc 还原焦点。 */

async function runFocusCases(tools, pageEntry) {
  const { ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds } = tools;

  const pageWc = ctx.views.currentWebContents();
  const pressPageKey = (keyCode, modifiers = []) => {
    if (!pageWc || pageWc.isDestroyed()) return;
    pageWc.focus();
    pageWc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    pageWc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  pressPageKey("b", ["control"]);
  await waitFor(() => ctx.cfg.get().rail.pinned === false && approx(ctx.views.railWidth(), 64), 2500);
  await wait(220);
  const ctrlBDom = await shell(`(() => {
    const rail = document.getElementById("rail");
    const pin = document.getElementById("rail-pin");
    return {
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : -1,
      pinPressed: pin ? pin.getAttribute("aria-pressed") : null,
      bodyPinned: document.body.classList.contains("rail-pinned")
    };
  })()`);
  const ctrlBBounds = pageEntry ? pageEntry.view.getBounds() : null;
  addCase(
    "ctrl-b-from-page",
    { ctrlBDom, ctrlBBounds, pinned: ctx.cfg.get().rail.pinned, mainRailW: ctx.views.railWidth() },
    {
      configUnpinned: ctx.cfg.get().rail.pinned === false,
      ariaReleased: ctrlBDom.pinPressed === "false",
      bodyUnpinned: !ctrlBDom.bodyPinned,
      railWidth: approx(ctrlBDom.railW, 64),
      mainWidth: approx(ctx.views.railWidth(), 64),
      pageViewX: !!ctrlBBounds && approx(ctrlBBounds.x, ctrlBDom.railW),
    }
  );

  const focusTrail = [];
  const onShellFocus = () => focusTrail.push("shell");
  const onPageFocus = () => focusTrail.push("page");
  let pageFocusCalls = 0;
  const realPageFocus = pageWc && !pageWc.isDestroyed() ? pageWc.focus.bind(pageWc) : null;
  if (pageWc && !pageWc.isDestroyed()) {
    pageWc.focus = (...args) => {
      pageFocusCalls++;
      return realPageFocus(...args);
    };
  }
  ctx.win.webContents.on("focus", onShellFocus);
  if (pageWc && !pageWc.isDestroyed()) pageWc.on("focus", onPageFocus);
  tools.focusCleanup = () => {
    ctx.win.webContents.removeListener("focus", onShellFocus);
    if (pageWc && !pageWc.isDestroyed()) {
      pageWc.removeListener("focus", onPageFocus);
      if (realPageFocus) pageWc.focus = realPageFocus;
    }
  };
  focusTrail.length = 0;
  pageWc.focus();
  await wait(60);
  pressPageKey("F6");
  const railFocused = await waitFor(
    () => shell(`!!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("rail-btn"))`),
    1800
  );
  const firstFocusId = await shell(`document.activeElement && (document.activeElement.dataset.id || "pin")`);
  ctx.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down", modifiers: [] });
  ctx.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Down", modifiers: [] });
  await wait(80);
  const secondFocusId = await shell(`document.activeElement && (document.activeElement.dataset.id || "pin")`);
  ctx.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "End", modifiers: [] });
  ctx.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "End", modifiers: [] });
  await wait(80);
  const endFocusId = await shell(`document.activeElement && (document.activeElement.dataset.id || "pin")`);
  ctx.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
  ctx.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
  await wait(160);
  addCase(
    "keyboard-rail-focus",
    { railFocused, firstFocusId, secondFocusId, endFocusId },
    {
      focusedFromPage: railFocused,
      arrowMoved: secondFocusId !== firstFocusId,
      endMovedToLast: endFocusId === "users",
    }
  );
  focusTrail.length = 0;
  pageFocusCalls = 0;
  pressPageKey("l", ["control"]);
  const jumpOpened = await waitFor(
    () =>
      shell(`(() => {
        const overlay = document.getElementById("overlay");
        const palette = document.getElementById("palette");
        return !!(overlay && !overlay.hidden && palette && !palette.hidden && document.activeElement && document.activeElement.id === "pal-input");
      })()`),
    2500
  );
  const jumpDom = await shell(`(() => {
    const overlay = document.getElementById("overlay");
    const palette = document.getElementById("palette");
    const input = document.getElementById("pal-input");
    const list = document.getElementById("pal-list");
    return {
      opened: !!overlay && !overlay.hidden,
      paletteVisible: !!palette && !palette.hidden,
      inputFocused: !!input && document.activeElement === input,
      inputLabel: input ? input.getAttribute("aria-label") : "",
      listHidden: !!list && list.hidden,
      railW: Math.round(document.getElementById("rail").getBoundingClientRect().width)
    };
  })()`);
  addCase(
    "ctrl-l-jump-focus",
    { jumpOpened, jumpDom, overlayOpen: ctx.views.overlayOpen },
    {
      opened: jumpOpened && jumpDom.opened && jumpDom.paletteVisible,
      focused: jumpDom.inputFocused,
      jumpMode: jumpDom.inputLabel === "输入题号跳转" && jumpDom.listHidden,
      railStayedCollapsed: approx(jumpDom.railW, 64),
      mainOverlayOpen: ctx.views.overlayOpen === true,
    }
  );

  await shell(`document.getElementById("pal-input").value = "P1001"; true`);
  ctx.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
  ctx.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
  const jumpClosed = await waitFor(() => shell(`document.getElementById("overlay").hidden`), 2500);
  await wait(260);
  const overlayHidden = await shell(`document.getElementById("overlay").hidden`);
  const focusLast = focusTrail.length ? focusTrail[focusTrail.length - 1] : "";
  const pageStillCurrent = !!pageEntry && ctx.views.currentEntry() === pageEntry;
  addCase(
    "escape-close-restore-page-focus",
    { jumpClosed, overlayHidden, focusTrail, focusLast, pageFocusCalls, overlayOpen: ctx.views.overlayOpen, pageStillCurrent },
    {
      closed: jumpClosed && overlayHidden,
      overlayReleased: ctx.views.overlayOpen === false,
      // 隐藏冒烟窗口没有 OS 焦点，focus 事件不会触发；验证恢复路径确实调用页面 focus。
      pageFocusRestored: pageFocusCalls > 0,
      pageStillCurrent,
    }
  );
  tools.focusCleanup();
  tools.focusCleanup = () => {};
}

module.exports = { runFocusCases };
