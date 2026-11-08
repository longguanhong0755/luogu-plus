/* 注入到洛谷页面主世界的通行密钥守卫（通过 CDP 在文档创建前注入）。
   桌面版不接入 Windows Hello / 安全密钥：站点即使自动调用 WebAuthn，
   也不会再拉起系统「选择通行密钥」窗口。密码登录与普通 Cookie 登录不受影响。 */
const SOURCE = `(() => {
  try {
    window.__lgPasskeyGuard = "blocked";
    const blocked = () => new Promise(() => {});
    const credentials = navigator.credentials;
    if (credentials && typeof credentials.get === "function") {
      const isWebAuthn = (options) => !!(options && options.publicKey);
      const siteGet = credentials.get.bind(credentials);
      const siteCreate = typeof credentials.create === "function" ? credentials.create.bind(credentials) : null;
      Object.defineProperty(credentials, "get", {
        configurable: true,
        value: function (options) {
          return isWebAuthn(options) ? blocked() : siteGet(options);
        }
      });
      if (siteCreate) {
        Object.defineProperty(credentials, "create", {
          configurable: true,
          value: function (options) {
            return isWebAuthn(options) ? blocked() : siteCreate(options);
          }
        });
      }
    }
    const PK = window.PublicKeyCredential;
    if (PK) {
      try {
        Object.defineProperty(PK, "isConditionalMediationAvailable", {
          configurable: true,
          value: async () => false
        });
      } catch {}
      try {
        Object.defineProperty(PK, "isUserVerifyingPlatformAuthenticatorAvailable", {
          configurable: true,
          value: async () => false
        });
      } catch {}
    }
  } catch (err) {
    window.__lgPasskeyGuardError = String(err);
  }
})();`;

const debugLog = (...args) => {
  if (process.env.LG_DEBUG_PASSKEY) console.log("[passkey]", ...args);
};

/* Electron 39 实测结论（2026-11-07，见 .lg-dev/probe-passkey/）：
   1) WebContentsView 刚创建、还没有任何已提交文档时，Page 域的命令
      （Page.enable / Page.addScriptToEvaluateOnNewDocument）会一直挂起；
   2) 即使 addScriptToEvaluateOnNewDocument 在没有 Page.enable 的情况下返回
      identifier，它也**不会**作用于任何新文档（静默失效）；
   3) 先有已提交文档（about:blank 亦可），再 Page.enable，再 addScript，
      之后的每个新文档都能在文档脚本执行前拿到守卫。
   所以：没有已提交文档时不做无谓等待，直接交给 dom-ready 兜底；文档就绪后
   由 views.js 重试一次，从此后续导航都是真正的 pre-document 注入。 */

async function ensurePageDomain(webContents, limitMs) {
  try {
    await Promise.race([
      webContents.debugger.sendCommand("Page.enable"),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Page.enable timeout")), limitMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function attachToWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
  } catch (err) {
    console.warn("[passkey] pre-document guard attach failed:", err.message);
    return false;
  }
  // 还没有已提交文档：Page 域命令必然挂起，直接跳过等待（保留 debugger，
  // Page.navigate 不受影响），首个文档由 dom-ready 的主世界注入兜底。
  if (!webContents.getURL()) {
    debugLog("pre-document guard deferred: no committed document");
    return false;
  }
  if (!(await ensurePageDomain(webContents, 900))) {
    debugLog("pre-document guard deferred: Page domain unavailable");
    return false;
  }
  try {
    await Promise.race([
      webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: SOURCE,
        runImmediately: true,
      }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("addScript timeout")), 1200)),
    ]);
    debugLog("pre-document guard installed");
    return true;
  } catch (err) {
    // 真挂住了只留排查线索，不再当功能性告警（dom-ready 兜底仍然生效）
    debugLog("pre-document guard timed out:", err.message);
    return false;
  }
}

async function injectIntoCurrentDocument(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    await Promise.race([
      webContents.executeJavaScript(SOURCE, true),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("passkey fallback timeout")), 1500)),
    ]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { SOURCE, attachToWebContents, injectIntoCurrentDocument };
