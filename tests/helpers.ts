import { loadConfig } from "../server/config.js";
import { createDeps } from "../server/deps.js";
import { createApp } from "../server/app.js";
import { hashPassword, totpCode } from "../server/lib/crypto.js";
import { newId } from "../server/lib/util.js";
import type { Deps } from "../server/context.js";

export const ORIGIN = "http://localhost:5173";

export function setup(env: Record<string, string> = {}, opts: { fetch?: typeof fetch } = {}) {
  const config = loadConfig({ NODE_ENV: "test", APP_URL: ORIGIN, APP_SECRET: "test-secret-test-secret-test-secret-123456", ...env });
  const deps = createDeps(config, { dbFile: ":memory:", fetch: opts.fetch });
  const app = createApp(deps);
  return { deps, app, config };
}

export async function addUser(deps: Deps, p: { email: string; name?: string; role?: "admin" | "member"; password?: string; status?: string }) {
  const id = newId();
  const now = Date.now();
  deps.db
    .prepare("INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, p.email, p.name ?? p.email.split("@")[0], p.role ?? "member", p.status ?? "active", p.password ? await hashPassword(p.password) : null, now, now);
  return id;
}

/** Sets up 2FA for the signed-in client. */
export async function enable2fa(c: Client, password: string) {
  const s = await c.post("/api/auth/2fa/setup", { password });
  const r = await c.post("/api/auth/2fa/enable", { code: totpCode(s.json.secret) });
  if (r.status !== 200) throw new Error("2FA-Einrichtung fehlgeschlagen: " + r.text);
  return { secret: s.json.secret as string, recoveryCodes: r.json.recoveryCodes as string[] };
}

/** Returns a valid TOTP code and frees the time window again for it (tests only). */
export function freshCode(deps: Deps, email: string, secret: string) {
  deps.db.prepare("UPDATE users SET totp_last_step = 0 WHERE email = ?").run(email);
  return totpCode(secret);
}

/** Sign in an admin with 2FA and confirm for sensitive actions. */
export async function elevatedAdmin(app: ReturnType<typeof createApp>, deps: Deps, email: string, password: string) {
  const c = new Client(app);
  await c.login(email, password);
  const { secret } = await enable2fa(c, password);
  const r = await c.post("/api/auth/confirm", { password, code: freshCode(deps, email, secret) });
  if (r.status !== 200) throw new Error("Confirmation failed: " + r.text);
  return { client: c, secret };
}

/** Small client with a cookie jar for app.request. */
export class Client {
  cookie = "";
  constructor(private app: ReturnType<typeof createApp>) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["content-type"] = "application/json";
    if (method !== "GET" && !("x-requested-with" in headers)) h["x-requested-with"] = "nalpia-intranet";
    const res = await this.app.request(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/(nalpia_sid|__Host-nalpia_sid)=([^;]*)/);
      if (m) this.cookie = m[2] ? `${m[1]}=${m[2]}` : "";
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: res.status, json, headers: res.headers, text };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: unknown = {}) => this.req("POST", p, b);
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string) => this.req("DELETE", p);
  async login(email: string, password: string, code?: string) {
    return this.post("/api/auth/login", { email, password, code });
  }
}
