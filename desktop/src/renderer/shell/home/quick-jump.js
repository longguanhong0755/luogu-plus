/* 问题跳转卡：题号直达与随机跳题（与标题栏共用同一个随机面板）。 */
import { el } from "./utils.js";

export function buildQuickJump(actions) {
  const card = el("article", "lg-article lg-index-stat jump-card home-jump-card");
  card.appendChild(el("h2", "", "问题跳转"));
  const group = el("div", "home-jump-input");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "home-jump-field";
  input.placeholder = "例：P1001，可跳至A+B";
  input.setAttribute("aria-label", "输入题号");
  input.autocomplete = "off";
  input.spellcheck = false;
  group.appendChild(input);

  const actionsRow = el("p", "jump-actions");
  const go = el("button", "am-btn danger home-jump-go", "跳转");
  go.type = "button";
  const random = el("button", "am-btn primary home-jump-random", "随机跳题");
  random.type = "button";
  const submit = () => {
    const pid = input.value.trim();
    if (!pid) {
      input.focus();
      return;
    }
    actions.openProblem(pid);
    input.value = "";
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  // 与标题栏「搜索题号」共用同一个随机面板，避免首页和面板出现两套
  // 不同的难度/题库条件与限流反馈。
  random.addEventListener("click", () => actions.openRandomJump());
  actionsRow.append(go, random);
  card.append(group, actionsRow);
  return card;
}
