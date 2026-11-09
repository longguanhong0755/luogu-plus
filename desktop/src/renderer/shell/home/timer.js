/* 比赛倒计时计时器：全局只有一个实例，重绘主页前必须先清掉。 */
let countdownTimer = null;

export function disposeHome() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
export function setCountdownTimer(timer) {
  countdownTimer = timer;
}
