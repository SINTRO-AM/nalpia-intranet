import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Calendar, ChevronRight, Linkedin, Mail, MessageSquare, Pencil, Phone, Plus, Search, StickyNote, Trash2, Users, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, IconButton, Pill, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { CONTACT_CATEGORIES, dueInfo, orgHref, relTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlays } from "@/lib/overlays";
import { MoreButton, usePaged } from "@/lib/paging";
import { useContact, useContactMeta, useContacts, useMe, useUserMap } from "@/lib/queries";
import type { Activity } from "@/lib/types";
import { Tx, TxNote, txNow, useTxVersion } from "@/lib/translate";

export function ContactsPage() {
  useTxVersion(); // re-render when translated content arrives
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const category = params.get("kategorie") ?? undefined;
  const mine = params.get("meine") === "1";
  const { data, isLoading } = useContacts({ q: debounced || undefined, category, owner: mine ? "me" : undefined });
  const counts = useQuery({ queryKey: ["contacts", "counts"], queryFn: () => api.get<{ total: number; byCategory: Record<string, number> }>("/api/contacts/counts") }).data;
  const paged = usePaged(data ?? [], 100, `${debounced}|${category}|${mine}`);
  const users = useUserMap();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const meta = useContactMeta().data;
  const stageLabel = (s: string) => meta?.stageLabels?.[s] ?? s;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const setFilter = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{tr("Contacts", "Kontakte")}</h1>
          <p className="text-[14px] text-muted">{tr("Investors, clients, partners and applicants with activity and next step.", "Investoren, Kunden, Partner und Bewerber mit Verlauf und nächstem Schritt.")}</p>
        </div>
        <Button variant="primary" className="hidden sm:inline-flex" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "contact" })}>
          {tr("New contact", "Neuer Kontakt")}
        </Button>
      </header>
      <div className="space-y-2.5">
        <div className="flex gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
            <Search className="h-4 w-4 text-muted" />
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70" placeholder={tr("Name, company, email or tag", "Name, Firma, E-Mail oder Schlagwort")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search contacts", "Kontakte durchsuchen")} />
          </div>
          <Segmented
            value={mine ? "mine" : "all"}
            onChange={(v) => setFilter({ meine: v === "mine" ? "1" : null })}
            options={[
              { value: "all", label: tr("All", "Alle") },
              { value: "mine", label: tr("Mine", "Meine") },
            ]}
          />
        </div>
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
          <button onClick={() => setFilter({ kategorie: null })} className={cx("h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold", !category ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted")}>
            {tr("All", "Alle")} <span className="num opacity-70">{counts?.total ?? 0}</span>
          </button>
          {Object.entries(CONTACT_CATEGORIES).map(([k, c]) => (
            <button key={k} onClick={() => setFilter({ kategorie: k })} className={cx("h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold", category === k ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted")}>
              {c.plural} <span className="num opacity-70">{counts?.byCategory[k] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : !data?.length ? (
        <EmptyState
          icon={<UsersRound className="h-5 w-5" />}
          title={q || category || mine ? tr("No matches", "Keine Treffer") : tr("No contacts yet", "Noch keine Kontakte")}
          text={q || category || mine ? tr("Adjust your search or filters.", "Passe Suche oder Filter an.") : tr("Create contacts or add them straight from an email.", "Lege Kontakte an oder übernimm sie direkt aus einer E-Mail.")}
          action={!q && !category && !mine ? <Button variant="primary" onClick={() => open({ kind: "contact" })}>{tr("Create contact", "Kontakt anlegen")}</Button> : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_120px_32px] gap-4 border-b border-line bg-surface2/50 px-4 py-2 text-[12px] font-semibold text-muted md:grid">
            <span>Name</span>
            <span>Status</span>
            <span>{tr("Next step", "Nächster Schritt")}</span>
            <span>{tr("Owner", "Zuständig")}</span>
            <span />
          </div>
          <ul>
            {paged.visible.map((c) => {
              const o = c.ownerId ? users.get(c.ownerId) : undefined;
              const d = dueInfo(c.nextDate);
              return (
                <li key={c.id}>
                  <button onClick={() => navigate(`/kontakte/${c.id}`)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface2/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_120px_32px] md:gap-4">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={c.name} color={c.category === "investor" ? "navy" : c.category === "partner" ? "teal" : c.category === "kunde" ? "moss" : "slate"} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.name}</span>
                        <span className="block truncate text-[13px] text-muted">{[txNow(c.position), c.company].filter(Boolean).join(", ") || c.email}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 justify-self-end md:justify-self-start">
                      <Pill className={CONTACT_CATEGORIES[c.category]?.tone}>{CONTACT_CATEGORIES[c.category]?.label}</Pill>
                      <span className="hidden truncate text-[13px] text-muted md:inline">{stageLabel(c.stage)}</span>
                    </span>
                    <span className="col-span-2 flex min-w-0 items-center gap-2 pl-12 text-[13px] md:col-span-1 md:pl-0">
                      <span className="text-muted md:hidden">{stageLabel(c.stage)}</span>
                      {c.nextStep && <span className="min-w-0 truncate"><Tx text={c.nextStep} /></span>}
                      {c.nextDate && <span className={cx("shrink-0", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{d.label}</span>}
                    </span>
                    <span className="hidden items-center gap-2 md:flex">
                      {o ? (
                        <>
                          <Avatar name={o.name} color={o.avatarColor} src={o.avatarUrl} size={24} />
                          <span className="truncate text-[13px]">{o.name.split(" ")[0]}</span>
                        </>
                      ) : (
                        <span className="text-[13px] text-muted">–</span>
                      )}
                    </span>
                    <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                  </button>
                </li>
              );
            })}
          </ul>
          {paged.rest > 0 && (
            <div className="border-t border-line px-4 py-3 text-center">
              <MoreButton rest={paged.rest} step={100} onClick={paged.more} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const KIND_ICON = { notiz: StickyNote, mail: Mail, anruf: Phone, meeting: Users, status: ChevronRight } as const;
const kindLabel = (k: Activity["kind"]) =>
  ({ notiz: tr("Note", "Notiz"), mail: tr("Email", "E-Mail"), anruf: tr("Call", "Anruf"), meeting: "Meeting", status: "Status" })[k];

export function ContactDetailPage() {
  useTxVersion(); // re-render when translated content arrives
  const { id } = useParams();
  const { data: c, isLoading, error } = useContact(id);
  const meta = useContactMeta().data;
  const users = useUserMap();
  const me = useMe().data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const [kind, setKind] = useState<"notiz" | "anruf" | "meeting">("notiz");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !c) return <EmptyState title={tr("Contact not found", "Kontakt nicht gefunden")} text={(error as Error)?.message} action={<Link to="/kontakte" className="link">{tr("Back to contacts", "Zu den Kontakten")}</Link>} />;
  const owner = c.ownerId ? users.get(c.ownerId) : undefined;
  const stages = meta?.stages[c.category] ?? [];
  const d = dueInfo(c.nextDate);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", c.id] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };

  async function patch(p: Record<string, unknown>) {
    try {
      await api.patch(`/api/contacts/${c!.id}`, p);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/contacts/${c!.id}/activities`, { kind, body: note.trim() });
      setNote("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeActivity(a: Activity) {
    await api.del(`/api/contacts/${c!.id}/activities/${a.id}`);
    refresh();
  }
  async function removeContact() {
    if (!window.confirm(tr(`Delete "${c!.name}"? Its activity and links will be lost.`, `„${c!.name}“ wirklich löschen? Verlauf und Verknüpfungen gehen verloren.`))) return;
    try {
      await api.del(`/api/contacts/${c!.id}`);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast(tr("Contact deleted", "Kontakt gelöscht"));
      navigate("/kontakte");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const canDelete = me?.user && (me.user.role === "admin" || c.ownerId === me.user.id || c.createdBy === me.user.id);

  return (
    <div className="space-y-4">
      <Link to="/kontakte" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {tr("Contacts", "Kontakte")}
      </Link>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <header className="card p-5">
            <div className="flex items-start gap-4">
              <Avatar name={c.name} color={c.category === "investor" ? "navy" : c.category === "partner" ? "teal" : c.category === "kunde" ? "moss" : "slate"} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.02em]">{c.name}</h1>
                <p className="text-[14.5px] text-muted">{[txNow(c.position), c.company].filter(Boolean).join(", ")}</p>
                {c.organizationId && (
                  <Link to={orgHref(c.organizationKind, c.organizationId)} className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-info hover:underline">
                    <Building2 className="h-3.5 w-3.5" /> {c.organizationName}
                  </Link>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill className={CONTACT_CATEGORIES[c.category]?.tone}>{CONTACT_CATEGORIES[c.category]?.label}</Pill>
                  {c.tags.map((t) => (
                    <Pill key={t}><Tx text={t} /></Pill>
                  ))}
                </div>
              </div>
              <IconButton label={tr("Edit", "Bearbeiten")} onClick={() => open({ kind: "contact", id: c.id })}>
                <Pencil className="h-[18px] w-[18px]" />
              </IconButton>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {c.email && (
                <Button size="sm" variant="primary" icon={<Mail className="h-4 w-4" />} onClick={() => open({ kind: "compose", defaults: { to: [c.email] } })}>
                  {tr("Email", "E-Mail")}
                </Button>
              )}
              {c.phone && (
                <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface2">
                  <Phone className="h-4 w-4" /> {tr("Call", "Anrufen")}
                </a>
              )}
              {/^https:\/\//i.test(c.linkedin) && (
                <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface2">
                  <Linkedin className="h-4 w-4" /> LinkedIn
                </a>
              )}
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task", defaults: { contactId: c.id, title: c.nextStep || "" } })}>
                {tr("Task", "Aufgabe")}
              </Button>
            </div>
            <div className="mt-5">
              <p className="label">Status</p>
              <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
                {stages.map((s, i) => {
                  const cur = stages.indexOf(c.stage);
                  const on = s === c.stage;
                  return (
                    <button
                      key={s}
                      onClick={() => !on && patch({ stage: s })}
                      className={cx(
                        "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition",
                        on ? "border-brand bg-brand text-brand-ink" : i < cur ? "border-brand/30 bg-info-soft/60 text-brand" : "border-line bg-surface text-muted hover:text-ink",
                      )}
                    >
                      {meta?.stageLabels?.[s] ?? s}
                    </button>
                  );
                })}
              </div>
            </div>
          </header>

          <section className="card p-4 sm:p-5">
            <h2 className="section-title">{tr("Activity", "Verlauf")}</h2>
            <div className="mt-3 rounded-xl border border-line bg-bg/60 p-2.5">
              <div className="mb-2 flex gap-1.5">
                {(["notiz", "anruf", "meeting"] as const).map((k) => {
                  const I = KIND_ICON[k];
                  return (
                    <button key={k} onClick={() => setKind(k)} className={cx("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold", kind === k ? "bg-brand text-brand-ink" : "text-muted hover:bg-surface2")}>
                      <I className="h-3.5 w-3.5" /> {kindLabel(k)}
                    </button>
                  );
                })}
              </div>
              <textarea
                className="field min-h-[70px] bg-surface"
                placeholder={kind === "anruf" ? tr("What was the call about?", "Worum ging es im Telefonat?") : kind === "meeting" ? tr("Meeting outcomes", "Ergebnisse des Meetings") : tr("Add a note", "Notiz hinzufügen")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addNote();
                }}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" onClick={addNote} loading={busy} disabled={!note.trim()}>
                  {tr("Save", "Speichern")}
                </Button>
              </div>
            </div>
            {c.activities.length === 0 ? (
              <p className="py-4 text-sm text-muted">{tr("No entries yet. You can save emails to the activity straight from Mail.", "Noch keine Einträge. Mails lassen sich direkt aus dem Postfach im Verlauf speichern.")}</p>
            ) : (
              <ol className="mt-4 space-y-0">
                {c.activities.map((a) => {
                  const u = a.userId ? users.get(a.userId) : undefined;
                  const I = KIND_ICON[a.kind] ?? MessageSquare;
                  return (
                    <li key={a.id} className="group relative flex gap-3 pb-4 last:pb-0">
                      <span className="absolute bottom-0 left-[15px] top-8 w-px bg-line group-last:hidden" aria-hidden />
                      <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", a.kind === "status" ? "bg-surface2 text-muted" : "bg-info-soft text-info")}>
                        <I className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="text-[12.5px] text-muted">
                          <b className="text-ink">{kindLabel(a.kind)}</b> {u ? tr(`by ${u.name.split(" ")[0]}`, `von ${u.name.split(" ")[0]}`) : ""}, {relTime(a.createdAt)}
                        </p>
                        <p className={cx("mt-1 whitespace-pre-wrap text-[14px] leading-relaxed", a.kind === "mail" && "line-clamp-6")}><Tx text={a.body} /></p>
                        {a.mailRef && a.mailRef.ownerId === me?.user?.id && (
                          <Link to={`/postfach?f=${a.mailRef.folderId}&m=${a.mailRef.messageId}`} className="link mt-1 inline-block text-[12.5px]">
                            {tr("Open in Mail", "Im Postfach öffnen")}
                          </Link>
                        )}
                      </div>
                      {(a.userId === me?.user?.id || me?.user?.role === "admin") && a.kind !== "status" && (
                        <IconButton label={tr("Delete entry", "Eintrag löschen")} size="sm" className="opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={() => removeActivity(a)}>
                          <Trash2 className="h-4 w-4 text-muted" />
                        </IconButton>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="section-title">{tr("Next step", "Nächster Schritt")}</h2>
            <input
              className="field mt-2"
              defaultValue={c.nextStep}
              key={`ns-${c.updatedAt}`}
              placeholder={tr("What needs to happen next?", "Was ist als Nächstes zu tun?")}
              onBlur={(e) => e.target.value !== c.nextStep && patch({ nextStep: e.target.value })}
              aria-label={tr("Next step", "Nächster Schritt")}
            />
            <div className="mt-2 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted" />
              <input type="date" className="field field-sm flex-1" value={c.nextDate ?? ""} onChange={(e) => patch({ nextDate: e.target.value || null })} aria-label={tr("Due by", "Bis wann")} />
              {c.nextDate && <span className={cx("text-[12.5px]", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{d.label}</span>}
            </div>
            <div className="mt-4">
              <p className="label">{tr("Owner", "Zuständig")}</p>
              <Select value={c.ownerId ?? ""} onChange={(e) => patch({ ownerId: e.target.value || null })} aria-label={tr("Owner", "Zuständig")}>
                <option value="">{tr("Nobody", "Niemand")}</option>
                {[...users.values()].map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              {owner && <p className="mt-1 text-[12.5px] text-muted"><Tx text={owner.title} /></p>}
            </div>
          </section>
          <section className="card px-4 pb-2 pt-3.5">
            <div className="flex items-center justify-between">
              <h2 className="section-title">{tr("Tasks", "Aufgaben")}</h2>
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task", defaults: { contactId: c.id } })}>
                {tr("New", "Neu")}
              </Button>
            </div>
            {c.tasks.length === 0 ? <p className="py-3 text-sm text-muted">{tr("No linked tasks.", "Keine Aufgaben verknüpft.")}</p> : c.tasks.map((t) => <TaskRow key={t.id} task={t} showContext={false} />)}
          </section>
          <section className="card p-4">
            <h2 className="section-title">Details</h2>
            <dl className="mt-2 space-y-2 text-[14px]">
              {[
                [tr("Email", "E-Mail"), c.email],
                [tr("Phone", "Telefon"), c.phone],
                [tr("Last contact", "Letzter Kontakt"), c.lastContactAt ? relTime(c.lastContactAt) : ""],
                [tr("Created", "Angelegt"), relTime(c.createdAt)],
              ].map(([k, v]) =>
                v ? (
                  <div key={k} className="flex gap-3">
                    <dt className="w-28 shrink-0 text-muted">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            <p className="label mt-4">{tr("Notes", "Notizen")}</p>
            <textarea className="field min-h-[110px]" defaultValue={c.notes} key={`n-${c.updatedAt}`} onBlur={(e) => e.target.value !== c.notes && patch({ notes: e.target.value })} aria-label={tr("Notes", "Notizen")} />
            <TxNote text={c.notes} />
            {canDelete && (
              <Button variant="ghost" size="sm" className="mt-3 text-neg" icon={<Trash2 className="h-4 w-4" />} onClick={removeContact}>
                {tr("Delete contact", "Kontakt löschen")}
              </Button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
