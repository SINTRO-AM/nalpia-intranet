import type { Address } from "../lib/util.js";

export type FolderType = "inbox" | "sent" | "drafts" | "spam" | "trash" | "outbox" | "templates" | "snoozed" | "archive" | "custom";

export interface MailFolder {
  id: string;
  name: string;
  type: FolderType;
  path: string;
}

export interface MailSummary {
  id: string;
  folderId: string;
  threadId: string | null;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: number;
  snippet: string;
  unread: boolean;
  hasAttachment: boolean;
  flagged: boolean;
}

export interface MailAttachment {
  id: string;
  name: string;
  size: number;
}

export interface MailMessage extends MailSummary {
  html: string;
  attachments: MailAttachment[];
}

export interface MailAccountInfo {
  accountId: string;
  email: string;
  displayName: string;
  addresses: string[];
}

export interface SendInput {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  reply?: { messageId: string; folderId: string };
  mode: "send" | "draft";
}

export interface ListOptions {
  folderId?: string;
  start: number;
  limit: number;
  unreadOnly?: boolean;
  search?: string;
}

/** Access to exactly ONE mailbox – the signed-in user's. */
export interface MailboxClient {
  folders(): Promise<MailFolder[]>;
  list(o: ListOptions): Promise<MailSummary[]>;
  get(folderId: string, messageId: string): Promise<MailMessage>;
  setRead(ids: string[], read: boolean): Promise<void>;
  send(input: SendInput): Promise<{ ok: true }>;
  attachment(folderId: string, messageId: string, attachmentId: string): Promise<{ body: ReadableStream<Uint8Array> | ArrayBuffer; type: string; name: string }>;
  unreadCount(folderId?: string): Promise<number>;
}

export class MailError extends Error {
  constructor(
    message: string,
    public code: "not_connected" | "reconnect" | "upstream" | "not_found" | "invalid" | "mismatch" | "disabled" | "denied" | "no_refresh" | "unknown_dc",
    public status = 502,
  ) {
    super(message);
  }
}
