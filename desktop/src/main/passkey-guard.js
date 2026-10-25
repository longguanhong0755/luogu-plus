/* 注入到洛谷页面主世界的通行密钥守卫（通过 CDP 在文档创建前注入）。
   目的：登录页加载时不允许任何自动 WebAuthn 调用；只有用户点击了含
   「密钥 / 通行密钥 / passkey」的按钮后 15 秒内（或正处于用户手势中）才放行。
   这样 Windows Hello 的安全窗口不会自己弹出来，点「通过密钥登录」仍然正常。 */
const SOURCE = `(() => {
  try {
    window.__lgPasskeyGuard = true;
    let allowUntil = 0;
    document.addEventListener("click", (event) => {
      const target = event.target && event.target.closest
        ? event.target.closest("button, a, [role=button], input[type=button], input[type=submit]")
        : null;
      if (!target) return;
      const text = [
        target.textContent || "",
        target.getAttribute("aria-label") || "",
        target.getAttribute("title") || "",
        target.getAttribute("href") || "",
        target.getAttribute("data-href") || ""
      ].join(" ");
      if (/密钥|通行|passkey|webauthn/i.test(text)) allowUntil = Date.now() + 15000;
    }, true);

    const credentials = navigator.credentials;
    if (!credentials || typeof credentials.get !== "function") return;
    const siteGet = credentials.get.bind(credentials);
    const siteCreate = typeof credentials.create === "function" ? credentials.create.bind(credentials) : null;
    const allowed = () => Date.now() < allowUntil || !!(navigator.userActivation && navigator.userActivation.isActive);
    const guard = (original, method) => function (options) {
      const isWebAuthn = !!(options && (options.publicKey || options.mediation || method === "create"));
      if (isWebAuthn && !allowed()) {
        // 静默挂起：拒绝会让站点弹出错误提示，自动调用应当像「没有可用凭据」一样
        // 什么也不发生；用户点击通行密钥按钮后走真实流程。
        return new Promise(() => {});
      }
      return original(options);
    };
    Object.defineProperty(credentials, "get", { configurable: true, value: guard(siteGet, "get") });
    if (siteCreate) Object.defineProperty(credentials, "create", { configurable: true, value: guard(siteCreate, "create") });
  } catch (err) {
    window.__lgPasskeyGuardError = String(err);
  }
})();`;

module.exports = { SOURCE };
