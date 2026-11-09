/* 覆盖层会话：进场/退场、焦点记忆与选中后的动作派发。 */
import { dom, store } from "./context.js";

/* 退场动画期间再次打开：作废收起计时器，直接进场 */
export function reveal() {
  if (store.closeTimer) {
    clearTimeout(store.closeTimer);
    store.closeTimer = null;
  }
  dom.overlay.classList.remove("closing");
  dom.overlay.hidden = false;
}

export function rememberFocus(options = {}) {
  if (!dom.overlay.hidden) return;
  store.lastFocus = document.activeElement;
  store.returnToPage = !!options.fromPage;
}

export function close({ restoreFocus = true } = {}) {
  if (dom.overlay.hidden) return;
  if (store.closeTimer) return;
  store.mode = "";
  const focusTarget = store.lastFocus;
  dom.overlay.classList.add("closing");
  // 页面视图立即恢复，但焦点只由外壳在退场结束后恢复，避免主进程与 DOM 争抢。
  store.actions.overlay(false);
  store.closeTimer = setTimeout(() => {
    store.closeTimer = null;
    dom.overlay.classList.remove("closing");
    dom.overlay.hidden = true;
    dom.palette.hidden = true;
    dom.switcher.hidden = true;
    dom.userSearch.hidden = true;
    if (dom.jumpOptions) dom.jumpOptions.hidden = true;
    dom.input.removeAttribute("aria-invalid");
    if (restoreFocus) {
      if (!store.returnToPage && focusTarget && focusTarget.isConnected && focusTarget !== document.body && typeof focusTarget.focus === "function") {
        focusTarget.focus();
      } else {
        store.actions.focusPage();
      }
    }
    store.lastFocus = null;
    store.returnToPage = false;
  }, 160);
}

export function choose(item) {
  close();
  store.actions.run(item);
}

export function chooseSwitcher(item) {
  close();
  store.actions.switchTo(item.key);
}
