/**
 * Fundraising agent – settings, defaults and the playbook.
 *
 * The playbook and the style profile are editable in the UI (settings key "agent"). They were
 * carried over from the SINTRO fundraising campaign (26 of Denis's own sent mails analysed) and
 * adapted to nalpia. Everything the agent writes follows them.
 */

export type AgentMode = "review" | "autopilot";

export interface AgentSettings {
  /** Scheduler on/off (manual runs always work) */
  enabled: boolean;
  /** review: drafts wait for a click; autopilot: the agent sends within the window and daily cap */
  mode: AgentMode;
  /** Whose mailbox sends and receives (must be connected under Mail) */
  ownerEmail: string;
  /** First mails drafted per day – quality before quantity */
  dailyDrafts: number;
  /** Mails sent per day in autopilot (first mails + follow-ups + replies) */
  dailyCap: number;
  /** Max. outreach threads waiting for a reply at the same time */
  maxOpen: number;
  /** Candidate filter: ISO country codes (empty = all) and cities that go first */
  countries: string[];
  priorityCities: string[];
  /** Minimum fit score (0–100) for new candidates */
  minFit: number;
  /** Also approach investors who declined SINTRO (with a new angle) */
  includePriorDeclined: boolean;
  /** Only one contact per firm is approached */
  onePerFirm: boolean;
  /** Days after the first mail for follow-ups (two steps by default) */
  followUpDays: number[];
  /** Autopilot sending window in the recipient-friendly time zone */
  sendWindow: { from: string; to: string; tz: string };
  /** Hour (Europe/Berlin) at which the daily batch of drafts is prepared */
  draftHour: number;
  workdaysOnly: boolean;
  /** Autopilot: reply automatically to clear "yes" (deck) and "no" (thanks) mails */
  autoReply: boolean;
  /** Let the model research the investor on the web before writing (needs an API key) */
  webResearch: boolean;
  /** Subject with {firm} placeholder */
  subject: string;
  /** First mail templates with {firstName} and {personal} */
  bodyEn: string;
  bodyDe: string;
  yesReplyEn: string;
  yesReplyDe: string;
  passReplyEn: string;
  passReplyDe: string;
  deckUrl: string;
  calendlyUrl: string;
  playbook: string;
  styleProfile: string;
}

export const BAY_AREA_CITIES = [
  "San Francisco",
  "Palo Alto",
  "Menlo Park",
  "Mountain View",
  "Berkeley",
  "Oakland",
  "San Mateo",
  "Redwood City",
  "Sunnyvale",
  "San Jose",
  "Cupertino",
  "Los Altos",
  "Burlingame",
  "Sausalito",
  "Woodside",
  "Atherton",
];

export const DEFAULT_SETTINGS: AgentSettings = {
  enabled: true,
  mode: "review",
  ownerEmail: "",
  dailyDrafts: 20,
  dailyCap: 20,
  maxOpen: 200,
  countries: ["US"],
  priorityCities: BAY_AREA_CITIES,
  minFit: 60,
  includePriorDeclined: false,
  onePerFirm: true,
  followUpDays: [5, 9],
  sendWindow: { from: "08:30", to: "17:30", tz: "America/Los_Angeles" },
  draftHour: 7,
  workdaysOnly: true,
  autoReply: true,
  webResearch: true,
  subject: "[{firm}/nalpia] Pre-seed <> Agentic Finance for Retail Investors",
  bodyEn: `Hi {firstName},

we are building nalpia, an AI-native agent for public-markets investing. Retail investors describe an investment idea in plain language; nalpia researches it, turns it into a visual flow of signals, conditions and orders, and runs it within the budget and rules they set. From investment ideas to action.

{personal}

We are raising a pre-seed round and would like to stay in touch before we open it up more widely. If that sounds interesting, just reply with "yes" and I will send over the deck.

Best, Denis`,
  bodyDe: `Hallo {firstName},

wir bauen nalpia, einen KI-nativen Agenten für das Investieren an den Public Markets. Privatanleger beschreiben eine Anlageidee in Alltagssprache; nalpia recherchiert sie, übersetzt sie in einen visuellen Ablauf aus Signalen, Bedingungen und Orders und führt sie im gesetzten Budget und Regelwerk aus. From Investment Ideas to Action.

{personal}

Wir bereiten gerade unsere Pre-Seed-Runde vor und möchten vor der breiten Ansprache in Kontakt bleiben. Wenn das interessant klingt, antworten Sie einfach mit „Ja“ – dann schicke ich das Deck.

Beste Grüße, Denis`,
  yesReplyEn: `Thanks, {firstName} – below is a link to our deck. I will follow up with a meeting. The pitch is always better than the PDF.

{deckUrl}

See you,
Denis`,
  yesReplyDe: `Danke, {firstName} – hier der Link zu unserem Deck. Ich melde mich wegen eines kurzen Termins. Der Pitch ist immer besser als das PDF.

{deckUrl}

Bis bald,
Denis`,
  passReplyEn: `Thanks for letting me know, {firstName} – much appreciated. If a colleague or another fund that invests in consumer fintech comes to mind, I would gladly follow the pointer.

All the best,
Denis`,
  passReplyDe: `Danke für die Rückmeldung, {firstName} – das weiß ich sehr zu schätzen. Falls Ihnen ein Kollege oder ein anderer Fonds mit Fokus auf Consumer-Fintech einfällt, nehme ich den Hinweis gerne auf.

Beste Grüße,
Denis`,
  deckUrl: "",
  calendlyUrl: "",
  playbook: `POSITIONIERUNG (1 Satz): nalpia ist ein KI-nativer Agent für das Investieren an den Public Markets: Privatanleger beschreiben eine Anlageidee in Alltagssprache, nalpia recherchiert sie, übersetzt sie in einen visuellen Ablauf aus Signalen, Bedingungen und Orders und führt sie im gesetzten Budget und Regelwerk aus – „From Investment Ideas to Action“ (Agentic Finance).

KERNARGUMENTE (nur belegte Fakten):
- Produkt: Idee in Alltagssprache → recherchierter, visueller Ablauf (Signale, Bedingungen, Orders) → automatische Ausführung; Budget und Handelsbedingungen setzt der Kunde, jederzeit änder- oder pausierbar. Transparenz und Kontrolle statt Blackbox oder Tipps.
- Team: Denis Keller (CEO) – Quant-Research und institutionelles Asset Management (DekaBank Risikomanagement, Deutsche Bank Asset Management, ODDO BHF quantitative Strategien, XTP), M.Sc. Finanzmathematik; zuvor CEO von SINTRO Asset Management (systematische Strategien für institutionelle Investoren, live seit 2023). Carlo Elwinger (Mitgründer) – Systemingenieur aus autonomen Systemen (Daimler Truck, Torc Robotics).
- Why now (qualitativ): Privatanleger handeln zunehmend selbst (Neobroker), KI-Agenten machen Recherche und Regelwerke für alle zugänglich; die Lücke zwischen „Idee“ und „sauber umgesetzter Strategie“ schließt heute niemand.
- Markt: B2C-Fintech, Start in Deutschland/Europa, Produkt englischsprachig angelegt.
- Nicht nennen (noch nicht freigegeben): Broker-Partner, Förderanträge, Nutzerzahlen, Umsatz, Warteliste. Rundengröße und Bewertung nur, wenn der Investor danach fragt – die aktuellen Zahlen kommen aus „Investoren → Runde“ (Abschnitt „Current round“), nie aus dem Gedächtnis.

EINWÄNDE – SO ANTWORTEN:
- „Regulatorik?“ → Ausführung über regulierte Partner (Broker/Haftungsdach); nalpia liefert Recherche, Ablauf und Steuerung – Details auf Anfrage [Denis: Setup ergänzen].
- „Was unterscheidet euch von Robo-Advisors oder Copy-Trading?“ → Keine Standardportfolios und kein Nachahmen: Die eigene Idee wird zur transparenten, regelbasierten Strategie mit Kontrolle über Budget und Bedingungen.
- „Zu früh / kein Fit“ → danken, Tür offen halten, um Erlaubnis für ein späteres Update bitten.
- „Asset Manager oder Software?“ → Software-Plattform für Privatanleger; das institutionelle Know-how aus SINTRO fließt in Recherche und Regelwerke ein.
- „Und Catalyst (Sequoia, 30 Mio. USD Seed)?“ → Bestätigt die These, dass Agenten das Interface zwischen Investmentidee und Umsetzung werden. Unterschied nalpia: Die KI baut die Regeln, deterministische Regeln handeln; echte Aktien und ETFs im regulierten Depot statt Token auf Krypto-Schienen; Start in Europa, wo dieses Produkt fehlt. Nie abwertend über Catalyst schreiben; Investoren von Catalyst (siehe Tag „Catalyst-Investor“) nur mit klarer Abgrenzung oder über Intro ansprechen.

ERSTMAIL AN INVESTOREN:
- Ziel: Beziehung vor der Runde aufbauen – kein Pitch, keine Terminanfrage. Wirkt wie eine persönliche Notiz von Denis, nicht wie eine Kampagne.
- Aufbau der Mail (Vorlage): 1) persönlicher Einstieg {personal} 2) Produkt in zwei Sätzen 3) Rundenkontext ohne künstliche Knappheit 4) leichter CTA („yes“).
- Der {personal}-Absatz ist das Herzstück: EIN belegtes, aktuelles Detail zu These, Portfolio oder einer öffentlichen Aussage des Investors – catchy, konkret, ohne Schmeichelei. Keine Jahre alten Referenzen, keine Datumsangaben, die alt wirken. Nie erfinden; ohne belegtes Detail wird der Entwurf als „persönlicher Absatz fehlt“ markiert und nicht gesendet.
- ÜBERLEITUNG ABWECHSELN: Die Verbindung zwischen Investor-Detail und nalpia muss inhaltlich tragen (Ähnlichkeit, Weiterführung, Kontrast, Ursache/Folge, gemeinsames Problem), aber Satzbau und Wortwahl wechseln von Mail zu Mail: zwei kurze Sätze; ein Nebensatz mit „because/while/where/since“; ein Doppelpunkt, der die Pointe nachreicht; mit nalpia beginnen und das Detail danach einordnen; ein Kontrast mit „but/yet“. Verbrauchte Formeln nicht verwenden: „the same logic“, „that logic“, „the same move/idea/approach“, „one layer deeper/further“, „one step deeper/further“, „exactly where … meet“, „you know better than most“, „we work on the same question“, „I came across“, „I noticed“.
- 40–80 Wörter für den persönlichen Absatz, einfache Sprache, kein Jargon. Betreff bleibt der Standard „[Firma/nalpia] Pre-seed <> Agentic Finance for Retail Investors“.
- Nie: „probably raising soon“, revolutionary/disruptive/game-changing, generische Komplimente, unbelegte Marktzahlen, erfundenes Interesse oder Traktion, Terminforderungen, künstliche Dringlichkeit.
- Sprache: Englisch, außer der Investor ist im DACH-Raum und schreibt erkennbar Deutsch (dann Deutsch, Anrede wie im Profil).
- Selbstcheck vor dem Speichern (je 2 Punkte): Investor-Bezug belegt, klares Problem, einfaches Wertversprechen, belegte Glaubwürdigkeit, natürlicher Ton mit leichtem CTA. Unter 8/10 überarbeiten – ohne Fakten zu erfinden.

FOLLOW-UPS:
- Zwei kurze Follow-ups (nach 5 und 9 Tagen): 2–3 Sätze, ein neuer Gedanke oder ein konkreter Fortschritt, nie „just checking in“. Danach ruhen lassen.

ANTWORTEN AUF INVESTOR-MAILS:
- Der erste Satz beantwortet die Frage direkt. Danach höchstens 2–3 kurze Absätze, max. 120 Wörter.
- Genau EIN nächster Schritt: Call mit zwei Zeitfenstern als Platzhalter oder das Deck.
- Selbstbewusst, präzise, ruhig. Keine Hype-Adjektive, keine Superlative, keine erfundenen Zahlen. Sprache und Anrede des Investors spiegeln.`,
  styleProfile: `SCHREIBSTIL VON DENIS (abgeleitet aus seinen eigenen gesendeten Investoren-Mails – für Antworten und den persönlichen Absatz verbindlich)

Grundton
- Kurz, direkt, freundlich, auf Augenhöhe. Typisch 30–90 Wörter, 2–4 kurze Absätze, ein Gedanke pro Absatz. Lange Mails nur, wenn der Investor eine inhaltliche Frage stellt (dann gern mit „-“-Aufzählung, je Punkt 1–2 Sätze).
- Kommt sofort zur Sache. Erster Satz = Dank oder direkte Antwort, kein Vorgeplänkel.
- Selbstbewusst und ehrlich: widerspricht offen, aber höflich und begründet („I do not share your concern, because …“ / „Hope you do not get me wrong. I always appreciate feedback.“).
- Verdichtet gern auf eine einfache Pointe am Ende eines Gedankens („We are building the autopilot for that.“ / „The pitch is always better than the PDF.“).
- Persönliche, konkrete Details statt Floskeln (wo er gerade ist, wann er erreichbar ist, wo man sich treffen kann) – nur wenn sie stimmen.

Anrede & Einstieg
- Englisch: „Hi {Vorname},“ – danach klein weiter („hope you are doing well!“, „it was great meeting you …“). Bei kurzen Antworten oft direkt: „Thanks, {Vorname} – …“ (Gedankenstrich nach dem Namen).
- Deutsch, Du: „Hi {Vorname},“ oder „Hallo {Vorname},“ – danach klein weiter („vielen Dank für deine Mail!“).
- Deutsch, Sie: „Hallo Frau/Herr {Nachname},“ – sachlicher, vollständige Sätze.

Nächster Schritt (immer genau einer, leicht und konkret)
- EN: „Happy to walk you through it in 15min.“ / „Does that work for you?“ / „Feel free to book a slot: {calendlyUrl}“
- DE: „Ich führe dich gerne in 15min kurz über's Deck und beantworte Fragen.“ / „Wie wäre es am Montag?“
- Deck-Link, wenn passend: {deckUrl}

Absagen
- „Thanks for letting me know, {Vorname} – much appreciated.“ + optional die Bitte um einen Hinweis auf einen passenderen Fonds.

Grußformeln
- EN: „Best, Denis“ (oft in einer Zeile) oder „All the best, Denis“.
- DE (Du): „Viele Grüße, Denis“ oder „VG Denis“.
- DE (Sie): „Mit besten Grüßen, Denis Keller“.

Nicht übernehmen
- Zahlen oder Rundendetails aus alten Mails; Performance-Kennzahlen nie nennen.
- „=)“ und „!!“ nur in lockeren deutschen Du-Mails an bekannte Kontakte, nie im Erstkontakt mit Investoren.
- Keine Floskeln wie „I hope this email finds you well“, „Ich schreibe Ihnen, um …“, „just checking in“, keine Hype-Adjektive.`,
};

/** Persistent state of the agent (settings key "agent_state") */
export interface AgentState {
  /** Newest inbox message timestamp already processed */
  inboxTs: number;
  /** Day (YYYY-MM-DD, Berlin) of the last draft batch and how many were drafted/sent that day */
  day: string;
  draftsToday: number;
  sentToday: number;
  lastInboxRun: number;
  lastDraftRun: number;
  lastFollowupRun: number;
  lastSendRun: number;
  lastError: string;
}

export const DEFAULT_STATE: AgentState = { inboxTs: 0, day: "", draftsToday: 0, sentToday: 0, lastInboxRun: 0, lastDraftRun: 0, lastFollowupRun: 0, lastSendRun: 0, lastError: "" };

/** Outreach statuses that still wait for the other side */
export const OPEN_STATUSES = ["sent", "followup"] as const;
export const REPLY_KINDS = ["ja", "frage", "absage", "ooo", "bounce", "sonstiges"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
