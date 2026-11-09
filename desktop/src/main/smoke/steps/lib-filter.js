/* 题库筛选面板行为探针：难度区间 / 搜索题面 / 标签弹窗与参数透传。 */

async function runLibFilterProbe({ ctx, wait, shot, shotView, outDir }, filterProbe, originalTags) {
  if (filterProbe) {
    ctx.views.showLibrary("problems");
    await wait(1000);
    const originalLibrary = ctx.luogu.fetchLibrary;
    const seen = [];
    ctx.luogu.fetchLibrary = async (kind, options = {}) => {
      seen.push({
        kind,
        page: Number(options.page) || 1,
        type: options.type || "",
        difficulty: options.difficulty || "",
        tags: options.tags || [],
        content: !!options.content,
        keyword: options.keyword || "",
      });
      return { kind, page: Number(options.page) || 1, perPage: 50, total: 0, items: [] };
    };
    try {
      const shell = ctx.win.webContents;
      const first = await shell.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const $ = (s) => document.querySelector(s);
        const $$ = (s) => [...document.querySelectorAll(s)];
        const result = {
          types: $$(".lib-type").map((b) => b.textContent.trim()),
          typeActive: $(".lib-type.on") ? $(".lib-type.on").textContent.trim() : "",
          captions: $$(".lib-filter-caption").map((e) => e.textContent.trim()),
        };
        $('.lib-type[data-type="CF"]').click();
        await sleep(220);
        result.typeAfter = $(".lib-type.on") ? $(".lib-type.on").textContent.trim() : "";
        $(".lib-diff-btn").click();
        await sleep(120);
        result.diff = {
          open: !$(".lib-diff-menu").hidden,
          levels: $$(".lib-diff-item").map((b) => b.textContent.trim()),
        };
        const level = (n) => $('.lib-diff-item[data-level="' + n + '"]');
        level(3).click();
        await sleep(160);
        level(5).click();
        await sleep(160);
        result.range = {
          text: $(".lib-diff-btn-text").textContent,
          checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
        };
        level(4).click();
        await sleep(160);
        result.inside = {
          text: $(".lib-diff-btn-text").textContent,
          checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
        };
        return result;
      })()`);
      const diffShot = await shot("lib-difficulty");
      const second = await shell.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const $ = (s) => document.querySelector(s);
        const $$ = (s) => [...document.querySelectorAll(s)];
        const level = (n) => $('.lib-diff-item[data-level="' + n + '"]');
        level(0).click();
        await sleep(180);
        const cleared = {
          text: $(".lib-diff-btn-text").textContent,
          checked: $$(".lib-diff-item.on").map((b) => b.dataset.level),
          menuOpen: !$(".lib-diff-menu").hidden,
        };
        $(".lib-toggle").click();
        await sleep(160);
        const contentOn = $(".lib-toggle").getAttribute("aria-pressed") === "true";
        $(".lib-toggle").click();
        await sleep(160);
        $(".lib-tag-btn").click();
        await sleep(240);
        const modal = {
          open: !$(".lib-modal").hidden,
          title: (document.querySelector(".lib-modal-title") || {}).textContent || "",
          placeholder: (document.querySelector(".lib-modal-search input") || {}).placeholder || "",
          tabs: $$(".lib-tag-tab").map((b) => b.textContent.trim()),
          chips: $$(".lib-tag-chip").length,
        };
        const chips = $$(".lib-tag-chip");
        if (chips[0]) chips[0].click();
        await sleep(90);
        if (chips[1]) chips[1].click();
        await sleep(90);
        return {
          cleared,
          contentOn,
          modal: Object.assign(modal, {
            pickedTitle: (document.querySelector(".lib-tag-selected-title") || {}).textContent || "",
            picked: $$(".lib-tag-selected-list .lib-sel-chip").length,
          }),
        };
      })()`);
      const tagShot = await shot("lib-tags");
      const third = await shell.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const $ = (s) => document.querySelector(s);
        const confirm = $(".lib-modal-btn.primary");
        if (confirm) confirm.click();
        await sleep(260);
        const applied = {
          badge: (document.querySelector(".lib-tag-count") || {}).textContent || "",
          row: (document.querySelector(".lib-selected") || {}).textContent || "",
        };
        const clear = $(".lib-clear-filters");
        if (clear) clear.click();
        await sleep(240);
        const cleared = {
          badge: (document.querySelector(".lib-tag-count") || {}).textContent || "",
          rowHidden: !!document.querySelector(".lib-selected") && document.querySelector(".lib-selected").hidden,
        };
        const luogu = $('.lib-type[data-type="luogu"]');
        if (luogu) luogu.click();
        await sleep(200);
        return { applied, cleared };
      })()`);
      const checks = [
        ["题库类型标签", first.types.join(",") === "洛谷,主题库,入门与面试,Codeforces,SPOJ,AtCoder,UVa"],
        ["分区标题", first.captions.includes("所属题库") && first.captions.includes("筛选条件")],
        ["切题库", first.typeAfter === "Codeforces"],
        ["难度下拉", first.diff.open && first.diff.levels.length === 9],
        ["难度区间", first.range.text === "普及 ~ 提高" && first.range.checked.join(",") === "3,4,5"],
        ["区间内部收缩", first.inside.text === "普及 ~ 普及+/提高−" && first.inside.checked.join(",") === "3,4"],
        ["清除难度", second.cleared.text === "题目难度范围" && second.cleared.checked.join(",") === "0" && !second.cleared.menuOpen],
        ["搜索题面", second.contentOn],
        [
          "标签弹窗",
          second.modal.open &&
            second.modal.title === "选择标签" &&
            second.modal.placeholder === "搜索全部标签" &&
            second.modal.tabs.join(",") === "算法,来源,时间,区域,特殊题目",
        ],
        ["标签多选", second.modal.pickedTitle === "已选标签（2）" && second.modal.picked === 2],
        ["标签应用", third.applied.badge === "2" && String(third.applied.row).length >= 2],
        ["清除筛选", third.cleared.badge === "" && third.cleared.rowHidden],
        ["题库参数", seen.some((item) => item.type === "CF")],
        ["难度参数", seen.some((item) => item.difficulty === "3|5") && seen.some((item) => item.difficulty === "3|4")],
        ["题面参数", seen.some((item) => item.content)],
        ["标签分组参数", seen.some((item) => item.tags.length === 1 && item.tags[0].length === 2)],
        [
          "末次无筛选",
          (() => {
            const last = seen[seen.length - 1] || {};
            return last.type === "luogu" && !last.difficulty && !last.tags.length && !last.content;
          })(),
        ],
      ];
      const failed = checks.filter(([, pass]) => !pass).map(([name]) => name);
      console.log(
        "SMOKE_LIB_FILTER " +
          JSON.stringify({
            passed: checks.length - failed.length,
            failed,
            first,
            second,
            third,
            seen,
            diffShot,
            tagShot,
          })
      );
      if (failed.length) console.log("SMOKE_FAIL 题库筛选: " + failed.join(","));
    } finally {
      ctx.luogu.fetchLibrary = originalLibrary;
      ctx.luogu.fetchTags = originalTags;
    }
    if (process.env.LG_SMOKE_NET === "1") {
      try {
        const catalog = await ctx.luogu.fetchTags();
        const algorithm = (catalog.tags || []).find((tag) => Number(tag.type) === 2 && Number(tag.id) > 0);
        if (!algorithm) throw new Error("标签目录没有算法标签");
        const real = await ctx.luogu.fetchLibrary("problems", {
          page: 1,
          type: "P",
          difficulty: "3|5",
          tags: [[Number(algorithm.id)]],
          content: true,
          force: true,
        });
        const okReal = !real.error && Array.isArray(real.items) && real.items.length > 0 && real.total > 0;
        console.log(
          "SMOKE_LIB_FILTER_NET " +
            JSON.stringify({
              tag: algorithm.name,
              tagId: algorithm.id,
              total: real.total,
              items: (real.items || []).length,
              first: ((real.items || [])[0] || {}).pid || "",
              itemTags: ((real.items || [])[0] || {}).tags || [],
              error: real.error || "",
              cacheKeys: [...ctx.luogu.libCache.keys()].filter((key) => key.includes("t:P|")),
            })
        );
        if (!okReal) console.log("SMOKE_FAIL 真实筛选请求没有结果");
      } catch (err) {
        console.log("SMOKE_FAIL 真实筛选请求: " + (err && err.message ? err.message : String(err)));
      }
    }
  }
}

module.exports = { runLibFilterProbe };
