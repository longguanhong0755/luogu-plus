/* 洛谷数据服务 · 提交链路（接口提交、验证码识别、评测完成通知；拆分自 src/main/luogu.js）。 */
const { Notification } = require("electron");
/* 语言 id 表在 ../langs（/_lfe/config 实测）。这里只消费 resolveLangId：
   不认识的语言返回 null → 拒绝提交并转页面内提交辅助，绝不悄悄换成默认语言。 */
const { resolveLangId } = require("../langs");
const { STATUS_TEXT } = require("./consts");
const { delay, findObject } = require("./util");

/* 验证码识别是可选能力（本机装了 python + ddddocr 才有），懒加载。 */
let ocrMod = null;
function captchaOcr(png) {
  if (!ocrMod) ocrMod = require("../ocr");
  return ocrMod.recognize(png).catch(() => ({ ok: false, reason: "ocr-crash" }));
}
const submitMethods = {
  /* ---------- 提交 ---------- */

  async fetchCaptchaPng() {
    // 提交验证码的图从 /api/verify/captcha 取（洛谷新前端提交重试用的就是这个路由，
    // 与 /lg4/captcha 是两套；拿错端点的图提交必被拒）
    const data = await this.exec(
      `(async () => {
        const r = await fetch("/api/verify/captcha?_t=" + Date.now(), { credentials: "include" });
        const b = await r.blob();
        return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
      })()`
    );
    if (!data || typeof data !== "string" || data.indexOf(",") === -1) return null;
    try {
      return Buffer.from(String(data).split(",").pop(), "base64");
    } catch {
      return null;
    }
  },

  async submit(pid, code, lang, captcha = "", o2 = false) {
    const result = await this.submitOnce(pid, code, lang, captcha, o2);
    if (result.ok || !result.captchaRequired || captcha) return result;
    // 交互式挑战（易盾滑块等）是洛谷的反自动化设计，不破解——交给页面内提交辅助。
    if (result.interactive) return result;
    // 图片验证码：本机有 ddddocr 时换新图最多再试 3 次；不可用则保持 captchaRequired 语义
    for (let attempt = 0; attempt < 3; attempt++) {
      const png = await this.fetchCaptchaPng();
      if (!png) break;
      const ocr = await captchaOcr(png);
      if (!ocr.ok) {
        console.log("[luogu] 验证码自动识别不可用 " + (ocr.reason || ""));
        break;
      }
      const retry = await this.submitOnce(pid, code, lang, ocr.text, o2);
      console.log(
        "[luogu] 提交验证码自动识别 #" +
          (attempt + 1) +
          " " +
          ocr.text +
          " → " +
          (retry.ok ? "通过" : "未通过 status=" + retry.status + " detail=" + String(retry.detail || "").slice(0, 100))
      );
      if (retry.ok || !retry.captchaRequired) return retry;
    }
    return result;
  },

  async submitOnce(pid, code, lang, captcha = "", o2 = false) {
    const langInfo = resolveLangId(lang);
    if (!langInfo) {
      // 不认识的语言不能悄悄按 C++14 交上去（那是数据事故）——转页面内提交辅助，
      // 用户在洛谷真实下拉里自选语言。
      return {
        ok: false,
        fallback: true,
        unsupportedLang: true,
        message: `暂不支持的语言「${lang || "未指定"}」，请在题目页的提交区选择语言提交。`,
      };
    }
    const langId = langInfo.id;
    // CSRF token 在页面 meta[name=csrf-token] 里，随会话轮换，不能拿 cookie 顶替。
    // payload 形状照抄洛谷新前端 columba bundle：{ code, lang: <数字id>, enableO2: 0|1, captcha }；
    // lang 必须是数字（字符串会被 record.invalid_language_type 拒），验证码字段是 captcha（不是 verify）。
    // enableO2 只对 canO2 的语言有效（C/C++/Pascal/Rust/Haskell/OCaml），其余语言传 0。
    const enableO2 = o2 && langInfo.o2 ? 1 : 0;
    const script = `(async () => {
      const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
      const headers = { "Content-Type": "application/json", "X-Luogu-Type": "content-only", "X-Requested-With": "XMLHttpRequest", "x-csrf-token": csrf };
      const tryReq = async (url, bodyText) => {
        try {
          const r = await fetch(url, { method: "POST", headers, body: bodyText, credentials: "include" });
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch {}
          // interactive 字段在 errorData 末尾，必须在全文上匹配（截断文本里没有）
          const interactive = (text.match(/"interactive"\\s*:\\s*\\{\\s*"type"\\s*:\\s*"([A-Z]+)"/) || [])[1] || "";
          return { status: r.status, json, text: text.slice(0, 240), interactive };
        } catch (e) { return { status: 0, error: String(e) }; }
      };
      const ridOf = (j) => j && (j.rid || (j.data && j.data.rid) || (j.currentData && j.currentData.rid));
      const code = ${JSON.stringify(code)};
      const captcha = ${JSON.stringify(String(captcha || ""))};
      const body = captcha
        ? { code, lang: ${Number(langId)}, enableO2: ${Number(enableO2)}, captcha }
        : { code, lang: ${Number(langId)}, enableO2: ${Number(enableO2)} };
      const res = await tryReq("/fe/api/problem/submit/${pid}", JSON.stringify(body));
      if (ridOf(res.json)) return { ok: true, rid: ridOf(res.json) };
      const text = String(res.text || "");
      if (text.indexOf("Captcha") !== -1 || text.indexOf("验证码") !== -1) {
        return { ok: false, captchaRequired: true, interactive: res.interactive || "", status: res.status, detail: text.slice(0, 200) };
      }
      return { ok: false, status: res.status, detail: res.text || res.error || "no response" };
    })()`;
    const result = await this.exec(script);
    if (result && result.captchaRequired) {
      return {
        ok: false,
        captchaRequired: true,
        interactive: result.interactive || "",
        status: result.status || 0,
        detail: result.detail || "",
        message: "本次提交需要图形验证码，已在题目页打开提交区。",
      };
    }
    if (!result || !result.ok) {
      return {
        ok: false,
        fallback: true,
        message: "自动提交没有成功，代码已复制，请在题目页内提交。",
        detail: result ? String(result.detail || result.error || "").slice(0, 300) : "exec failed",
        status: result ? result.status : 0,
      };
    }
    this.watchRecord(result.rid, pid).catch(() => {});
    return { ok: true, rid: result.rid };
  },

  async watchRecord(rid, pid) {
    for (let i = 0; i < 50; i++) {
      await delay(1500);
      const context = await this.fetchContext("/record/" + rid);
      if (!context) continue;
      const record = findObject(context, (item) => item && typeof item === "object" && "status" in item && "score" in item);
      if (!record) continue;
      const status = Number(record.status);
      if (status === 0 || status === 1) continue;
      const score = Number(record.score);
      const text = STATUS_TEXT[status] || String(status);
      const title = `评测完成 · ${pid} ${text}`;
      const body = `${score} 分${record.time ? " · " + record.time + "ms" : ""}`;
      if (this.ctx.cfg.get().notify.judge) {
        const notification = new Notification({ title, body });
        notification.on("click", () => {
          this.ctx.showWindow && this.ctx.showWindow();
          this.ctx.views && this.ctx.views.openProblem(pid);
        });
        notification.show();
      }
      if (this.ctx.notify && this.ctx.notify.judgeDone) this.ctx.notify.judgeDone(status === 12 ? "ac" : "wa");
      if (this.ctx.emitState) this.ctx.emitState();
      return;
    }
  }
};

module.exports = { captchaOcr, submitMethods };
