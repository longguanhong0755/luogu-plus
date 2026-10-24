/* 把主进程解析好的主题落成 CSS 变量。外壳与设置窗共用。 */
export function applyTheme(theme) {
  if (!theme || !theme.colors) return;
  const root = document.documentElement;
  const map = {
    "--bg": theme.colors.bg,
    "--rail": theme.colors.rail,
    "--title": theme.colors.title,
    "--surface": theme.colors.surface,
    "--surface-2": theme.colors.surface2,
    "--editor": theme.colors.editor,
    "--border": theme.colors.border,
    "--text": theme.colors.text,
    "--text-2": theme.colors.text2,
    "--text-3": theme.colors.text3,
    "--accent": theme.colors.accent,
    "--accent-soft": theme.colors.accentSoft,
    "--green": theme.colors.green,
    "--red": theme.colors.red,
    "--orange": theme.colors.orange,
    "--panel-pct": theme.panelPct + "%",
    "--blur": theme.blurPx + "px",
    "--mat": String(theme.material),
  };
  for (const key of Object.keys(map)) root.style.setProperty(key, map[key]);
  root.dataset.theme = theme.isDark ? "dark" : "light";

  const layer = document.getElementById("wallpaper");
  if (layer) {
    const wall = theme.wallpaper || { kind: "builtin", url: "" };
    layer.dataset.kind = wall.kind || "builtin";
    if (wall.url) {
      layer.classList.add("has-image");
      layer.style.backgroundImage = `url("${String(wall.url).replace(/"/g, '\\"')}")`;
    } else {
      layer.classList.remove("has-image");
      layer.style.backgroundImage = "";
    }
  }
}

export function panelStyle() {
  return getComputedStyle(document.documentElement);
}
