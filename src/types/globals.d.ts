/* ============================================================
   预加载注入的全局对象 —— 类型声明
   preload-*.js 用 contextBridge.exposeInMainWorld 往 window 上挂了
   lgChrome / lgConfig / lgApp / lgPopup / lgDock。没有这份声明，类型检查
   会把**每一个** window.lgConfig.xxx 报成"属性不存在"（781 个错误里
   728 个是这类噪音），真正的类型问题就被埋掉了。

   先用 any 把噪音去掉，让检查能看见真问题；后续给各 preload 暴露的方法
   补上具体签名（见 src/types/bridges.d.ts 的逐步补全）。
   ============================================================ */
import type { IpcRenderer } from "electron";

export {};

declare global {
  interface Window {
    /** chrome 层桥接：标签、弹层、壁纸、设置、缩放、分组等 */
    lgChrome: any;
    /** 本地页桥接：配置读写、历史、下载、账号、诊断报告 */
    lgConfig: any;
    /** 站点页桥接：壁纸、缩放、视差、翻译 */
    lgApp: any;
    /** 弹层桥接 */
    lgPopup: any;
    /** 坞桥接 */
    lgDock: any;

    /* ---- 注入层（src/inject.js）在页面里挂的调试/能力接口 ---- */
    /** 能力注册表同步：重复调用不改变已贴的面（探针在用） */
    __lgGlassSweep?: () => void;
    __lgGlass?: any;
    __lgWallHeal?: number;
    __lgFlipCount?: number;
    __lgDragLog?: unknown[];
    __lgDragDbg?: () => void;
    /* 注入层共享上下文：内核 src/inject.js 建，各能力模块 src/inject/*.js 取。
       模块文件靠它拿 cfg/state/isLuoguPage 等共享状态与 ctx.features 上的兄弟能力。 */
    __lgInjectCtx?: any;
    /** IDE 模式（R38）判定调试出口 */
    __lgIdeInPage?: () => { on: boolean; state: boolean; bridge: boolean };
    __lgIdeSync?: () => void;

    /* ---- 站点页：主进程注入的账号态与网络态 ---- */
    __lgUser?: any;
    __lgContests?: any;

    /* ---- 图标库（src/icons.js 在 window 上挂的）---- */
    LGIcons?: {
      PATHS: Record<string, string>;
      svg: (name: string, size?: number) => string;
    };

    /* ---- 外壳层的地址栏解析（src/chrome/chrome.js 挂的，供输入框调用）---- */
    resolveOmnibox?: (
      raw: string,
      mappings: unknown[],
      searchTpl: string,
      searchIsLuogu: boolean
    ) => { url: string; label?: string; kind?: string } | string;
  }
}
