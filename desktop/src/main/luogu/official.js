/* 洛谷数据服务 · 官方主页老版 DOM 抓取（拆分自 src/main/luogu.js）。 */
const officialMethods = {
  /* 官方主页融合：结构化倒计时/运势/比赛/讨论/任务/双联曲线图。
     昵称统一使用登录资料；无法识别的打卡容器文本必须丢弃，禁止整块文本回填。 */
  async fetchOfficialHome() {
    const data = await this.exec(`(async () => {
      const root = document.querySelector("#app-old .lg-index-content") || document.querySelector("#app-old");
      if (!root) return { ok: false };
      const text = (el) => ((el && el.textContent) || "").replace(/\\s+/g, " ").trim();
      const absolute = (href) => {
        try { return new URL(href, location.origin).href; } catch { return ""; }
      };
      const articles = Array.from(root.querySelectorAll(".lg-article"));
      const headingOf = (article) => text(article && article.querySelector("h2, h3, .panel-title"));
      const findSection = (wanted) => articles.find((article) => {
        const heading = headingOf(article);
        return heading === wanted || heading.indexOf(wanted) === 0;
      }) || null;
      const uniqueLinks = (node, limit = 40, pattern = "") => {
        if (!node) return [];
        const re = pattern ? new RegExp(pattern) : null;
        return Array.from(node.querySelectorAll("a[href]"))
          .map((a) => ({ title: text(a).slice(0, 120), url: absolute(a.getAttribute("href")) }))
          .filter((item) => item.title && item.url && (!re || re.test(item.url)))
          .filter((item, index, list) => list.findIndex((x) => x.url === item.url) === index)
          .slice(0, limit);
      };
      const toneOf = (className) => {
        const value = String(className || "");
        if (/lg-bg-red|am-badge-danger/.test(value)) return "red";
        if (/lg-bg-green|am-badge-success/.test(value)) return "green";
        if (/lg-bg-orange/.test(value)) return "orange";
        if (/lg-bg-yellow|am-badge-warning/.test(value)) return "yellow";
        if (/lg-bg-blue|am-badge-primary/.test(value)) return "blue";
        if (/lg-bg-purple/.test(value)) return "purple";
        return "gray";
      };
      const readBadge = (node) => ({ text: text(node).slice(0, 24), tone: toneOf(node.className) });
      const readBadges = (node) => node
        ? Array.from(node.querySelectorAll(".am-badge")).map(readBadge).filter((item) => item.text).slice(0, 6)
        : [];

      const countdowns = [];
      const countdownText = String((root.querySelector(".lg-punch") && root.querySelector(".lg-punch").innerText) || "");
      for (const raw of countdownText.split("\\n")) {
        const line = raw.replace(/\\s+/g, " ").trim();
        const m = line.match(/距\\s*(.+?)\\s*还剩\\s*(-?\\d+)\\s*天/);
        if (m) countdowns.push({ name: m[1].trim(), days: Number(m[2]) });
      }

      const punch = root.querySelector(".lg-punch");
      const punchText = punch ? String(punch.innerText || punch.textContent || "") : "";
      const punchLines = punchText.split("\\n").map((line) => line.replace(/\\s+/g, " ").trim()).filter(Boolean);
      const resultNode = punch && punch.querySelector(".lg-punch-result, [class*='punch-result']");
      const resultText = text(resultNode) || (punchLines.find((line) => /大吉|中吉|小吉|末吉|大凶|凶|吉/.test(line)) || "");
      const fortuneResult = (resultText.match(/(大吉|中吉|小吉|末吉|大凶|凶|吉)/) || [])[1] || "";
      const adviceNodes = punch
        ? Array.from(punch.querySelectorAll(".am-u-sm-6, .lg-punch-advice, [class*='fortune'], [class*='advice']"))
        : [];
      const advice = [];
      for (const node of adviceNodes) {
        const value = text(node);
        if (value && !advice.includes(value)) advice.push(value);
      }
      for (const line of punchLines) {
        if (/^[宜忌]\\s*[:：]/.test(line) && !advice.includes(line)) advice.push(line);
      }
      const part = (prefix) => {
        const row = advice.find((item) => item.startsWith(prefix));
        return row ? row.slice(prefix.length).replace(/^[\\s:：]+/, "").replace(/[§·,，。;；\\s]+$/g, "").slice(0, 36) : "";
      };
      const fortuneGood = part("宜");
      const fortuneBad = part("忌");
      const punched = /已打卡|已签到|今日已/.test(punchText);
      const streakMatch = punchText.match(/(\\d+)\\s*天/);
      const fortune = fortuneResult || fortuneGood || fortuneBad
        ? { result: fortuneResult, good: fortuneGood, bad: fortuneBad, advice, text: punchText }
        : null;

      const linksNode = findSection("友情链接");
      const linkGroups = [];
      if (linksNode) {
        for (const p of Array.from(linksNode.querySelectorAll("p"))) {
          const strong = p.querySelector("strong");
          const links = uniqueLinks(p, 20);
          if (links.length) linkGroups.push({ title: text(strong) || "相关链接", links });
        }
        if (!linkGroups.length) linkGroups.push({ title: "相关链接", links: uniqueLinks(linksNode, 40) });
      }

      const announcementNode = findSection("本站公告");
      const discussionNode = findSection("最近讨论");
      const contestNode = findSection("近期比赛");

      const contests = contestNode
        ? Array.from(contestNode.querySelectorAll("section.am-panel"))
            .map((node) => {
              const titleLink = node.querySelector(".am-panel-hd a[href], h3 a[href], h2 a[href]");
              const title = text(titleLink);
              if (!title) return null;
              const panelClass = String(node.className || "");
              const tone = /am-panel-success/.test(panelClass)
                ? "success"
                : /am-panel-danger/.test(panelClass)
                  ? "danger"
                  : "primary";
              const body = node.querySelector(".am-panel-bd");
              const cols = body ? Array.from(body.children).filter((child) => child.tagName === "SPAN") : [];
              const statusNode = body && body.querySelector("strong");
              const statusText = text(statusNode);
              const statusTone = /lg-fg-green/.test(String((statusNode && statusNode.className) || ""))
                ? "success"
                : /lg-fg-gray/.test(String((statusNode && statusNode.className) || ""))
                  ? "danger"
                  : "primary";
              const statusLine = cols[1] ? text(cols[1]) : "";
              const rest = statusText && statusLine.indexOf(statusText) === 0
                ? statusLine.slice(statusText.length)
                : statusLine;
              const remainingMatch = rest.match(/(剩[^\\s]+|\\d[^\\s]*后)/);
              const teamLink = body && body.querySelector("a.colored, a[href*='team/show']");
              const timeCol = cols.length > 2 ? cols[cols.length - 1] : null;
              const timeLines = timeCol && timeCol.innerText
                ? String(timeCol.innerText).split("\\n").map((line) => line.trim()).filter(Boolean)
                : (text(timeCol) ? [text(timeCol)] : []);
              return {
                title: title.slice(0, 120),
                url: absolute(titleLink.getAttribute("href")),
                tone,
                rated: readBadges(node.querySelector(".am-panel-hd")),
                badges: cols[0]
                  ? readBadges(cols[0])
                  : readBadges(node),
                statusText: statusText.slice(0, 20),
                statusTone,
                remaining: remainingMatch ? remainingMatch[1].replace(/\\s+/g, "") : "",
                team: text(teamLink).slice(0, 40),
                teamUrl: teamLink ? absolute(teamLink.getAttribute("href")) : "",
                start: String(timeLines[0] || "").slice(0, 20),
                end: String(timeLines[1] || "").slice(0, 20),
              };
            })
            .filter(Boolean)
            .filter((item, index, list) => list.findIndex((x) => x.url === item.url && x.title === item.title) === index)
            .slice(0, 8)
        : [];

      const discussions = discussionNode
        ? Array.from(discussionNode.querySelectorAll("section.am-panel"))
            .map((node) => {
              const anchors = Array.from(node.querySelectorAll("a[href]"));
              const titleLink = anchors
                .filter((a) => /\\/discuss\\//.test(a.getAttribute("href") || "") && text(a))
                .sort((a, b) => text(b).length - text(a).length)[0];
              const title = text(titleLink);
              if (!title) return null;
              const avatar = node.querySelector("img[src]");
              const authorLink = anchors.find((a) => {
                const href = a.getAttribute("href") || "";
                return /\\/user\\//.test(href) && text(a) && !a.querySelector("img");
              });
              const forumLink = anchors.find((a) => {
                const href = a.getAttribute("href") || "";
                return a !== titleLink && a !== authorLink && text(a) && !a.querySelector("svg") && !/\\/user\\//.test(href);
              });
              const metaText = text(node.querySelector(".am-panel-bd, .lg-small"));
              const dateMatch = metaText.match(/@\\s*(\\d{2}-\\d{2}\\s+\\d{2}:\\d{2})/);
              const replyMatch = metaText.match(/(\\d+)\\s*回复/);
              return {
                title: title.slice(0, 120),
                url: absolute(titleLink.getAttribute("href")),
                avatar: avatar ? absolute(avatar.getAttribute("src")) : "",
                author: text(authorLink).slice(0, 40),
                authorUrl: authorLink ? absolute(authorLink.getAttribute("href")) : "",
                forum: text(forumLink).slice(0, 60),
                forumUrl: forumLink ? absolute(forumLink.getAttribute("href")) : "",
                date: dateMatch ? dateMatch[1] : "",
                replies: replyMatch ? Number(replyMatch[1]) : 0,
                badges: readBadges(node),
              };
            })
            .filter(Boolean)
            .filter((item, index, list) => list.findIndex((x) => x.url === item.url && x.title === item.title) === index)
            .slice(0, 20)
        : [];

      const taskNode = findSection("任务计划");
      const taskItems = taskNode
        ? Array.from(taskNode.querySelectorAll(".tasklist-item")).map((node) => {
            const pid = String(node.getAttribute("data-pid") || "").trim();
            const link = node.querySelector("a[href*='/problem/']") || node.querySelector("a.colored[href]");
            const title = text(link);
            if (!pid && !title) return null;
            const state = node.querySelector("strong");
            const stateClass = String((state && state.className) || "");
            const done = /lg-fg-green/.test(stateClass) || !!node.querySelector(".am-icon-check");
            return { pid, title: title.slice(0, 160), url: link ? absolute(link.getAttribute("href")) : "", done };
          }).filter(Boolean).slice(0, 40)
        : [];
      const taskText = taskNode ? String(taskNode.innerText || "") : "";
      const recommendIndex = taskText.indexOf("智能推荐");
      const recommendText = recommendIndex >= 0 ? taskText.slice(recommendIndex + "智能推荐".length) : "";
      const recommend = recommendIndex >= 0
        ? {
            empty: /暂无推荐/.test(recommendText),
            note: (recommendText.match(/洛谷根据[^\\n]*/) || [""])[0].trim().slice(0, 160),
            text: recommendText.replace(/\\s+/g, " ").trim().slice(0, 400),
          }
        : null;

      const taskPlan = { title: "任务计划", text: taskText.replace(/\\s+/g, " ").trim().slice(0, 6000), items: taskItems, recommend };

      /* 官方双联曲线图：Highcharts 实例就挂在主页，DOM 里取不到数据。
         隐藏数据窗的视口只有 520×400，图表渲染比正文晚，最多轮询 4 秒。 */
      const readCharts = async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const live = window.Highcharts && Array.isArray(window.Highcharts.charts)
            ? window.Highcharts.charts.filter((chart) => chart && chart.xAxis && chart.xAxis[0] && Array.isArray(chart.xAxis[0].categories) && chart.xAxis[0].categories.length && chart.series && chart.series.length)
            : [];
          if (live.length) {
            return live.map((chart, index) => ({
              index,
              categories: chart.xAxis[0].categories.map(String),
              axes: (chart.yAxis || []).map((axis) => ({ min: Number(axis.min), max: Number(axis.max) })),
              series: chart.series.map((series) => ({
                name: String(series.name || ""),
                type: String(series.type || ""),
                yAxis: Number((series.options && series.options.yAxis) || 0),
                data: (series.options && Array.isArray(series.options.data) ? series.options.data : []).map((value) => {
                  const num = typeof value === "object" && value !== null ? value.y : value;
                  return num === null || num === undefined || !Number.isFinite(Number(num)) ? null : Number(num);
                }),
              })),
            }));
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return [];
      };
      const charts = await readCharts();

      return {
        ok: true,
        countdowns: countdowns.slice(0, 4),
        fortune,
        punch: {
          punched,
          streak: streakMatch ? Number(streakMatch[1]) : 0,
          text: punchText,
        },
        charts,
        sections: {
          announcement: { title: "本站公告", text: text(announcementNode).slice(0, 6000), links: uniqueLinks(announcementNode, 40) },
          tasks: taskPlan,
          links: { title: "友情链接", text: text(linksNode).slice(0, 6000), groups: linkGroups },
          discussions: { title: "最近讨论", items: discussions },
          contests: { title: "近期比赛", items: contests },
          quickJump: { title: "问题跳转", text: text(findSection("问题跳转")).slice(0, 500) },
        },
      };
    })()`);
    if (!data || data.ok !== true) return null;
    return data;
  }
};

module.exports = { officialMethods };
