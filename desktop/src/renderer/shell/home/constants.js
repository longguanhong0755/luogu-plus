/* 主页静态定义：星期表与官网友情链接的内置回退。 */
export const WEEK = "日一二三四五六";
export const FALLBACK_LINK_GROUPS = [
  {
    title: "推荐题库",
    links: [
      ["LibreOJ", "https://loj.ac/"],
      ["Vijos", "https://vijos.org/"],
      ["HydroOJ", "https://hydro.ac/"],
    ],
  },
  {
    title: "洛谷开源项目",
    links: [
      ["CYaRon 测试数据生成器", "https://www.luogu.com.cn/discuss/11410"],
      ["Markdown*Palettes", "https://github.com/luogu-dev/markdown-palettes"],
    ],
  },
  {
    title: "洛谷服务",
    links: [
      ["《深入浅出程序设计竞赛》", "https://www.luogu.com.cn/discuss/273220"],
      ["洛谷网校 - 算法竞赛学习", "https://class.luogu.com.cn"],
      ["学校编程训练辅助工具", "https://www.zhihu.com/answer/1629008261"],
      ["协办企业院校在线编程比赛", "https://zhuanlan.zhihu.com/p/338174582"],
    ],
  },
];
