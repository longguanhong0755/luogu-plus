/* 覆盖层共享上下文：DOM 引用、动作回调与可变状态。
   initOverlays() 调用一次 collectDom() 注入，其余模块只读写这一份。 */

export const dom = {
  overlay: null,
  palette: null,
  switcher: null,
  scrim: null,
  input: null,
  palList: null,
  swList: null,
  jumpOptions: null,
  jumpDifficulty: null,
  jumpSource: null,
  jumpStatus: null,
  jumpRandom: null,
  jumpTrueRandom: null,
  userSearch: null,
  userForm: null,
  userInput: null,
  userList: null,
  palFoot: null,
  palFootDefault: "",
};

export const store = {
  actions: null,
  mode: "",
  rows: [],
  selected: 0,
  swRows: [],
  swSelected: 0,
  queryToken: 0,
  featureState: {},
  lastFocus: null,
  returnToPage: false,
  closeTimer: null,
};

export function collectDom() {
  dom.overlay = document.getElementById("overlay");
  dom.palette = document.getElementById("palette");
  dom.switcher = document.getElementById("switcher");
  dom.scrim = document.getElementById("scrim");
  dom.input = document.getElementById("pal-input");
  dom.palList = document.getElementById("pal-list");
  dom.swList = document.getElementById("sw-list");
  dom.jumpOptions = document.getElementById("jump-options");
  dom.jumpDifficulty = document.getElementById("jump-difficulty");
  dom.jumpSource = document.getElementById("jump-source");
  dom.jumpStatus = document.getElementById("jump-status");
  dom.jumpRandom = document.getElementById("jump-random");
  dom.jumpTrueRandom = document.getElementById("jump-true-random");
  dom.userSearch = document.getElementById("user-search");
  dom.userForm = document.getElementById("user-search-form");
  dom.userInput = document.getElementById("user-search-input");
  dom.userList = document.getElementById("user-search-list");
  dom.palFoot = dom.palette.querySelector(".pal-foot");
  dom.palFootDefault = dom.palFoot ? dom.palFoot.textContent : "";
  return dom;
}
