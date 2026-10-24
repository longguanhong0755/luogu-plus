/* IDE 面板：单文件编辑器 + 提交。草稿只存在内存里（应用重启不恢复）。
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

  submit.addEventListener("click", async () => {
    if (!actions.canSubmit()) {
      result.textContent = "请先登录洛谷。";
      return;
    }
    submit.disabled = true;
    result.textContent = "正在提交…";
    try {
      const res = await actions.submit(code.value, lang.value);
      if (res && res.ok) result.textContent = "已提交，记录号 " + (res.rid || "—");
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
