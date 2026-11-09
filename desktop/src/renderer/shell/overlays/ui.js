/* 覆盖层通用件：动作图标映射、行 id 生成、占位行。 */

export const ACTION_ICONS = {
  home: "home",
  problems: "library",
  training: "training",
  contest: "contest",
  discuss: "discuss",
  article: "article",
  record: "record",
  chat: "chat",
  notification: "bell",
  checkin: "calendarCheck",
  login: "user",
  reopen: "reopen",
  settings: "settings",
  problem: "code",
};

export function rowId(prefix, index) {
  return `${prefix}-opt-${index}`;
}

export function loadingRow(text, kind = "pal") {
  const row = document.createElement("div");
  row.className = (kind === "sw" ? "sw-row" : "pal-row") + " empty";
  row.textContent = text;
  return row;
}
