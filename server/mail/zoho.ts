import { decodeEntities, lazyLabels, parseAddresses } from "../lib/util.js";
import {
  MailError,
  type FolderType,
  type ListOptions,
  type MailAccountInfo,
  type MailAttachment,
  type MailboxClient,
  type MailFolder,
  type MailMessage,
  type MailSummary,
  type SendInput,
} from "./types.js";
import { tr } from "../lib/i18n.js";

/** Minimal permissions: read account, read folders, read/send/mark messages, read calendars and manage events. */
export const ZOHO_SCOPES = ["ZohoMail.accounts.READ", "ZohoMail.folders.READ", "ZohoMail.messages.ALL", "ZohoCalendar.calendar.READ", "ZohoCalendar.event.ALL"].join(",");

/** Known Zoho data centers: accounts server → mail API host. */
const DC_LIST: Record<string, string> = {
  "accounts.zoho.com": "https://mail.zoho.com",
  "accounts.zoho.eu": "https://mail.zoho.eu",
  "accounts.zoho.in": "https://mail.zoho.in",
  "accounts.zoho.com.au": "https://mail.zoho.com.au",
  "accounts.zoho.jp": "https://mail.zoho.jp",
  "accounts.zohocloud.ca": "https://mail.zohocloud.ca",
  "accounts.zoho.sa": "https://mail.zoho.sa",
  "accounts.zoho.uk": "https://mail.zoho.uk",
  "accounts.zoho.com.cn": "https://mail.zoho.com.cn",
};
/** Map instead of object lookup: names like "constructor" or "__proto__" must never match. */
const DC = new Map(Object.entries(DC_LIST));

export interface ZohoEndpoints {
  accountsServer: string;
  mailApi: string;
}

/**
 * Validates the `accounts-server` returned by the callback against the known list
 * (prevents tokens from being sent to foreign hosts).
 */
export function resolveEndpoints(raw: string | undefined, defaultAccounts: string, mailOverride?: string): ZohoEndpoints | null {
  const candidate = (raw || defaultAccounts).replace(/\/+$/, "");
  if (candidate === defaultAccounts.replace(/\/+$/, "")) {
    let host = "";
    try {
      host = new URL(candidate).host;
    } catch {
      return null;
    }
    const api = mailOverride || DC.get(host);
    return api ? { accountsServer: candidate, mailApi: api.replace(/\/+$/, "") } : null;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const api = DC.get(url.host);
  if (url.protocol !== "https:" || url.pathname.replace(/\/+$/, "") !== "" || url.username || url.password || url.port || !api) return null;
  return { accountsServer: url.origin, mailApi: api };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  api_domain?: string;
}

export async function zohoToken(accountsServer: string, params: Record<string, string>, fetchImpl = fetch): Promise<TokenResponse> {
  const res = await fetchImpl(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!res.ok || typeof data.access_token !== "string") {
    const err = String(data.error ?? res.status);
    const reconnect = ["invalid_code", "invalid_client", "invalid_grant", "invalid_token", "access_denied"].includes(err);
    throw new MailError(
      reconnect ? tr("The connection to Zoho has expired. Please reconnect your mailbox.", "Die Verbindung zu Zoho ist abgelaufen. Bitte verbinde dein Postfach neu.") : tr(`Zoho sign-in failed (${err}).`, `Zoho-Anmeldung fehlgeschlagen (${err}).`),
      reconnect ? "reconnect" : "upstream",
    );
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token as string | undefined, expires_in: Number(data.expires_in ?? 3600), api_domain: data.api_domain as string | undefined };
}

export async function zohoRevoke(accountsServer: string, refreshToken: string, fetchImpl = fetch) {
  try {
    await fetchImpl(`${accountsServer}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
  } catch {
    /* revocation is best effort */
  }
}

/**
 * JSON.parse that keeps long integers (≥16 digits, e.g. Zoho IDs) as strings
 * instead of rounding them to doubles.
 */
export function parseLosslessJson(text: string): unknown {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "-" && /[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      const isFloat = /[.eE]/.test(text[j] ?? "");
      const num = text.slice(i, j);
      out += !isFloat && num.replace("-", "").length >= 16 ? `"${num}"` : num;
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

const ID_RE = /^\d{1,24}$/;
function assertId(v: string, what: string) {
  if (!ID_RE.test(v)) throw new MailError(tr(`Invalid ${what}.`, `Ungültige ${what}.`), "invalid", 400);
}

function folderType(f: { folderType?: string; path?: string; folderName?: string }): FolderType {
  const t = (f.folderType ?? "").toLowerCase();
  const path = (f.path ?? "").toLowerCase();
  if (t === "inbox") return path === "/inbox" ? "inbox" : "custom";
  if (t === "sent") return "sent";
  if (t === "drafts") return "drafts";
  if (t === "spam") return "spam";
  if (t === "trash") return "trash";
  if (t === "outbox") return "outbox";
  if (t === "templates") return "templates";
  if (t === "snoozed") return "snoozed";
  if ((f.folderName ?? "").toLowerCase() === "archive" || path === "/archive") return "archive";
  return "custom";
}

/** Display names of the system folders, in the language of the request */
const FOLDER_NAMES: Partial<Record<FolderType, string>> = lazyLabels({
  inbox: ["Inbox", "Posteingang"],
  sent: ["Sent", "Gesendet"],
  drafts: ["Drafts", "Entwürfe"],
  spam: ["Spam", "Spam"],
  trash: ["Trash", "Papierkorb"],
  outbox: ["Outbox", "Postausgang"],
  templates: ["Templates", "Vorlagen"],
  snoozed: ["Snoozed", "Zurückgestellt"],
  archive: ["Archive", "Archiv"],
});

type Raw = Record<string, unknown>;

export function mapZohoSummary(m: Raw): MailSummary {
  const fromEmail = String(m.fromAddress ?? "").toLowerCase();
  let fromName = decodeEntities(String(m.sender ?? ""));
  if (fromName.toLowerCase() === fromEmail) fromName = "";
  const flag = String(m.flagid ?? "flag_not_set");
  return {
    id: String(m.messageId ?? ""),
    folderId: String(m.folderId ?? ""),
    threadId: m.threadId ? String(m.threadId) : null,
    subject: decodeEntities(String(m.subject ?? "")).trim() || tr("(no subject)", "(kein Betreff)"),
    from: { name: fromName, email: fromEmail },
    to: parseAddresses(m.toAddress as string | undefined),
    cc: parseAddresses(m.ccAddress as string | undefined),
    date: Number(m.receivedTime ?? m.sentDateInGMT ?? 0) || 0,
    snippet: decodeEntities(String(m.summary ?? "")).replace(/\s+/g, " ").trim().slice(0, 280),
    unread: String(m.status) === "0",
    hasAttachment: String(m.hasAttachment) === "1" || m.hasAttachment === true || String(m.hasAttachment) === "true",
    flagged: flag !== "flag_not_set" && flag !== "0" && flag !== "",
  };
}

export class ZohoMailbox implements MailboxClient {
  constructor(
    private o: {
      accountId: string;
      mailApi: string;
      token: (force?: boolean) => Promise<string>;
      onReconnectNeeded: () => void;
      fetch?: typeof fetch;
    },
  ) {
    assertId(o.accountId, tr("account ID", "Konto-ID"));
  }

  private get f() {
    return this.o.fetch ?? fetch;
  }

  private async request(method: string, path: string, opts: { query?: Record<string, string | number | boolean | undefined>; json?: string; raw?: boolean } = {}, retried = false): Promise<Response | unknown> {
    const url = new URL(`${this.o.mailApi}/api/accounts/${this.o.accountId}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = await this.o.token(retried);
    const res = await this.f(url, {
      method,
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        accept: opts.raw ? "application/octet-stream" : "application/json",
        ...(opts.json ? { "content-type": "application/json" } : {}),
      },
      body: opts.json,
      signal: AbortSignal.timeout(25_000),
    });
    if (opts.raw && res.ok) return res;
    const text = await res.text();
    let data: Raw = {};
    try {
      data = parseLosslessJson(text) as Raw;
    } catch {
      /* not JSON */
    }
    const errorCode = String((data.data as Raw | undefined)?.errorCode ?? "");
    const tokenProblem = res.status === 401 || /INVALID_OAUTHTOKEN|INVALID_TICKET|OAUTH_SCOPE_MISMATCH/i.test(errorCode);
    if (tokenProblem && !retried) return this.request(method, path, opts, true);
    if (tokenProblem) {
      this.o.onReconnectNeeded();
      throw new MailError(tr("Zoho denied access. Please reconnect your mailbox.", "Zoho hat den Zugriff abgelehnt. Bitte verbinde dein Postfach neu."), "reconnect", 409);
    }
    const statusCode = Number((data.status as Raw | undefined)?.code ?? res.status);
    if (!res.ok || statusCode >= 400) {
      if (res.status === 404 || statusCode === 404) throw new MailError(tr("This message was not found – it may have been moved or deleted.", "Diese Nachricht wurde nicht gefunden – evtl. verschoben oder gelöscht."), "not_found", 404);
      const desc = String((data.status as Raw | undefined)?.description ?? res.statusText ?? "");
      throw new MailError(tr(`Zoho reported an error${desc ? `: ${desc}` : ""}.`, `Zoho meldet einen Fehler${desc ? `: ${desc}` : ""}.`), "upstream", 502);
    }
    return data.data;
  }

  async folders(): Promise<MailFolder[]> {
    const data = (await this.request("GET", "/folders")) as Raw[];
    return (Array.isArray(data) ? data : []).map((f) => {
      const type = folderType(f as { folderType?: string; path?: string; folderName?: string });
      return {
        id: String(f.folderId),
        type,
        name: FOLDER_NAMES[type] ?? decodeEntities(String(f.folderName ?? tr("Folder", "Ordner"))),
        path: String(f.path ?? ""),
      };
    });
  }

  async list(o: ListOptions): Promise<MailSummary[]> {
    if (o.folderId) assertId(o.folderId, tr("folder ID", "Ordner-ID"));
    let data: unknown;
    if (o.search) {
      const term = o.search.replace(/[:"]/g, " ").trim();
      data = await this.request("GET", "/messages/search", {
        query: { searchKey: `entire:${term}`, start: o.start, limit: o.limit, includeto: true, receivedTime: Date.now() + 60_000 },
      });
    } else {
      data = await this.request("GET", "/messages/view", {
        query: { folderId: o.folderId, start: o.start, limit: o.limit, status: o.unreadOnly ? "unread" : "all", includeto: true, sortorder: false },
      });
    }
    return (Array.isArray(data) ? (data as Raw[]) : []).map(mapZohoSummary);
  }

  async get(folderId: string, messageId: string): Promise<MailMessage> {
    assertId(folderId, tr("folder ID", "Ordner-ID"));
    assertId(messageId, tr("message ID", "Nachrichten-ID"));
    const base = `/folders/${folderId}/messages/${messageId}`;
    const [details, content, attach] = await Promise.all([
      this.request("GET", `${base}/details`) as Promise<Raw>,
      this.request("GET", `${base}/content`, { query: { includeBlockContent: true } }) as Promise<Raw>,
      (this.request("GET", `${base}/attachmentinfo`) as Promise<Raw>).catch(() => ({}) as Raw),
    ]);
    const summary = mapZohoSummary({ ...(details ?? {}), messageId, folderId });
    const list = Array.isArray((attach as Raw)?.attachments) ? ((attach as Raw).attachments as Raw[]) : [];
    const attachments: MailAttachment[] = list.map((a) => ({
      id: String(a.attachmentId),
      name: decodeEntities(String(a.attachmentName ?? tr("Attachment", "Anhang"))),
      size: Number(a.attachmentSize ?? 0),
    }));
    return { ...summary, html: String((content as Raw)?.content ?? ""), attachments };
  }

  async setRead(ids: string[], read: boolean) {
    ids.forEach((id) => assertId(id, tr("message ID", "Nachrichten-ID")));
    if (!ids.length) return;
    // IDs as JSON numbers without rounding (they exceed Number.MAX_SAFE_INTEGER)
    const json = `{"mode":"${read ? "markAsRead" : "markAsUnread"}","messageId":[${ids.join(",")}]}`;
    await this.request("PUT", "/updatemessage", { json });
  }

  async send(input: SendInput) {
    const payload: Record<string, unknown> = {
      fromAddress: input.from,
      toAddress: input.to.join(","),
      ccAddress: input.cc.length ? input.cc.join(",") : undefined,
      bccAddress: input.bcc.length ? input.bcc.join(",") : undefined,
      subject: input.subject,
      content: input.html,
      mailFormat: "html",
      askReceipt: "no",
      encoding: "UTF-8",
    };
    if (input.mode === "draft") {
      payload.mode = "draft";
      await this.request("POST", "/messages", { json: JSON.stringify(payload) });
    } else if (input.reply) {
      assertId(input.reply.messageId, tr("message ID", "Nachrichten-ID"));
      payload.action = "reply";
      await this.request("POST", `/messages/${input.reply.messageId}`, { json: JSON.stringify(payload) });
    } else {
      await this.request("POST", "/messages", { json: JSON.stringify(payload) });
    }
    return { ok: true as const };
  }

  async attachment(folderId: string, messageId: string, attachmentId: string) {
    assertId(folderId, tr("folder ID", "Ordner-ID"));
    assertId(messageId, tr("message ID", "Nachrichten-ID"));
    assertId(attachmentId, tr("attachment ID", "Anhang-ID"));
    const res = (await this.request("GET", `/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`, { raw: true })) as Response;
    const disposition = res.headers.get("content-disposition") ?? "";
    const m = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    return {
      body: res.body ?? (await res.arrayBuffer()),
      type: res.headers.get("content-type") ?? "application/octet-stream",
      name: m ? decodeURIComponent(m[1]!) : tr("attachment", "anhang"),
    };
  }

  async unreadCount(folderId?: string) {
    const data = (await this.request("GET", "/messages/view", {
      query: { folderId, status: "unread", start: 1, limit: 100 },
    })) as unknown[];
    return Array.isArray(data) ? data.length : 0;
  }
}

export async function zohoAccountInfo(mailApi: string, accessToken: string, fetchImpl = fetch): Promise<MailAccountInfo> {
  const res = await fetchImpl(`${mailApi}/api/accounts`, {
    headers: { authorization: `Zoho-oauthtoken ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const json = parseLosslessJson(text) as Raw;
  const list = Array.isArray(json?.data) ? (json.data as Raw[]) : [];
  const acc = list.find((a) => a.isDefaultAccount === true || a.type === "ZOHO_ACCOUNT") ?? list[0];
  if (!res.ok || !acc) throw new MailError(tr("Could not read the Zoho account.", "Zoho-Konto konnte nicht gelesen werden."), "upstream");
  const primary = String(acc.primaryEmailAddress ?? acc.mailboxAddress ?? acc.incomingUserName ?? "").toLowerCase();
  const addresses = new Set<string>([primary]);
  for (const e of (acc.emailAddress as Raw[] | undefined) ?? []) if (e.mailId && e.isConfirmed !== false) addresses.add(String(e.mailId).toLowerCase());
  for (const s of (acc.sendMailDetails as Raw[] | undefined) ?? []) if (s.fromAddress && s.status !== false) addresses.add(String(s.fromAddress).toLowerCase());
  return {
    accountId: String(acc.accountId),
    email: primary,
    displayName: decodeEntities(String(acc.displayName ?? acc.accountDisplayName ?? "")),
    addresses: [...addresses].filter(Boolean),
  };
}
