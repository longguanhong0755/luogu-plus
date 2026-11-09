/* 洛谷数据服务 · 官方主页老版 DOM 抓取（拆分自 src/main/luogu.js）。 */
const officialMethods = {
  /* 0.7.2 官方主页融合：只抓结构化倒计时与可识别的运势片段。
     昵称统一使用登录资料；无法识别的打卡容器文本必须丢弃，禁止整块文本回填。 */
  async fetchOfficialHome() {
    const data = await this.exec(`(() => {
      const root = document.querySelector("#app-old .lg-index-content") || document.querySelector("#app-old");
      if (!root) return { ok: false };
      const text = (el) => ((el && el.textContent) || "").replace(/\\s+/g, " ").trim();
      const absolute = (href) => {
        try { return new URL(href, location.origin).href; } catch { return ""; }
      };
      const articles = Array.from(root.querySelectorAll(".lg-article"));
      const headingOf = (article) => text(article && article.querySelector("h2, h3, .panel-title"));
      const findSection = (wanted) => articles.find((article) => headingOf(article) === wanted) || null;
      const uniqueLinks = (node, limit = 40, pattern = "") => {
        if (!node) return [];
        const re = pattern ? new RegExp(pattern) : null;
        return Array.from(node.querySelectorAll("a[href]"))
          .map((a) => ({ title: text(a).slice(0, 120), url: absolute(a.getAttribute("href")) }))
          .filter((item) => item.title && item.url && (!re || re.test(item.url)))
          .filter((item, index, list) => list.findIndex((x) => x.url === item.url) === index)
          .slice(0, limit);
      };

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
      const contestItems = contestNode
        ? Array.from(contestNode.querySelectorAll("section.am-panel, [class*='contest']"))
            .map((node) => {
              const titleLink = node.querySelector("h3 a[href], h2 a[href], a[href]");
              const title = text(titleLink);
              if (!title) return null;
              return {
                title,
                url: absolute(titleLink.getAttribute("href")),
                badges: Array.from(node.querySelectorAll(".am-badge")).map(text).filter(Boolean).slice(0, 4),
                meta: text(node.querySelector(".am-panel-bd, [class*='body']")).slice(0, 260),
              };
            })
            .filter(Boolean)
            .filter((item, index, list) => list.findIndex((x) => x.url === item.url && x.title === item.title) === index)
            .slice(0, 8)
        : [];

      const tasksFor = (wanted) => {
        const node = findSection(wanted);
        if (!node) return { title: wanted, text: "", items: [] };
        const itemMap = new Map();
        const candidates = Array.from(node.querySelectorAll("li, a[href], button, [role='button'], [class*='task'], [class*='mission'], [class*='todo']"));
        const push = (element) => {
          if (!element || element === node) return;
          const lines = String(element.innerText || "")
            .split("\\n")
            .map((line) => line.replace(/\\s+/g, " ").trim())
            .filter(Boolean)
            .filter((line) => line !== wanted);
          if (!lines.length) return;
          const title = lines[0].slice(0, 180);
          if (!title || title.length < 2) return;
          const all = lines.join(" ");
          const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
          const url = link ? absolute(link.getAttribute("href")) : "";
          const meta = lines.slice(1, 5).join(" · ").slice(0, 260);
          const progressMatch = all.match(/(\\d+\\s*\\/\\s*\\d+|\\d+\\s*%)/);
          const item = {
            title,
            meta,
            url,
            progress: progressMatch ? progressMatch[1].replace(/\\s+/g, "") : "",
            done: /已完成|已领取|已打卡/.test(all),
          };
          const key = [url, title, meta].join("|");
          if (!itemMap.has(key)) itemMap.set(key, item);
        };
        for (const element of candidates.slice(0, 160)) push(element);
        let items = Array.from(itemMap.values());
        if (!items.length) {
          const lines = String(node.innerText || "")
            .split("\\n")
            .map((line) => line.replace(/\\s+/g, " ").trim())
            .filter(Boolean)
            .filter((line) => line !== wanted);
          items = lines.slice(0, 60).map((line) => ({ title: line.slice(0, 180), meta: "", url: "", progress: "", done: /已完成|已领取|已打卡/.test(line) }));
        }
        return { title: wanted, text: text(node).slice(0, 6000), items: items.slice(0, 60) };
      };
      const taskPlan = tasksFor("任务计划");
      const taskData = taskPlan.items.length ? taskPlan : tasksFor("智能推荐");

      const discussionLinks = uniqueLinks(discussionNode, 12, "/discuss/");
      return {
        ok: true,
        countdowns: countdowns.slice(0, 4),
        fortune,
        punch: {
          punched,
          streak: streakMatch ? Number(streakMatch[1]) : 0,
          text: punchText,
        },
        sections: {
          announcement: { title: "本站公告", text: text(announcementNode).slice(0, 6000), links: uniqueLinks(announcementNode, 40) },
          tasks: taskData,
          links: { title: "友情链接", text: text(linksNode).slice(0, 6000), groups: linkGroups },
          discussions: { title: "最近讨论", items: discussionLinks },
          contests: { title: "近期比赛", items: contestItems },
          quickJump: { title: "问题跳转", text: text(findSection("问题跳转")).slice(0, 500) },
        },
      };
    })()`);
    if (!data || data.ok !== true) return null;
    return data;
  }
};

module.exports = { officialMethods };
