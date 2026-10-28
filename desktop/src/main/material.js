/* 透明度分级：配置 → 内容面/纱层/外壳的不透明度。
   纯函数，不依赖 Electron，check.js 可以直接 require 做数值断言。

   语义（0.7.0 起）：
   - material：材质强度，控制基线透明度与模糊半径；
   - glass   ：壁纸透出程度，0-70 在基线上继续压低，70-100 把剩余底色
               线性压到 0。因此 glass=100 时内容面、页面纱层、外壳都是
               真正的 0%，壁纸完整透出；
   - 浮层（菜单/下拉/tooltip）单独保留 60% 可读下限，不跟着归零；
   - 性能模式只影响模糊与外壳基线，不再把 glass=100 顶回去。 */

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

  if (perf) panelBase = Math.min(98, panelBase + 8);

  const panelAlpha = tail(panelBase, glass);
  const pageScrim = tail(scrimBase, glass);
  const cardAlpha = tail(cardBase, glass);
  const overlayAlpha = Math.max(60, Math.min(98, cardAlpha + 2));

  return {
    material,
    glass,
    panelAlpha,
    pageScrim,
    cardAlpha,
    overlayAlpha,
    blurPx: perf ? 0 : Math.round((6 + material * 0.24) * 10) / 10,
    performanceMode: perf,
  };
}

module.exports = { levels, tail, clamp };
