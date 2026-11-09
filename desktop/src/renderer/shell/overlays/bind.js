/* 事件绑定：面板输入、全局按键、遮罩点击与功能开关注入。 */
import { dom, store } from "./context.js";
import { choose, chooseSwitcher, close } from "./session.js";
import { runQuery, updatePaletteSelection } from "./palette.js";
import { updateSwitcherSelection } from "./switcher.js";
import { normalizeProblemInput, runRandomProblem } from "./jump.js";
import { submitUserSearch } from "./user.js";

export function bind() {
  dom.input.addEventListener("input", () => {
    if (store.mode === "jump") {
      dom.input.removeAttribute("aria-invalid");
      return;
    }
    store.selected = 0;
    runQuery(dom.input.value);
  });

  dom.input.addEventListener("keydown", (event) => {
    if (store.mode === "jump" && event.key === "Enter") {
      event.preventDefault();
      const pid = normalizeProblemInput(dom.input.value);
      if (!pid) {
        dom.input.setAttribute("aria-invalid", "true");
        dom.input.select();
        return;
      }
      close();
      store.actions.openProblem(pid);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (store.rows.length) {
        store.selected = (store.selected + 1) % store.rows.length;
        updatePaletteSelection(true);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (store.rows.length) {
        store.selected = (store.selected - 1 + store.rows.length) % store.rows.length;
        updatePaletteSelection(true);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (store.rows[store.selected]) choose(store.rows[store.selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  dom.jumpRandom.addEventListener("click", runRandomProblem);
  dom.jumpTrueRandom.addEventListener("click", () => {
    close();
    store.actions.openUrl("https://www.luogu.com.cn/problem/random", "随机跳题");
  });
  dom.userForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitUserSearch();
  });
  dom.userList.addEventListener("keydown", (event) => {
    const nodes = [...dom.userList.querySelectorAll(".user-search-row")];
    if (!nodes.length) return;
    const index = nodes.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % nodes.length;
    else if (event.key === "ArrowUp") next = index < 0 ? nodes.length - 1 : (index - 1 + nodes.length) % nodes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    if (next < 0) return;
    event.preventDefault();
    nodes[next].focus({ preventScroll: false });
  });

  document.addEventListener("keydown", (event) => {
    if (dom.overlay.hidden) return;
    if (event.key === "Tab") {
      event.preventDefault();
      if (store.mode === "palette" || store.mode === "jump") dom.input.focus();
      else if (store.mode === "user") dom.userInput.focus();
      else dom.switcher.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (store.mode !== "switcher") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (store.swRows.length) {
        store.swSelected = (store.swSelected + 1) % store.swRows.length;
        updateSwitcherSelection(true);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (store.swRows.length) {
        store.swSelected = (store.swSelected - 1 + store.swRows.length) % store.swRows.length;
        updateSwitcherSelection(true);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (store.swRows[store.swSelected]) chooseSwitcher(store.swRows[store.swSelected]);
    }
  });

  dom.scrim.addEventListener("click", close);
}

export function setFeatures(next) {
  store.featureState = next && typeof next === "object" ? next : {};
}
