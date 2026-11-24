import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, SendHorizontal, Sparkles, Square, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { api, ApiError, qs, streamPost } from "@/lib/api";
import { type ComposeDefaults, useOverlay, useOverlays } from "@/lib/overlays";
import { useContacts, useMailStatus, useMe, useUsers } from "@/lib/queries";
import type { ContactLookup } from "@/lib/types";
import { Select } from "./pickers";
import { Sheet } from "./Sheet";
import { Button, cx, Switch } from "./ui";
import { tr } from "@/lib/i18n";

const INTENTS = () =>
  [
    { v: "antworten", label: tr("Reply", "Antworten") },
    { v: "zusagen", label: tr("Accept", "Zusagen") },
    { v: "absagen", label: tr("Decline", "Absagen") },
    { v: "termin", label: tr("Suggest a time", "Termin vorschlagen") },
    { v: "nachfragen", label: tr("Follow up", "Nachfragen") },
    { v: "danke", label: tr("Thank", "Danke") },
  ] as const;
const TONES = () =>
  [
    { v: "freundlich", label: tr("Friendly", "Freundlich") },
    { v: "foermlich", label: tr("Formal", "Förmlich") },
    { v: "kurz", label: tr("Brief", "Kurz") },
    { v: "herzlich", label: tr("Warm", "Herzlich") },
  ] as const;

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Common revision requests as one-click messages to the AI assistant */
const QUICK = (): { label: string; instruction: string }[] => [
  { label: tr("Shorter", "Kürzer"), instruction: tr("Make it shorter", "Kürzer") },
  { label: tr("More formal", "Förmlicher"), instruction: tr("Make it more formal", "Förmlicher") },
  { label: tr("More personal", "Persönlicher"), instruction: tr("Make it more personal", "Persönlicher") },
  // offers the other language than the UI's
  { label: tr("In German", "Auf Englisch"), instruction: tr("Rewrite it in German", "Auf Englisch umschreiben") },
  { label: tr("Suggest a time", "Termin vorschlagen"), instruction: tr("Suggest a time for a meeting", "Termin vorschlagen") },
  { label: tr("Add a question", "Mit Rückfrage"), instruction: tr("Add a follow-up question", "Mit Rückfrage") },
];

interface ChatTurn {
  id: number;
  role: "user" | "ai";
  text: string;
  /** Draft text before this change (for "Undo") */
  before?: string;
  undone?: boolean;
  error?: boolean;
}

export function ComposerSheet() {
  const o = useOverlay("compose");
  const { close } = useOverlays();
  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && close("compose")} title={o?.defaults.reply ? tr("Reply", "Antworten") : tr("New e-mail", "Neue E-Mail")} size="lg" fullMobile>
      {o && <Composer key={JSON.stringify(o.defaults)} defaults={o.defaults} />}
    </Sheet>
  );
}

function RecipientInput({ label, value, onChange, listId, autoFocus }: { label: string; value: string[]; onChange: (v: string[]) => void; listId: string; autoFocus?: boolean }) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", ";", "Tab"].includes(e.key) && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-[44px] items-start gap-2 border-b border-line py-1.5">
      <span className="w-10 shrink-0 pt-1.5 text-[13px] font-semibold text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {value.map((a) => (
          <span
            key={a}
            className={cx("inline-flex h-7 max-w-full items-center gap-1 rounded-full pl-2.5 pr-1 text-[13px] font-medium", EMAIL_RE.test(a) ? "bg-surface2" : "bg-neg-soft text-neg")}
          >
            <span className="truncate">{a}</span>
            <button type="button" aria-label={tr(`Remove ${a}`, `${a} entfernen`)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-line" onClick={() => onChange(value.filter((x) => x !== a))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          list={listId}
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-label={label}
          className="h-8 min-w-[140px] flex-1 bg-transparent text-[15px] outline-none"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]$/.test(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
    </div>
  );
}

function Composer({ defaults }: { defaults: ComposeDefaults }) {
  const qc = useQueryClient();
  const { close } = useOverlays();
  const me = useMe().data;
  const status = useMailStatus().data;
  const contacts = useContacts({}).data;
  const users = useUsers().data;
  const aiOn = !!me?.features.ai;
  const reply = defaults.reply;

  const [to, setTo] = useState<string[]>(defaults.to ?? (reply ? [reply.from] : []));
  const [cc, setCc] = useState<string[]>(defaults.cc ?? reply?.cc ?? []);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(!!(defaults.cc?.length || reply?.cc?.length));
  const [subject, setSubject] = useState(defaults.subject ?? (reply ? (/^(re|aw):/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : ""));
  const [body, setBody] = useState(defaults.body ?? "");
  const [from, setFrom] = useState(me?.prefs?.fromAddress || status?.email || "");
  const [quote, setQuote] = useState(true);
  const [signature, setSignature] = useState(true);
  const [logToContact, setLogToContact] = useState(true);

  const [aiOpen, setAiOpen] = useState(aiOn && (!!reply || !!defaults.autoDraft || !!defaults.suggestion));
  const [chat, setChat] = useState<ChatTurn[]>(() =>
    defaults.suggestion ? [{ id: 1, role: "ai", text: tr(`Suggestion "${defaults.suggestion}" applied. Tell me what to change – or send it as is.`, `Vorschlag „${defaults.suggestion}“ übernommen. Sag mir, was ich daran ändern soll – oder schick ihn so ab.`) }] : [],
  );
  const chatRef = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState<string>("antworten");
  const [tone, setTone] = useState<string>("freundlich");
  const [instruction, setInstruction] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placeholderAck, setPlaceholderAck] = useState(false);

  const listId = "composer-addresses";
  const suggestions = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts ?? []) if (c.email) s.add(c.email);
    for (const u of users ?? []) s.add(u.email);
    return [...s];
  }, [contacts, users]);

  const allRecipients = [...to, ...cc];
  const lookupKey = allRecipients.filter((a) => EMAIL_RE.test(a)).sort().join(",");
  const lookup = useQuery({
    queryKey: ["contact-lookup", lookupKey],
    queryFn: () => api.get<Record<string, ContactLookup>>(`/api/contacts/lookup${qs({ emails: lookupKey })}`),
    enabled: !!lookupKey,
  });
  const matched = Object.entries(lookup.data ?? {});

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (defaults.autoDraft && aiOn) void sendChat("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  /** Writes or revises the draft; reports whether it arrived completely. */
  async function runDraft(instr = instruction, history: string[] = []) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const revise = body.trim().length > 0;
    setStreaming(true);
    setError(null);
    let acc = "";
    let ok = false;
    let failure: string | null = null;
    if (!revise) setBody("");
    await streamPost(
      "/api/ai/draft",
      {
        source: reply ? { folderId: reply.folderId, messageId: reply.messageId } : undefined,
        compose: reply ? undefined : { to: to.join(", "), subject },
        intent,
        tone,
        instruction: instr || undefined,
        currentText: revise ? body : undefined,
        history: history.length ? history : undefined,
      },
      {
        onDelta: (t) => {
          acc += t;
          setBody(acc.replace(/^\s+/, ""));
          const el = bodyRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        },
        onDone: (t) => {
          setBody(t);
          ok = true;
        },
        onError: (m) => {
          failure = m;
          setError(m);
        },
      },
      ctrl.signal,
    );
    setStreaming(false);
    return { ok, failure: failure as string | null, aborted: ctrl.signal.aborted };
  }

  /** One message in the AI chat: remember the instruction, adjust the draft, confirm the result with "Undo" */
  async function sendChat(text?: string) {
    const instr = (text ?? instruction).trim();
    if (streaming) return;
    if (!instr && body.trim()) return;
    const before = body;
    const history = chat.filter((t) => t.role === "user" && !t.undone).map((t) => t.text);
    const id = Date.now();
    setChat((c) => [...c, ...(instr ? [{ id, role: "user" as const, text: instr }] : [])]);
    setInstruction("");
    const r = await runDraft(instr, history);
    setChat((c) => [
      ...c,
      {
        id: id + 1,
        role: "ai",
        text: r.ok
          ? before.trim()
            ? tr("Draft updated.", "Entwurf angepasst.")
            : tr("Draft created. What should I change?", "Entwurf erstellt. Was soll ich ändern?")
          : r.aborted
            ? tr("Stopped.", "Abgebrochen.")
            : (r.failure ?? tr("That didn't work. Please try again.", "Das hat nicht geklappt.")),
        before: r.ok ? before : undefined,
        error: !r.ok && !r.aborted,
      },
    ]);
    requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }));
  }

  function undoTurn(t: ChatTurn) {
    if (t.before === undefined) return;
    setBody(t.before);
    // The matching instruction no longer applies
    setChat((c) => {
      const i = c.findIndex((x) => x.id === t.id);
      return c.map((x, j) => (x.id === t.id || (j === i - 1 && x.role === "user") ? { ...x, undone: true } : x));
    });
  }

  function validate() {
    if (!to.length) return tr("Please add at least one recipient.", "Bitte gib mindestens einen Empfänger an.");
    const bad = [...to, ...cc, ...bcc].find((a) => !EMAIL_RE.test(a));
    if (bad) return tr(`"${bad}" isn't a valid e-mail address.`, `„${bad}“ ist keine gültige E-Mail-Adresse.`);
    if (!body.trim()) return tr("The message is empty.", "Die Nachricht ist leer.");
    if (/\[[^\]\n]{3,60}\]/.test(body) && !placeholderAck) {
      setPlaceholderAck(true);
      return tr("The text still contains placeholders in [square brackets]. Tap Send again to send anyway.", "Im Text stehen noch Platzhalter in [eckigen Klammern]. Tippe erneut auf „Senden“, um trotzdem zu senden.");
    }
    return null;
  }

  async function doSend(mode: "send" | "draft") {
    try {
      await api.post("/api/mail/send", {
        to,
        cc,
        bcc,
        subject,
        body,
        from: from || undefined,
        reply: reply && mode === "send" ? { messageId: reply.messageId, folderId: reply.folderId } : undefined,
        quote: !!reply && quote,
        signature,
        mode,
      });
      if (mode === "send" && logToContact && matched.length) {
        await Promise.allSettled(
          matched.map(([, c]) =>
            api.post(`/api/contacts/${c.id}/activities`, {
              kind: "mail",
              body: `${subject || tr("(no subject)", "(kein Betreff)")}\n\n${body.slice(0, 3000)}`,
            }),
          ),
        );
        qc.invalidateQueries({ queryKey: ["contact"] });
        qc.invalidateQueries({ queryKey: ["contacts"] });
      }
      qc.invalidateQueries({ queryKey: ["mail", "list"] });
      qc.invalidateQueries({ queryKey: ["mail", "list-inf"] });
      toast.success(mode === "draft" ? tr("Saved as a draft in your mailbox", "Als Entwurf in deinem Postfach gespeichert") : tr("Sent", "Gesendet"), { description: subject || to.join(", ") });
      close("compose");
    } catch (e) {
      setCountdown(null);
      setError(e instanceof ApiError ? e.message : tr("Couldn't send. Please try again.", "Senden fehlgeschlagen."));
    }
  }

  function startSend() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    let n = 4;
    setCountdown(n);
    timerRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(timerRef.current!);
        timerRef.current = null;
        setCountdown(0);
        void doSend("send");
      } else setCountdown(n);
    }, 1000);
  }

  function undoSend() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setCountdown(null);
  }

  const addresses = status?.addresses ?? [];
  const sendingNow = countdown === 0;

  return (
    <div className="flex h-full flex-col">
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="-mt-1">
        <RecipientInput label={tr("To", "An")} value={to} onChange={setTo} listId={listId} autoFocus={!reply && !to.length} />
        {showCc ? (
          <>
            <RecipientInput label="Cc" value={cc} onChange={setCc} listId={listId} />
            <RecipientInput label="Bcc" value={bcc} onChange={setBcc} listId={listId} />
          </>
        ) : (
          <button type="button" className="mt-1 text-[13px] font-semibold text-muted hover:text-ink" onClick={() => setShowCc(true)}>
            {tr("Add Cc/Bcc", "Cc/Bcc hinzufügen")}
          </button>
        )}
        {addresses.length > 1 && (
          <div className="flex items-center gap-2 border-b border-line py-1.5">
            <span className="w-10 shrink-0 text-[13px] font-semibold text-muted">{tr("From", "Von")}</span>
            <Select className="flex-1" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr("Sender", "Absender")}>
              {addresses.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
        )}
        <input
          className="h-11 w-full border-b border-line bg-transparent text-[16px] font-semibold outline-none placeholder:text-muted/70"
          placeholder={tr("Subject", "Betreff")}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-label={tr("Subject", "Betreff")}
        />
      </div>

      {aiOn && (
        <div className="mt-3 rounded-2xl border border-line bg-surface">
          <button type="button" className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen}>
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="flex-1 text-sm font-bold">{tr("AI assistant", "KI-Assistent")}</span>
            <span className="text-[12.5px] text-muted">{me?.features.demo ? "Demo" : "Claude"}</span>
            <ChevronDown className={cx("h-4 w-4 text-muted transition", aiOpen && "rotate-180")} />
          </button>
          {aiOpen && (
            <div className="space-y-2.5 border-t border-line px-3.5 pb-3.5 pt-3">
              {chat.length > 0 && (
                <div ref={chatRef} className="max-h-[168px] space-y-1.5 overflow-y-auto pr-1" role="log" aria-label={tr("Conversation with the AI assistant", "Verlauf mit dem KI-Assistenten")} aria-live="polite">
                  {chat.map((t) =>
                    t.role === "user" ? (
                      <p key={t.id} className={cx("ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-1.5 text-[13.5px] text-brand-ink", t.undone && "opacity-50 line-through")}>
                        {t.text}
                      </p>
                    ) : (
                      <div key={t.id} className={cx("flex w-fit max-w-[90%] items-center gap-2 rounded-2xl rounded-bl-md px-3 py-1.5 text-[13.5px]", t.error ? "bg-neg-soft text-neg" : "bg-surface2")}>
                        <span>{t.undone ? tr("Undone.", "Rückgängig gemacht.") : t.text}</span>
                        {t.before !== undefined && !t.undone && (
                          <button type="button" className="link shrink-0 text-[12.5px]" onClick={() => undoTurn(t)} disabled={streaming}>
                            {tr("Undo", "Rückgängig")}
                          </button>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
              {body.trim() ? (
                <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" aria-label={tr("Quick changes", "Schnelle Änderungen")}>
                  {QUICK().map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={streaming}
                      onClick={() => void sendChat(q.instruction)}
                      className="h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-muted transition hover:text-ink disabled:opacity-50"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              ) : (
                reply && (
                  <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="radiogroup" aria-label={tr("Goal of the reply", "Ziel der Antwort")}>
                    {INTENTS().map((i) => (
                      <button
                        key={i.v}
                        type="button"
                        role="radio"
                        aria-checked={intent === i.v}
                        onClick={() => setIntent(i.v)}
                        className={cx(
                          "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition",
                          intent === i.v ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted hover:text-ink",
                        )}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                )
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="field field-sm flex-1"
                  placeholder={
                    body.trim()
                      ? tr('What should I change? E.g. "Suggest Tuesday 3 pm and make it shorter"', "Was soll ich ändern? z. B. „Dienstag 15 Uhr vorschlagen und kürzer“")
                      : reply
                        ? tr('What should it say? E.g. "Accept, send the deck by Friday"', "Was soll drinstehen? z. B. „Zusagen, Deck bis Freitag schicken“")
                        : tr('What is it about? E.g. "Ask for feedback on the one-pager"', "Worum geht es? z. B. „Bitte um Feedback zum One-Pager“")
                  }
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                  aria-label={tr("Message to the AI assistant", "Nachricht an den KI-Assistenten")}
                />
                <div className="flex gap-2">
                  <Select className="w-[140px]" value={tone} onChange={(e) => setTone(e.target.value)} aria-label={tr("Tone", "Tonalität")}>
                    {TONES().map((t) => (
                      <option key={t.v} value={t.v}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  {streaming ? (
                    <Button variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={() => abortRef.current?.abort()}>
                      {tr("Stop", "Stopp")}
                    </Button>
                  ) : body.trim() ? (
                    <Button variant="accent" icon={<SendHorizontal className="h-4 w-4" />} onClick={() => void sendChat()} disabled={!instruction.trim()} aria-label={tr("Send to the AI assistant", "An den KI-Assistenten senden")}>
                      {tr("Revise", "Ändern")}
                    </Button>
                  ) : (
                    <Button variant="accent" icon={<Sparkles className="h-4 w-4" />} onClick={() => void sendChat()}>
                      {tr("Write draft", "Entwurf schreiben")}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-[12px] text-muted">{tr("Nothing is sent automatically – you review and send it yourself. Please check facts, figures and placeholders in [square brackets].", "Nichts wird automatisch gesendet – du prüfst und schickst selbst ab. Fakten, Zahlen und Platzhalter in [eckigen Klammern] bitte kontrollieren.")}</p>
            </div>
          )}
        </div>
      )}

      <textarea
        ref={bodyRef}
        className={cx("field mt-3 min-h-[220px] flex-1 resize-none leading-relaxed", streaming && "caret-accent")}
        placeholder={tr("Write a message …", "Nachricht schreiben …")}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setPlaceholderAck(false);
        }}
        aria-label={tr("Message", "Nachricht")}
        aria-busy={streaming}
      />

      <div className="mt-3 space-y-2.5">
        {reply && <Switch checked={quote} onChange={setQuote} label={tr("Quote original message", "Ursprüngliche Nachricht zitieren")} />}
        <Switch checked={signature} onChange={setSignature} label={tr("Add signature", "Signatur anhängen")} description={me?.prefs?.signature ? undefined : tr("No signature set up yet (Settings → Mailbox).", "Noch keine Signatur hinterlegt (Einstellungen → Postfach).")} />
        {matched.length > 0 && (
          <Switch
            checked={logToContact}
            onChange={setLogToContact}
            label={tr("Log in contact activity", "Im Kontaktverlauf vermerken")}
            description={matched.map(([, c]) => c.name).join(", ")}
          />
        )}
      </div>

      {error && <p className="mt-3 rounded-xl bg-neg-soft px-3 py-2 text-sm font-medium text-neg">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="md" onClick={() => void doSend("draft")} disabled={countdown !== null || streaming || !to.length}>
          {tr("Save as draft", "Als Entwurf speichern")}
        </Button>
        {countdown !== null && !sendingNow ? (
          <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={undoSend}>
            {tr("Undo", "Rückgängig")} <span className="num">({countdown})</span>
          </Button>
        ) : (
          <Button variant="primary" onClick={startSend} loading={sendingNow} disabled={streaming}>
            {tr("Send", "Senden")}
          </Button>
        )}
      </div>
    </div>
  );
}
