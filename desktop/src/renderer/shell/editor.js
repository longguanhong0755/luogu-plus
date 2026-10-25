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

export function initEditor(actions) {
  const pane = document.getElementById("ide-pane");
  pane.innerHTML = `
    <div class="ide-head">
      <span class="ide-file">main.cpp</span>
      <select class="ide-lang" aria-label="语言">
        <option>C++14</option>
        <option>C++17</option>
        <option>C++20</option>
        <option>C++11</option>
        <option>C++98</option>
        <option>C</option>
        <option>Python3</option>
        <option>Pascal</option>
      </select>
    </div>
    <textarea class="ide-code" spellcheck="false" aria-label="代码"></textarea>
    <div class="ide-foot">
      <span class="ide-result"></span>
      <button class="btn-accent" type="button">提交</button>
    </div>
  `;

  const code = pane.querySelector(".ide-code");
  const lang = pane.querySelector(".ide-lang");
  const result = pane.querySelector(".ide-result");
  const submit = pane.querySelector(".btn-accent");

  code.value = DEFAULT_CODE;
  let draftLoaded = false;

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
          result.textContent = draft.savedAt ? "已恢复上次草稿。" : "";
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
      actions.saveDraft({ code: code.value, lang: lang.value }).catch(() => {});
    }, 800);
  };
  code.addEventListener("input", saveDraft);
  lang.addEventListener("change", saveDraft);

  submit.addEventListener("click", async () => {
    if (!actions.canSubmit()) {
      result.textContent = "请先登录洛谷。";
      return;
    }
    saveDraft();
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
      actions.saveDraft({ code: code.value, lang: lang.value }).catch(() => {});
    }
    submit.disabled = true;
    result.textContent = "正在提交…";
    try {
      const res = await actions.submit(code.value, lang.value);
      if (res && res.ok) result.textContent = "已提交，记录号 " + (res.rid || "—");
      else if (res && res.queued) result.textContent = res.message || "已加入离线队列。";
      else result.textContent = (res && res.message) || "提交失败";
    } catch (err) {
      result.textContent = "提交失败：" + err.message;
    } finally {
      submit.disabled = false;
    }
  });

  return {
    show(on) {
      pane.hidden = !on;
      if (on) code.focus();
    },
  };
}
