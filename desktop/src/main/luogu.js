/* 洛谷数据服务入口（R96 拆分：实现都在 ./luogu/ 目录，这里只保留 require + module.exports）。
   公开 API 不变：{ LuoguService, STATUS_TEXT, QUOTES }。 */
const { LuoguService, STATUS_TEXT, QUOTES } = require("./luogu/service");

module.exports = { LuoguService, STATUS_TEXT, QUOTES };
