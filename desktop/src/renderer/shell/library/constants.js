/* 原生列表的静态定义：题库分区、难度档位、标签分类、各列表元信息与星期表。 */
/* 题库分区与网页版一致：luogu = 洛谷（主题库 + 入门与面试） */
export const PROBLEM_TYPES = [
  ["luogu", "洛谷"],
  ["P", "主题库"],
  ["B", "入门与面试"],
  ["CF", "Codeforces"],
  ["SP", "SPOJ"],
  ["AT", "AtCoder"],
  ["UVA", "UVa"],
];
export const DIFFICULTIES = [
  [1, "入门", "#fe4c61"],
  [2, "普及−", "#f39c11"],
  [3, "普及", "#ffc116"],
  [4, "普及+/提高−", "#52c41a"],
  [5, "提高", "#13c2c2"],
  [6, "提高+/省选−", "#3498db"],
  [7, "省选/NOI−", "#9d3dcf"],
  [8, "NOI/NOI+/CTS", "#0e1d69"],
];
export const TAG_TYPES = [
  [2, "算法"],
  [3, "来源"],
  [4, "时间"],
  [1, "区域"],
  [5, "特殊题目"],
];
export const META = {
  problems: {
    title: "题库",
    search: true,
    empty: "没有找到题目",
  },
  training: { title: "训练", empty: "暂无题单" },
  contest: {
    title: "比赛",
    empty: "暂无比赛",
    filters: [
      ["all", "全部"],
      ["live", "进行中"],
      ["upcoming", "即将开始"],
      ["ended", "已结束"],
    ],
  },
  record: {
    title: "记录",
    empty: "还没有提交记录",
    filters: [
      ["all", "全部"],
      ["ac", "AC"],
      ["nonac", "非 AC"],
    ],
  },
  discuss: { title: "讨论", empty: "暂无讨论" },
  article: { title: "文章", empty: "暂无文章" },
};
export const WEEK = "日一二三四五六";
