import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Diamond, Mail, MapPin, Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ReauthProvider } from "@/components/Reauth";
import { OrgChart } from "./OrgChart";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Progress, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { countdown } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useUsers } from "@/lib/queries";
import type { Milestone, Task, User } from "@/lib/types";
import { locale, tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

export function TeamPage() {
  const { data, isLoading } = useUsers();
  const [params, setParams] = useSearchParams();
  const view = (params.get("ansicht") as "organigramm" | "personen" | "zustaendig") || "organigramm";
  const setView = (v: "organigramm" | "personen" | "zustaendig") => setParams(v === "organigramm" ? {} : { ansicht: v }, { replace: true });
  const [q, setQ] = useState("");
  const { open } = useOverlays();
  const filtered = (data ?? []).filter((u) => !q || (u.name + u.title + u.responsibilities.join(" ") + u.location).toLowerCase().includes(q.toLowerCase()));
  const index = useMemo(() => {
    const m = new Map<string, User[]>();
    for (const u of data ?? []) for (const r of u.responsibilities) m.set(r, [...(m.get(r) ?? []), u]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], locale()));
  }, [data]);

  return (
    <ReauthProvider>
    <div className="space-y-4">
      <header>
        <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">Team</h1>
        <p className="text-[14px] text-muted">{tr("Who is responsible for what and how to reach them.", "Wer wofür zuständig ist und wie du die Person erreichst.")}</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "organigramm", label: tr("Org chart", "Organigramm") },
            { value: "personen", label: tr("People", "Personen") },
            { value: "zustaendig", label: tr("Responsibilities", "Zuständig") },
          ]}
        />
        {view === "personen" && (
          <div className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 sm:max-w-xs">
            <Search className="h-4 w-4 text-muted" />
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" placeholder={tr("Name, role, topic", "Name, Rolle, Thema")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search team", "Team durchsuchen")} />
          </div>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : view === "organigramm" ? (
        <OrgChart />
      ) : view === "personen" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((u) => (
            <article key={u.id} className="card flex flex-col p-4">
              <Link to={`/team/${u.id}`} className="flex items-center gap-3">
                <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-bold">{u.name}</p>
                  <p className="truncate text-[13.5px] text-muted">
                    {u.title ? <Tx text={u.title} /> : "–"}
                    {u.status === "invited" && <span className="ml-1.5 text-[12px] font-semibold text-accent-ink">· {tr("not signed in yet", "noch nicht angemeldet")}</span>}
                  </p>
                  {u.location && (
                    <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
                      <MapPin className="h-3 w-3" /> {u.location}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="num text-[18px] font-semibold leading-none">{u.openTasks ?? 0}</p>
                  <p className="text-[11.5px] text-muted">{tr("open", "offen")}</p>
                </div>
              </Link>
              {u.responsibilities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {u.responsibilities.map((r) => (
                    <span key={r} className="rounded-md bg-surface2 px-1.5 py-0.5 text-[12px] font-semibold text-muted">
                      <Tx text={r} />
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-auto flex gap-2 pt-4">
                <Button size="sm" variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => open({ kind: "compose", defaults: { to: [u.email] } })} className="flex-1">
                  {tr("E-mail", "E-Mail")}
                </Button>
                {u.phone && (
                  <a href={`tel:${u.phone.replace(/\s+/g, "")}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface text-[13px] font-semibold hover:bg-surface2">
                    <Phone className="h-4 w-4" /> {tr("Call", "Anrufen")}
                  </a>
                )}
                <Button size="sm" variant="ghost" onClick={() => open({ kind: "task", defaults: { assigneeId: u.id } })}>
                  {tr("Task", "Aufgabe")}
                </Button>
              </div>
            </article>
          ))}
          {!filtered.length && <EmptyState title={tr("No one found", "Niemand gefunden")} />}
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {index.length === 0 ? (
            <EmptyState title={tr("No responsibilities yet", "Noch keine Zuständigkeiten")} text={tr("Everyone adds their areas in their profile.", "Jede Person trägt ihre Bereiche im Profil ein.")} />
          ) : (
            index.map(([r, people]) => (
              <div key={r} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <p className="min-w-[180px] flex-1 font-semibold"><Tx text={r} /></p>
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <Link key={p.id} to={`/team/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface2 py-1 pl-1 pr-2.5 text-[13px] font-semibold hover:bg-line/60">
                      <Avatar name={p.name} color={p.avatarColor} src={p.avatarUrl} size={22} /> {p.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
    </ReauthProvider>
  );
}

export function PersonPage() {
  const { id } = useParams();
  const { open } = useOverlays();
  const { data, isLoading, error } = useQuery({
    queryKey: ["person", id],
    queryFn: () => api.get<{ user: User; tasks: Task[]; milestones: Milestone[]; contacts: number }>(`/api/users/${id}`),
    enabled: !!id,
  });
  if (isLoading) return <Skeleton className="h-80" />;
  if (error || !data) return <EmptyState title={tr("Person not found", "Person nicht gefunden")} text={(error as Error)?.message} />;
  const u = data.user;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/team" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Team
      </Link>
      <header className="card p-5">
        <div className="flex items-center gap-4">
          <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={68} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{u.name}</h1>
            <p className="text-muted"><Tx text={u.title} /></p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
              <a className="link" href={`mailto:${u.email}`}>
                {u.email}
              </a>
              {u.phone && (
                <a className="link" href={`tel:${u.phone.replace(/\s+/g, "")}`}>
                  {u.phone}
                </a>
              )}
              {u.location && <span className="text-muted">{u.location}</span>}
              {u.linkedin && (
                <a className="link" href={u.linkedin} target="_blank" rel="noreferrer noopener">
                  LinkedIn
                </a>
              )}
            </p>
          </div>
        </div>
        <OrgFacts u={u} />
        {u.bio && <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed"><Tx text={u.bio} /></p>}
        {u.responsibilities.length > 0 && (
          <div className="mt-4">
            <p className="label">{tr("Responsible for", "Zuständig für")}</p>
            <div className="flex flex-wrap gap-1.5">
              {u.responsibilities.map((r) => (
                <span key={r} className="rounded-lg bg-surface2 px-2.5 py-1 text-[13px] font-semibold">
                  <Tx text={r} />
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="primary" icon={<Mail className="h-4 w-4" />} onClick={() => open({ kind: "compose", defaults: { to: [u.email] } })}>
            {tr("Write e-mail", "E-Mail schreiben")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open({ kind: "task", defaults: { assigneeId: u.id } })}>
            {tr("Assign task", "Aufgabe zuweisen")}
          </Button>
        </div>
      </header>
      {data.milestones.length > 0 && (
        <section className="card px-4 py-3.5">
          <h2 className="section-title">{tr("Owns", "Verantwortet")}</h2>
          <ul className="mt-1">
            {data.milestones.map((m) => (
              <li key={m.id}>
                <Link to={`/aufgaben/meilensteine/${m.id}`} className="block border-b border-line py-3 last:border-0">
                  <span className="flex items-center gap-2">
                    <Diamond className="h-3.5 w-3.5 fill-accent text-accent" />
                    <span className="flex-1 truncate font-semibold"><Tx text={m.title} /></span>
                    <span className="text-[12.5px] text-muted">{countdown(m.dueDate)}</span>
                  </span>
                  <Progress label={`${tr("Progress", "Fortschritt")}: ${m.title}`} value={m.progress} className="mt-2" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={cx("card px-4 pb-2 pt-3.5")}>
        <h2 className="section-title">
          {tr("Open tasks", "Offene Aufgaben")} <span className="num text-muted">{data.tasks.length}</span>
        </h2>
        {data.tasks.length === 0 ? <p className="py-3 text-sm text-muted">{tr("No open tasks.", "Keine offenen Aufgaben.")}</p> : data.tasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}
      </section>
    </div>
  );
}

function OrgFacts({ u }: { u: User }) {
  const users = useUsers().data ?? [];
  const manager = users.find((x) => x.id === u.managerId);
  const reports = users.filter((x) => x.managerId === u.id);
  if (!u.department && !manager && !reports.length) return null;
  return (
    <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-3">
      {u.department && (
        <div>
          <dt className="text-[12px] text-muted">{tr("Area", "Bereich")}</dt>
          <dd className="font-semibold"><Tx text={u.department} /></dd>
        </div>
      )}
      {manager && (
        <div>
          <dt className="text-[12px] text-muted">{tr("Reports to", "Berichtet an")}</dt>
          <dd>
            <Link className="inline-flex items-center gap-1.5 font-semibold hover:underline" to={`/team/${manager.id}`}>
              <Avatar name={manager.name} color={manager.avatarColor} src={manager.avatarUrl} size={20} /> {manager.name}
            </Link>
          </dd>
        </div>
      )}
      {reports.length > 0 && (
        <div>
          <dt className="text-[12px] text-muted">{tr("Direct reports", "Direkte Berichte")}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {reports.map((r) => (
              <Link key={r.id} to={`/team/${r.id}`} title={r.name} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                <Avatar name={r.name} color={r.avatarColor} src={r.avatarUrl} size={24} />
              </Link>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
