/* 渲染层致命错误的全屏错误卡。
   此前四处错误路径直接 `document.body.textContent = "…"` —— 壁纸/主题全没了，
   用户只能看到一行裸文本，连重启都得自己想办法。现在给主题化卡片 + 重试按钮。 */
export function fatal(title, detail) {
  const body = document.body;
  body.textContent = "";
  body.className = "";
  const box = document.createElement("div");
  box.className = "fatal";
  const card = document.createElement("div");
  card.className = "fatal-card";
  const h = document.createElement("div");
  h.className = "fatal-title";
  h.textContent = title;
  card.appendChild(h);
  if (detail) {
    const p = document.createElement("div");
    p.className = "fatal-detail";
    p.textContent = String(detail);
    card.appendChild(p);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "重试";
  btn.addEventListener("click", () => location.reload());
  card.appendChild(btn);
  box.appendChild(card);
  body.appendChild(box);
}
