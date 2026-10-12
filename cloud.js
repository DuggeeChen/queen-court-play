export class Cloud {
  constructor(config) {
    this.config = config;
    this.device = sessionStorage.getItem("queen-device") || crypto.randomUUID();
    sessionStorage.setItem("queen-device", this.device);
    this.session = JSON.parse(localStorage.getItem("queen-session") || "null");
    this.user = null;
    this.revision = 0;
    this.gameId = null;
    this.locked = false;
  }
  get configured() {
    return !!this.config.url && !!this.config.key;
  }
  async request(path, body, method = "POST", auth = true) {
    if (!this.configured) throw Error("未配置真实云端服务");
    if (
      auth &&
      this.session &&
      Date.now() / 1000 > this.session.expires_at - 60
    )
      await this.refresh();
    const headers = {
      apikey: this.config.key,
      "Content-Type": "application/json",
    };
    if (auth && this.session)
      headers.Authorization = "Bearer " + this.session.access_token;
    const response = await fetch(this.config.url + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
    if (!response.ok)
      throw Error(
        result?.message ||
          result?.msg ||
          result?.error_description ||
          "云端请求失败 " + response.status,
      );
    return result;
  }
  persist(s) {
    this.session = {
      ...s,
      expires_at:
        s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    };
    localStorage.setItem("queen-session", JSON.stringify(this.session));
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const s = await this.request(
        "/auth/v1/token?grant_type=refresh_token",
        { refresh_token: this.session.refresh_token },
        "POST",
        false,
      );
      this.persist(s);
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  async init() {
    if (!this.configured || !this.session) return;
    try {
      this.user = await this.request("/auth/v1/user", undefined, "GET");
    } catch (e) {
      this.session = null;
      localStorage.removeItem("queen-session");
      throw e;
    }
  }
  async sendCode(email) {
    return this.request(
      "/auth/v1/otp",
      { email, create_user: true },
      "POST",
      false,
    );
  }
  async verify(email, token) {
    const s = await this.request(
      "/auth/v1/verify",
      { email, token, type: "email" },
      "POST",
      false,
    );
    this.persist(s);
    this.user = await this.request("/auth/v1/user", undefined, "GET");
  }
  async signout() {
    if (this.session) await this.request("/auth/v1/logout", {});
    this.user = null;
    this.session = null;
    this.gameId = null;
    localStorage.removeItem("queen-session");
  }
  rpc(name, args) {
    if (!this.user) throw Error("请先登录真实账号");
    return this.request("/rest/v1/rpc/" + name, args);
  }
  async load() {
    const rows = await this.request(
      "/rest/v1/queen_saves?select=game_id,revision,state,updated_at&order=updated_at.desc&limit=1",
      undefined,
      "GET",
    );
    return rows[0] || null;
  }
  async acquire(id) {
    await this.rpc("queen_acquire", { p_game: id, p_device: this.device });
    this.gameId = id;
    this.locked = false;
  }
  async heartbeat() {
    if (!this.gameId) return;
    try {
      await this.acquire(this.gameId);
    } catch (e) {
      this.locked = true;
      throw e;
    }
  }
  async release() {
    if (this.gameId)
      await this.rpc("queen_release", {
        p_game: this.gameId,
        p_device: this.device,
      });
    this.gameId = null;
  }
  async save(state) {
    if (this.locked) throw Error("控制权已失效，请重新加载云端棋局");
    if (this.gameId !== state.gameId) {
      await this.acquire(state.gameId);
      this.revision = 0;
    }
    const rows = await this.rpc("queen_save", {
      p_game: state.gameId,
      p_device: this.device,
      p_expected: this.revision,
      p_state: state,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    this.revision = row.revision;
    return row;
  }
  async settings(value) {
    if (value === undefined) {
      const rows = await this.request(
        "/rest/v1/queen_settings?select=settings",
        undefined,
        "GET",
      );
      return rows[0]?.settings || null;
    }
    return this.rpc("queen_settings_save", { p_settings: value });
  }
}
