/* 洛谷数据服务 · 签到状态读取与页面内打卡（拆分自 src/main/luogu.js）。 */
const { delay } = require("./util");

const punchMethods = {
  async readPunchState() {
    const result = await this.exec(`(() => {
      const clean = (node) => String((node && node.textContent) || "").replace(/\\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll(
        ".lg-punch, [class*='punch'], [class*='checkin'], [class*='check-in'], [class*='signin'], [class*='sign-in']"
      ));
      const controls = Array.from(document.querySelectorAll("button, a, [role='button'], [onclick], .am-btn"));
      const target = controls.find((node) => /^(签到|打卡|已签到|已打卡|今日已签)/.test(clean(node)));
      if (target) {
        const panel = target.closest(".am-panel, .card, section, [class*='punch'], [class*='checkin'], [class*='signin']");
        if (panel) cards.push(panel);
      }
      const uniqueCards = cards.filter((node, index) => node && cards.indexOf(node) === index);
      const text = uniqueCards.map(clean).filter(Boolean).join(" ");
      const btnText = target ? clean(target) : "";
      const streakMatch = (text + " " + btnText).match(/(\\d+)\\s*天/);
      return {
        punched: /已打卡|已签到|今日已/.test(text + " " + btnText),
        hasButton: !!target,
        hasCard: uniqueCards.length > 0,
        streak: streakMatch ? Number(streakMatch[1]) : 0
      };
    })()`);
    if (!result) return { punched: null, hasButton: false, hasCard: false, streak: 0 };
    return {
      punched: result.punched || (result.hasCard && result.hasButton === false ? false : null),
      hasButton: !!result.hasButton,
      hasCard: !!result.hasCard,
      streak: result.streak || 0,
    };
  },

  async checkin() {
    if (!this.online) return { ok: false, message: "当前离线，签到需要联网后进行。" };
    const refreshedMs = Number(this.home && this.home.updatedAt) || 0;
    const homeAge = Date.now() - refreshedMs;
    const homeDay = refreshedMs ? new Date(refreshedMs).toDateString() : "";
    const today = new Date().toDateString();
    if (homeDay === today && homeAge < 30 * 60 * 1000 && this.home && this.home.punched === true) {
      const refreshed = await this.refresh(true);
      const payload = refreshed && refreshed.home ? refreshed.home : this.home;
      return {
        ok: true,
        already: true,
        home: refreshed,
        fortune: payload && payload.official ? payload.official.fortune || null : null,
      };
    }
    const punchState = await this.readPunchState();
    if (punchState.punched) {
      // 已签到时仍强制同步一次，确保历史登录会话能立刻拿到当天真实运势。
      const refreshed = await this.refresh(true);
      return {
        ok: true,
        already: true,
        home: refreshed,
        fortune: refreshed && refreshed.home && refreshed.home.official ? refreshed.home.official.fortune || null : null,
      };
    }
    const clickScript = `(() => {
      const clean = (node) => String((node && node.textContent) || "").replace(/\\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll(
        ".lg-punch, [class*='punch'], [class*='checkin'], [class*='check-in'], [class*='signin'], [class*='sign-in']"
      ));
      const scoped = Array.from(document.querySelectorAll(
        ".lg-punch button, .lg-punch a, [class*='punch'] button, [class*='punch'] a, " +
        "[class*='checkin'] button, [class*='checkin'] a, [class*='signin'] button, [class*='signin'] a, " +
        "[name='punch'], [name='checkin'], [role='button'], .am-btn"
      ));
      const controls = Array.from(new Set(scoped.concat(
        Array.from(document.querySelectorAll("button, a, [role='button'], [onclick], .am-btn"))
      )));
      const target = controls.find((node) => /^(签到|打卡|已签到|已打卡|今日已签)/.test(clean(node)));
      if (!target) return { ok: false, reason: "not-found" };
      const panel = target.closest(".am-panel, .card, section, [class*='punch'], [class*='checkin'], [class*='signin']");
      if (/已打卡|已签到|今日已/.test(clean(panel) + " " + clean(target))) return { ok: true, already: true };
      if (target.disabled || target.classList.contains("am-disabled")) return { ok: false, reason: "disabled" };
      target.click();
      return { ok: true, clicked: true };
    })()`;
    let result = await this.exec(clickScript);
    if (!result || !result.ok) {
      // 首页可能还没渲染出打卡卡，重载一次再试
      this.reloadHidden();
      await delay(3500);
      result = await this.exec(clickScript);
    }
    if (!result || !result.ok) {
      // 页面 DOM 已更新但选择器没命中时，先用一次完整同步确认是否其实已签到，
      // 避免把“今日已完成”误报成失败。
      const refreshed = await this.refresh(true);
      const payload = refreshed && refreshed.home ? refreshed.home : this.home;
      if (payload && payload.punched === true) {
        return {
          ok: true,
          already: true,
          home: refreshed,
          fortune: payload.official ? payload.official.fortune || null : null,
        };
      }
      return { ok: false, uncertain: true, message: "暂时没找到签到入口，可能今天已经完成。请刷新主页确认。" };
    }
    let confirmed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(attempt === 0 ? 1200 : 650);
      const stateAfter = await this.readPunchState();
      if (stateAfter && stateAfter.punched) {
        confirmed = true;
        break;
      }
    }
    let refreshed = null;
    if (confirmed) refreshed = await this.refresh(true);
    if (!confirmed) {
      // 页面 DOM 尚未换新时再完整同步一次；refresh 内部也会重新读取打卡卡。
      refreshed = await this.refresh(true);
      confirmed = !!(refreshed && refreshed.home && refreshed.home.punched);
    }
    if (!confirmed) {
      return { ok: false, message: "洛谷没有确认签到成功，请稍后重试。" };
    }
    return {
      ok: true,
      already: !!result.already,
      home: refreshed,
      fortune: refreshed && refreshed.home && refreshed.home.official ? refreshed.home.official.fortune || null : null,
    };
  }
};

module.exports = { punchMethods };
