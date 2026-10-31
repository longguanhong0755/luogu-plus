/* 站外链接出口（唯一）：只放行 http/https，其余 scheme 一律丢弃。
   Electron 安全清单：openExternal 前必须验证 URL 协议，
   file://、smb://、自定义协议等绝不能交给系统打开。 */
const { shell } = require("electron");

function safeOpenExternal(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol === "https:" || u.protocol === "http:") {
      shell.openExternal(u.toString());
    }
  } catch {
    /* 解析失败 = 不打开 */
  }
}

module.exports = { safeOpenExternal };