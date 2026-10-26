/* IDE 面板：单文件编辑器 + 提交。草稿防抖落盘，重启后自动恢复；
   断网时提交自动进离线队列（联网后由主进程重放，这里只呈现结果）。
   提交走主进程：先尝试接口，失败会复制代码并打开题目页的提交区。 */
const DEFAULT_CODE = `#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`;

/* 与主进程 src/main/langs.js 的 o2 字段保持一致：这些语言支持洛谷的 O2 优化。
   其余语言（Python/Java/Go…）选 O2 无效，开关置灰。 */
const O2_LANGS = new Set([
  "C++14 (GCC 9)",
  "C++14",
  "C++17",
  "C++20",
  "C++23",
  "C++11",
  "C++98",
  "C",
  "Pascal",
  "Rust",
  "Haskell",
  "OCaml",
]);

export function initEditor(actions) {
  const pane = document.getElementById("ide-pane");
  const workspace = document.getElementById("workspace");
  const resizer = document.getElementById("ide-resizer");
  pane.innerHTML = `
    <div class="ide-head">
      <span class="ide-file"><span class="ide-dot"></span>main.cpp</span>
      <select class="ide-lang" aria-label="语言">
        <option>C++14 (GCC 9)</option>
        <option>C++14</option>
        <option>C++17</option>
        <option>C++20</option>
        <option>C++23</option>
        <option>C++11</option>
        <option>C++98</option>
        <option>C</option>
        <option>Python 3</option>
        <option>Pascal</option>
        <option>Java 8</option>
        <option>Java 21</option>
        <option>Rust</option>
        <option>Go</option>
      </select>
      <label class="ide-o2" title="开启洛谷的 O2 优化（仅 C/C++/Pascal/Rust 等语言有效）">
        <input type="checkbox" class="ide-o2-box" />O2
      </label>
    </div>
    <div class="ide-body">
      <div class="ide-gutter" aria-hidden="true"></div>
      <textarea class="ide-code" spellcheck="false" aria-label="代码"></textarea>
    </div>
    <div class="ide-foot">
      <span class="ide-state"><span class="ide-status-dot"></span><span class="ide-result">就绪</span></span>
      <span class="ide-saved"></span>
      <button class="btn-accent" type="button">提交</button>
    </div>
  `;

  const code = pane.querySelector(".ide-code");
  const gutter = pane.querySelector(".ide-gutter");
  const lang = pane.querySelector(".ide-lang");
  const o2 = pane.querySelector(".ide-o2-box");
  const stateEl = pane.querySelector(".ide-state");
  const result = pane.querySelector(".ide-result");
  const saved = pane.querySelector(".ide-saved");
  const submit = pane.querySelector(".btn-accent");

  /* O2 只对支持的语言有效：切到 Python/Java 等自动置灰并取消勾选 */
  function syncO2() {
    const canO2 = O2_LANGS.has(lang.value);
    o2.disabled = !canO2;
    if (!canO2) o2.checked = false;
  }

  code.value = DEFAULT_CODE;
  let draftLoaded = false;
  let split = 0.5;

  function setStatus(tone, text) {
    stateEl.className = "ide-state" + (tone ? " " + tone : "");
    result.textContent = text;
  }

  let savedTimer = null;
  function flashSaved(text) {
    saved.textContent = text;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      saved.textContent = "";
    }, 1800);
  }

  function updateGutter() {
    const lines = code.value.split("\n").length;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
    gutter.scrollTop = code.scrollTop;
  }

  function applySplit(value) {
    split = Math.min(0.7, Math.max(0.35, value));
    workspace.style.setProperty("--ide-split", String(split));
    if (actions.setIdeSplit) actions.setIdeSplit(split);
  }

  /* 草稿：上次写到的代码/语言选择在启动时恢复，输入防抖 800ms 落盘 */
  if (actions.loadDraft) {
    actions
      .loadDraft()
      .then((draft) => {
        if (draft && draft.code) {
          code.value = draft.code;
          if (draft.lang && [...lang.options].some((option) => option.value === draft.lang)) {
            lang.value = draft.lang;
          }
          if (draft.o2 && O2_LANGS.has(lang.value)) o2.checked = true;
          syncO2();
          updateGutter();
          if (draft.savedAt) flashSaved("已恢复上次草稿");
        }
      })
      .catch(() => {})
      .finally(() => {
        draftLoaded = true;
      });
  } else {
    draftLoaded = true;
  }

  let draftTimer = null;
  const saveDraft = () => {
    if (!draftLoaded || !actions.saveDraft) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      actions
        .saveDraft({ code: code.value, lang: lang.value, o2: !o2.disabled && o2.checked })
        .then(() => flashSaved("已保存"))
        .catch(() => {});
    }, 800);
  };

  code.addEventListener("input", () => {
    updateGutter();
    saveDraft();
  });
  code.addEventListener("scroll", () => {
    gutter.scrollTop = code.scrollTop;
  });
  code.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = code.selectionStart;
      const end = code.selectionEnd;
      const pad = "    ";
      code.value = code.value.slice(0, start) + pad + code.value.slice(end);
      code.selectionStart = code.selectionEnd = start + pad.length;
      updateGutter();
      saveDraft();
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      const start = code.selectionStart;
      const lineStart = code.value.lastIndexOf("\n", start - 1) + 1;
      const indent = (code.value.slice(lineStart, start).match(/^\s+/) || [""])[0];
      if (!indent) return;
      event.preventDefault();
      code.value = code.value.slice(0, start) + "\n" + indent + code.value.slice(code.selectionEnd);
      code.selectionStart = code.selectionEnd = start + 1 + indent.length;
      updateGutter();
      saveDraft();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit.click();
    }
  });
  lang.addEventListener("change", () => {
    syncO2();
    saveDraft();
  });
  o2.addEventListener("change", saveDraft);

  function beginDrag(event) {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    document.body.classList.add("resizing");
  }

  let splitRaf = 0;
  let nextSplit = 0.5;
  resizer.addEventListener("pointerdown", beginDrag);
  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.classList.contains("dragging")) return;
    const rect = workspace.getBoundingClientRect();
    if (!rect.width) return;
    nextSplit = 1 - (event.clientX - rect.left) / rect.width;
    if (!splitRaf) {
      splitRaf = requestAnimationFrame(() => {
        splitRaf = 0;
        applySplit(nextSplit);
      });
    }
  });
  const endDrag = () => {
    resizer.classList.remove("dragging");
    document.body.classList.remove("resizing");
  };
  resizer.addEventListener("pointerup", endDrag);
  resizer.addEventListener("pointercancel", endDrag);
  resizer.addEventListener("dblclick", () => applySplit(0.5));
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    applySplit(split + (event.key === "ArrowLeft" ? 0.03 : -0.03));
  });

  submit.addEventListener("click", async () => {
    if (!actions.canSubmit()) {
      setStatus("bad", "请先登录洛谷。");
      return;
    }
    saveDraft();
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
      actions.saveDraft({ code: code.value, lang: lang.value, o2: !o2.disabled && o2.checked }).catch(() => {});
    }
    submit.disabled = true;
    setStatus("", "正在提交…");
    try {
      const res = await actions.submit(code.value, lang.value, !o2.disabled && o2.checked);
      if (res && res.ok) setStatus("ok", "已提交 · 记录号 " + (res.rid || "—"));
      else if (res && res.queued) setStatus("queued", res.message || "已加入离线队列。");
      else setStatus("bad", (res && res.message) || "提交失败");
    } catch (err) {
      setStatus("bad", "提交失败：" + err.message);
    } finally {
      submit.disabled = false;
    }
  });

  updateGutter();
  syncO2();
  applySplit(0.5);

  return {
    show(on) {
      pane.hidden = !on;
      if (resizer) {
        resizer.hidden = !on;
        resizer.setAttribute("tabindex", on ? "0" : "-1");
        resizer.setAttribute("role", "separator");
        resizer.setAttribute("aria-orientation", "vertical");
        resizer.setAttribute("aria-label", "调整编辑器和题目宽度");
      }
      if (on) code.focus();
    },
  };
}
