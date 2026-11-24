import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { relTime } from "@/lib/format";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useNotifications, useUserMap } from "@/lib/queries";
import { Sheet } from "./Sheet";
import { Avatar, Button, cx, EmptyState, Skeleton } from "./ui";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

export function NotificationsSheet() {
  const o = useOverlay("notifications");
  const { close, open } = useOverlays();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useUserMap();
  const { data, isLoading } = useNotifications();

  async function markAll() {
    await api.post("/api/notifications/read", {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <Sheet
      open={!!o}
      onOpenChange={(v) => !v && close("notifications")}
      title={tr("Notifications", "Benachrichtigungen")}
      headerAction={
        data && data.unread > 0 ? (
          <Button size="sm" variant="ghost" onClick={markAll}>
            {tr("Mark all read", "Alle gelesen")}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !data?.items.length ? (
        <EmptyState icon={<Bell className="h-5 w-5" />} title={tr("All quiet", "Alles ruhig")} text={tr("This is where you'll see when someone assigns you something, comments or publishes something new.", "Hier erscheint, wenn dir jemand etwas zuweist, kommentiert oder etwas Neues veröffentlicht.")} />
      ) : (
        <ul className="-mx-2">
          {data.items.map((n) => {
            const actor = n.actorId ? users.get(n.actorId) : undefined;
            return (
              <li key={n.id}>
                <button
                  className={cx("flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface2", !n.readAt && "bg-info-soft/50")}
                  onClick={async () => {
                    if (!n.readAt) {
                      void api.post("/api/notifications/read", { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
                    }
                    close("notifications");
                    const m = n.link.match(/^\/aufgaben\?task=(.+)$/);
                    if (m) open({ kind: "task", id: m[1]! });
                    else if (n.link) navigate(n.link);
                  }}
                >
                  {actor ? <Avatar name={actor.name} color={actor.avatarColor} src={actor.avatarUrl} size={32} /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-surface2"><Bell className="h-4 w-4 text-muted" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className={cx("block text-sm leading-snug", !n.readAt && "font-semibold")}><Tx text={n.title} /></span>
                    <span className="text-[12.5px] text-muted">{relTime(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-label={tr("Unread", "Ungelesen")} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
