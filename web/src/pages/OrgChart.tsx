import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Linkedin, Mail, MapPin, Pencil, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { ReauthCancelled, useGuarded } from "@/components/Reauth";
import { Sheet } from "@/components/Sheet";
import { Avatar, Button, cx, Field, IconButton, Pill, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useOverlays } from "@/lib/overlays";
import { useMe, useUsers } from "@/lib/queries";
import type { TeamExternal, User } from "@/lib/types";
import { locale, tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

const LEADERSHIP = "Management";
/** Areas shown at the top leadership level ("Geschäftsführung" kept for existing data) */
const TOP_DEPTS = new Set([LEADERSHIP, "Geschäftsführung", "C-Level"]);
/** Group key for external people without a specific group */
const EXTERNAL = "External";

/** Manager → direct reports, in the maintained order (sort_order, then name) */
function buildTree(users: User[]) {
  const ids = new Set(users.map((u) => u.id));
  const children = new Map<string, User[]>();
  const roots: User[] = [];
  for (const u of users) {
    if (u.managerId && ids.has(u.managerId) && u.managerId !== u.id) children.set(u.managerId, [...(children.get(u.managerId) ?? []), u]);
    else roots.push(u);
  }
  const lead = roots.filter((u) => TOP_DEPTS.has(u.department));
  const top = lead.length ? lead : roots;
  const loose = lead.length ? roots.filter((u) => !TOP_DEPTS.has(u.department)) : [];
  return { top, loose, children };
}

export function OrgChart() {
  const { data: users, isLoading } = useUsers();
  const me = useMe().data?.user;
  const isAdmin = me?.role === "admin";
  const externals = useQuery({ queryKey: ["team-externals"], queryFn: () => api.get<TeamExternal[]>("/api/team/externals") }).data ?? [];
  const [edit, setEdit] = useState<User | null>(null);
  const [editExt, setEditExt] = useState(false);
  const tree = useMemo(() => buildTree(users ?? []), [users]);
  const groups = useMemo(() => {
    const m = new Map<string, TeamExternal[]>();
    for (const x of externals) {
      // "Extern" (older data) and "External" (server default) form one group
      const key = !x.group || x.group === "Extern" || x.group === "External" ? EXTERNAL : x.group;
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return [...m.entries()];
  }, [externals]);

  if (isLoading || !users) return <Skeleton className="h-[480px]" />;
  const departments = [...new Set(users.map((u) => u.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale()));
  const people = users.length;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted">
        {people} {people === 1 ? tr("person", "Person") : tr("people", "Personen")}
        {departments.length > 0 && <> in {departments.length} {departments.length === 1 ? tr("area", "Bereich") : tr("areas", "Bereichen")}</>}
        {externals.length > 0 && <>, {tr(`plus ${externals.length} external ${externals.length === 1 ? "partner" : "partners"}`, `dazu ${externals.length} ${externals.length === 1 ? "externer Begleiter" : "externe Begleiter"}`)}</>}
        {isAdmin && <span> · {tr("Edit managers, areas and bios with the pencil on each card.", "Vorgesetzte, Bereiche und Kurzprofile pflegst du über den Stift auf jeder Karte.")}</span>}
      </p>

      {/* Leadership */}
      <section aria-label={tr("Leadership", "Leitungsebene")} className="rounded-2xl bg-rail p-4 text-rail-ink sm:p-5">
        <h2 className="text-[12.5px] font-semibold tracking-[0.08em] text-rail-muted">{tree.top.some((u) => u.department === "C-Level") ? tr("Management & C-level", "Geschäftsführung & C-Level") : tree.top.some((u) => u.department === LEADERSHIP || u.department === "Geschäftsführung") ? tr("Management", "Geschäftsführung") : tr("Leadership", "Leitung")}</h2>
        <div className={cx("mt-3 grid grid-cols-1 gap-3", tree.top.length > 1 && "md:grid-cols-2", tree.top.length > 2 && "xl:grid-cols-3")}>
          {tree.top.map((u) => (
            <PersonCard key={u.id} u={u} users={users} lead isAdmin={isAdmin} onEdit={() => setEdit(u)} />
          ))}
        </div>
      </section>

      {/* Areas below leadership */}
      <div className={cx("grid grid-cols-1 gap-5", tree.top.length > 1 && "md:grid-cols-2", tree.top.length > 2 && "xl:grid-cols-3")}>
        {tree.top.map((u) => {
          const kids = tree.children.get(u.id) ?? [];
          return (
            <section key={u.id} aria-label={tr(`Reports to ${u.name}`, `Berichtet an ${u.name}`)} className="min-w-0">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
                <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={20} />
                {tr("Reports to", "Berichtet an")} {u.name.split(" ")[0]}
                <span className="font-normal">{countAll(u.id, tree.children)}</span>
              </h3>
              {kids.length ? (
                <Branch nodes={kids} users={users} tree={tree.children} isAdmin={isAdmin} onEdit={setEdit} />
              ) : (
                <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">{tr("No one assigned yet", "Noch niemand zugeordnet")}</p>
              )}
            </section>
          );
        })}
      </div>

      {tree.loose.length > 0 && (
        <section aria-label={tr("Not yet assigned", "Noch ohne Zuordnung")}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{tr("No manager yet", "Noch ohne Vorgesetzte")}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tree.loose.map((u) => (
              <div key={u.id} className="space-y-2">
                <PersonCard u={u} users={users} isAdmin={isAdmin} onEdit={() => setEdit(u)} />
                {(tree.children.get(u.id)?.length ?? 0) > 0 && <Branch nodes={tree.children.get(u.id)!} users={users} tree={tree.children} isAdmin={isAdmin} onEdit={setEdit} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* External: advisory board, advisors, legal counsel */}
      {(groups.length > 0 || isAdmin) && (
        <section aria-label={tr("Advisory board and external partners", "Beirat und externe Partner")} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-bold">{tr("Advisory board and external partners", "Beirat und externe Partner")}</h2>
            {isAdmin && (
              <button className="link text-[13px]" onClick={() => setEditExt(true)}>
                {tr("Edit", "Bearbeiten")}
              </button>
            )}
          </div>
          {groups.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groups.flatMap(([g, list]) =>
                list.map((x) => (
                  <article key={x.id} className="flex gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-4">
                    <Avatar name={x.name} color="slate" size={44} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-muted">{g === EXTERNAL ? tr("External", "Extern") : g}</p>
                      <p className="font-bold leading-snug">{x.name}</p>
                      <p className="text-[13.5px] text-muted">{x.role}</p>
                      {x.note && <p className="mt-1.5 text-[13px] leading-snug"><Tx text={x.note} /></p>}
                    </div>
                  </article>
                )),
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted">{tr("No external people added yet.", "Noch keine externen Personen eingetragen.")}</p>
          )}
        </section>
      )}

      {edit && <PersonEditSheet user={edit} users={users} departments={departments} onClose={() => setEdit(null)} />}
      {isAdmin && <ExternalsSheet open={editExt} onOpenChange={setEditExt} items={externals} />}
    </div>
  );
}

function countAll(id: string, tree: Map<string, User[]>): number {
  return (tree.get(id) ?? []).reduce((n, k) => n + 1 + countAll(k.id, tree), 0);
}

/** Branch with connector lines: vertical line on the left, short branch to each card */
function Branch({ nodes, users, tree, isAdmin, onEdit, depth = 0 }: { nodes: User[]; users: User[]; tree: Map<string, User[]>; isAdmin: boolean; onEdit: (u: User) => void; depth?: number }) {
  return (
    <ul className={cx("relative space-y-3", depth > 0 && "mt-3")}>
      {nodes.map((u, i) => {
        const kids = tree.get(u.id) ?? [];
        const last = i === nodes.length - 1;
        return (
          <li key={u.id} className="relative pl-6">
            {/* Line down from the parent; for the last child only down to the branch */}
            <span aria-hidden className={cx("absolute left-[9px] top-0 w-[2px] bg-line", last ? "h-[34px]" : "-bottom-3")} />
            <span aria-hidden className="absolute left-[9px] top-[33px] h-[2px] w-[15px] bg-line" />
            <PersonCard u={u} users={users} isAdmin={isAdmin} onEdit={() => onEdit(u)} />
            {kids.length > 0 && <Branch nodes={kids} users={users} tree={tree} isAdmin={isAdmin} onEdit={onEdit} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

function PersonCard({ u, users, lead, isAdmin, onEdit }: { u: User; users: User[]; lead?: boolean; isAdmin: boolean; onEdit: () => void }) {
  const { open } = useOverlays();
  const reports = users.filter((x) => x.managerId === u.id).length;
  return (
    <article className={cx("flex min-w-0 flex-col rounded-2xl p-4", lead ? "bg-surface text-ink shadow-pop" : "card")}>
      <div className="flex items-start gap-3">
        <Link to={`/team/${u.id}`} className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={lead ? 60 : 48} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/team/${u.id}`} className="block truncate text-[16px] font-bold leading-snug hover:underline">
            {u.name}
          </Link>
          <p className="truncate text-[13.5px] text-muted">{u.title ? <Tx text={u.title} /> : tr("No role added yet", "Rolle noch nicht eingetragen")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {u.department && !TOP_DEPTS.has(u.department) && <span className="rounded-md bg-surface2 px-1.5 py-0.5 font-semibold text-ink"><Tx text={u.department} /></span>}
            {u.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden /> {u.location}
              </span>
            )}
            {reports > 0 && !lead && <span>{reports} {tr("direct", "direkt")}</span>}
            {isAdmin && u.status === "invited" && <Pill className="bg-accent-soft text-accent-ink">{tr("Not signed in yet", "Noch nicht angemeldet")}</Pill>}
          </p>
        </div>
        {isAdmin && <IconButton label={tr(`Edit ${u.name}`, `${u.name} bearbeiten`)} size="sm" onClick={onEdit} className="-mr-1 -mt-1 shrink-0">
          <Pencil className="h-4 w-4" />
        </IconButton>}
      </div>
      {u.bio && <p className={cx("mt-3 text-[13px] leading-relaxed", lead ? "line-clamp-4" : "line-clamp-3")}><Tx text={u.bio} /></p>}
      {u.responsibilities.some((r) => r !== u.department) && (
        <div className="mt-3 flex flex-wrap gap-1">
          {u.responsibilities.filter((r) => r !== u.department).slice(0, 5).map((r) => (
            <span key={r} className="rounded-md bg-surface2 px-1.5 py-0.5 text-[12px] font-semibold text-muted"><Tx text={r} /></span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-1 pt-3">
        <IconButton label={tr(`E-mail ${u.name}`, `E-Mail an ${u.name}`)} size="sm" onClick={() => open({ kind: "compose", defaults: { to: [u.email] } })}>
          <Mail className="h-4 w-4" />
        </IconButton>
        {u.phone && (
          <a href={`tel:${u.phone.replace(/\s+/g, "")}`} aria-label={tr(`Call ${u.name}`, `${u.name} anrufen`)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink">
            <Phone className="h-4 w-4" />
          </a>
        )}
        {u.linkedin && (
          <a href={u.linkedin} target="_blank" rel="noreferrer noopener" aria-label={tr(`${u.name} on LinkedIn`, `${u.name} auf LinkedIn`)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink">
            <Linkedin className="h-4 w-4" />
          </a>
        )}
        <Link to={`/team/${u.id}`} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink">
          <UserRound className="h-3.5 w-3.5" /> {tr("Profile", "Profil")}
        </Link>
      </div>
    </article>
  );
}

/* ---------- Editing (admins) ---------- */

function PersonEditSheet({ user: u, users, departments, onClose }: { user: User; users: User[]; departments: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const guarded = useGuarded();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: u.name,
    email: u.email,
    title: u.title,
    department: u.department,
    managerId: u.managerId ?? "",
    location: u.location,
    phone: u.phone,
    linkedin: u.linkedin,
    responsibilities: u.responsibilities.join(", "),
    bio: u.bio,
    sortOrder: String(u.sortOrder || ""),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: f.name.trim(),
        title: f.title.trim(),
        department: f.department.trim(),
        managerId: f.managerId || null,
        location: f.location.trim(),
        phone: f.phone.trim(),
        linkedin: f.linkedin.trim(),
        responsibilities: f.responsibilities
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 12),
        bio: f.bio.trim(),
        sortOrder: Number.parseInt(f.sortOrder, 10) || 0,
      };
      if (u.status === "invited" && f.email.trim().toLowerCase() !== u.email) payload.email = f.email.trim().toLowerCase();
      await guarded(() => api.patch(`/api/admin/users/${u.id}`, payload));
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["person", u.id] });
      toast.success(tr(`${f.name} saved`, `${f.name} gespeichert`));
      onClose();
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={u.name} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="oe-name">
            <input id="oe-name" className="field" value={f.name} onChange={set("name")} />
          </Field>
          <Field label={tr("Role / title", "Rolle / Titel")} htmlFor="oe-title">
            <input id="oe-title" className="field" value={f.title} onChange={set("title")} />
          </Field>
          <Field label={tr("Area", "Bereich")} htmlFor="oe-dep" hint={tr("“Management” and “C-Level” appear at the top of the org chart.", "„Management“ (bzw. „Geschäftsführung“) und „C-Level“ stehen oben im Organigramm.")}>
            <input id="oe-dep" className="field" list="oe-deps" value={f.department} onChange={set("department")} placeholder={tr("e.g. Technology", "z. B. Technologie")} />
            <datalist id="oe-deps">
              {[LEADERSHIP, "C-Level", ...departments.filter((d) => !TOP_DEPTS.has(d))].map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label={tr("Reports to", "Berichtet an")} htmlFor="oe-mgr">
            <Select id="oe-mgr" value={f.managerId} onChange={set("managerId")}>
              <option value="">{tr("No one (top level)", "Niemand (oberste Ebene)")}</option>
              {users
                .filter((x) => x.id !== u.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.title ? ` – ${x.title}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={tr("Location", "Standort")} htmlFor="oe-loc">
            <input id="oe-loc" className="field" value={f.location} onChange={set("location")} placeholder="Frankfurt, Berlin, Zürich …" />
          </Field>
          <Field label={tr("Phone", "Telefon")} htmlFor="oe-phone">
            <input id="oe-phone" type="tel" className="field" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="LinkedIn" htmlFor="oe-li">
            <input id="oe-li" className="field" value={f.linkedin} onChange={set("linkedin")} placeholder="linkedin.com/in/…" />
          </Field>
          <Field label={tr("Order", "Reihenfolge")} htmlFor="oe-sort" hint={tr("Lower numbers appear higher up.", "Kleinere Zahl steht weiter oben.")}>
            <input id="oe-sort" inputMode="numeric" className="field" value={f.sortOrder} onChange={set("sortOrder")} />
          </Field>
        </div>
        {u.status === "invited" && (
          <Field label={tr("E-mail address (sign-in)", "E-Mail-Adresse (Anmeldung)")} htmlFor="oe-mail" hint={tr("Can be changed until the person has signed in. Invite links already created become invalid.", "Änderbar, solange sich die Person noch nicht angemeldet hat. Bereits erzeugte Einladungslinks werden dabei ungültig.")}>
            <input id="oe-mail" type="email" className="field" value={f.email} onChange={set("email")} />
          </Field>
        )}
        <Field label={tr("Responsibilities", "Zuständigkeiten")} htmlFor="oe-resp" hint={tr("Separate with commas.", "Mit Komma trennen.")}>
          <input id="oe-resp" className="field" value={f.responsibilities} onChange={set("responsibilities")} />
        </Field>
        <Field label={tr("Bio", "Kurzprofil")} htmlFor="oe-bio">
          <textarea id="oe-bio" className="field min-h-[110px]" maxLength={1500} value={f.bio} onChange={set("bio")} placeholder={tr("Background and focus areas in two or three sentences", "Werdegang und Schwerpunkte in zwei, drei Sätzen")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={f.name.trim().length < 2}>
            {tr("Save", "Speichern")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ExternalsSheet({ open, onOpenChange, items }: { open: boolean; onOpenChange: (v: boolean) => void; items: TeamExternal[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<TeamExternal[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setRows(items.length ? items.map((x) => ({ ...x })) : [{ id: "", name: "", role: "", note: "", group: tr("Advisory board", "Beirat & Berater") }]);
  }, [open, items]);
  const upd = (i: number, k: keyof TeamExternal, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save() {
    setBusy(true);
    try {
      await api.put<TeamExternal[]>("/api/team/externals", new Blob([JSON.stringify({ items: rows.filter((r) => r.name.trim()) })], { type: "application/json" }));
      qc.invalidateQueries({ queryKey: ["team-externals"] });
      toast.success(tr("External people saved", "Externe Personen gespeichert"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tr("Advisory board and external partners", "Beirat und externe Partner")} size="lg">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input className="field" aria-label="Name" placeholder="Name" value={r.name} onChange={(e) => upd(i, "name", e.target.value)} />
            <input className="field" aria-label={tr("Role", "Rolle")} placeholder={tr("Role, e.g. Advisor", "Rolle, z. B. Advisor")} value={r.role} onChange={(e) => upd(i, "role", e.target.value)} />
            <input className="field" aria-label={tr("Group", "Gruppe")} placeholder={tr("Group", "Gruppe")} list="ext-groups" value={r.group} onChange={(e) => upd(i, "group", e.target.value)} />
            <IconButton label={tr(`Remove ${r.name || "entry"}`, `${r.name || "Eintrag"} entfernen`)} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
            <input className="field sm:col-span-4" aria-label={tr("Note", "Notiz")} placeholder={tr("Short info, e.g. “CEO of a neobroker”", "Kurzinfo, z. B. „CEO eines Neobrokers“")} value={r.note} onChange={(e) => upd(i, "note", e.target.value)} />
          </div>
        ))}
        <datalist id="ext-groups">
          <option value={tr("Advisory board", "Beirat & Berater")} />
          <option value={tr("External", "Extern")} />
        </datalist>
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { id: "", name: "", role: "", note: "", group: tr("External", "Extern") }])}>
          {tr("Add person", "Person hinzufügen")}
        </Button>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {tr("Save", "Speichern")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
