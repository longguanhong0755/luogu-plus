/* 通用/通知分区与账号信息回填。 */
import { $ } from "./utils.js";

export function applyGeneral(state) {
  const closeRadio = document.querySelector(`input[name="close"][value="${state.general.closeAction}"]`);
  if (closeRadio) closeRadio.checked = true;
  $("autolaunch").checked = !!state.general.autoLaunch;
  $("perf-mode").checked = !!state.general.performanceMode;
  $("disclaimer-accepted").checked = !!state.general.disclaimerAccepted;
  $("shortcut-problems").value = state.general.shortcutOpenProblems || "Alt+L";
  document.body.classList.toggle("perf", !!state.general.performanceMode);
  $("notify-judge").checked = !!state.notify.judge;
  $("notify-contest").checked = !!state.notify.contest;
  $("notify-lead").value = String(state.notify.contestLeadMin || 10);
}

export function applyAccount(state) {
  const name = $("account-name");
  const uid = $("account-uid");
  const avatar = $("account-avatar");
  if (state.user && state.user.loggedIn) {
    name.textContent = state.user.name || "已登录";
    uid.textContent = state.user.uid ? "UID " + state.user.uid : "";
    const url = state.user.avatar ? String(state.user.avatar) : "";
    avatar.textContent = "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = state.user.name || "头像";
      avatar.appendChild(img);
    } else {
      avatar.textContent = (state.user.name || "洛").slice(0, 1);
    }
  } else {
    name.textContent = "未登录";
    uid.textContent = "登录后可查看提交记录与签到";
    avatar.textContent = "洛";
  }
  $("btn-logout").disabled = !(state.user && state.user.loggedIn);
}
