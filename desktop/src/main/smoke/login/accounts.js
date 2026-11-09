/* 真实账号登录测试：账号文件解析（每行 用户名----密码，第三段起忽略）。 */
const fs = require("node:fs");

function readLoginAccounts() {
  const file = process.env.LG_SMOKE_LOGIN;
  let accounts = [];
  try {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const parts = line.split("----");
    if (parts.length < 2) continue;
    const user = parts[0].trim();
    const pass = parts[1].trim(); // 第三段（如有）是其他字段，不是密码
    if (user && pass) accounts.push({ user, pass });
  }
  } catch (err) {
    console.log("LGTEST_FAIL 账号文件读取失败 " + err.message);
    return null;
  }
  const maxAccounts = Number(process.env.LG_SMOKE_LOGIN_MAX || 5);
  accounts = accounts.slice(0, maxAccounts);
  return accounts;
}

module.exports = { readLoginAccounts };
