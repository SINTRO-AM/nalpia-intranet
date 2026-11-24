import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { NEWS_CATEGORIES } from "@/lib/format";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useMe, useNewsItem } from "@/lib/queries";
import type { NewsItem } from "@/lib/types";
import { Sheet } from "./Sheet";
import { Button, cx, Field, Segmented, Skeleton, Switch } from "./ui";
import { tr } from "@/lib/i18n";

const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export function NewsComposer() {
  const o = useOverlay("news");
  const { close } = useOverlays();
  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && close("news")} title={o?.id ? tr("Edit post", "Beitrag bearbeiten") : tr("New post", "Neuer Beitrag")} size="lg" fullMobile>
      {o && <NewsForm key={o.id ?? "new"} id={o.id} />}
    </Sheet>
  );
}

function NewsForm({ id }: { id?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { close } = useOverlays();
  const me = useMe().data?.user;
  const existing = useNewsItem(id);
  const [f, setF] = useState({ title: "", body: "", category: "allgemein", pinned: false, notifyAll: true });
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = existing.data;
    if (n) setF((s) => ({ ...s, title: n.title, body: n.body, category: n.category, pinned: n.pinned }));
  }, [existing.data]);

  if (id && existing.isLoading) return <Skeleton className="h-64" />;

  async function submit() {
    setBusy(true);
    setErr({});
    try {
      const payload: Record<string, unknown> = { title: f.title, body: f.body, category: f.category };
      if (me?.role === "admin") payload.pinned = f.pinned;
      let n: NewsItem;
      if (id) n = await api.patch<NewsItem>(`/api/news/${id}`, payload);
      else n = await api.post<NewsItem>("/api/news", { ...payload, notifyAll: f.notifyAll });
      qc.invalidateQueries({ queryKey: ["news"] });
      qc.invalidateQueries({ queryKey: ["news-item", n.id] });
      qc.invalidateQueries({ queryKey: ["home"] });
      toast.success(id ? tr("Post saved", "Beitrag gespeichert") : tr("Post published", "Beitrag veröffentlicht"));
      close("news");
      if (!id) navigate(`/news/${n.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? { ...e.fields, _: e.message } : { _: tr("Saving failed.", "Speichern fehlgeschlagen.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex h-full flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field error={err.title}>
        <input autoFocus={!id} className="field text-[18px] font-bold" placeholder={tr("Headline", "Überschrift")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label={tr("Headline", "Überschrift")} maxLength={160} />
      </Field>
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="radiogroup" aria-label={tr("Category", "Kategorie")}>
        {Object.entries(NEWS_CATEGORIES).map(([k, c]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={f.category === k}
            onClick={() => setF({ ...f, category: k })}
            className={cx(
              "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition",
              f.category === k ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "write", label: tr("Write", "Schreiben") },
              { value: "preview", label: tr("Preview", "Vorschau") },
            ]}
          />
          <span className="hidden text-[12px] text-muted sm:block">{tr("**bold**, *italic*, - list, [link](https://…)", "**fett**, *kursiv*, - Liste, [Link](https://…)")}</span>
        </div>
        {mode === "write" ? (
          <textarea
            className="field min-h-[220px] flex-1 leading-relaxed"
            placeholder={tr("What's new? Context, outcome, what it means for the team …", "Was gibt es Neues? Kontext, Ergebnis, was das fürs Team bedeutet …")}
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
            aria-label="Text"
          />
        ) : (
          <div className="card min-h-[220px] flex-1 overflow-y-auto px-4 py-3">{f.body.trim() ? <Suspense fallback={null}><Markdown>{f.body}</Markdown></Suspense> : <p className="text-sm text-muted">{tr("No text yet.", "Noch kein Text.")}</p>}</div>
        )}
        {err.body && <p className="mt-1 text-[13px] font-medium text-neg">{err.body}</p>}
      </div>
      <div className="space-y-3">
        {me?.role === "admin" && <Switch checked={f.pinned} onChange={(v) => setF({ ...f, pinned: v })} label={tr("Pin to top", "Oben anheften")} description={tr("Pinned posts always appear first.", "Angeheftete Beiträge stehen immer zuerst.")} />}
        {!id && <Switch checked={f.notifyAll} onChange={(v) => setF({ ...f, notifyAll: v })} label={tr("Notify everyone", "Alle benachrichtigen")} description={tr("Everyone sees the post in their notifications.", "Jede Person sieht den Beitrag in ihren Benachrichtigungen.")} />}
      </div>
      {err._ && <p className="text-sm font-medium text-neg">{err._}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close("news")}>
          {tr("Cancel", "Abbrechen")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={f.title.trim().length < 3 || !f.body.trim()}>
          {id ? tr("Save", "Speichern") : tr("Publish", "Veröffentlichen")}
        </Button>
      </div>
    </form>
  );
}
