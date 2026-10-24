/* 应用图标集：24×24 线性图标，stroke 跟随 currentColor。 */
const S = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: S('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>'),
  library: S(
    '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h7M8 11h7"/>'
  ),
  training: S(
    '<path d="M2 9.5 12 4l10 5.5L12 15z"/><path d="M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>'
  ),
  contest: S(
    '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5v2a3 3 0 0 0 3 3"/><path d="M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8 20h8"/>'
  ),
  discuss: S('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
  record: S(
    '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>'
  ),
  settings: S(
    '<path d="M4 7h10M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2M10 17h10"/><circle cx="8" cy="17" r="2"/>'
  ),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  back: S('<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>'),
  forward: S('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  refresh: S('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  external: S(
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5H5V6h5"/>'
  ),
  more: S('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  code: S('<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>'),
  upload: S('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>'),
  list: S('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  close: S('<path d="m6 6 12 12M18 6 6 18"/>'),
  check: S('<path d="m4 12.5 5 5L20 6.5"/>'),
  calendarCheck: S(
    '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9 15 2 2 4-4"/>'
  ),
  logout: S('<path d="M10 4H5v16h5"/><path d="M14 12h7"/><path d="m18 8 4 4-4 4"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  chevronUp: S('<path d="m6 15 6-6 6 6"/>'),
  chevronDown: S('<path d="m6 9 6 6 6-6"/>'),
  image: S(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5.5-5.5L15 17l2.5-2.5L20 17"/>'
  ),
  monitor: S('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  star: S('<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>'),
};

export function icon(name) {
  return ICONS[name] || "";
}
