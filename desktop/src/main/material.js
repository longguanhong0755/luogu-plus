/* 透明度分级：配置 → 内容面/纱层/外壳的不透明度。
   纯函数，不依赖 Electron，check.js 可以直接 require 做数值断言。

   语义（0.7.2 同层透出）：
   - material：材质强度；glass：壁纸透出程度，0-70 在基线上继续压低，
     70-100 把剩余底色线性压到 0。glass=100 时 pageScrim/raiseAlpha 真 0，
     壁纸完整透出（0.7.0「100% 壁纸透出」承诺保持）；
   - pageScrim：壁纸之上的主题色纱层（地板），所有正文落在它上面；
   - raiseAlpha：承载面统一浮起档 —— 卡片/筛选 chips/输入框/分页条/分页按钮
     同一深度，同屏只有「地板 + 一档浮起」，随 glass 一同归零
     （0.7.0 的 cardAlpha 高卡面 + 55% 下限被 0.7.2 用户决定取代）；
   - codeAlpha：代码块例外层 = 浮起档 + 55，密集正文保读，下限 55%；
   - cardAlpha：外壳原生卡片可读下限 88%；
   - 浮层（菜单/下拉/tooltip）保留 60% 可读下限，不跟着归零；
   - 性能模式只影响模糊；可读下限始终保留。 */

function clamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/* 70 以下不动；70-100 线性压到 0。默认 45 的观感与旧版一致。 */
function tail(value, glass) {
  if (glass <= 70) return value;
  const k = (glass - 70) / 30;
  return Math.round(value * (1 - k));
}

function levels(appearance, performanceMode) {
  const a = appearance || {};
  const material = clamp(a.material, 0, 100, 55);
  const glass = clamp(a.glass, 0, 100, 45);
  const perf = !!performanceMode;

  let panelBase = clamp(Math.round(94 - material * 0.2 - glass * 0.25), 58, 98);
  const scrimBase = clamp(Math.round(97 - material * 0.06 - glass * 0.42), 50, 99);
  const cardBase = clamp(Math.round(99 - material * 0.08 - glass * 0.32), 55, 99);
  const raiseBase = clamp(Math.round(30 - material * 0.18 - glass * 0.2), 0, 30);

  if (perf) panelBase = Math.min(98, panelBase + 8);

  /* 官方化可读底线：壁纸可以透出，但任何文字承载面都不再归零。
     这修正了旧版 glass=100 时动态高对比壁纸直接压住正文的问题。 */
  const panelAlpha = Math.max(86, tail(panelBase, glass));
  const pageScrim = Math.max(90, tail(scrimBase, glass));
  const cardAlpha = Math.max(88, tail(cardBase, glass));
  const raiseAlpha = Math.max(8, Math.min(24, tail(raiseBase, glass)));
  const codeAlpha = Math.max(68, tail(raiseBase + 55, glass));
  const overlayAlpha = Math.max(94, Math.min(99, cardAlpha + 2));

  return {
    material,
    glass,
    panelAlpha,
    pageScrim,
    cardAlpha,
    raiseAlpha,
    codeAlpha,
    overlayAlpha,
    blurPx: perf ? 0 : Math.round((5 + material * 0.12) * 10) / 10,
    performanceMode: perf,
  };
}
module.exports = { levels, tail, clamp };
