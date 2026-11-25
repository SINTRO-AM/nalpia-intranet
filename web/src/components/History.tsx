import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { dateShort, PRIORITY, relTime, TASK_STATUS, TOPIC_STAGE } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlays } from "@/lib/overlays";
import { useMe, useUserMap } from "@/lib/queries";
import { Tx } from "@/lib/translate";
import type { Comment, EventEntry, HistoryEvent, User } from "@/lib/types";
import { Avatar } from "./ui";

const q = (s: string) => tr(`“${s}”`, `„${s}“`);

/** One readable sentence per event (in the interface language). */
export function eventText(ev: HistoryEvent, users: Map<string, User>, openTask?: (id: string) => void): ReactNode {
  const name = (id: string | null) => (id ? (users.get(id)?.name ?? tr("a former member", "eine ehemalige Person")) : "");
  switch (ev.t) {
    case "status":
      return tr(`set the status from ${TASK_STATUS[ev.from] ?? ev.from} to ${TASK_STATUS[ev.to] ?? ev.to}`, `hat den Status von ${TASK_STATUS[ev.from] ?? ev.from} auf ${TASK_STATUS[ev.to] ?? ev.to} gesetzt`);
    case "assignee":
      return ev.to ? tr(`handed it to ${name(ev.to)}`, `hat sie an ${name(ev.to)} übergeben`) : tr("removed the owner", "hat die Zuständigkeit entfernt");
    case "due":
      if (!ev.to) return tr("removed the due date", "hat das Fälligkeitsdatum entfernt");
      return ev.from
        ? tr(`moved the due date from ${dateShort(ev.from)} to ${dateShort(ev.to)}`, `hat die Fälligkeit von ${dateShort(ev.from)} auf ${dateShort(ev.to)} verschoben`)
        : tr(`set the due date to ${dateShort(ev.to)}`, `hat die Fälligkeit auf ${dateShort(ev.to)} gesetzt`);
    case "priority":
      return tr(`set the priority to ${PRIORITY[ev.to]?.label ?? ev.to}`, `hat die Priorität auf ${PRIORITY[ev.to]?.label ?? ev.to} gesetzt`);
    case "topic":
      return ev.to ? tr(`filed it under ${q(ev.to)}`, `hat sie dem Thema ${q(ev.to)} zugeordnet`) : tr(`removed it from ${q(ev.from ?? "")}`, `hat sie aus ${q(ev.from ?? "")} genommen`);
    case "stage":
      return tr(`moved the topic from ${TOPIC_STAGE[ev.from]?.label ?? ev.from} to ${TOPIC_STAGE[ev.to]?.label ?? ev.to}`, `hat das Thema von ${TOPIC_STAGE[ev.from]?.label ?? ev.from} nach ${TOPIC_STAGE[ev.to]?.label ?? ev.to} verschoben`);
    case "owner":
      return ev.to ? tr(`made ${name(ev.to)} responsible`, `hat die Verantwortung an ${name(ev.to)} übergeben`) : tr("removed the owner", "hat die Verantwortung entfernt");
    case "follow_up":
      return ev.to ? tr(`set a follow-up for ${dateShort(ev.to)}`, `hat die Wiedervorlage auf ${dateShort(ev.to)} gesetzt`) : tr("removed the follow-up", "hat die Wiedervorlage entfernt");
    case "waiting":
      return (
        <>
          {tr("is waiting on: ", "wartet auf: ")}
          <b>
            <Tx text={ev.to} />
          </b>
        </>
      );
    case "task_done":
    case "task_added": {
      const link = openTask ? (
        <button type="button" className="link" onClick={() => openTask(ev.taskId)}>
          {q(ev.title)}
        </button>
      ) : (
        q(ev.title)
      );
      return ev.t === "task_done" ? <>{tr("completed ", "hat ")}{link}{tr("", " erledigt")}</> : <>{tr("added the task ", "hat die Aufgabe ")}{link}{tr("", " hinzugefügt")}</>;
    }
  }
}

/** Comments and events in one chronological list. */
export function Timeline({ comments, events, onDeleteComment }: { comments: Comment[]; events: EventEntry[]; onDeleteComment?: (id: string) => void }) {
  const users = useUserMap();
  const me = useMe().data?.user;
  const { open } = useOverlays();
  const items = [...comments.map((c) => ({ type: "c" as const, at: c.createdAt, c })), ...events.map((e) => ({ type: "e" as const, at: e.createdAt, e }))].sort((a, b) => a.at - b.at);
  if (!items.length) return null;
  return (
    <ol className="space-y-2.5">
      {items.map((it) => {
        if (it.type === "e") {
          const u = it.e.userId ? users.get(it.e.userId) : undefined;
          return (
            <li key={it.e.id} className="flex items-start gap-2 pl-1 text-[12.5px] text-muted">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" aria-hidden />
              <span className="min-w-0 flex-1">
                <b className="font-semibold text-ink">{u?.name.split(" ")[0] ?? tr("Someone", "Jemand")}</b> {eventText(it.e.event, users, (id) => open({ kind: "task", id }))}
                <span className="whitespace-nowrap"> · {relTime(it.at)}</span>
              </span>
            </li>
          );
        }
        const u = it.c.userId ? users.get(it.c.userId) : undefined;
        const mine = !!me && (it.c.userId === me.id || me.role === "admin");
        return (
          <li key={it.c.id} className="group flex gap-2.5">
            <Avatar name={u?.name ?? "?"} color={u?.avatarColor} src={u?.avatarUrl} size={28} />
            <div className="min-w-0 flex-1 rounded-xl bg-surface px-3 py-2 ring-1 ring-line">
              <p className="flex items-center gap-1 text-[12.5px]">
                <b>{u?.name ?? tr("Former member", "Ehemalig")}</b> <span className="text-muted">{relTime(it.c.createdAt)}</span>
                <span className="flex-1" />
                {mine && onDeleteComment && (
                  <button type="button" onClick={() => onDeleteComment(it.c.id)} className="rounded p-0.5 text-muted opacity-0 transition hover:text-neg focus:opacity-100 group-hover:opacity-100" aria-label={tr("Delete comment", "Kommentar löschen")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">
                <Tx text={it.c.body} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
