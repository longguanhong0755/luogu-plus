/* 广告与推广拦截（请求级）。
   只挂在 persist:luogu 这一个会话上；回调实时读配置，开关切换立即生效，
   不需要重挂监听。Electron 的 webRequest 同一事件每个会话只保留最后一个
   监听器，以后要再加 onBeforeRequest 必须并进这里，不要另挂第二个。 */

const AD_URL_FILTERS = [
  "*://*.luogu.com.cn/*qiafan*",
  "*://*.googlesyndication.com/*",
  "*://*.doubleclick.net/*",
  "*://*.googleadservices.com/*",
  "*://*/adsserver/*",
];

let blocked = 0;
let wired = false;

function wire(session, getEnabled) {
  if (!session || wired) return false;
  wired = true;
  try {
    session.webRequest.onBeforeRequest({ urls: AD_URL_FILTERS }, (details, callback) => {
      let on = false;
      try {
        on = !!getEnabled();
      } catch {
        on = false;
      }
      if (!on) {
        callback({});
        return;
      }
      blocked += 1;
      const url = String((details && details.url) || "").slice(0, 180);
      console.log("[adblock] block " + url);
      callback({ cancel: true });
    });
    return true;
  } catch (err) {
    wired = false;
    console.error("[adblock] wire failed:", err.message);
    return false;
  }
}

function stats() {
  return { wired, blocked };
}

module.exports = { wire, stats, AD_URL_FILTERS };
