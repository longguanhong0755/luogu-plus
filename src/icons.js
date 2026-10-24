/* ============================================================
   LuoguLab — 图标唯一来源（R41 收口）
   此前 chrome.js / home.js / settings.js 各养一份"同一份线稿"
   （注释都这么写，实际是三套不同路径）：外壳/坞画一套、首页快捷入口
   画一套、设置页坞编辑器预览又是一套。现在路径只有这一份，四个页面
   （chrome / home / settings / history）用 <script src="../icons.js">
   引入同一份；注入层（inject.js）拿不到 window.LGIcons，需要的内联
   SVG 直接复制这里的 path 并注明出处。
   svg() 产出裸 <svg viewBox="0 0 24 24">：描边样式由各层 CSS 管
   （settings 页历史上有内联 stroke 属性，svgIcon 包装保留它）。
   ============================================================ */
(function () {
  const PATHS = {
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
    page: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="0.6"/><circle cx="4" cy="12" r="0.6"/><circle cx="4" cy="18" r="0.6"/>',
    book: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2.4-2.4A8 8 0 1 1 21 12z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    /* 设置：三档滑杆（旧齿轮画成了太阳，废弃） */
    sliders: '<path d="M3 7h9M19 7h2M3 12h3M13 12h8M3 17h11M19.3 17H21"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="9.5" cy="12" r="2.5"/><circle cx="16.5" cy="17" r="2.5"/>',
    moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4 6.8 6.8 0 1 0 20 13.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.5 1.5M18 18l1.5 1.5M4.5 19.5 6 18M18 6l1.5-1.5"/>',
    mute: '<path d="M4 9v6h3l4 3.5V5.5L7 9z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
    winMin: '<path d="M4 12h16"/>',
    winMax: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    winRestore: '<rect x="4" y="8" width="11" height="11" rx="1.5"/><path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16"/>',
    winClose: '<path d="m6 6 12 12M18 6 6 18"/>',
    star: '<path d="m12 4 2.35 4.9 5.4.72-3.95 3.78.98 5.35L12 16.2l-4.78 2.55.98-5.35L4.25 9.62l5.4-.72z"/>',
    starOn: '<path d="m12 4 2.35 4.9 5.4.72-3.95 3.78.98 5.35L12 16.2l-4.78 2.55.98-5.35L4.25 9.62l5.4-.72z" fill="currentColor"/>',
    download: '<path d="M12 3v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
    camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="m8 7 1.5-3h5L16 7"/><circle cx="12" cy="13" r="3.5"/>',
    /* 钉子（侧栏"钉住"开关）：钉住 = 竖直 + 实心钉帽；未钉住 = 斜 40°（松着）。
       用户要求：显示状态的那颗图标画成钉子，折叠窄条上不出现（只留向下三角）。 */
    nailOn: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" fill="currentColor"/><path d="M12 15v6"/>',
    nailOff: '<g transform="rotate(40 12 11.5)"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/></g>',
    sleep: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    tabMore: '<path d="m6 9 6 6 6-6"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/>',
    chevronR: '<path d="m9 6 6 6-6 6"/>',
    organize: '<path d="M4 6h16M4 12h10M4 18h7"/>',
    searchTab: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
    historyClock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    article: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h6M9 16h6"/>',
    split: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
    splitOff: '<path d="M4 5h16v14H4z"/><path d="m8 8 8 8M16 8l-8 8"/>',
    /* 垂直/水平标签栏切换（Edge 左上角那颗）：
       面板 + 左缘分隔线，箭头朝外=打开垂直栏，朝内=收起垂直栏。 */
    railOpen: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m6 9-2 3 2 3"/>',
    railClose: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m4 9 2 3-2 3"/>',
    /* 当前站点玻璃开关（地址栏右侧）：水滴 = 已玻璃化，斜杠 = 本站已排除 */
    glassOn: '<path d="M12 3c3.6 4.3 6 7.5 6 10.2A6 6 0 0 1 6 13.2C6 10.5 8.4 7.3 12 3z"/><path d="M9.4 13.4a2.6 2.6 0 0 0 5.2 0"/>',
    glassOff: '<path d="M12 3c3.6 4.3 6 7.5 6 10.2A6 6 0 0 1 6 13.2C6 10.5 8.4 7.3 12 3z"/><path d="m4 4 16 16"/>',
    /* R41 新增：设置页行内"上移/下移"按钮（此前是文本 ↑/↓ 字形） */
    arrowUp: '<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m5.5 12.5 6.5 6.5 6.5-6.5"/>',
  };
  function svg(name, attrs) {
    return '<svg viewBox="0 0 24 24"' + (attrs ? " " + attrs : "") + ">" + (PATHS[name] || PATHS.page) + "</svg>";
  }
  window.LGIcons = { PATHS, svg };
})();
