/**
 * nalpia news as a template: starter posts for the News page (goals, milestones, fundraising and
 * sales status, product, regulatory, team). Every post carries a fixed key (external_ref) –
 * applying it again never creates duplicates, and deleted or edited posts stay as they are.
 * No notifications are sent.
 */
import type { DB } from "../db/index.js";
import { getSetting, setSetting } from "../db/index.js";
import { audit } from "./audit.js";
import { tr } from "./i18n.js";
import { newId } from "./util.js";

export interface NewsTemplatePost {
  key: string;
  /** Date of the post (event or status date) */
  date: string;
  /** Both languages – the post is created once, in the language of the admin who applies the template */
  title: { en: string; de: string };
  category: "allgemein" | "fundraising" | "produkt" | "vertrieb" | "regulatorik" | "team";
  pinned?: boolean;
  body: { en: string; de: string };
}

export const NALPIA_NEWS: NewsTemplatePost[] = [
  {
    key: "willkommen",
    date: "2026-11-24",
    title: { en: "Welcome to the nalpia intranet", de: "Willkommen im nalpia-Intranet" },
    category: "allgemein",
    pinned: true,
    body: {
      en: `From now on we have one shared place for everything that happens at nalpia. The intranet runs on our own server at **intranet.nalpia.com** and is independent of the SINTRO intranet.

**What you will find here**

- **News:** decisions, milestones and status – instead of scattered chat messages.
- **Tasks and milestones:** who does what by when, grouped by goal.
- **Mail:** your own nalpia mailbox, with AI reply suggestions. Nothing is sent unless you review and send it yourself.
- **Investors:** the full fundraising pipeline – more than 2,000 investors taken over from the SINTRO CRM, with fit for nalpia, focus, stage, region and ticket size as filters.
- **Partners:** brokers, data providers, exchanges, accelerators and service providers.
- **Agent:** the fundraising agent researches investors, drafts personal first mails, sends them (after review), follows up and sorts the replies.

**Please do this today**

1. Complete your profile (role, phone number, responsibilities).
2. Connect your mailbox under *Mail*.
3. Turn on two-factor authentication in the settings.`,
      de: `Ab sofort haben wir einen gemeinsamen Ort für alles, was bei nalpia passiert. Das Intranet läuft auf unserem eigenen Server unter **intranet.nalpia.com** und ist unabhängig vom SINTRO-Intranet.

**Was ihr hier findet**

- **News:** Entscheidungen, Meilensteine und Stand – statt verstreuter Chat-Nachrichten.
- **Aufgaben und Meilensteine:** wer macht was bis wann, gebündelt nach Ziel.
- **Postfach:** euer eigenes nalpia-Postfach, mit KI-Antwortvorschlägen. Gesendet wird nur, was ihr selbst prüft und abschickt.
- **Investoren:** die komplette Fundraising-Pipeline – über 2.000 Investoren aus dem SINTRO-CRM übernommen, mit Fit für nalpia, Fokus, Phase, Region und Ticketgröße als Filter.
- **Partner:** Broker, Datenanbieter, Börsen, Accelerator und Dienstleister.
- **Agent:** Der Fundraising-Agent recherchiert Investoren, entwirft persönliche Erstmails, versendet sie (nach Freigabe), fasst nach und sortiert die Antworten.

**Bitte heute erledigen**

1. Profil vervollständigen (Rolle, Telefonnummer, Zuständigkeiten).
2. Postfach unter *Postfach* verbinden.
3. Zwei-Faktor-Anmeldung in den Einstellungen einschalten.`,
    },
  },
  {
    key: "positionierung",
    date: "2026-11-24",
    title: { en: "What we are building: from investment ideas to action", de: "Was wir bauen: From Investment Ideas to Action" },
    category: "produkt",
    body: {
      en: `nalpia is an **AI-native agent for public-markets investing** for retail investors.

- A customer describes an investment idea in plain language.
- The platform researches it and translates it into a **visual flow of signals, conditions and orders**.
- The customer sets the budget and the trading conditions, and the strategy can then run automatically – with the option to change or pause it at any time.

**Positioning:** Agentic Finance. We do not sell signals or tips; we turn a person's own idea into a transparent, executable and controllable process.

**Company:** nalpia GmbH i. G., Rosenthaler Straße 50, Berlin · app.nalpia.com · contact@nalpia.com`,
      de: `nalpia ist ein **KI-nativer Agent für das Investieren an den Public Markets** – für Privatanleger.

- Kunden beschreiben eine Handelsidee in Alltagssprache.
- Die Plattform recherchiert sie und übersetzt sie in einen **visuellen Ablauf aus Signalen, Bedingungen und Orders**.
- Kunden legen Budget und Handelsbedingungen fest; die Strategie kann anschließend automatisch laufen – jederzeit änderbar oder pausierbar.

**Positionierung:** Agentic Finance. Wir verkaufen keine Signale oder Tipps, sondern machen aus der eigenen Idee einen transparenten, ausführbaren und kontrollierbaren Prozess.

**Firma:** nalpia GmbH i. G., Rosenthaler Straße 50, Berlin · app.nalpia.com · contact@nalpia.com`,
    },
  },
  {
    key: "preseed",
    date: "2026-11-24",
    title: { en: "Pre-seed round: how the pipeline works", de: "Pre-Seed-Runde: So funktioniert die Pipeline" },
    category: "fundraising",
    body: {
      en: `We are raising a **pre-seed round** from business angels and pre-seed funds. Round size and valuation are maintained under *Investors → Round* (the agent reads them from there).

**How the pipeline works**

- All investors live under *Investors*. The **fit for nalpia** (0–100) is calculated from investor type, thematic focus, stage focus, ticket size, geography and the history with SINTRO.
- The **agent** picks the best candidates (currently US investors, Bay Area first), writes personal first mails in Denis's style and tracks every reply.
- Default is **review mode**: drafts are shown under *Agent*, one click sends them from Denis's mailbox. *Autopilot* can be switched on in the agent settings.

**Rules for every investor conversation**

- Log every call and reply in the CRM (activity or next step).
- Round size and valuation only as maintained under *Investors → Round*; no other numbers in writing.
- Warm relationships from the SINTRO round (replied, call, deck) are marked – use them first.`,
      de: `Wir raisen eine **Pre-Seed-Runde** von Business Angels und Pre-Seed-Fonds. Rundengröße und Bewertung werden unter *Investoren → Runde* gepflegt (der Agent liest sie von dort).

**So funktioniert die Pipeline**

- Alle Investoren liegen unter *Investoren*. Der **Fit für nalpia** (0–100) ergibt sich aus Investorentyp, thematischem Fokus, Phasenfokus, Ticketgröße, Geografie und der Vorgeschichte mit SINTRO.
- Der **Agent** wählt die besten Kandidaten (aktuell US-Investoren, Bay Area zuerst), schreibt persönliche Erstmails im Stil von Denis und verfolgt jede Antwort.
- Standard ist der **Prüfmodus**: Entwürfe erscheinen unter *Agent*, ein Klick sendet sie aus Denis' Postfach. Der *Autopilot* lässt sich in den Agent-Einstellungen einschalten.

**Regeln für jedes Investorengespräch**

- Jeden Call und jede Antwort im CRM festhalten (Verlauf oder nächster Schritt).
- Rundengröße und Bewertung nur wie unter *Investoren → Runde* gepflegt; keine weiteren Zahlen schriftlich.
- Warme Beziehungen aus der SINTRO-Runde (Antwort, Call, Deck) sind markiert – zuerst nutzen.`,
    },
  },
  {
    key: "partner",
    date: "2026-11-24",
    title: { en: "Partners: broker, data, regulatory", de: "Partner: Broker, Daten, Regulatorik" },
    category: "vertrieb",
    body: {
      en: `Under *Partners* we track everyone nalpia needs besides capital: **brokers** for order routing and custody, **data and API providers**, **exchanges and market infrastructure**, the **regulatory set-up** (liability umbrella / licence), **accelerators and programs** and **service providers**.

Each partner has a stage from *Identified* to *Live partner*. Please add contacts, notes and next steps the same way as for investors.`,
      de: `Unter *Partner* führen wir alle, die nalpia neben Kapital braucht: **Broker** für Orderrouting und Verwahrung, **Daten- und API-Anbieter**, **Börsen und Marktinfrastruktur**, das **regulatorische Setup** (Haftungsdach / Lizenz), **Accelerator und Programme** und **Dienstleister**.

Jeder Partner hat einen Status von *Identifiziert* bis *Aktiver Partner*. Bitte Ansprechpartner, Notizen und nächste Schritte genauso pflegen wie bei Investoren.`,
    },
  },
  {
    key: "team",
    date: "2026-11-24",
    title: { en: "Team and advisors", de: "Team und Berater" },
    category: "team",
    body: {
      en: `**Founders:** Denis Keller (CEO – product, fundraising, partnerships) and Carlo Elwinger (co-founder – engineering, agent platform).

**Advisors:** maintained in the org chart under *Team → External* (brokerage/distribution and capital markets research).

The org chart under *Team* shows who is responsible for what. New colleagues get an invitation to the intranet from an admin.`,
      de: `**Gründer:** Denis Keller (CEO – Produkt, Fundraising, Partnerschaften) und Carlo Elwinger (Mitgründer – Engineering, Agenten-Plattform).

**Berater:** werden im Organigramm unter *Team → Extern* gepflegt (Brokerage/Vertrieb und Kapitalmarktforschung).

Das Organigramm unter *Team* zeigt, wer wofür zuständig ist. Neue Kolleginnen und Kollegen bekommen von einem Admin eine Einladung ins Intranet.`,
    },
  },
];

export interface NewsTemplateResult {
  dryRun: boolean;
  created: string[];
  existing: string[];
  author: string;
}

class Rollback extends Error {}

/** 9 a.m. Berlin time on the post's date (never in the future); order within a day as in the template */
const at = (date: string, index: number, now: number) => Math.min(Date.parse(`${date}T09:00:00+01:00`), now) - index * 60_000;

export function applyNewsTemplate(db: DB, opts: { actorId: string | null; dryRun?: boolean; ip?: string }): NewsTemplateResult {
  const author =
    (db.prepare("SELECT id, name FROM users WHERE email = 'denis@nalpia.com'").get() as { id: string; name: string } | undefined) ??
    (opts.actorId ? (db.prepare("SELECT id, name FROM users WHERE id = ?").get(opts.actorId) as { id: string; name: string } | undefined) : undefined) ??
    (db.prepare("SELECT id, name FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() as { id: string; name: string } | undefined);
  if (!author) throw new Error(tr("There is no account yet that the posts can be assigned to.", "Es gibt noch kein Konto, dem die Beiträge zugeordnet werden können."));
  const res: NewsTemplateResult = { dryRun: !!opts.dryRun, created: [], existing: [], author: author.name };
  const run = db.transaction(() => {
    const exists = db.prepare("SELECT 1 FROM news WHERE external_ref = ?");
    const ins = db.prepare(
      "INSERT INTO news (id, author_id, title, body, category, pinned, created_at, updated_at, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const read = db.prepare("INSERT OR IGNORE INTO news_reads (news_id, user_id, read_at) VALUES (?, ?, ?)");
    // Remember posts created once – a deleted post does not come back on the next run
    const applied = new Set(getSetting<string[]>(db, "news_template_applied", []));
    NALPIA_NEWS.forEach((p, i) => {
      const ref = `nalpia-news:${p.key}`;
      const title = tr(p.title.en, p.title.de);
      if (exists.get(ref) || applied.has(p.key)) {
        res.existing.push(title);
        return;
      }
      const id = newId();
      const ts = at(p.date, i, Date.now());
      ins.run(id, author.id, title, tr(p.body.en, p.body.de), p.category, p.pinned ? 1 : 0, ts, ts, ref);
      read.run(id, author.id, Date.now());
      res.created.push(title);
      applied.add(p.key);
    });
    setSetting(db, "news_template_applied", [...applied]);
    audit(db, { userId: opts.actorId, action: "news.template", ip: opts.ip, meta: { created: res.created.length } });
    if (opts.dryRun) throw new Rollback();
  });
  try {
    run();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}
