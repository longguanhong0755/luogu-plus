/* 侧栏冒烟：用户搜索覆盖层 + 冻结帧背景。 */

async function runSearchCases({ ctx, wait, shot, shotView, shell, waitFor, approx, addCase, originalBounds }) {
  // 冻结帧依赖 WebContentsView 在合成器中至少有一帧；冒烟主窗默认完全隐藏，
  // 这里用透明度 0 的 showInactive 生成一帧，不抢焦点也不显示给用户。
  ctx.win.setOpacity(0);
  ctx.win.setSkipTaskbar(true);
  ctx.win.showInactive();
  await wait(120);
  ctx.views.openProblem("P1001");
  await waitFor(() => {
    const wc = ctx.views.currentWebContents();
    return !!wc && !wc.isLoading();
  }, 12000);
  ctx.views.currentEntry()?.view.webContents.invalidate();
  await wait(1100);
  const originalUserSearch = ctx.luogu.searchUsers;
  const originalOpenProfile = ctx.views.openProfile;
  let searchedKeyword = "";
  let openedUid = 0;
  ctx.luogu.searchUsers = async (keyword) => {
    searchedKeyword = keyword;
    return { ok: true, users: [{ uid: 42, name: "测试用户", ccfLevel: 6, badge: "AC" }] };
  };
  ctx.views.openProfile = (uid) => {
    openedUid = uid;
  };
  // 先完整排空上一轮覆盖层队列，避免复用上一张冻结帧把新打开的抓图误判为成功。
  await ctx.views.setOverlay(false);
  await waitFor(() => shell(`document.getElementById("page-freeze").hidden`), 2500);
  ctx.command("userSearch");
  await waitFor(() => shell(`(() => {
    const overlay = document.getElementById("overlay");
    const userSearch = document.getElementById("user-search");
    const freeze = document.getElementById("page-freeze");
    return !!overlay && !overlay.hidden && !!userSearch && !userSearch.hidden &&
      !!freeze && !freeze.hidden && String(freeze.style.backgroundImage || "").startsWith('url("data:image/');
  })()`), 8000);
  await shell(`(() => {
    const input = document.getElementById("user-search-input");
    input.value = "测试";
    document.getElementById("user-search-form").requestSubmit();
    return true;
  })()`);
  await waitFor(() => shell(`document.querySelectorAll("#user-search-list .user-search-row").length === 1`), 1800);
  const userSearchDom = await shell(`(() => {
    const freeze = document.getElementById("page-freeze");
    return {
      rows: document.querySelectorAll("#user-search-list .user-search-row").length,
      focused: document.activeElement && document.activeElement.classList.contains("user-search-row"),
      text: document.getElementById("user-search-list").textContent,
      freezeVisible: !!freeze && !freeze.hidden && String(freeze.style.backgroundImage || "").startsWith('url("data:image/')
    };
  })()`);
  if (process.env.LG_SMOKE_VISUAL === "1") {
    await wait(360);
    await shot("user-search", ctx.win);
  }
  await shell(`document.querySelector("#user-search-list .user-search-row").click(); true`);
  await wait(220);
  const userOverlayHidden = await shell(`document.getElementById("overlay").hidden`);
  addCase(
    "user-search",
    { searchedKeyword, userSearchDom, openedUid, overlayHidden: userOverlayHidden },
    {
      querySent: searchedKeyword === "测试",
      oneResult: userSearchDom.rows === 1,
      resultFocused: userSearchDom.focused,
      resultVisibleText: /测试用户/.test(userSearchDom.text) && /UID 42/.test(userSearchDom.text),
      pageBackdropFrozen: userSearchDom.freezeVisible,
      profileOpened: openedUid === 42,
      overlayClosed: userOverlayHidden,
    }
  );
  ctx.luogu.searchUsers = originalUserSearch;
  ctx.views.openProfile = originalOpenProfile;
  ctx.win.hide();
}

module.exports = { runSearchCases };
