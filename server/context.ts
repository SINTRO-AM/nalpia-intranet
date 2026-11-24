import type { Context } from "hono";
import type { Config } from "./config.js";
import type { DB } from "./db/index.js";
import type { Vault } from "./lib/crypto.js";
import type { RateLimiter } from "./lib/ratelimit.js";
import type { MailService } from "./mail/service.js";
import type { AiService } from "./ai/service.js";
import type { SystemMailer } from "./lib/mailer.js";
import type { AgentService } from "./agent/service.js";
import { parseJson } from "./db/index.js";

export interface Deps {
  db: DB;
  config: Config;
  vault: Vault;
  limiter: RateLimiter;
  mail: MailService;
  ai: AiService;
  mailer: SystemMailer;
  /** Fundraising agent (drafts, sending, inbox, follow-ups) */
  agent: AgentService;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  title: string;
  phone: string;
  location: string;
  responsibilities: string;
  avatar_color: string;
  avatar_updated_at: number | null;
  department: string;
  manager_id: string | null;
  bio: string;
  linkedin: string;
  sort_order: number;
  role: "admin" | "member";
  status: "invited" | "active" | "disabled";
  password_hash: string | null;
  password_changed_at: number | null;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_last_step: number;
  recovery_codes: string;
  failed_logins: number;
  locked_until: number;
  prefs: string;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  title: string;
  phone: string;
  location: string;
  responsibilities: string[];
  avatarColor: string;
  avatarUrl: string | null;
  department: string;
  managerId: string | null;
  bio: string;
  linkedin: string;
  sortOrder: number;
  role: "admin" | "member";
  status: "invited" | "active" | "disabled";
}

export interface SelfUser extends PublicUser {
  totpEnabled: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface UserPrefs {
  signature?: string;
  aiStyle?: string;
  salutation?: "du" | "sie" | "auto";
  theme?: "system" | "light" | "dark";
  fromAddress?: string;
  /** Automatically create reply suggestions when opening an email (default: on) */
  autoSuggest?: boolean;
  /** Show the AI assistant (chat window) (default: on) */
  assistant?: boolean;
  /** Interface language */
  lang?: "en" | "de";
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    title: u.title,
    phone: u.phone,
    location: u.location,
    responsibilities: parseJson<string[]>(u.responsibilities, []),
    avatarColor: u.avatar_color,
    avatarUrl: u.avatar_updated_at ? `/api/users/${u.id}/avatar?v=${u.avatar_updated_at}` : null,
    department: u.department ?? "",
    managerId: u.manager_id ?? null,
    bio: u.bio ?? "",
    linkedin: u.linkedin ?? "",
    sortOrder: u.sort_order ?? 0,
    role: u.role,
    status: u.status,
  };
}

export function toSelfUser(u: UserRow): SelfUser {
  return { ...toPublicUser(u), totpEnabled: !!u.totp_enabled, lastLoginAt: u.last_login_at, createdAt: u.created_at };
}

export function userPrefs(u: UserRow): UserPrefs {
  return parseJson<UserPrefs>(u.prefs, {});
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    user: UserRow;
    sessionHash: string;
    elevatedUntil: number;
    ip: string;
  };
};

export type Ctx = Context<AppEnv>;

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // Take the (last) entry appended by our own reverse proxy – earlier entries can be forged by the client
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",").pop()!.trim();
    const real = c.req.header("x-real-ip");
    if (real) return real.trim();
  }
  // @hono/node-server exposes the socket address under env.incoming
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "";
}
