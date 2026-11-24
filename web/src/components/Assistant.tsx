import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, RefreshCw, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, streamPost } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { Markdown } from "./Markdown";
import { cx, Skeleton } from "./ui";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

/**
 * Personal AI assistant: floating chat window at the bottom right. When closed, a small
 * robot icon stays at the bottom right. Briefing and suggestions follow the open page.
 */

interface Msg {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}
interface AssistantContext {
  available: boolean;
  firstName: string;
  label: string;
  facts: string[];
  suggestions: { label: string; prompt: string }[];
}
interface Briefing {
  text: string;
  at: number;
  cached: boolean;
}

const OPEN_KEY = "nalpia.assistant.open";
const readOpen = () => {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    if (v !== null) return v === "1";
  } catch {
    /* ignore */
  }
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
};
const writeOpen = (v: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
};
const chatKey = (uid: string) => `nalpia.assistant.chat.${uid}`;
function loadChat(uid: string): Msg[] {
  try {
    const raw = sessionStorage.getItem(chatKey(uid));
    const v = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(v) ? v.slice(-40) : [];
  } catch {
    return [];
  }
}
function saveChat(uid: string, msgs: Msg[]) {
  try {
    sessionStorage.setItem(chatKey(uid), JSON.stringify(msgs.slice(-40)));
  } catch {
    /* ignore */
  }
}

const INVALIDATE: Record<string, string[]> = { tasks: ["tasks", "task", "milestone", "milestones"], orgs: ["orgs", "org"], contacts: ["contacts", "contact"], home: ["home"] };

export function Assistant() {
  const me = useMe().data;
  const user = me?.user;
  const enabled = !!user && me?.prefs?.assistant !== false;
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    writeOpen(v);
  };
  if (!enabled || !user) return null;
  return open ? <Panel userId={user.id} onClose={() => setOpen(false)} /> : <Launcher onOpen={() => setOpen(true)} />;
}

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={tr("Open AI assistant", "KI-Assistent öffnen")}
      title={tr("Open AI assistant", "KI-Assistent öffnen")}
      className="assistant-launcher fixed right-5 z-30 grid h-12 w-12 place-items-center rounded-full bg-brand text-brand-ink shadow-pop transition hover:scale-105 active:scale-95"
    >
      <Bot className="h-6 w-6" strokeWidth={2} />
      <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-accent" aria-hidden />
    </button>
  );
}

function Panel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const navigate = useNavigate();
  const path = loc.pathname;
  const [msgs, setMsgs] = useState<Msg[]>(() => loadChat(userId));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ctx = useQuery({
    queryKey: ["assistant", "context", path],
    queryFn: () => api.get<AssistantContext>(`/api/assistant/context?path=${encodeURIComponent(path)}`),
    staleTime: 30_000,
  });
  const briefing = useQuery({
    queryKey: ["assistant", "briefing", path],
    queryFn: () => api.post<Briefing>("/api/assistant/briefing", { path }),
    enabled: !!ctx.data?.available && msgs.length === 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  async function refreshBriefing() {
    setRefreshing(true);
    try {
      qc.setQueryData(["assistant", "briefing", path], await api.post<Briefing>("/api/assistant/briefing", { path, refresh: true }));
    } catch {
      /* the query shows the error */
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => saveChat(userId, msgs), [userId, msgs]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, status]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement && scrollRef.current?.closest("[data-assistant]")?.contains(document.activeElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history: Msg[] = [...msgs.filter((m) => !m.error), { role: "user", content: q }];
      setMsgs([...msgs, { role: "user", content: q }, { role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      setStatus(tr("Thinking", "Denke nach"));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = "";
      const setLast = (patch: Partial<Msg>) =>
        setMsgs((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { ...copy[copy.length - 1]!, ...patch };
          return copy;
        });
      await streamPost(
        "/api/assistant/chat",
        { path, messages: history.map(({ role, content }) => ({ role, content })) },
        {
          onDelta: (t) => {
            acc += t;
            setStatus(null);
            setLast({ content: acc.replace(/^\s+/, "") });
          },
          onDone: () => undefined,
          onError: (m) => setLast({ content: acc ? `${acc}\n\n_${m}_` : m, error: !acc }),
          onEvent: (event, data) => {
            if (event === "tool") setStatus(String(data.label ?? tr("Working", "Arbeite")));
            if (event === "changed") for (const k of (data.keys as string[]) ?? []) for (const q of INVALIDATE[k] ?? []) qc.invalidateQueries({ queryKey: [q] });
          },
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) setLast({ content: acc ? `${acc} …` : tr("Stopped.", "Abgebrochen."), error: !acc });
      abortRef.current = null;
      setBusy(false);
      setStatus(null);
      qc.invalidateQueries({ queryKey: ["assistant", "context"] });
    },
    [busy, msgs, path, qc],
  );

  function applyPrompt(prompt: string) {
    // Suggestions ending in ": " still need the user to complete them
    if (/:\s*$/.test(prompt)) {
      setInput(prompt);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } else void send(prompt);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  // Open internal links in the chat without a page reload
  function onLinkClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || !/^\/(?!\/)/.test(href) || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
    if (window.matchMedia("(max-width: 1023px)").matches) onClose();
  }

  const c = ctx.data;
  const unavailable = c && !c.available;
  const briefErr = briefing.error instanceof ApiError ? briefing.error.message : briefing.error ? tr("The briefing isn't available right now.", "Das Briefing ist gerade nicht verfügbar.") : null;

  return (
    <section
      data-assistant
      aria-label={tr("AI assistant", "KI-Assistent")}
      className="assistant-panel fixed inset-x-2 z-40 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in sm:inset-x-auto sm:right-4 sm:w-[400px] lg:bottom-5"
    >
      <header className="flex items-center gap-3 bg-brand px-4 py-3 text-brand-ink">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold leading-tight">{tr("Your assistant", "Dein Assistent")}</p>
          <p className="truncate text-[12px] opacity-75">{c ? <Tx text={c.label} /> : "…"}</p>
        </div>
        {msgs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setMsgs([]);
            }}
            className="grid h-8 w-8 place-items-center rounded-lg opacity-80 transition hover:bg-white/10 hover:opacity-100"
            aria-label={tr("New chat", "Neuer Chat")}
            title={tr("New chat", "Neuer Chat")}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg opacity-80 transition hover:bg-white/10 hover:opacity-100" aria-label={tr("Close assistant", "Assistent schließen")} title={tr("Close", "Schließen")}>
          <X className="h-[18px] w-[18px]" />
        </button>
      </header>

      <div ref={scrollRef} onClick={onLinkClick} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {msgs.length === 0 ? (
          <div className="space-y-4">
            <div>
              <p className="text-[19px] font-extrabold tracking-[-0.015em]">{tr(`Hi ${c?.firstName ?? ""}!`, `Hallo ${c?.firstName ?? ""}!`)}</p>
              <p className="mt-0.5 text-[13.5px] text-muted">{tr("How can I help? I know your tasks, the pipelines and the news.", "Womit kann ich dir helfen? Ich kenne deine Aufgaben, die Pipelines und die News.")}</p>
            </div>
            {c && c.facts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.facts.map((f) => (
                  <span key={f} className="rounded-full bg-surface2 px-2.5 py-1 text-[12px] font-semibold text-ink">
                    {f}
                  </span>
                ))}
              </div>
            )}
            {unavailable ? (
              <p className="rounded-xl bg-surface2 p-3 text-[13px] text-muted">{tr("AI isn't set up on the server yet (ANTHROPIC_API_KEY). Until then you'll only see the quick facts here.", "Die KI ist auf dem Server noch nicht eingerichtet (ANTHROPIC_API_KEY). Bis dahin siehst du hier nur die Kurzinfos.")}</p>
            ) : (
              <div className="rounded-xl border border-line bg-surface2/50 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <p className="flex-1 text-[12.5px] font-bold text-muted">Briefing</p>
                  {briefing.data && (
                    <button type="button" onClick={refreshBriefing} disabled={refreshing} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface2 hover:text-ink" aria-label={tr("Refresh briefing", "Briefing aktualisieren")} title={tr("Refresh", "Aktualisieren")}>
                      <RefreshCw className={cx("h-3.5 w-3.5", refreshing && "animate-spin")} />
                    </button>
                  )}
                </div>
                {briefing.isLoading || !c ? (
                  <div className="space-y-2 py-1">
                    <Skeleton className="h-3.5 w-11/12" />
                    <Skeleton className="h-3.5 w-9/12" />
                    <Skeleton className="h-3.5 w-10/12" />
                  </div>
                ) : briefErr ? (
                  <p className="text-[13px] text-muted">{briefErr}</p>
                ) : briefing.data ? (
                  <Markdown className="assistant-md text-[13.5px]">{briefing.data.text}</Markdown>
                ) : null}
              </div>
            )}
            {c && c.suggestions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12.5px] font-bold text-muted">{tr("Suggestions", "Vorschläge")}</p>
                <div className="flex flex-col gap-1.5">
                  {c.suggestions.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={unavailable}
                      onClick={() => applyPrompt(s.prompt)}
                      className="group flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left transition hover:border-brand/40 hover:bg-surface2 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold">{s.label}</span>
                        <span className="line-clamp-1 text-[12px] text-muted">{s.prompt}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ol className="space-y-3">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <li key={i} className="ml-8 flex justify-end">
                  <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[14px] text-brand-ink">{m.content}</p>
                </li>
              ) : (
                <li key={i} className="mr-2">
                  {m.content ? (
                    m.error ? (
                      <p className="rounded-xl bg-neg-soft px-3 py-2 text-[13.5px] text-neg">{m.content}</p>
                    ) : (
                      <Markdown className="assistant-md text-[14px]">{m.content}</Markdown>
                    )
                  ) : null}
                  {busy && i === msgs.length - 1 && status && (
                    <p className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
                      <span className="flex gap-0.5" aria-hidden>
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
                      </span>
                      {status} …
                    </p>
                  )}
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      {msgs.length > 0 && !busy && c && c.suggestions.length > 0 && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-t border-line px-3 pt-2">
          {c.suggestions.map((s) => (
            <button key={s.label} type="button" onClick={() => applyPrompt(s.prompt)} className="h-7 shrink-0 rounded-full border border-line px-2.5 text-[12px] font-semibold text-muted transition hover:text-ink">
              {s.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 px-3 pb-3 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={unavailable ? tr("AI not set up", "KI nicht eingerichtet") : tr("Ask me anything …", "Frag mich etwas …")}
          disabled={unavailable}
          aria-label={tr("Message to the assistant", "Nachricht an den Assistenten")}
          className="field max-h-32 min-h-[42px] flex-1 resize-none py-2.5 text-[14px] [field-sizing:content]"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-surface2 text-ink" aria-label={tr("Stop response", "Antwort stoppen")}>
            <Square className="h-4 w-4" fill="currentColor" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || unavailable} className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-brand text-brand-ink transition disabled:opacity-40" aria-label={tr("Send", "Senden")}>
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </form>
      <p className="px-4 pb-2.5 text-center text-[11px] text-muted">{tr("Can make mistakes. Never sends e-mails.", "Kann sich irren. Verschickt nie E-Mails.")}</p>
    </section>
  );
}
