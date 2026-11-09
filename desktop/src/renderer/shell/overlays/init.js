/* 覆盖层入口：注入 DOM 引用与动作回调，绑定事件后返回外壳使用的 API。 */
import { collectDom, dom, store } from "./context.js";
import { bind, setFeatures } from "./bind.js";
import { close } from "./session.js";
import { openPalette } from "./palette.js";
import { openSwitcher } from "./switcher.js";
import { openJump, openRandomJump } from "./jump.js";
import { openUserSearch } from "./user.js";

export function initOverlays(actions) {
  collectDom();
  store.actions = actions;
  bind();
  return {
    setFeatures,
    openPalette,
    openJump,
    openRandomJump,
    openUserSearch,
    openSwitcher,
    close,
    isOpen: () => !dom.overlay.hidden,
  };
}
