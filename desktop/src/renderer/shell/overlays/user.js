/* 用户搜索面板：打开、结果渲染与提交。 */
import { dom, store } from "./context.js";
import { loadingRow } from "./ui.js";
import { close, rememberFocus, reveal } from "./session.js";

export function openUserSearch(options = {}) {
  rememberFocus(options);
  store.mode = "user";
  reveal();
  dom.palette.hidden = true;
  dom.switcher.hidden = true;
  dom.userSearch.hidden = false;
  dom.userInput.value = "";
  dom.userList.textContent = "";
  dom.userList.appendChild(loadingRow("输入用户名或 UID 后搜索", "sw"));
  store.actions.overlay(true);
  dom.userInput.focus();
}

export function renderUserResults(result) {
  dom.userList.textContent = "";
  const users = result && Array.isArray(result.users) ? result.users : [];
  if (!users.length) {
    const text =
      result && result.reason === "interval" ? "操作过于频繁，请稍后再试" :
      result && result.reason === "daily" ? "今日用户搜索次数已达上限" :
      result && result.reason === "offline" ? "当前离线，无法搜索用户" :
      "未搜索到相关内容";
    dom.userList.appendChild(loadingRow(text, "sw"));
    return;
  }
  for (const user of users) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "user-search-row";
    row.setAttribute("role", "option");
    const avatar = document.createElement("span");
    avatar.className = "user-search-avatar";
    avatar.textContent = String(user.name || "洛").slice(0, 1);
    if (/^https?:\/\//i.test(String(user.avatar || ""))) {
      avatar.textContent = "";
      const image = document.createElement("img");
      image.src = user.avatar;
      image.alt = "";
      image.loading = "lazy";
      avatar.appendChild(image);
    }
    const info = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = user.name || "未命名用户";
    const meta = document.createElement("small");
    meta.textContent = "UID " + user.uid + (user.badge ? " · " + user.badge : "") + (user.ccfLevel ? " · CCF " + user.ccfLevel : "");
    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(avatar);
    row.appendChild(info);
    row.addEventListener("click", () => {
      close();
      store.actions.openUser(user.uid);
    });
    dom.userList.appendChild(row);
  }
  const first = dom.userList.querySelector(".user-search-row");
  if (first) first.focus({ preventScroll: true });
}

export async function submitUserSearch() {
  const keyword = dom.userInput.value.trim();
  if (!keyword) {
    renderUserResults({ users: [], reason: "empty" });
    dom.userInput.focus();
    return;
  }
  dom.userList.textContent = "";
  dom.userList.appendChild(loadingRow("正在搜索用户…", "sw"));
  try {
    renderUserResults(await store.actions.searchUsers(keyword));
  } catch {
    renderUserResults({ users: [], reason: "network" });
  }
}
