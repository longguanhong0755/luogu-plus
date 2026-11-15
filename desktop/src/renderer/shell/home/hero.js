/* 主页顶部：Luogu Plus 欢迎卡 + 官方运势面板（官方首页第一行 8/4 栅格）。 */
import { buildFortunePanel } from "./fortune.js";
import { el } from "./utils.js";

const ACTION_ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15.2 15.2 21 21"/>',
  book: '<path d="M4 5.5h5.5A2.5 2.5 0 0 1 12 8v11a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-5.5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h6z"/>',
  discuss: '<path d="M4.5 5.5h15A1.5 1.5 0 0 1 21 7v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 3.2V7a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 10h8M8 13h5"/>',
};

function welcomeButton(label, tone, iconName, onClick) {
  const button = el("button", "wc-btn wc-btn-" + tone);
  button.type = "button";
  const glyph = el("span", "wc-btn-icon");
  glyph.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ACTION_ICONS[iconName] + "</svg>";
  button.append(glyph, document.createTextNode(label));
  button.addEventListener("click", onClick);
  return button;
}

function buildWelcome(user, actions) {
  const section = el("section", "welcome-card");
  const head = el("div", "wc-head");
  const avatarBox = el("div", "wc-avatar-box");
  if (user.loggedIn && user.avatar) {
    const image = el("img", "wc-avatar");
    image.alt = String(user.name || "洛谷用户") + " 的头像";
    image.src = String(user.avatar);
    image.addEventListener("error", () => {
      const fallback = el("span", "wc-avatar wc-avatar-guest", "洛");
      fallback.setAttribute("aria-hidden", "true");
      if (image.parentNode) image.parentNode.replaceChild(fallback, image);
    });
    avatarBox.appendChild(image);
  } else {
    const fallback = el("span", "wc-avatar wc-avatar-guest", "洛");
    fallback.setAttribute("aria-hidden", "true");
    avatarBox.appendChild(fallback);
  }

  const content = el("div", "wc-content");
  const heading = el("h2");
  const name = el("a", "wc-name " + (user.loggedIn ? "lg-fg-red" : "lg-fg-gray"), String(user.loggedIn ? user.name || "洛谷用户" : "同学"));
  name.href = "#";
  name.addEventListener("click", (event) => {
    event.preventDefault();
    if (user.loggedIn) {
      if (user.uid) actions.openUser(user.uid);
    } else {
      actions.login();
    }
  });
  heading.append(document.createTextNode("你好，"), name, document.createTextNode("！"));
  content.appendChild(heading);
  content.appendChild(el("p", "", user.loggedIn ? "洛谷 UID " + (user.uid || "—") : "登录后，这里会显示你的专属主页。"));
  head.append(avatarBox, content);

  const actionRow = el("div", "wc-actions");
  actionRow.append(
    welcomeButton("今日推荐", "blue", "search", () => actions.openRandomJump()),
    welcomeButton("算法笔记", "green", "book", () => actions.openDetail({ url: "https://www.luogu.com.cn/article/list", title: "算法笔记" })),
    welcomeButton("社区讨论", "orange", "discuss", () => actions.nav("discuss"))
  );
  section.append(head, actionRow);
  return section;
}

export function buildHero(state, actions, options) {
  const user = state.user || {};
  const opts = options || {};
  const card = el("article", "lg-article top-card home-top-card");
  const grid = el("div", "home-hero-grid");
  const main = el("div", "home-hero-main");
  main.appendChild(buildWelcome(user, actions));
  grid.appendChild(main);
  if (opts.showFortune !== false) {
    const side = el("div", "home-hero-side");
    side.appendChild(buildFortunePanel(state, actions));
    grid.appendChild(side);
  } else {
    grid.classList.add("single");
  }
  card.appendChild(grid);
  return card;
}
