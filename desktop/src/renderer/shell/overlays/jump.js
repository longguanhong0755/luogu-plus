/* 题号跳转面板：题号规范化、条件随机跳题与状态提示。 */
import { dom, store } from "./context.js";
import { close, rememberFocus, reveal } from "./session.js";

export function openJump(options = {}) {
  rememberFocus(options);
  store.mode = "jump";
  reveal();
  dom.palette.hidden = false;
  dom.switcher.hidden = true;
  dom.userSearch.hidden = true;
  dom.jumpOptions.hidden = store.featureState.betterSearch === false;
  dom.input.value = "";
  dom.input.placeholder = "输入题号，例如 P1001";
  dom.input.setAttribute("aria-label", "输入题号跳转");
  dom.input.setAttribute("aria-expanded", "false");
  dom.input.removeAttribute("aria-invalid");
  dom.palette.setAttribute("aria-label", "题号跳转");
  dom.palList.hidden = true;
  dom.palList.textContent = "";
  if (dom.palFoot) dom.palFoot.textContent = store.featureState.betterSearch === false
    ? "题号支持 P1001 / 1001 / 13A · ↵ 跳转 · Esc 关闭"
    : "题号支持 P1001 / 1001 / 13A · ↵ 跳转 · 难度/题库随机 · Esc 关闭";
  const randomMode = options && options.random === true;
  if (dom.jumpStatus) {
    dom.jumpStatus.textContent = randomMode
      ? "选择难度与题库，然后点击「按条件随机」"
      : "可输入题号，或按难度与题库随机跳题";
    dom.jumpStatus.classList.remove("bad");
  }
  if (dom.jumpRandom) dom.jumpRandom.disabled = false;
  store.actions.overlay(true);
  if (randomMode && dom.jumpRandom && !dom.jumpOptions.hidden) {
    requestAnimationFrame(() => dom.jumpRandom.focus());
  } else {
    dom.input.focus();
    dom.input.select();
  }
}

export function openRandomJump() {
  openJump({ random: true });
}

export function normalizeProblemInput(raw) {
  let value = String(raw || "").trim().toUpperCase();
  if (/^\d+$/.test(value)) value = "P" + value;
  else if (/^\d{1,4}[A-Z]\d?$/.test(value)) value = "CF" + value;
  return /^(?:AT_?[A-Z0-9_]+|CF\d{1,4}[A-Z]\d?|SP\d{1,5}|UVA\d{1,5}|[PBU]\d{1,6})$/.test(value)
    ? value
    : "";
}

export function setJumpStatus(text, bad) {
  if (!dom.jumpStatus) return;
  dom.jumpStatus.textContent = text;
  dom.jumpStatus.classList.toggle("bad", !!bad);
}

export async function runRandomProblem() {
  if (!dom.jumpRandom || dom.jumpRandom.disabled) return;
  dom.jumpRandom.disabled = true;
  setJumpStatus("正在随机选题…", false);
  try {
    const result = await store.actions.randomProblem({
      difficulty: Number(dom.jumpDifficulty.value),
      source: dom.jumpSource.value,
    });
    if (result && result.ok && result.pid) {
      close();
      store.actions.openProblem(result.pid);
      return;
    }
    const wait = result && result.waitMs ? Math.ceil(result.waitMs / 1000) + " 秒后再试" : "稍后再试";
    const messages = {
      daily: "今日随机次数已达上限",
      interval: "冷却中，请 " + wait,
      offline: "当前离线，无法随机跳题",
      empty: "该条件下暂无题目",
      network: "加载失败，请稍后再试",
    };
    setJumpStatus((result && messages[result.reason]) || "加载失败，请稍后再试", true);
  } catch {
    setJumpStatus("加载失败，请稍后再试", true);
  } finally {
    if (dom.jumpRandom) dom.jumpRandom.disabled = false;
  }
}
