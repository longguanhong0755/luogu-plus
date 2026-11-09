/* 设置窗共享状态：preload API 与跨模块可变状态（单一 store，避免各模块各持副本）。 */

export const api = window.lgSettings;

export const store = {
  current: null,
  section: "appearance",
  weItems: [],
  weScanning: false,
  railSignature: "",
  weSignature: "",
  previewSignature: "",
};
