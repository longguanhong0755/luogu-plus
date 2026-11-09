/* 洛谷数据服务 · 登录态读取与退出（拆分自 src/main/luogu.js）。 */
const accountMethods = {
  async cookies() {
    try {
      return await this.ctx.session.cookies.get({ url: "https://www.luogu.com.cn" });
    } catch {
      return [];
    }
  },

  async loginState() {
    const list = await this.cookies();
    const get = (name) => {
      const c = list.find((item) => item.name === name);
      return c ? c.value : "";
    };
    const clientId = get("__client_id");
    const uid = Number(get("_uid")) || 0;
    // 游客也会拿到 __client_id 和 _uid=0，必须要求真实 uid 才算登录。
    return { loggedIn: !!clientId && uid > 0, uid: uid || null };
  },

  async logout() {
    try {
      await this.ctx.session.clearStorageData({ storages: ["cookies"] });
    } catch {
      /* ignore */
    }
    this.libCache.clear();
    this.lastRefresh = 0;
    // 本地快照属于上一个账号，一并清掉（题目快照是公开题面，保留无害但顺手清理列表/主页）
    const store = this.ctx.store;
    if (store) {
      store.delete("home");
      store.delete("user");
      for (const entry of store.entries("lib:")) store.delete(entry.key);
    }
    await this.refresh(true);
  }
};

module.exports = { accountMethods };
