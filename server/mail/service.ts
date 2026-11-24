import type { Config } from "../config.js";
import type { DB } from "../db/index.js";
import { parseJson } from "../db/index.js";
import type { UserRow } from "../context.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256, type Vault } from "../lib/crypto.js";
import { MockMailbox } from "./mock.js";
import { MailError, type MailboxClient, type MailFolder } from "./types.js";
import { calendarApiFor, MockCalendar, ZohoCalendar, type CalendarClient } from "../calendar/calendar.js";
import { resolveEndpoints, zohoAccountInfo, ZohoMailbox, zohoRevoke, zohoToken, ZOHO_SCOPES } from "./zoho.js";
import { tr } from "../lib/i18n.js";

interface AccountRow {
  user_id: string;
  provider: "zoho" | "demo";
  account_id: string;
  email: string;
  display_name: string;
  addresses: string;
  accounts_server: string;
  mail_api: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: number;
  needs_reconnect: number;
  connected_at: number;
}

export interface MailStatus {
  available: boolean;
  mode: "zoho" | "demo" | "off";
  connected: boolean;
  email?: string;
  displayName?: string;
  addresses?: string[];
  needsReconnect?: boolean;
  connectedAt?: number;
}

const STATE_TTL = 10 * 60_000;

/**
 * Manages the mailbox connection per user. Every method receives the signed-in user and
 * only accesses that user's own connection – there is no way to pass someone else's userId.
 */
export class MailService {
  private locks = new Map<string, Promise<string>>();
  private mocks = new Map<string, MockMailbox>();
  private mockCalendars = new Map<string, MockCalendar>();
  private folderCache = new Map<string, { at: number; folders: MailFolder[] }>();
  private unreadCache = new Map<string, { at: number; n: number }>();

  constructor(
    private db: DB,
    private config: Config,
    private vault: Vault,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get mode(): "zoho" | "demo" | "off" {
    if (this.config.zohoEnabled) return "zoho";
    if (this.config.DEMO_MODE) return "demo";
    return "off";
  }

  get available() {
    return this.mode !== "off";
  }

  get redirectUri() {
    return `${this.config.appOrigin}/api/mail/oauth/callback`;
  }

  private row(userId: string) {
    return this.db.prepare("SELECT * FROM mail_accounts WHERE user_id = ?").get(userId) as AccountRow | undefined;
  }

  status(user: UserRow): MailStatus {
    const r = this.row(user.id);
    const base = { available: this.available, mode: this.mode };
    if (!r) return { ...base, connected: false };
    return {
      ...base,
      connected: true,
      email: r.email,
      displayName: r.display_name,
      addresses: parseJson<string[]>(r.addresses, [r.email]),
      needsReconnect: !!r.needs_reconnect,
      connectedAt: r.connected_at,
    };
  }

  /** Starts the OAuth flow and returns the Zoho sign-in URL. */
  authorizeUrl(user: UserRow): string {
    if (this.mode === "off") throw new MailError(tr("The mailbox integration is not set up yet (Zoho credentials are missing).", "Die Postfach-Anbindung ist noch nicht eingerichtet (Zoho-Zugangsdaten fehlen)."), "disabled", 503);
    const state = randomToken(24);
    const now = Date.now();
    this.db.prepare("DELETE FROM oauth_states WHERE created_at < ? OR user_id = ?").run(now - STATE_TTL, user.id);
    this.db.prepare("INSERT INTO oauth_states (state_hash, user_id, created_at) VALUES (?, ?, ?)").run(sha256(state), user.id, now);
    if (this.mode === "demo") return `/api/mail/oauth/callback?code=demo&state=${encodeURIComponent(state)}`;
    const u = new URL(`${this.config.ZOHO_ACCOUNTS_URL.replace(/\/+$/, "")}/oauth/v2/auth`);
    u.searchParams.set("scope", ZOHO_SCOPES);
    u.searchParams.set("client_id", this.config.ZOHO_CLIENT_ID!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("redirect_uri", this.redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  }

  /** Handles the OAuth callback for the signed-in user. */
  async completeOAuth(user: UserRow, q: Record<string, string | undefined>, ip: string) {
    const stateRow = q.state
      ? (this.db.prepare("SELECT user_id, created_at FROM oauth_states WHERE state_hash = ?").get(sha256(q.state)) as
          | { user_id: string; created_at: number }
          | undefined)
      : undefined;
    if (q.state) this.db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(sha256(q.state));
    if (!stateRow || stateRow.user_id !== user.id || stateRow.created_at < Date.now() - STATE_TTL) {
      throw new MailError(tr("The Zoho sign-in has expired or is invalid. Please start the connection again.", "Die Anmeldung bei Zoho ist abgelaufen oder ungültig. Bitte starte die Verbindung erneut."), "invalid", 400);
    }
    if (q.error) throw new MailError(tr("You did not grant access in Zoho.", "Du hast den Zugriff in Zoho nicht freigegeben."), "denied", 400);
    if (!q.code) throw new MailError(tr("Zoho did not return an authorization code.", "Zoho hat keinen Autorisierungscode geliefert."), "invalid", 400);

    if (this.mode === "demo") {
      this.store(user, {
        provider: "demo",
        accountId: "1",
        email: user.email,
        displayName: user.name,
        addresses: [user.email],
        accountsServer: "demo",
        mailApi: "demo",
        refresh: "demo",
      });
      audit(this.db, { userId: user.id, action: "mail.connected", ip, meta: { provider: "demo" } });
      return;
    }

    const ep = resolveEndpoints(q["accounts-server"], this.config.ZOHO_ACCOUNTS_URL, this.config.ZOHO_MAIL_API_URL);
    if (!ep) throw new MailError(tr("Unknown Zoho data center.", "Unbekanntes Zoho-Rechenzentrum."), "unknown_dc", 400);
    const tok = await zohoToken(
      ep.accountsServer,
      {
        grant_type: "authorization_code",
        code: q.code,
        client_id: this.config.ZOHO_CLIENT_ID!,
        client_secret: this.config.ZOHO_CLIENT_SECRET!,
        redirect_uri: this.redirectUri,
        scope: ZOHO_SCOPES,
      },
      this.fetchImpl,
    );
    if (!tok.refresh_token) {
      throw new MailError(tr("Zoho did not grant permanent access. Please remove the app under accounts.zoho.eu → Connected Apps and connect again.", "Zoho hat keinen dauerhaften Zugriff gewährt. Bitte trenne die App unter accounts.zoho.eu → Connected Apps und verbinde neu."), "no_refresh");
    }
    const info = await zohoAccountInfo(ep.mailApi, tok.access_token, this.fetchImpl);
    if (this.config.ZOHO_ENFORCE_EMAIL_MATCH && !info.addresses.includes(user.email.toLowerCase())) {
      await zohoRevoke(ep.accountsServer, tok.refresh_token, this.fetchImpl);
      audit(this.db, { userId: user.id, action: "mail.connect_mismatch", ip, meta: { zoho: info.email } });
      throw new MailError(
        tr(`The Zoho mailbox ${info.email} does not belong to your intranet account (${user.email}). Please sign in to Zoho with your own mailbox.`, `Das Zoho-Postfach ${info.email} gehört nicht zu deinem Intranet-Konto (${user.email}). Melde dich bei Zoho mit deinem eigenen Postfach an.`),
        "mismatch",
        403,
      );
    }
    this.store(user, {
      provider: "zoho",
      accountId: info.accountId,
      email: info.email,
      displayName: info.displayName,
      addresses: info.addresses,
      accountsServer: ep.accountsServer,
      mailApi: ep.mailApi,
      refresh: tok.refresh_token,
      access: tok.access_token,
      expiresIn: tok.expires_in,
    });
    audit(this.db, { userId: user.id, action: "mail.connected", ip, meta: { provider: "zoho", email: info.email } });
  }

  private store(
    user: UserRow,
    a: {
      provider: "zoho" | "demo";
      accountId: string;
      email: string;
      displayName: string;
      addresses: string[];
      accountsServer: string;
      mailApi: string;
      refresh: string;
      access?: string;
      expiresIn?: number;
    },
  ) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO mail_accounts (user_id, provider, account_id, email, display_name, addresses, accounts_server, mail_api, refresh_token_enc, access_token_enc, access_expires_at, needs_reconnect, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, account_id = excluded.account_id, email = excluded.email,
           display_name = excluded.display_name, addresses = excluded.addresses, accounts_server = excluded.accounts_server, mail_api = excluded.mail_api,
           refresh_token_enc = excluded.refresh_token_enc, access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
           needs_reconnect = 0, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
      )
      .run(
        user.id,
        a.provider,
        a.accountId,
        a.email,
        a.displayName,
        JSON.stringify(a.addresses),
        a.accountsServer,
        a.mailApi,
        this.vault.encrypt(a.refresh),
        a.access ? this.vault.encrypt(a.access) : null,
        a.access ? now + (a.expiresIn ?? 3600) * 1000 : 0,
        now,
        now,
      );
    this.folderCache.delete(user.id);
    this.unreadCache.delete(user.id);
  }

  async disconnect(user: Pick<UserRow, "id">, ip: string, reason: "user" | "password_reset" | "admin_reset" | "disabled" | "2fa_reset" = "user") {
    const r = this.row(user.id);
    if (!r) return;
    if (r.provider === "zoho") {
      try {
        await zohoRevoke(r.accounts_server, this.vault.decrypt(r.refresh_token_enc), this.fetchImpl);
      } catch {
        /* best effort */
      }
    }
    this.db.prepare("DELETE FROM mail_accounts WHERE user_id = ?").run(user.id);
    this.mocks.delete(user.id);
    this.folderCache.delete(user.id);
    this.unreadCache.delete(user.id);
    audit(this.db, { userId: user.id, action: "mail.disconnected", ip, meta: { reason } });
  }

  private async accessToken(userId: string, force: boolean): Promise<string> {
    const r = this.row(userId);
    if (!r) throw new MailError(tr("Your mailbox is not connected.", "Dein Postfach ist nicht verbunden."), "not_connected", 409);
    if (!force && r.access_token_enc && r.access_expires_at > Date.now() + 60_000) return this.vault.decrypt(r.access_token_enc);
    const pending = this.locks.get(userId);
    if (pending) return pending;
    const p = (async () => {
      try {
        const t = await zohoToken(
          r.accounts_server,
          {
            grant_type: "refresh_token",
            refresh_token: this.vault.decrypt(r.refresh_token_enc),
            client_id: this.config.ZOHO_CLIENT_ID!,
            client_secret: this.config.ZOHO_CLIENT_SECRET!,
          },
          this.fetchImpl,
        );
        this.db
          .prepare("UPDATE mail_accounts SET access_token_enc = ?, access_expires_at = ?, needs_reconnect = 0, updated_at = ? WHERE user_id = ?")
          .run(this.vault.encrypt(t.access_token), Date.now() + t.expires_in * 1000, Date.now(), userId);
        return t.access_token;
      } catch (e) {
        if (e instanceof MailError && e.code === "reconnect") this.markReconnect(userId);
        throw e;
      } finally {
        this.locks.delete(userId);
      }
    })();
    this.locks.set(userId, p);
    return p;
  }

  private markReconnect(userId: string) {
    this.db.prepare("UPDATE mail_accounts SET needs_reconnect = 1, updated_at = ? WHERE user_id = ?").run(Date.now(), userId);
  }

  /** Returns the signed-in user's mailbox client. */
  client(user: UserRow): MailboxClient {
    const r = this.row(user.id);
    if (!r) throw new MailError(tr("Your mailbox is not connected yet.", "Dein Postfach ist noch nicht verbunden."), "not_connected", 409);
    if (r.provider === "demo") {
      let m = this.mocks.get(user.id);
      if (!m) {
        m = new MockMailbox({ email: user.email, name: user.name });
        this.mocks.set(user.id, m);
      }
      return m;
    }
    if (this.mode !== "zoho") throw new MailError(tr("The Zoho integration is not configured on the server.", "Die Zoho-Anbindung ist auf dem Server nicht konfiguriert."), "disabled", 503);
    return new ZohoMailbox({
      accountId: r.account_id,
      mailApi: r.mail_api,
      token: (force) => this.accessToken(user.id, !!force),
      onReconnectNeeded: () => this.markReconnect(user.id),
      fetch: this.fetchImpl,
    });
  }

  /** The signed-in user's calendar (same Zoho sign-in as the mailbox). */
  calendar(user: UserRow): CalendarClient {
    const r = this.row(user.id);
    if (!r) throw new MailError(tr("Connect your mailbox first – the calendar uses the same Zoho sign-in.", "Verbinde zuerst dein Postfach – der Kalender nutzt dieselbe Zoho-Anmeldung."), "not_connected", 409);
    if (r.provider === "demo") {
      let c = this.mockCalendars.get(user.id);
      if (!c) {
        c = new MockCalendar(user.email);
        this.mockCalendars.set(user.id, c);
      }
      return c;
    }
    if (this.mode !== "zoho") throw new MailError(tr("The Zoho integration is not configured on the server.", "Die Zoho-Anbindung ist auf dem Server nicht konfiguriert."), "disabled", 503);
    return new ZohoCalendar({ api: calendarApiFor(r.mail_api), email: r.email, token: (force) => this.accessToken(user.id, !!force), fetch: this.fetchImpl });
  }

  /** Sender address: the chosen alias, otherwise the main address. */
  fromAddress(user: UserRow, preferred?: string) {
    const st = this.status(user);
    const list = st.addresses ?? [];
    if (preferred && list.includes(preferred.toLowerCase())) return preferred.toLowerCase();
    return st.email ?? user.email;
  }

  async folders(user: UserRow) {
    const hit = this.folderCache.get(user.id);
    if (hit && hit.at > Date.now() - 5 * 60_000) return hit.folders;
    const folders = await this.client(user).folders();
    this.folderCache.set(user.id, { at: Date.now(), folders });
    return folders;
  }

  async unread(user: UserRow, fresh = false) {
    const hit = this.unreadCache.get(user.id);
    if (!fresh && hit && hit.at > Date.now() - 60_000) return hit.n;
    const folders = await this.folders(user);
    const inbox = folders.find((f) => f.type === "inbox");
    const n = await this.client(user).unreadCount(inbox?.id);
    this.unreadCache.set(user.id, { at: Date.now(), n });
    return n;
  }

  invalidateUnread(userId: string) {
    this.unreadCache.delete(userId);
  }
}
