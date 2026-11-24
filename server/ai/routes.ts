import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { userPrefs, type AppEnv, type Ctx } from "../context.js";
import { audit } from "../lib/audit.js";
import { body, HttpError, zText } from "../lib/http.js";
import { currentLang, localeTag, tr } from "../lib/i18n.js";
import { htmlToText } from "../lib/util.js";
import { INTENTS, TONES, type ReplySuggestions } from "./service.js";

export const aiRoutes = new Hono<AppEnv>();

const zMsgId = z.string().regex(/^\d{1,24}$/);

aiRoutes.get("/status", (c) => {
  const { ai, config } = c.get("deps");
  return c.json({ available: ai.available, mode: ai.mode, model: ai.mode === "claude" ? config.ANTHROPIC_MODEL : null });
});

function takeQuota(c: Ctx) {
  const { limiter, config, ai } = c.get("deps");
  if (!ai.available) throw new HttpError(503, tr("The AI features are not set up (ANTHROPIC_API_KEY is missing).", "Die KI-Funktionen sind nicht eingerichtet (ANTHROPIC_API_KEY fehlt)."), "ai_disabled");
  const user = c.get("user");
  if (!limiter.take(`ai:${user.id}`, config.AI_HOURLY_LIMIT, 3600_000)) {
    throw new HttpError(429, tr("You have reached the hourly AI limit. Please try again later.", "Du hast das stündliche KI-Kontingent erreicht. Bitte versuche es später erneut."), "rate_limited");
  }
}

async function loadMail(c: Ctx, folderId: string, messageId: string) {
  const { mail } = c.get("deps");
  const m = await mail.client(c.get("user")).get(folderId, messageId);
  const fmt = (a: { name: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);
  return {
    from: fmt(m.from),
    to: m.to.map(fmt).join(", "),
    date: new Intl.DateTimeFormat(localeTag(), { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(m.date)),
    subject: m.subject,
    text: htmlToText(m.html),
  };
}

aiRoutes.post("/draft", async (c) => {
  const p = await body(
    c,
    z.object({
      source: z.object({ folderId: zMsgId, messageId: zMsgId }).optional(),
      compose: z.object({ to: zText(500), subject: zText(400) }).optional(),
      intent: z.enum(Object.keys(INTENTS) as [keyof typeof INTENTS, ...(keyof typeof INTENTS)[]]).default("antworten"),
      tone: z.enum(Object.keys(TONES) as [keyof typeof TONES, ...(keyof typeof TONES)[]]).default("freundlich"),
      instruction: zText(1500).optional(),
      currentText: z.string().max(20000).optional(),
      history: z.array(zText(1500)).max(20).optional(),
    }),
  );
  takeQuota(c);
  const { ai } = c.get("deps");
  const user = c.get("user");
  const mail = p.source ? await loadMail(c, p.source.folderId, p.source.messageId) : undefined;
  audit(c.get("deps").db, { userId: user.id, action: "ai.draft", target: p.source?.messageId ?? "", ip: c.get("ip"), meta: { intent: p.intent, tone: p.tone } });
  return streamSSE(c, async (s) => {
    const ctrl = new AbortController();
    s.onAbort(() => ctrl.abort());
    try {
      const text = await ai.draft(
        { user, prefs: userPrefs(user), mail, compose: p.compose, intent: p.intent, tone: p.tone, instruction: p.instruction, currentText: p.currentText, history: p.history },
        (delta) => {
          void s.writeSSE({ event: "delta", data: JSON.stringify({ text: delta }) });
        },
        ctrl.signal,
      );
      await s.writeSSE({ event: "done", data: JSON.stringify({ text }) });
    } catch (e) {
      console.error("[ai] draft:", (e as Error).message);
      await s.writeSSE({ event: "error", data: JSON.stringify({ message: tr("The draft could not be created. Please try again.", "Der Entwurf konnte nicht erstellt werden. Bitte versuche es erneut.") }) });
    }
  });
});

aiRoutes.post("/summarize", async (c) => {
  const p = await body(c, z.object({ folderId: zMsgId, messageId: zMsgId }));
  takeQuota(c);
  const mail = await loadMail(c, p.folderId, p.messageId);
  audit(c.get("deps").db, { userId: c.get("user").id, action: "ai.summarize", target: p.messageId, ip: c.get("ip") });
  try {
    return c.json(await c.get("deps").ai.summarize(c.get("user"), mail));
  } catch (e) {
    console.error("[ai] summarize:", (e as Error).message);
    throw new HttpError(502, tr("The summary could not be created. Please try again.", "Die Zusammenfassung konnte nicht erstellt werden. Bitte versuche es erneut."), "ai_failed");
  }
});

/* ---------- Reply suggestions ---------- */

// Cache suggestions per person and e-mail for an hour: reopening the same e-mail costs no extra quota
const SUGGEST_TTL = 3600_000;
const suggestCache = new Map<string, { at: number; value: ReplySuggestions }>();

aiRoutes.post("/suggestions", async (c) => {
  const p = await body(c, z.object({ folderId: zMsgId, messageId: zMsgId, refresh: z.boolean().optional() }));
  const user = c.get("user");
  const key = `${user.id}:${currentLang()}:${p.folderId}:${p.messageId}`;
  const now = Date.now();
  const hit = suggestCache.get(key);
  if (hit && !p.refresh && now - hit.at < SUGGEST_TTL) return c.json({ ...hit.value, cached: true });
  takeQuota(c);
  const mail = await loadMail(c, p.folderId, p.messageId);
  audit(c.get("deps").db, { userId: user.id, action: "ai.suggestions", target: p.messageId, ip: c.get("ip") });
  try {
    const value = await c.get("deps").ai.suggest(user, userPrefs(user), mail);
    if (suggestCache.size > 2000) for (const [k, v] of suggestCache) if (now - v.at > SUGGEST_TTL) suggestCache.delete(k);
    suggestCache.set(key, { at: now, value });
    return c.json({ ...value, cached: false });
  } catch (e) {
    console.error("[ai] suggestions:", (e as Error).message);
    throw new HttpError(502, tr("The reply suggestions could not be created. Please try again.", "Die Antwortvorschläge konnten nicht erstellt werden. Bitte versuche es erneut."), "ai_failed");
  }
});
