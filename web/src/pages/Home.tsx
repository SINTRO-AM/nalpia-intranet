import { format } from "date-fns";
import { CheckCircle2, ChevronRight, Diamond, Inbox, Pin } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Horizon } from "@/components/Horizon";

import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Pill, Progress, Section, Skeleton } from "@/components/ui";
import { CONTACT_CATEGORIES, countdown, dueInfo, firstName, greeting, mailTime, NEWS_CATEGORIES, relTime } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useHome, useMailList, useMailFolders, useMailStatus, useMe, useUserMap, useContactMeta } from "@/lib/queries";
import type { Task } from "@/lib/types";
import { dfLocale, tr } from "@/lib/i18n";
import { Tx, TxPlain } from "@/lib/translate";

function groupTasks(tasks: Task[]) {
  const g = { over: [] as Task[], today: [] as Task[], week: [] as Task[], later: [] as Task[] };
  for (const t of tasks) {
    const d = dueInfo(t.dueDate);
    if (d.tone === "over") g.over.push(t);
    else if (d.tone === "today") g.today.push(t);
    else if (d.days !== null && d.days <= 7) g.week.push(t);
    else g.later.push(t);
  }
  return g;
}

function MailPreview() {
  const status = useMailStatus().data;
  const folders = useMailFolders(!!status?.connected).data;
  const inbox = folders?.find((f) => f.type === "inbox");
  const list = useMailList(inbox?.id, "", !!status?.connected && !!inbox);
  const navigate = useNavigate();
  const me = useMe().data;
  if (!me?.features.mail) return null;
  const unread = (list.data?.items ?? []).filter((m) => m.unread);
  return (
    <Section
      title={tr("Mail", "Postfach")}
      id="home-mail"
      action={
        status?.connected ? (
          <Link to="/postfach" className="link text-[13px]">
            {tr("Open", "Öffnen")}
          </Link>
        ) : undefined
      }
    >
      {!status ? (
        <Skeleton className="h-20" />
      ) : !status.connected ? (
        <div className="flex items-center gap-3 py-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface2 text-muted">
            <Inbox className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-muted">{tr(`Connect your mailbox (${status.providerName}). Only you can see your mail.`, `Verbinde dein Postfach (${status.providerName}). Nur du siehst deine Mails.`)}</p>
          <Button size="sm" variant="primary" onClick={() => navigate("/postfach")}>
            {tr("Connect", "Verbinden")}
          </Button>
        </div>
      ) : list.isLoading ? (
        <div className="space-y-2 py-1">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : unread.length === 0 ? (
        <p className="py-3 text-sm text-muted">{tr("No unread mail.", "Keine ungelesenen Mails.")}</p>
      ) : (
        <ul>
          {unread.slice(0, 4).map((m) => (
            <li key={m.id}>
              <button onClick={() => navigate(`/postfach?f=${m.folderId}&m=${m.id}`)} className="flex w-full items-start gap-3 border-b border-line py-2.5 text-left last:border-0">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold">{m.from.name || m.from.email}</span>
                    <span className="shrink-0 text-[12px] text-muted">{mailTime(m.date)}</span>
                  </span>
                  <span className="block truncate text-[13.5px]">{m.subject}</span>
                </span>
              </button>
            </li>
          ))}
          {unread.length > 4 && <li className="pt-2 text-[13px] text-muted">{tr(`and ${unread.length - 4} more unread`, `und ${unread.length - 4} weitere ungelesene`)}</li>}
        </ul>
      )}
    </Section>
  );
}

export function HomePage() {
  const stageLabels = useContactMeta().data?.stageLabels;
  const { data, isLoading } = useHome();
  const me = useMe().data?.user;
  const users = useUserMap();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const groups = useMemo(() => groupTasks(data?.tasks ?? []), [data?.tasks]);

  if (isLoading || !data || !me)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );

  const todayCount = groups.today.length;
  const summary =
    data.stats.overdue > 0
      ? tr(`${data.stats.overdue} overdue, ${todayCount} due today`, `${data.stats.overdue} überfällig, ${todayCount} heute fällig`)
      : todayCount > 0
        ? todayCount === 1
          ? tr("1 task due today", "1 Aufgabe heute fällig")
          : tr(`${todayCount} tasks due today`, `${todayCount} Aufgaben heute fällig`)
        : data.stats.open > 0
          ? tr("Nothing due today", "Heute nichts fällig")
          : tr("No open tasks", "Keine offenen Aufgaben");

  const block = (label: string, list: Task[], tone?: string) =>
    list.length > 0 && (
      <div key={label} className="mt-1">
        <p className={cx("pt-2 text-[12.5px] font-semibold", tone ?? "text-muted")}>{label}</p>
        {list.map((t) => (
          <TaskRow key={t.id} task={t} showAssignee={false} />
        ))}
      </div>
    );

  return (
    <div className="space-y-4 lg:space-y-5">
      <header className="pb-1 pt-1">
        <p className="text-[13.5px] font-medium text-muted">{format(new Date(), tr("EEEE, d MMMM", "EEEE, d. MMMM"), { locale: dfLocale() })}</p>
        <h1 className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-[-0.025em] lg:text-[34px]">
          {greeting()}, {firstName(me.name)}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {summary}
          {data.stats.doneThisWeek > 0 && <span>. {tr("Done this week:", "Diese Woche erledigt:")} <span className="num font-semibold text-pos">{data.stats.doneThisWeek}</span></span>}
        </p>
      </header>

      <Horizon horizon={data.horizon} meId={me.id} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Section
            title={tr("Your focus", "Dein Fokus")}
            id="home-focus"
            action={
              <Link to="/aufgaben" className="link text-[13px]">
                {tr("All", "Alle")} <span className="num">{data.stats.open}</span>
              </Link>
            }
          >
            {data.tasks.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-5 w-5" />}
                title={tr("Nothing open", "Nichts offen")}
                text={tr("New tasks assigned to you will appear here.", "Neue Aufgaben, die dir zugewiesen werden, erscheinen hier.")}
                action={
                  <Button size="sm" variant="primary" onClick={() => open({ kind: "task" })}>
                    {tr("Create task", "Aufgabe anlegen")}
                  </Button>
                }
              />
            ) : (
              <>
                {block(tr("Overdue", "Überfällig"), groups.over, "text-neg")}
                {block(tr("Today", "Heute"), groups.today, "text-accent-ink")}
                {block(tr("This week", "Diese Woche"), groups.week)}
                {block(tr("Later", "Später"), groups.later)}
              </>
            )}
          </Section>
          <MailPreview />
        </div>

        <div className="space-y-4 lg:space-y-5">
          <Section
            title={tr("News", "Neuigkeiten")}
            id="home-news"
            action={
              <Link to="/news" className="link text-[13px]">
                {data.newsUnread > 0 ? tr(`${data.newsUnread} new`, `${data.newsUnread} neu`) : tr("All", "Alle")}
              </Link>
            }
          >
            {data.news.length === 0 ? (
              <p className="py-3 text-sm text-muted">{tr("No posts yet.", "Noch keine Beiträge.")}</p>
            ) : (
              <ul>
                {data.news.map((n) => {
                  const a = users.get(n.authorId);
                  return (
                    <li key={n.id}>
                      <Link to={`/news/${n.id}`} className="flex gap-3 border-b border-line py-3 last:border-0">
                        <Avatar name={a?.name ?? "?"} color={a?.avatarColor} src={a?.avatarUrl} size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={tr("New", "Neu")} />}
                            {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent" aria-label={tr("Pinned", "Angeheftet")} />}
                            <span className={cx("truncate text-[14.5px]", n.read ? "font-semibold" : "font-bold")}><Tx text={n.title} /></span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-[13px] text-muted"><TxPlain text={n.body} /></span>
                          <span className="mt-1 flex items-center gap-2 text-[12px] text-muted">
                            <span className={cx("rounded-full px-2 py-px font-semibold", NEWS_CATEGORIES[n.category]?.tone)}>{NEWS_CATEGORIES[n.category]?.label}</span>
                            {a?.name.split(" ")[0]}, {relTime(n.createdAt)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title={tr("Milestones", "Meilensteine")}
            id="home-ms"
            action={
              <Link to="/aufgaben?ansicht=meilensteine" className="link text-[13px]">
                {tr("All", "Alle")}
              </Link>
            }
          >
            {data.milestones.length === 0 ? (
              <p className="py-3 text-sm text-muted">{tr("No active milestones.", "Keine aktiven Meilensteine.")}</p>
            ) : (
              <ul>
                {data.milestones.slice(0, 5).map((m) => {
                  const o = m.ownerId ? users.get(m.ownerId) : undefined;
                  const d = dueInfo(m.dueDate);
                  return (
                    <li key={m.id}>
                      <button onClick={() => navigate(`/aufgaben/meilensteine/${m.id}`)} className="w-full border-b border-line py-3 text-left last:border-0">
                        <span className="flex items-center gap-2">
                          <Diamond className="h-3.5 w-3.5 shrink-0 fill-accent text-accent" />
                          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold"><Tx text={m.title} /></span>
                          {o && <Avatar name={o.name} color={o.avatarColor} src={o.avatarUrl} size={22} />}
                        </span>
                        <span className="mt-2 flex items-center gap-3">
                          <Progress label={tr(`Progress: ${m.title}`, `Fortschritt: ${m.title}`)} value={m.progress} className="flex-1" tone={m.progress >= 1 ? "pos" : "brand"} />
                          <span className="num w-[52px] shrink-0 text-right text-[12px] text-muted">
                            {m.taskDone}/{m.taskTotal}
                          </span>
                        </span>
                        <span className={cx("mt-1 block text-[12.5px]", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" || d.tone === "soon" ? "font-semibold text-accent-ink" : "text-muted")}>
                          {m.dueDate ? tr(`Target: ${countdown(m.dueDate)}`, `Ziel ${countdown(m.dueDate)}`) : tr("No target date", "Ohne Zieldatum")}
                          {m.area && <span className="text-muted">, {m.area}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {data.followUps.length > 0 && (
            <Section
              title={tr("Follow up", "Nachfassen")}
              id="home-follow"
              action={
                <Link to="/investoren?meine=1&ansicht=liste&sortierung=naechster" className="link text-[13px]">
                  {tr("My investors", "Meine Investoren")}
                </Link>
              }
            >
              <ul>
                {data.followUps.map((c) => {
                  const d = dueInfo(c.nextDate);
                  return (
                    <li key={`${c.source}-${c.id}`}>
                      <Link to={c.href} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {c.name}
                            {c.company && <span className="font-normal text-muted"> – {c.company}</span>}
                          </span>
                          <span className="block truncate text-[13px] text-muted">{c.nextStep ? <Tx text={c.nextStep} /> : (stageLabels?.[c.stage] ?? c.stage)}</span>
                        </span>
                        <Pill className={cx(CONTACT_CATEGORIES[c.category]?.tone, "hidden sm:inline-flex")}>{CONTACT_CATEGORIES[c.category]?.label}</Pill>
                        <span className={cx("shrink-0 text-[12.5px]", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{d.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
