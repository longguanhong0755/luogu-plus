/* 问题跳转卡：题号直达与随机跳题（与标题栏共用同一个随机面板）。 */
import { cardHead, el } from "./utils.js";
export function buildQuickJump(actions) {
  const card = el("section", "quick-jump-card card");
  card.appendChild(cardHead("问题跳转", "search"));
  const form = el("form", "quick-jump-form");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "quick-jump-input";
  input.placeholder = "例：P1001，可跳至 A+B";
  input.setAttribute("aria-label", "输入题号");
  input.autocomplete = "off";
  input.spellcheck = false;
  const go = el("button", "btn btn-primary", "跳转");
  go.type = "submit";
  const random = el("button", "btn btn-secondary", "随机跳题");
  random.type = "button";
  const submit = () => {
    const pid = input.value.trim().replace(/^\s+|\s+$/g, "");
    if (!pid) {
      input.focus();
      return;
    }
    actions.openProblem(pid);
    input.value = "";
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  // 与标题栏「搜索题号」共用同一个随机面板，避免首页和面板出现两套
  // 不同的难度/题库条件与限流反馈。
  random.addEventListener("click", () => actions.openRandomJump());
  form.append(input, go, random);
  card.appendChild(form);
  return card;
}
