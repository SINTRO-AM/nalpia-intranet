import { useQueryClient } from "@tanstack/react-query";
import { AtSign, CalendarDays, Flag, Hash, Plus, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { dueInfo, PRIORITY, todayISO } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlays } from "@/lib/overlays";
import { invalidateWork, useMe, useTopics, useUsers } from "@/lib/queries";
import { activeToken, normalize, parseQuickAdd } from "@/lib/quickadd";
import type { Task, TaskStatus } from "@/lib/types";
import { Avatar, cx } from "./ui";

export interface QuickAddHandle {
  focus: () => void;
}

interface Props {
  /** Applied unless the line says otherwise (e.g. the topic of the open topic, the column of the board) */
  defaults?: { topicId?: string | null; status?: TaskStatus; assigneeId?: string | null };
  placeholder?: string;
  className?: string;
  /** Smaller variant for board columns and sheets */
  compact?: boolean;
  onCreated?: (t: Task) => void;
}

/**
 * One line, Enter, done: "Antrag schicken @carlo fr !hoch #exist".
 * Shows what was recognised as chips (each can be turned back into text) and suggests people and topics after @ and #.
 */
export const QuickAdd = forwardRef<QuickAddHandle, Props>(function QuickAdd({ defaults, placeholder, className, compact, onCreated }, ref) {
  const qc = useQueryClient();
  const { open } = useOverlays();
  const me = useMe().data?.user;
  const users = useUsers().data ?? [];
  const topics = useTopics({ state: "open" }).data ?? [];
  const [text, setText] = useState("");
  const [ignore, setIgnore] = useState<string[]>([]);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const parsed = useMemo(
    () => parseQuickAdd(text, { users, topics, meId: me?.id, today: todayISO(), ignore }),
    [text, users, topics, me?.id, ignore],
  );

  // Suggestions for the @/# word under the cursor
  const token = focused ? activeToken(text, caret) : null;
  const suggestions = useMemo(() => {
    if (!token) return [];
    const q = normalize(token.query);
    if (token.kind === "@")
      return users
        .filter((u) => !q || normalize(u.name).includes(q) || normalize(u.email.split("@")[0] ?? "").startsWith(q))
        .slice(0, 6)
        .map((u) => ({ id: u.id, label: u.name, insert: `@${(u.name.split(" ")[0] ?? u.name).toLowerCase()}`, user: u }));
    return topics
      .filter((t) => !q || normalize(t.title).includes(q))
      .slice(0, 6)
      .map((t) => ({ id: t.id, label: t.title, insert: `#${normalize(t.title.split(/[\s/–-]+/)[0] ?? t.title).slice(0, 18) || normalize(t.title).slice(0, 18)}`, user: undefined }));
  }, [token?.kind, token?.query, users, topics]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(i: number) {
    const s = suggestions[i];
    if (!s || !token) return;
    // Use a token that resolves to exactly this entry (for topics the whole normalized title if needed)
    let insert = s.insert;
    if (token.kind === "#") {
      const probe = parseQuickAdd(insert, { users, topics, today: todayISO() });
      if (probe.topic?.value !== s.id) insert = `#${normalize(s.label).slice(0, 40)}`;
    }
    const next = text.slice(0, token.start) + insert + " " + text.slice(token.end).replace(/^\s+/, "");
    setText(next);
    const pos = token.start + insert.length + 1;
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
    setSel(0);
  }

  async function submit() {
    const title = parsed.title.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const assigneeId = parsed.assignee?.value ?? (defaults?.assigneeId !== undefined ? defaults.assigneeId : undefined);
      const t = await api.post<Task>("/api/tasks", {
        title,
        assigneeId,
        dueDate: parsed.due?.value ?? null,
        priority: parsed.priority?.value ?? "mittel",
        topicId: parsed.topic?.value ?? defaults?.topicId ?? null,
        status: defaults?.status && defaults.status !== "erledigt" ? defaults.status : undefined,
      });
      invalidateWork(qc);
      setText("");
      setIgnore([]);
      onCreated?.(t);
      toast.success(tr("Task created", "Aufgabe angelegt"), { description: t.title, action: { label: tr("Open", "Öffnen"), onClick: () => open({ kind: "task", id: t.id }) } });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tr("Couldn't save. Please try again.", "Speichern fehlgeschlagen."));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => (s + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s - 1 + suggestions.length) % suggestions.length);
        return;
      }
      // Enter completes the word – unless it already points to exactly that suggestion (then Enter creates the task)
      const resolved = token && ((token.kind === "@" && parsed.assignee?.value === suggestions[sel]?.id) || (token.kind === "#" && parsed.topic?.value === suggestions[sel]?.id));
      if (e.key === "Tab" || (e.key === "Enter" && token && token.query.length > 0 && !resolved)) {
        e.preventDefault();
        pick(sel);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      if (text) {
        e.stopPropagation();
        setText("");
        setIgnore([]);
      } else input.current?.blur();
    }
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "";
  const topicName = (id: string) => topics.find((t) => t.id === id)?.title ?? "";
  const chips: { key: string; icon: ReactNode; label: string; text: string; tone?: string }[] = [];
  if (parsed.assignee) chips.push({ key: "a", icon: <AtSign className="h-3 w-3" />, label: userName(parsed.assignee.value), text: parsed.assignee.text });
  if (parsed.due) {
    const d = dueInfo(parsed.due.value);
    chips.push({ key: "d", icon: <CalendarDays className="h-3 w-3" />, label: `${d.label} · ${parsed.due.value.slice(8, 10)}.${parsed.due.value.slice(5, 7)}.`, text: parsed.due.text });
  }
  if (parsed.priority) chips.push({ key: "p", icon: <Flag className="h-3 w-3" />, label: PRIORITY[parsed.priority.value]?.label ?? "", text: parsed.priority.text, tone: parsed.priority.value === "hoch" ? "text-neg" : undefined });
  if (parsed.topic) chips.push({ key: "t", icon: <Hash className="h-3 w-3" />, label: topicName(parsed.topic.value), text: parsed.topic.text });

  return (
    <div className={cx("relative", className)}>
      <div
        className={cx(
          "flex items-center gap-2 rounded-xl border bg-surface transition",
          focused ? "border-brand/50 ring-2 ring-brand/15" : "border-line hover:border-muted/40",
          compact ? "px-2.5" : "px-3",
        )}
      >
        <Plus className={cx("shrink-0 text-muted", compact ? "h-4 w-4" : "h-[18px] w-[18px]")} aria-hidden />
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setSel(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder={placeholder ?? tr("Add a task … (@person #topic !high tomorrow)", "Aufgabe hinzufügen … (@Person #Thema !hoch morgen)")}
          aria-label={tr("Add a task", "Aufgabe hinzufügen")}
          className={cx("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/70", compact ? "h-9 text-[14px]" : "h-11 text-[15px]")}
          maxLength={400}
          enterKeyHint="done"
        />
        {text && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()} disabled={!parsed.title || busy} className="shrink-0 rounded-lg bg-brand px-2.5 py-1 text-[12.5px] font-semibold text-brand-ink disabled:opacity-40">
            {busy ? "…" : tr("Add", "Anlegen")}
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop">
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]", i === sel ? "bg-surface2" : "hover:bg-surface2")}
              >
                {s.user ? <Avatar name={s.user.name} color={s.user.avatarColor} src={s.user.avatarUrl} size={20} /> : <Hash className="h-4 w-4 text-muted" />}
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {text && (chips.length > 0 || parsed.unknown.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
          {chips.map((c) => (
            <span key={c.key} className={cx("inline-flex items-center gap-1 rounded-full bg-surface2 py-0.5 pl-2 pr-1 text-[12px] font-semibold", c.tone ?? "text-ink")}>
              {c.icon}
              {c.label}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setIgnore((l) => [...l, c.text.toLowerCase()])}
                className="grid h-4 w-4 place-items-center rounded-full text-muted hover:bg-line hover:text-ink"
                aria-label={tr(`Keep “${c.text}” as text`, `„${c.text}“ als Text behalten`)}
                title={tr(`Keep “${c.text}” as text`, `„${c.text}“ als Text behalten`)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {parsed.unknown.map((u) => (
            <span key={u} className="text-[12px] text-muted">
              {tr(`${u} not found`, `${u} nicht gefunden`)}
            </span>
          ))}
        </div>
      )}
      {focused && !text && !compact && (
        <p className="mt-1.5 px-1 text-[12px] text-muted">
          {tr("Tip: ", "Tipp: ")}
          <b>@{(users.find((u) => u.id !== me?.id)?.name.split(" ")[0] ?? "name").toLowerCase()}</b> {tr("assigns", "weist zu")}, <b>#{tr("topic", "thema")}</b> {tr("files under a topic", "ordnet einem Thema zu")}, <b>!hoch</b> {tr("high priority", "hohe Priorität")}, <b>{tr("tomorrow", "morgen")}</b>, <b>fr</b>, <b>5.12.</b> {tr("set the due date", "setzen das Datum")}.
        </p>
      )}
    </div>
  );
});
