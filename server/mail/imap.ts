/**
 * Mailbox via IMAP (read) and SMTP (send) – used for Spacemail (mail.spacemail.com), works with any
 * standard IMAP/SMTP host. Every person connects their own mailbox with their own mailbox password;
 * the password is stored encrypted (AES-256-GCM) and only used for this person's connection.
 *
 * IDs: the routes and the agent expect numeric IDs that identify a message without knowing the folder
 * (Zoho heritage). Folder IDs are a CRC32 of the folder path; message IDs are the folder ID followed by
 * the IMAP UID padded to 10 digits – so every message ID also carries its folder.
 */
import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { Address } from "../lib/util.js";
import { escapeHtml, htmlToText, textToHtml } from "../lib/util.js";
import { tr } from "../lib/i18n.js";
import { MailError, type FolderType, type ListOptions, type MailboxClient, type MailFolder, type MailMessage, type MailSummary, type SendInput } from "./types.js";

export interface ImapSettings {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** TLS from the first byte (993/465). false = STARTTLS (143/587). */
  secure: boolean;
  /** Only for local tests with a self-signed certificate */
  allowSelfSigned?: boolean;
}

export interface ImapCredentials {
  user: string;
  pass: string;
}

/* ---------- IDs ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Stable numeric folder ID from the folder path (CRC32, 1–10 digits). */
export function folderIdFor(path: string): string {
  let c = 0xffffffff;
  for (const b of Buffer.from(path, "utf8")) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return String(((c ^ 0xffffffff) >>> 0) || 1);
}

export function messageIdFor(folderId: string, uid: number): string {
  return `${folderId}${String(uid).padStart(10, "0")}`;
}

export function parseMessageId(id: string): { folderId: string; uid: number } {
  if (!/^\d{11,20}$/.test(id)) throw new MailError(tr("Invalid message ID.", "Ungültige Nachrichten-ID."), "invalid", 400);
  return { folderId: id.slice(0, -10), uid: Number(id.slice(-10)) };
}

/* ---------- Helpers ---------- */

const SPECIAL: Record<string, FolderType> = {
  "\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Junk": "spam",
  "\\Trash": "trash",
  "\\Archive": "archive",
};

function folderType(f: ListResponse): FolderType {
  if (f.path.toUpperCase() === "INBOX") return "inbox";
  if (f.specialUse && SPECIAL[f.specialUse]) return SPECIAL[f.specialUse]!;
  return "custom";
}

const addr = (a?: { name?: string; address?: string }): Address => ({ name: (a?.name ?? "").trim(), email: (a?.address ?? "").toLowerCase() });

function hasAttachment(s?: MessageStructureObject): boolean {
  if (!s) return false;
  if (s.disposition === "attachment") return true;
  return (s.childNodes ?? []).some(hasAttachment);
}

function parsedAddrs(a: AddressObject | AddressObject[] | undefined): Address[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list.flatMap((x) => x.value).map((v) => ({ name: (v.name ?? "").trim(), email: (v.address ?? "").toLowerCase() }));
}

function snippetOf(p: ParsedMail): string {
  const text = p.text ?? (p.html ? htmlToText(p.html) : "");
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function translateError(e: unknown): never {
  if (e instanceof MailError) throw e;
  const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed/i.test(`${err?.responseText ?? ""} ${err?.message ?? ""}`)) {
    throw new MailError(tr("The mailbox rejected the password. Please connect your mailbox again with the current password.", "Das Postfach hat das Passwort abgelehnt. Bitte verbinde dein Postfach mit dem aktuellen Passwort neu."), "reconnect", 401);
  }
  if (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT") {
    throw new MailError(tr("The mail server cannot be reached right now. Please try again in a moment.", "Der Mailserver ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal."), "upstream", 502);
  }
  throw new MailError(tr("The mail server reported an error: ", "Der Mailserver meldet einen Fehler: ") + (err?.responseText || err?.message || "unknown"), "upstream", 502);
}

/* ---------- Connection pool (one IMAP connection per person, closed when idle) ---------- */

interface PoolEntry {
  client: ImapFlow;
  ready: Promise<void>;
  timer?: NodeJS.Timeout;
}

const IDLE_MS = 90_000;

export class ImapPool {
  private entries = new Map<string, PoolEntry>();

  constructor(private settings: ImapSettings) {}

  private open(key: string, cred: ImapCredentials): PoolEntry {
    const client = new ImapFlow({
      host: this.settings.imapHost,
      port: this.settings.imapPort,
      secure: this.settings.secure,
      auth: { user: cred.user, pass: cred.pass },
      logger: false,
      emitLogs: false,
      tls: this.settings.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
    });
    const entry: PoolEntry = { client, ready: client.connect() };
    const drop = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      if (entry.timer) clearTimeout(entry.timer);
    };
    client.on("close", drop);
    client.on("error", drop);
    entry.ready.catch(drop);
    this.entries.set(key, entry);
    return entry;
  }

  /** Runs fn with a connected client for this person; reconnects once if the connection was lost. */
  async use<T>(key: string, cred: ImapCredentials, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let entry = this.entries.get(key);
      if (!entry || !entry.client.usable) entry = this.open(key, cred);
      try {
        await entry.ready;
      } catch (e) {
        this.drop(key);
        translateError(e);
      }
      if (entry.timer) clearTimeout(entry.timer);
      try {
        return await fn(entry.client);
      } catch (e) {
        const lost = !entry.client.usable;
        if (lost && attempt === 0) {
          this.drop(key);
          continue;
        }
        translateError(e);
      } finally {
        if (this.entries.get(key) === entry) {
          entry.timer = setTimeout(() => this.drop(key), IDLE_MS);
          entry.timer.unref();
        }
      }
    }
  }

  drop(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    if (e.timer) clearTimeout(e.timer);
    e.client.logout().catch(() => e.client.close());
  }

  closeAll() {
    for (const k of [...this.entries.keys()]) this.drop(k);
  }
}

/** Checks the credentials against IMAP and SMTP before they are stored. */
export async function verifyImapLogin(settings: ImapSettings, cred: ImapCredentials): Promise<{ folders: number }> {
  const client = new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.secure,
    auth: cred,
    logger: false,
    tls: settings.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  let folders = 0;
  try {
    await client.connect();
    folders = (await client.list()).length;
  } catch (e) {
    translateError(e);
  } finally {
    await client.logout().catch(() => client.close());
  }
  const smtp = smtpTransport(settings, cred);
  try {
    await smtp.verify();
  } catch (e) {
    const err = e as { code?: string; responseCode?: number };
    if (err.code === "EAUTH" || err.responseCode === 535) {
      throw new MailError(tr("Reading works, but the outgoing server (SMTP) rejected the password.", "Lesen klappt, aber der Postausgangsserver (SMTP) hat das Passwort abgelehnt."), "reconnect", 401);
    }
    throw new MailError(tr("The outgoing server (SMTP) cannot be reached: ", "Der Postausgangsserver (SMTP) ist nicht erreichbar: ") + ((e as Error).message ?? ""), "upstream", 502);
  } finally {
    smtp.close();
  }
  return { folders };
}

function smtpTransport(settings: ImapSettings, cred: ImapCredentials) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465 ? true : settings.secure && settings.smtpPort !== 587 && settings.smtpPort !== 25,
    auth: cred,
    tls: settings.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/* ---------- Mailbox ---------- */

export class ImapMailbox implements MailboxClient {
  private folderList?: MailFolder[];

  constructor(
    private o: {
      key: string;
      pool: ImapPool;
      settings: ImapSettings;
      cred: ImapCredentials;
      displayName: string;
      onReconnectNeeded: () => void;
    },
  ) {}

  private async run<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    try {
      return await this.o.pool.use(this.o.key, this.o.cred, fn);
    } catch (e) {
      if (e instanceof MailError && e.code === "reconnect") {
        this.o.pool.drop(this.o.key);
        this.o.onReconnectNeeded();
      }
      throw e;
    }
  }

  async folders(): Promise<MailFolder[]> {
    if (this.folderList) return this.folderList;
    const list = await this.run((c) => c.list());
    const order: FolderType[] = ["inbox", "drafts", "sent", "archive", "spam", "trash", "custom"];
    this.folderList = list
      .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent"))
      .map((f) => ({ id: folderIdFor(f.path), name: f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name, type: folderType(f), path: f.path }))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.path.localeCompare(b.path));
    return this.folderList;
  }

  private async folder(folderId?: string): Promise<MailFolder> {
    const list = await this.folders();
    const f = folderId ? list.find((x) => x.id === folderId) : list.find((x) => x.type === "inbox");
    if (!f) throw new MailError(tr("This folder no longer exists.", "Diesen Ordner gibt es nicht mehr."), "not_found", 404);
    return f;
  }

  private async folderOfType(type: FolderType): Promise<MailFolder | undefined> {
    return (await this.folders()).find((f) => f.type === type);
  }

  private summary(f: MailFolder, m: FetchMessageObject): MailSummary {
    const env = m.envelope ?? {};
    const flags = m.flags ?? new Set<string>();
    const date = env.date ? new Date(env.date).getTime() : m.internalDate ? new Date(m.internalDate).getTime() : 0;
    return {
      id: messageIdFor(f.id, m.uid),
      folderId: f.id,
      threadId: null,
      subject: env.subject ?? "",
      from: addr(env.from?.[0]),
      to: (env.to ?? []).map(addr),
      cc: (env.cc ?? []).map(addr),
      date: Number.isFinite(date) ? date : 0,
      snippet: "",
      unread: !flags.has("\\Seen"),
      hasAttachment: hasAttachment(m.bodyStructure),
      flagged: flags.has("\\Flagged"),
    };
  }

  async list(o: ListOptions): Promise<MailSummary[]> {
    const f = await this.folder(o.folderId);
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(f.path, { readOnly: true });
      try {
        const mb = c.mailbox;
        const exists = mb && typeof mb === "object" ? mb.exists : 0;
        if (!exists) return [];
        let uids: number[] | null = null;
        if (o.unreadOnly || o.search) {
          const q = o.search?.trim();
          const query: Record<string, unknown> = {};
          if (o.unreadOnly) query.seen = false;
          if (q) query.or = [{ subject: q }, { from: q }, { to: q }];
          const found = await c.search(query, { uid: true });
          uids = (found || []).sort((a, b) => b - a).slice(o.start - 1, o.start - 1 + o.limit);
          if (!uids.length) return [];
        }
        const query = { uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true } as const;
        let msgs: FetchMessageObject[];
        if (uids) {
          msgs = await c.fetchAll(uids.join(","), query, { uid: true });
        } else {
          const hi = exists - (o.start - 1);
          if (hi < 1) return [];
          const lo = Math.max(1, hi - o.limit + 1);
          msgs = await c.fetchAll(`${lo}:${hi}`, query);
        }
        return msgs.sort((a, b) => b.uid - a.uid).map((m) => this.summary(f, m));
      } finally {
        lock.release();
      }
    });
  }

  private async source(folderId: string, uid: number): Promise<{ f: MailFolder; m: FetchMessageObject; p: ParsedMail }> {
    const f = await this.folder(folderId);
    const m = await this.run(async (c) => {
      const lock = await c.getMailboxLock(f.path, { readOnly: true });
      try {
        return await c.fetchOne(String(uid), { uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true, source: true }, { uid: true });
      } finally {
        lock.release();
      }
    });
    if (!m || !m.source) throw new MailError(tr("This email was not found – it may have been moved or deleted.", "Diese E-Mail wurde nicht gefunden – evtl. verschoben oder gelöscht."), "not_found", 404);
    const p = await simpleParser(m.source, { skipImageLinks: true });
    return { f, m, p };
  }

  async get(folderId: string, messageId: string): Promise<MailMessage> {
    const { uid } = parseMessageId(messageId);
    const { f, m, p } = await this.source(folderId, uid);
    const base = this.summary(f, m);
    return {
      ...base,
      subject: p.subject ?? base.subject,
      from: parsedAddrs(p.from)[0] ?? base.from,
      to: parsedAddrs(p.to),
      cc: parsedAddrs(p.cc),
      snippet: snippetOf(p),
      html: typeof p.html === "string" && p.html ? p.html : textToHtml(p.text ?? ""),
      attachments: p.attachments
        .map((a, i) => ({ id: String(i + 1), name: a.filename ?? `attachment-${i + 1}`, size: a.size, inline: a.contentDisposition === "inline" && !!a.cid }))
        .filter((a) => !a.inline)
        .map(({ inline: _, ...a }) => a),
      hasAttachment: p.attachments.some((a) => a.contentDisposition !== "inline"),
    };
  }

  async setRead(ids: string[], read: boolean): Promise<void> {
    const byFolder = new Map<string, number[]>();
    for (const id of ids) {
      const { folderId, uid } = parseMessageId(id);
      byFolder.set(folderId, [...(byFolder.get(folderId) ?? []), uid]);
    }
    for (const [folderId, uids] of byFolder) {
      const f = await this.folder(folderId);
      await this.run(async (c) => {
        const lock = await c.getMailboxLock(f.path);
        try {
          if (read) await c.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
          else await c.messageFlagsRemove(uids.join(","), ["\\Seen"], { uid: true });
        } finally {
          lock.release();
        }
      });
    }
  }

  async send(input: SendInput): Promise<{ ok: true }> {
    let inReplyTo: string | undefined;
    let references: string[] | undefined;
    let replyRef: { folderId: string; uid: number } | undefined;
    if (input.reply) {
      try {
        const { uid } = parseMessageId(input.reply.messageId);
        const { p } = await this.source(input.reply.folderId, uid);
        inReplyTo = p.messageId;
        const prev = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
        references = [...prev, ...(p.messageId ? [p.messageId] : [])].slice(-20);
        replyRef = { folderId: input.reply.folderId, uid };
      } catch {
        /* threading headers are optional */
      }
    }
    const from = this.o.displayName ? { name: this.o.displayName, address: input.from } : input.from;
    const mail = {
      from,
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      bcc: input.bcc.length ? input.bcc : undefined,
      subject: input.subject,
      html: input.html,
      text: htmlToText(input.html),
      inReplyTo,
      references,
    };
    const raw = await new Promise<Buffer>((resolve, reject) =>
      new MailComposer({ ...mail, bcc: undefined }).compile().build((err, msg) => (err ? reject(err) : resolve(msg))),
    );

    if (input.mode === "draft") {
      const drafts = await this.folderOfType("drafts");
      if (!drafts) throw new MailError(tr("Your mailbox has no drafts folder.", "Dein Postfach hat keinen Entwürfe-Ordner."), "upstream", 502);
      await this.run((c) => c.append(drafts.path, raw, ["\\Draft", "\\Seen"]));
      return { ok: true };
    }

    const smtp = smtpTransport(this.o.settings, this.o.cred);
    try {
      await smtp.sendMail(mail);
    } catch (e) {
      const err = e as { code?: string; responseCode?: number; message?: string };
      if (err.code === "EAUTH" || err.responseCode === 535) {
        this.o.onReconnectNeeded();
        throw new MailError(tr("The outgoing server rejected the password. Please connect your mailbox again.", "Der Postausgangsserver hat das Passwort abgelehnt. Bitte verbinde dein Postfach neu."), "reconnect", 401);
      }
      if (err.code === "EENVELOPE") throw new MailError(tr("A recipient address was rejected: ", "Eine Empfängeradresse wurde abgelehnt: ") + (err.message ?? ""), "invalid", 400);
      throw new MailError(tr("Sending failed: ", "Senden fehlgeschlagen: ") + escapeHtml(err.message ?? ""), "upstream", 502);
    } finally {
      smtp.close();
    }

    // Keep a copy in "Sent" (SMTP does not do that by itself) and mark the original as answered
    const sent = await this.folderOfType("sent");
    if (sent) await this.run((c) => c.append(sent.path, raw, ["\\Seen"])).catch(() => undefined);
    if (replyRef) {
      const f = await this.folder(replyRef.folderId).catch(() => undefined);
      if (f) {
        await this.run(async (c) => {
          const lock = await c.getMailboxLock(f.path);
          try {
            await c.messageFlagsAdd(String(replyRef!.uid), ["\\Answered"], { uid: true });
          } finally {
            lock.release();
          }
        }).catch(() => undefined);
      }
    }
    return { ok: true };
  }

  async attachment(folderId: string, messageId: string, attachmentId: string) {
    const { uid } = parseMessageId(messageId);
    const { p } = await this.source(folderId, uid);
    const a = p.attachments[Number(attachmentId) - 1];
    if (!a) throw new MailError(tr("This attachment was not found.", "Dieser Anhang wurde nicht gefunden."), "not_found", 404);
    const buf = a.content;
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { body, type: a.contentType || "application/octet-stream", name: a.filename ?? `attachment-${attachmentId}` };
  }

  async unreadCount(folderId?: string): Promise<number> {
    const f = await this.folder(folderId);
    const st = await this.run((c) => c.status(f.path, { unseen: true }));
    return st ? (st.unseen ?? 0) : 0;
  }
}
