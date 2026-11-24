import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { userPrefs, type AppEnv } from "../context.js";
import { audit } from "../lib/audit.js";
import { body, HttpError, query, zMsg, zText } from "../lib/http.js";
import { escapeHtml, textToHtml } from "../lib/util.js";
import { ImportanceIndex, pickImportant } from "./important.js";
import { MailError, type MailSummary } from "./types.js";
import { localeTag, tr } from "../lib/i18n.js";

export const mailRoutes = new Hono<AppEnv>();

const zMsgId = z.string().regex(/^\d{1,24}$/, zMsg("Invalid ID", "Ungültige ID"));

mailRoutes.get("/status", (c) => c.json(c.get("deps").mail.status(c.get("user"))));

mailRoutes.post("/connect", (c) => {
  const { mail } = c.get("deps");
  return c.json({ url: mail.authorizeUrl(c.get("user")) });
});

mailRoutes.post("/disconnect", async (c) => {
  await c.get("deps").mail.disconnect(c.get("user"), c.get("ip"));
  return c.json({ ok: true });
});

mailRoutes.get("/folders", async (c) => c.json(await c.get("deps").mail.folders(c.get("user"))));

mailRoutes.get("/unread", async (c) => {
  const { mail } = c.get("deps");
  const user = c.get("user");
  if (!mail.status(user).connected) return c.json({ connected: false, unread: 0 });
  try {
    return c.json({ connected: true, unread: await mail.unread(user, c.req.query("fresh") === "1") });
  } catch (e) {
    if (e instanceof MailError) return c.json({ connected: true, unread: 0, error: e.code });
    throw e;
  }
});

mailRoutes.get("/messages", async (c) => {
  const { mail } = c.get("deps");
  const q = query(
    c,
    z.object({
      folderId: zMsgId.optional(),
      start: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(40),
      unread: z.enum(["1"]).optional(),
      q: z.string().trim().max(120).optional(),
    }),
  );
  const items = await mail.client(c.get("user")).list({
    folderId: q.folderId,
    start: q.start,
    limit: q.limit,
    unreadOnly: !!q.unread,
    search: q.q || undefined,
  });
  return c.json({ items, nextStart: items.length === q.limit ? q.start + q.limit : null });
});

/**
 * "Important": inbox filtered by senders from the CRM. Scans up to 300 emails from `start`
 * and returns the matches; `nextStart` continues the scan further back.
 */
const SCAN_PAGE = 100;
const SCAN_MAX = 300;
const importantCache = new Map<string, { at: number; value: unknown }>();
mailRoutes.get("/important", async (c) => {
  const { mail, db, config } = c.get("deps");
  const user = c.get("user");
  const q = query(c, z.object({ start: z.coerce.number().int().min(1).max(100000).default(1), fresh: z.enum(["1"]).optional() }));
  const key = `${user.id}:${q.start}`;
  const hit = importantCache.get(key);
  if (hit && !q.fresh && Date.now() - hit.at < 60_000) return c.json(hit.value);
  const inbox = (await mail.folders(user)).find((f) => f.type === "inbox");
  if (!inbox) return c.json({ items: [], nextStart: null, scanned: 0, unread: 0 });
  const st = mail.status(user);
  const index = new ImportanceIndex(db, [...config.allowedDomains, ...(st.addresses ?? []).map((a) => a.split("@")[1] ?? "")].filter(Boolean));
  const client = mail.client(user);
  const found: ReturnType<typeof pickImportant> = [];
  let start = q.start;
  let more = true;
  let scanned = 0;
  while (more && start - q.start < SCAN_MAX && found.length < 40) {
    const page: MailSummary[] = await client.list({ folderId: inbox.id, start, limit: SCAN_PAGE });
    found.push(...pickImportant(page, index));
    scanned += page.length;
    more = page.length === SCAN_PAGE;
    start += SCAN_PAGE;
  }
  const value = { items: found, nextStart: more ? start : null, scanned, unread: found.filter((m) => m.unread).length };
  if (importantCache.size > 500) importantCache.clear();
  importantCache.set(key, { at: Date.now(), value });
  return c.json(value);
});

mailRoutes.get("/messages/:folderId/:messageId", async (c) => {
  const { mail } = c.get("deps");
  const user = c.get("user");
  const folderId = zMsgId.parse(c.req.param("folderId"));
  const messageId = zMsgId.parse(c.req.param("messageId"));
  const client = mail.client(user);
  const msg = await client.get(folderId, messageId);
  if (msg.unread && c.req.query("markRead") !== "0") {
    client.setRead([messageId], true).then(
      () => mail.invalidateUnread(user.id),
      () => undefined,
    );
    msg.unread = false;
  }
  return c.json(msg);
});

mailRoutes.get("/messages/:folderId/:messageId/attachments/:attachmentId", async (c) => {
  const { mail, db } = c.get("deps");
  const folderId = zMsgId.parse(c.req.param("folderId"));
  const messageId = zMsgId.parse(c.req.param("messageId"));
  const attachmentId = zMsgId.parse(c.req.param("attachmentId"));
  const nameHint = (c.req.query("name") ?? "").slice(0, 200);
  const a = await mail.client(c.get("user")).attachment(folderId, messageId, attachmentId);
  // Only log metadata – never content
  audit(db, { userId: c.get("user").id, action: "mail.attachment", target: messageId, ip: c.get("ip") });
  const name = (nameHint || a.name).replace(/[\r\n"]/g, "_");
  c.header("content-type", "application/octet-stream");
  c.header("content-disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "private, no-store");
  if (a.body instanceof ArrayBuffer) return c.body(a.body);
  const readable = a.body;
  return stream(c, async (s) => {
    const reader = readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await s.write(value);
    }
  });
});

mailRoutes.post("/messages/read", async (c) => {
  const { mail } = c.get("deps");
  const user = c.get("user");
  const p = await body(c, z.object({ ids: z.array(zMsgId).min(1).max(100), read: z.boolean() }));
  await mail.client(user).setRead(p.ids, p.read);
  mail.invalidateUnread(user.id);
  return c.json({ ok: true });
});

const addressList = z
  .array(z.string().trim().toLowerCase().pipe(z.email(zMsg("Invalid email address", "Ungültige E-Mail-Adresse"))))
  .max(50, zMsg("At most 50 recipients", "Maximal 50 Empfänger"));

mailRoutes.post("/send", async (c) => {
  const deps = c.get("deps");
  const user = c.get("user");
  const p = await body(
    c,
    z.object({
      to: addressList.min(1, zMsg("Please enter at least one recipient.", "Bitte gib mindestens einen Empfänger an.")),
      cc: addressList.default([]),
      bcc: addressList.default([]),
      subject: zText(400),
      body: z.string().max(100_000),
      from: z.string().trim().toLowerCase().max(254).optional(),
      reply: z.object({ messageId: zMsgId, folderId: zMsgId }).optional(),
      quote: z.boolean().default(true),
      signature: z.boolean().default(true),
      mode: z.enum(["send", "draft"]).default("send"),
    }),
  );
  if (!deps.limiter.take(`mail:send:${user.id}`, 60, 3600_000)) throw new HttpError(429, tr("Too many emails in a short time. Please wait a moment.", "Zu viele Mails in kurzer Zeit. Bitte warte etwas."), "rate_limited");
  const client = deps.mail.client(user);
  const prefs = userPrefs(user);
  let html = textToHtml(p.body);
  if (p.signature && prefs.signature?.trim()) html += `<div><br></div><div style="color:#56667C">${textToHtml(prefs.signature.trim())}</div>`;
  if (p.reply && p.quote) {
    try {
      const orig = await client.get(p.reply.folderId, p.reply.messageId);
      const when = new Intl.DateTimeFormat(localeTag(), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(orig.date));
      const who = orig.from.name ? `${orig.from.name} <${orig.from.email}>` : orig.from.email;
      html += `<div><br></div><div>${escapeHtml(tr(`On ${when}, ${who} wrote:`, `Am ${when} schrieb ${who}:`))}</div><blockquote style="margin:0 0 0 4px;padding-left:12px;border-left:2px solid #C9D3E0;color:#3A4A60">${orig.html}</blockquote>`;
    } catch {
      /* quote is optional */
    }
  }
  const from = deps.mail.fromAddress(user, p.from ?? prefs.fromAddress);
  await client.send({ from, to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, html, reply: p.reply, mode: p.mode });
  const domains = [...new Set([...p.to, ...p.cc, ...p.bcc].map((e) => e.split("@")[1]))];
  audit(deps.db, {
    userId: user.id,
    action: p.mode === "draft" ? "mail.draft_saved" : p.reply ? "mail.replied" : "mail.sent",
    ip: c.get("ip"),
    meta: { recipients: p.to.length + p.cc.length + p.bcc.length, domains },
  });
  return c.json({ ok: true });
});
