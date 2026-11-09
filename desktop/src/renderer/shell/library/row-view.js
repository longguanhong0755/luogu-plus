/* 单行渲染：题目/题单/比赛/记录/讨论/文章六种行结构。 */
import { catalogTag } from "./catalog.js";
import { contestState, el, fmtDateTime, fmtExact, fmtNum, fmtTime, statusTone } from "./utils.js";
  export function rowFor(ctx, state, item) {
    const row = el("div", "lib-row lib-" + item.type);

    if (item.type === "problem") {
      row.appendChild(el("span", "lib-pid", item.pid));
      const main = el("div", "lib-main lib-problem-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      const dot = el("span", "diff-dot");
      dot.style.background = item.difficultyColor;
      meta.appendChild(dot);
      meta.appendChild(el("span", "", item.difficultyName));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", item.provider || "洛谷"));
      main.appendChild(meta);
      const tagCell = el("span", "lib-tags lib-problem-tags");
      if (state.showTags && Array.isArray(item.tags) && item.tags.length) {
        const named = item.tags
          .map((id) => catalogTag(id))
          .filter((tag) => tag && Number(tag.id) > 0 && (Number(tag.type) === 2 || Number(tag.type) === 5));
        for (const tag of named.slice(0, 3)) {
          const chip = el("span", "lib-tag", tag.name);
          chip.title = tag.name;
          tagCell.appendChild(chip);
        }
        if (named.length > 3) tagCell.appendChild(el("span", "lib-tag more", "+" + (named.length - 3)));
        if (named.length) tagCell.title = named.map((tag) => tag.name).join(" · ");
      }
      row.appendChild(main);
      row.appendChild(tagCell);
      const stats = el("div", "lib-stats");
      const rate = item.submissions ? Math.round((item.accepted / item.submissions) * 100) : 0;
      const counts = `${fmtExact(item.accepted)} / ${fmtExact(item.submissions)}`;
      const strong = el("span", "lib-stat-strong", counts);
      strong.title = `通过 ${fmtExact(item.accepted)} 人，提交 ${fmtExact(item.submissions)} 人`;
      stats.appendChild(strong);
      stats.appendChild(el("span", "lib-stat-weak", `通过率 ${rate}%`));
      row.appendChild(stats);
      return row;
    }

    if (item.type === "training") {
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.provider || "洛谷"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${item.problemCount} 题`));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${fmtNum(item.markCount)} 人收藏`));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", fmtTime(item.createTime)));
      return row;
    }

    if (item.type === "contest") {
      const status = contestState(item);
      const chip = el(
        "span",
        "lib-status " + (status === "live" ? "ok" : status === "upcoming" ? "mid" : "quiet"),
        status === "live" ? "进行中" : status === "upcoming" ? "即将开始" : "已结束"
      );
      row.appendChild(chip);
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.host || "洛谷"));
      if (item.start) {
        meta.appendChild(el("span", "lib-sep", "·"));
        meta.appendChild(el("span", "", fmtDateTime(item.start)));
      }
      main.appendChild(meta);
      row.appendChild(main);
      const tail = el("div", "lib-tail-block");
      tail.appendChild(el("span", "lib-tail-strong", item.problemCount ? item.problemCount + " 题" : "—"));
      tail.appendChild(el("span", "lib-tail-weak", item.rated ? "rated" : "unrated"));
      row.appendChild(tail);
      return row;
    }

    if (item.type === "record") {
      const tone = statusTone(item.status);
      row.appendChild(el("span", "lib-status " + tone, item.statusText || "—"));
      row.appendChild(el("span", "lib-pid", item.pid));
      const main = el("div", "lib-main");
      main.appendChild(el("span", "lib-name", item.title || ""));
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.language || "提交"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", `${item.score} 分`));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", fmtTime(item.time)));
      return row;
    }

    if (item.type === "discuss") {
      const main = el("div", "lib-main");
      const name = el("span", "lib-name");
      if (item.topped) name.appendChild(el("span", "lib-pin", "置顶"));
      name.appendChild(document.createTextNode(item.title));
      main.appendChild(name);
      const meta = el("span", "lib-meta");
      meta.appendChild(el("span", "", item.forum || "讨论"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", item.author || "匿名"));
      meta.appendChild(el("span", "lib-sep", "·"));
      meta.appendChild(el("span", "", fmtTime(item.time)));
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(el("span", "lib-tail", `${fmtNum(item.replyCount)} 回复`));
      return row;
    }

    // article
    const main = el("div", "lib-main");
    main.appendChild(el("span", "lib-name", item.title));
    if (item.excerpt) main.appendChild(el("span", "lib-excerpt", item.excerpt));
    const meta = el("span", "lib-meta");
    meta.appendChild(el("span", "", item.author || "洛谷用户"));
    meta.appendChild(el("span", "lib-sep", "·"));
    meta.appendChild(el("span", "", fmtTime(item.time)));
    main.appendChild(meta);
    row.appendChild(main);
    const stats = el("div", "lib-stats");
    stats.appendChild(el("span", "lib-stat-strong", fmtNum(item.upvote)));
    stats.appendChild(el("span", "lib-stat-weak", "赞"));
    row.appendChild(stats);
    return row;
  }
