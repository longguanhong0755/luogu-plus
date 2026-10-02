/* LuoguLab — 标签悬停卡片渲染
   主进程把内容（标题/网址/图标）与"卡片在窗口里的坐标"发过来，这里只渲染：
   配色变量与假壁纸偏移都照抄外壳下发的那一份（与弹层同一套换算）。 */
const root = document.getElementById("tip-root");
const ICON_PAGE = '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/></svg>';

function show(p) {
  p = p || {};
  const de = document.documentElement;
  if (p.cssText) de.style.cssText = p.cssText;
  de.setAttribute("data-theme", p.theme || "light");
  de.setAttribute("data-glass", p.glass || "flat");
  /* 假壁纸的窗口几何（必须在 cssText 赋值之后）：卡片视图只有 340×54，
     --lg-wall-w/h 的 100vw/100vh 兜底会把壁纸压成一小片，与背后的真壁纸对不上 */
  if (p.winW && p.winH) {
    de.style.setProperty("--lg-wall-w", Math.round(p.winW) + "px");
    de.style.setProperty("--lg-wall-h", Math.round(p.winH) + "px");
  }
  root.classList.add("lg-fake", "lg-face-b");
  /* 假壁纸副本按"卡片在窗口里的坐标"偏移（与弹层 popup.js 同一套公式） */
  root.style.setProperty("--pop-x", Math.round(p.x || 0) + "px");
  root.style.setProperty("--pop-y", Math.round(p.y || 0) + "px");
  const ic = root.querySelector(".tip-ic");
  ic.textContent = "";
  if (p.favicon) {
    const img = document.createElement("img");
    img.src = p.favicon;
    img.onerror = () => { img.remove(); ic.innerHTML = ICON_PAGE; };
    ic.appendChild(img);
  } else {
    ic.innerHTML = ICON_PAGE;
  }
  root.querySelector(".tip-title").textContent = p.title || p.url || "";
  root.querySelector(".tip-url").textContent = p.url || "";
}

window.lgTip.onShow(show);
