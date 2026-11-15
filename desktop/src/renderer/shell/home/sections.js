/* 官方主页板块卡：同步提示、公告、最近讨论、动态发布/空态、任务计划与友情链接。 */
import { icon } from "../icons.js";
import { FALLBACK_LINK_GROUPS } from "./constants.js";
import { cardHead, el } from "./utils.js";

function sectionData(home, name) {
  const sections = home.official && home.official.sections;
  return (sections && sections[name]) || {};
}

function open(actions, url, title) {
  if (url) actions.openDetail({ url, title });
}

export function buildSyncNotice(home, actions) {
  const notice = el("div", "home-sync-note");
  notice.setAttribute("role", "status");
  const glyph = el("span", "home-sync-icon");
  glyph.innerHTML = icon("alert");
  const copy = el("span", "home-sync-copy");
  copy.appendChild(el("strong", "", "部分数据未更新"));
  copy.appendChild(el("span", "", String(home.error || "")));
  const retry = el("button", "btn-quiet", "重试");
  retry.type = "button";
  retry.addEventListener("click", () => actions.refresh());
  notice.append(glyph, copy, retry);
  return notice;
}

export function buildAnnouncement(home, actions) {
  const section = sectionData(home, "announcement");
  const card = el("article", "lg-article notice-card");
  card.appendChild(el("h2", "", "本站公告"));
  const items = Array.isArray(section.links) ? section.links.slice(0, 12) : [];
  if (items.length) {
    for (const item of items) {
      const paragraph = el("p");
      const link = el("a", "", String(item.title || item.url).slice(0, 120));
      link.href = "#";
      link.title = String(item.title || "");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        open(actions, item.url, item.title || "本站公告");
      });
      paragraph.appendChild(link);
      card.appendChild(paragraph);
    }
    return card;
  }
  const text = String(section.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  card.appendChild(el("p", "", text.slice(0, 400)));
  return card;
}

function discussionAvatar(item, name) {
  const box = el("span", "disc-avatar-box");
  if (item.avatar) {
    const image = el("img", "disc-avatar");
    image.alt = "";
    image.loading = "lazy";
    image.src = String(item.avatar);
    image.addEventListener("error", () => {
      const fallback = el("span", "disc-avatar disc-avatar-fallback", String(name || "洛").slice(0, 1));
      if (image.parentNode) image.parentNode.replaceChild(fallback, image);
    });
    box.appendChild(image);
  } else {
    box.appendChild(el("span", "disc-avatar disc-avatar-fallback", String(name || "洛").slice(0, 1)));
  }
  return box;
}

export function buildDiscussions(home, actions) {
  const section = sectionData(home, "discussions");
  const items = Array.isArray(section.items) ? section.items.slice(0, 20) : [];
  const card = el("article", "lg-article discuss-card");
  card.appendChild(el("h2", "", "最近讨论"));
  const flow = el("div", "contest-flow discuss-flow");
  if (!items.length) {
    flow.appendChild(el("p", "home-empty-note", "暂无讨论信息。"));
    card.appendChild(flow);
    return card;
  }
  for (const item of items) {
    const row = el("section", "disc");
    row.appendChild(discussionAvatar(item, item.author));
    const body = el("div", "disc-body");
    const title = el("div", "disc-title");
    const link = el("a", "", String(item.title || "未命名讨论"));
    link.href = "#";
    link.title = String(item.title || "");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      open(actions, item.url, item.title || "讨论");
    });
    title.appendChild(link);
    body.appendChild(title);

    const meta = el("div", "disc-meta");
    const first = el("span", "meta-line");
    if (item.author) {
      const author = el("a", "author", String(item.author));
      author.href = "#";
      author.addEventListener("click", (event) => {
        event.preventDefault();
        const uid = String(item.authorUrl || "").match(/\/user\/(\d+)/);
        if (uid) actions.openUser(uid[1]);
        else open(actions, item.authorUrl, item.author);
      });
      first.appendChild(author);
    }
    if (item.forum) {
      first.append(document.createTextNode(" In "));
      const forum = el("a", "forum", String(item.forum));
      forum.href = "#";
      forum.title = String(item.forum);
      forum.addEventListener("click", (event) => {
        event.preventDefault();
        open(actions, item.forumUrl, item.forum);
      });
      first.appendChild(forum);
    }
    meta.appendChild(first);

    const second = el("span", "meta-line");
    const facts = [item.date ? "@ " + item.date : "", item.replies ? item.replies + "回复" : ""].filter(Boolean).join(" ");
    second.appendChild(document.createTextNode(facts));
    for (const badge of Array.isArray(item.badges) ? item.badges : []) {
      if (!badge || !badge.text) continue;
      second.appendChild(el("span", "badge " + (badge.tone || "gray") + " mini", String(badge.text)));
    }
    meta.appendChild(second);
    body.appendChild(meta);
    row.appendChild(body);
    flow.appendChild(row);
  }
  card.appendChild(flow);
  return card;
}

/* 动态区：发布框 / 我关注的 / 没有更多动态了。桌面版只读，不代用户发帖。 */
export function buildFeed(state, actions, isEnabled) {
  const user = state.user || {};
  if (!user.loggedIn) return [];
  const on = typeof isEnabled === "function" ? isEnabled : () => true;
  const cards = [];
  const compose = on("homeFeedCompose");
  const empty = on("homeFeedEmpty");

  if (compose) {
    const card = el("article", "lg-article feed-compose");
    card.appendChild(el("h2", "", "有什么新鲜事告诉大家"));
    const form = el("div", "feed-form");
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.placeholder = "在洛谷网页版发布动态";
    textarea.setAttribute("aria-label", "动态内容");
    form.appendChild(textarea);
    const submit = el("button", "feed-submit", "　发射犇犇！　");
    submit.type = "button";
    submit.addEventListener("click", () => {
      if (actions.toast) {
        actions.toast({ kind: "info", title: "动态发布请前往洛谷网页版", body: "桌面版不会代你发布任何内容。" });
      }
    });
    card.append(form, submit);
    cards.push(card);
  }

  if (compose || empty) {
    const card = el("article", "lg-article feed-tabs-card");
    const tabs = el("ul", "feed-tabs");
    const follow = el("li", "feed-tab active");
    const followLink = el("a", "", "我关注的");
    followLink.href = "#";
    followLink.addEventListener("click", (event) => event.preventDefault());
    follow.appendChild(followLink);
    const own = el("li", "feed-tab");
    const ownLink = el("a", "", "我发布的");
    ownLink.href = "#";
    ownLink.addEventListener("click", (event) => {
      event.preventDefault();
      follow.classList.remove("active");
      own.classList.add("active");
      if (actions.toast) actions.toast({ kind: "info", title: "动态流请前往洛谷网页版" });
    });
    own.appendChild(ownLink);
    tabs.append(follow, own);
    card.appendChild(tabs);
    cards.push(card);
  }

  if (empty) {
    const card = el("article", "lg-article feed-empty");
    card.appendChild(el("h2", "", "没有更多动态了"));
    card.appendChild(el("p", "", "快去关注一些人，查看他们的动态吧！"));
    cards.push(card);
  }
  return cards;
}

function taskStateIcon(done) {
  const box = el("span", "task-state" + (done ? " done" : ""));
  box.innerHTML = done
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3.2L13 5"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>';
  return box;
}

export function buildTasks(home, actions) {
  const section = sectionData(home, "tasks");
  const items = (Array.isArray(section.items) ? section.items : []).filter((item) => item && (item.pid || item.title));
  const card = el("article", "lg-article task-card");
  const heading = el("h2", "", "任务计划");
  const edit = el("button", "task-edit", "编辑");
  edit.type = "button";
  edit.addEventListener("click", () => {
    if (actions.toast) actions.toast({ kind: "info", title: "任务计划编辑请前往洛谷网页版" });
  });
  heading.appendChild(edit);
  card.appendChild(heading);

  if (!items.length) {
    card.appendChild(el("p", "home-empty-note", "暂无可显示的任务计划。"));
  } else {
    for (const item of items) {
      const pid = String(item.pid || "");
      const full = String(item.title || pid).trim();
      const rest = pid && full.indexOf(pid) === 0 ? full.slice(pid.length).trim() : full;
      const row = el("div", "tasklist-item");
      row.appendChild(taskStateIcon(!!item.done));
      const link = el("a", "task-item-link");
      link.href = "#";
      link.title = full;
      if (pid) link.appendChild(el("b", "", pid));
      if (rest) {
        if (pid) link.append(document.createTextNode(" "));
        link.appendChild(document.createTextNode(rest));
      }
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (pid) actions.openProblem(pid);
        else open(actions, item.url, full);
      });
      row.appendChild(link);
      card.appendChild(row);
    }
  }

  const recommend = section.recommend;
  if (recommend) {
    card.appendChild(el("h2", "recommend-title", "智能推荐"));
    if (recommend.empty) card.appendChild(el("div", "recommend-empty", "暂无推荐"));
    if (recommend.note) {
      const note = el("div", "recommend-note");
      note.appendChild(el("small", "", recommend.note));
      card.appendChild(note);
    }
  }
  return card;
}

export function buildLinks(home, actions) {
  const section = sectionData(home, "links");
  const liveGroups = Array.isArray(section.groups) && section.groups.length;
  const groups = liveGroups ? section.groups : FALLBACK_LINK_GROUPS;
  const card = el("article", "lg-article links-card");
  card.appendChild(el("h2", "", "友情链接"));
  for (const group of groups) {
    const block = el("p");
    block.appendChild(el("strong", "", String(group.title || "相关链接")));
    block.appendChild(document.createElement("br"));
    const links = (Array.isArray(group.links) ? group.links : [])
      .map((raw) => (Array.isArray(raw) ? { title: raw[0], url: raw[1] } : raw || {}))
      .filter((item) => item.title && item.url);
    links.forEach((item, index) => {
      if (index) block.append(document.createTextNode(index === 1 && /推荐题库/.test(String(group.title || "")) ? " | " : ""));
      if (index > 1 && /推荐题库/.test(String(group.title || ""))) block.append(document.createTextNode(" | "));
      const link = el("a", "", String(item.title));
      link.href = "#";
      link.title = String(item.title);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        open(actions, item.url, item.title);
      });
      block.appendChild(link);
      if (index < links.length - 1 && !/推荐题库/.test(String(group.title || ""))) block.appendChild(document.createElement("br"));
    });
    card.appendChild(block);
  }
  return card;
}

export function buildSupport(actions) {
  const card = el("div", "support-card card");
  card.appendChild(cardHead("支持项目", "star"));
  card.appendChild(el("div", "welcome-line sub", "如果这个客户端对你有帮助，可以前往仓库点一个 Star。"));
  const btn = el("button", "sign-btn", "前往项目仓库");
  btn.type = "button";
  btn.addEventListener("click", () => actions.openDetail({ url: "https://github.com/longguanhong0755/luogu-plus", title: "项目仓库" }));
  card.appendChild(btn);
  return card;
}
