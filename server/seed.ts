import type { Deps } from "./context.js";
import { hashPassword } from "./lib/crypto.js";
import { addDaysISO, newId, todayISO } from "./lib/util.js";
import { issueAuthToken } from "./auth/service.js";
import { refit } from "./routes/orgs.js";

export const DEMO_PASSWORD = "nalpia-demo-2026";

/** On first start, creates the first admin and outputs the invite link. */
export async function bootstrapAdmin(deps: Deps) {
  const { db, config } = deps;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0 || !config.BOOTSTRAP_ADMIN_EMAIL) return;
  const email = config.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, name, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'invited', ?, ?)").run(
    id,
    email,
    config.BOOTSTRAP_ADMIN_NAME?.trim() || email.split("@")[0],
    now,
    now,
  );
  const { url } = issueAuthToken(deps, id, "invite", null);
  console.log("\n================ nalpia Intranet ================");
  console.log(`First admin created: ${email}`);
  // In production the link never goes to the logs (which often end up in log collectors):
  // it is sent by e-mail or fetched once via the command line.
  let emailed = false;
  if (config.isProd && deps.mailer.enabled) {
    try {
      emailed = await deps.mailer.send(
        email,
        "Your access to the nalpia intranet",
        ["Hello,", "the intranet is set up. Use the link to set your password. The link is valid for 7 days."],
        { label: "Set password", url },
      );
    } catch (e) {
      console.error("[mailer] Invitation not sent:", (e as Error).message);
    }
  }
  if (!config.isProd) {
    console.log(`Set password (valid for 7 days):\n${url}`);
  } else if (emailed) {
    console.log(`The link to set the password was sent to ${email}.`);
  } else {
    console.log("Get the link to set the password with:");
    console.log(`  docker compose exec intranet node dist/server/cli.js reset-link --email ${email}`);
  }
  console.log("=================================================\n");
}

const TEAM = [
  { key: "denis", name: "Denis Keller", title: "CEO & Co-Founder", role: "admin", color: "navy", resp: ["Fundraising", "Product", "Investor relations"], location: "Berlin" },
  { key: "carlo", name: "Carlo Elwinger", title: "Co-Founder", role: "admin", color: "teal", resp: ["Engineering", "Agent platform", "Systems"], location: "Berlin" },
  { key: "mira", name: "Mira Hansen", title: "Founding Engineer", role: "member", color: "sky", resp: ["App", "Backend", "Broker integration"], location: "Berlin" },
  { key: "leo", name: "Leo Brandt", title: "Growth & Community", role: "member", color: "gold", resp: ["Waitlist", "Content", "Partnerships"], location: "Berlin" },
] as const;

/** Demo data (DEMO_MODE only): fictional content so the intranet can be tried out right away. */
export async function seedDemo(deps: Deps) {
  const { db } = deps;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0) return;
  const pw = await hashPassword(DEMO_PASSWORD);
  const now = Date.now();
  const today = todayISO();
  const d = (n: number) => addDaysISO(today, n);
  const u: Record<string, string> = {};
  const insUser = db.prepare(
    `INSERT INTO users (id, email, name, title, phone, location, responsibilities, avatar_color, role, status, password_hash, password_changed_at, prefs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  );
  for (const t of TEAM) {
    u[t.key] = newId();
    insUser.run(
      u[t.key],
      `${t.key}@nalpia.demo`,
      t.name,
      t.title,
      "",
      t.location,
      JSON.stringify(t.resp),
      t.color,
      t.role,
      pw,
      now,
      JSON.stringify({ salutation: "auto", signature: `${t.name}\n${t.title}\nnalpia GmbH i. G.` }),
      now - 30 * 86400_000,
      now,
    );
  }
  // Org chart (fictional demo data)
  const ORG: Record<string, [string, string | null, number, string]> = {
    denis: ["Management", null, 1, "Founder, responsible for product, funding and investor relations."],
    carlo: ["Management", null, 2, "Co-founder, responsible for engineering and the agent platform."],
    mira: ["Technology", "carlo", 20, ""],
    leo: ["Growth", "denis", 10, ""],
  };
  const setOrg = db.prepare("UPDATE users SET department = ?, manager_id = ?, sort_order = ?, bio = ? WHERE id = ?");
  for (const [k, [dep, mgr, sort, bio]] of Object.entries(ORG)) if (u[k]) setOrg.run(dep, mgr ? u[mgr] : null, sort, bio, u[k]);
  db.prepare("INSERT INTO settings (key, value) VALUES ('team_externals', ?) ON CONFLICT(key) DO NOTHING").run(
    JSON.stringify([
      { id: "ext-1", name: "Dr. Example Advisor", role: "Advisor (brokerage)", note: "Fictional demo entry.", group: "Advisory board & advisors" },
      { id: "ext-2", name: "Sample Law Firm", role: "Legal Counsel (external)", note: "Fictional demo entry.", group: "External" },
    ]),
  );

  const ms: Record<string, string> = {};
  const insMs = db.prepare(
    "INSERT INTO milestones (id, title, description, owner_id, due_date, status, area, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const milestones = [
    ["preseed", "Pre-seed round: €750k committed", "Close €750k at €4m pre-money with angels and pre-seed funds; prepare the notarial closing.", "denis", d(60), "aktiv", "Fundraising"],
    ["mvp", "nalpia app: first strategy runs live", "From an idea in plain language to a visual flow of signals, conditions and orders – executed in a paper account.", "carlo", d(21), "aktiv", "Product"],
    ["broker", "Broker integration signed", "Order routing and custody through a partner broker; sandbox access and contract.", "mira", d(35), "aktiv", "Partnerships"],
    ["exist", "EXIST application submitted", "Business plan, team description and financial plan for the EXIST start-up grant.", "denis", d(14), "aktiv", "Grants"],
    ["waitlist", "1,000 people on the waitlist", "Landing page, content and community; first 100 beta users invited.", "leo", d(45), "geplant", "Growth"],
  ] as const;
  for (const m of milestones) {
    ms[m[0]] = newId();
    insMs.run(ms[m[0]], m[1], m[2], u[m[3]], m[4], m[5], m[6], u.denis, now - 20 * 86400_000, now);
  }

  const ct: Record<string, string> = {};
  const insCt = db.prepare(
    `INSERT INTO contacts (id, name, email, company, position, category, stage, owner_id, phone, linkedin, tags, notes, next_step, next_date, last_contact_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const contacts = [
    // Contact stages are stored ids (German strings from routes/contacts.ts STAGES)
    ["tobias", "Tobias Brandt", "t.brandt@isarvest-capital.example", "Isarvest Capital", "Principal", "investor", "Due Diligence", "denis", ["VC", "Pre-seed"], "Partner meeting on Friday. Needs the cap table and use of funds.", "Send cap table + use of funds", d(1), 1],
    ["maja", "Maja Lindqvist", "maja@northbridge-ventures.example", "Northbridge Ventures", "Partner", "investor", "Im Gespräch", "denis", ["VC", "Fintech"], "Second meeting went well; thesis fit with consumer fintech and AI agents.", "Grant data room access", d(6), 4],
    ["henrik", "Dr. Henrik Sommer", "henrik@sommer-invest.example", "Sommer Invest", "Business Angel", "investor", "Commitment", "denis", ["Angel", "Smart money"], "Verbal commitment of €100k, waiting for the investment agreement.", "Send the investment agreement", d(3), 2],
    ["lena", "Lena Hoffmann", "lena.hoffmann@kanzlei-hoffmann.example", "Kanzlei Hoffmann", "Lawyer", "partner", "In Abstimmung", "denis", ["Legal"], "Advises on the GmbH formation and the investment agreement.", "Go through comments on the shareholder agreement", d(3), 2],
    ["sven", "Sven Okafor", "sven.okafor@brokerhub.example", "BrokerHub", "Head of Partnerships", "partner", "In Abstimmung", "mira", ["Broker", "API"], "Sandbox access granted; order routing for the paper account in test.", "Send the integration test report", d(5), 2],
    ["paul", "Paul Riedel", "p.riedel@example.org", "", "Full-Stack Engineer", "bewerber", "Interview", "carlo", ["Engineering"], "Strong background in trading systems and TypeScript.", "Schedule the case study", d(7), 5],
    ["anna", "Anna Weber", "anna.weber@example.org", "", "Beta user", "kunde", "Onboarding", "leo", ["Beta"], "First strategy created from an idea in plain language; feedback call planned.", "Feedback call", d(2), 1],
  ] as const;
  for (const c of contacts) {
    ct[c[0]] = newId();
    insCt.run(ct[c[0]], c[1], c[2], c[3], c[4], c[5], c[6], u[c[7]], JSON.stringify(c[8]), c[9], c[10], c[11], now - c[12] * 86400_000, u.denis, now - 25 * 86400_000, now - c[12] * 86400_000);
  }

  // Organizations (fictional): investors and partners
  const og: Record<string, string> = {};
  const insOrg = db.prepare(
    `INSERT INTO organizations (id, kind, name, type, stage, priority, owner_id, website, city, country, aum_mio, potential_mio, ticket_min_mio, ticket_max_mio, committed_mio,
     probability, focus, focus_tags, stage_focus, region_focus, prior_outcome, history, source, tags, notes, next_step, next_date, last_contact_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  type OrgSeed = [
    key: string, kind: "investor" | "partner", name: string, type: string, stage: string, prio: "hoch" | "mittel" | "niedrig", owner: string, city: string, country: string,
    aum: number | null, potential: number | null, tMin: number | null, tMax: number | null, committed: number | null, prob: number | null,
    focus: string, focusTags: string[], stageFocus: string[], regionFocus: string, prior: string, history: string,
    source: string, tags: string[], notes: string, nextStep: string, nextIn: number | null, lastDays: number,
  ];
  const orgs: OrgSeed[] = [
    ["isarvest", "investor", "Isarvest Capital", "vc", "pruefung", "hoch", "denis", "Munich", "DE", 120, 0.2, 0.1, 0.5, null, 40, "Fintech, consumer software, AI", ["fintech", "consumer", "ai"], ["pre_seed", "seed"], "DACH, Europe", "", "", "Intro via advisor", ["Pre-seed", "Lead candidate"], "Partner meeting on Friday. Needs the cap table and use of funds.", "Send cap table + use of funds", 1, 1],
    ["northbridge", "investor", "Northbridge Ventures", "vc", "gespraech", "hoch", "denis", "Berlin", "DE", 250, 0.25, 0.25, 1, null, 30, "Consumer fintech, AI agents, wealthtech", ["fintech", "wealthtech", "ai"], ["pre_seed", "seed"], "Europe", "antwort", "SINTRO: replied, call held – thesis fit is stronger for nalpia (B2C)", "Conference", ["Seed", "Fintech"], "Second meeting went well; thesis fit with retail investing.", "Grant data room access", 6, 4],
    ["sommer", "investor", "Dr. Henrik Sommer", "angel", "zugesagt", "mittel", "denis", "Zürich", "CH", null, 0.1, 0.05, 0.15, 0.1, 90, "Ex-CIO, quantitative strategies, retail brokerage", ["wealthtech", "capital_markets"], ["pre_seed"], "DACH", "", "", "Network", ["Angel", "Smart money"], "Verbal commitment of €100k, waiting for the investment agreement.", "Send the investment agreement", 3, 2],
    ["baylight", "investor", "Baylight Ventures", "vc", "kontaktiert", "hoch", "denis", "San Francisco", "US", 180, 0.3, 0.1, 1, null, 20, "AI-native consumer apps, fintech; invests globally from day one", ["ai", "consumer", "fintech"], ["pre_seed", "seed"], "Global, Bay Area", "", "", "Research", ["Bay Area", "AI-native"], "First mail sent by the agent; personal note referenced their robo-advisor investment.", "Wait for reply (follow-up in 5 days)", 5, 3],
    ["alpen", "investor", "Alpen Angels Syndikat", "syndikat", "kontaktiert", "mittel", "carlo", "Innsbruck", "AT", null, 0.1, 0.05, 0.3, null, 20, "DACH fintech and consumer", ["fintech", "consumer"], ["pre_seed"], "DACH", "", "", "Platform", ["Angel", "Syndicate"], "Requested a pitch slot in the next syndicate call.", "Send a short pitch (5 slides)", 4, 9],
    ["ibbdemo", "investor", "Berlin Seed Fund (demo)", "foerder", "identifiziert", "mittel", "denis", "Berlin", "DE", 400, 0.25, 0.25, 1, null, 10, "Berlin-based start-ups, matching with private leads", ["generalist", "software"], ["pre_seed", "seed"], "Berlin", "", "", "Program", ["Public", "Matching"], "Berlin registered office condition is met.", "Apply after the first private commitments", null, 0],
    ["brenner", "investor", "Brenner Familienholding", "family_office", "abgesagt", "niedrig", "denis", "Düsseldorf", "DE", 600, 0.5, 0.25, 1, null, 0, "Later stages", ["generalist"], ["series_a", "growth"], "DACH", "absage", "SINTRO: declined (only from Series A)", "Referral", ["Family office"], "Declined: only invests from Series A. Get back in touch in 12 months.", "", null, 40],
    ["brokerhub", "partner", "BrokerHub", "broker", "pruefung", "hoch", "mira", "Berlin", "DE", null, null, null, null, null, 60, "Order routing and custody via API for retail investors", [], [], "", "", "", "Research", ["API", "Execution"], "Sandbox access granted; order routing in test.", "Send the integration test report", 5, 2],
    ["marketdata", "partner", "QuoteStream Data", "data", "gespraech", "mittel", "carlo", "London", "GB", null, null, null, null, null, 40, "Real-time and historical market data", [], [], "", "", "", "Conference", ["Data"], "Pricing proposal for the start-up tier received.", "Compare with alternatives", 8, 6],
    ["hoffmann", "partner", "Kanzlei Hoffmann", "service", "aktiv", "mittel", "denis", "Berlin", "DE", null, null, null, null, null, 100, "Corporate law, financing rounds", [], [], "", "", "", "Referral", ["Legal"], "Advises on the formation and the investment agreement.", "Go through comments on the shareholder agreement", 3, 2],
  ];
  for (const o of orgs) {
    og[o[0]] = newId();
    insOrg.run(
      og[o[0]], o[1], o[2], o[3], o[4], o[5], u[o[6]],
      `https://${o[2].toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.example`,
      o[7], o[8], o[9], o[10], o[11], o[12], o[13], o[14], o[15], JSON.stringify(o[16]), JSON.stringify(o[17]), o[18], o[19], o[20], o[21], JSON.stringify(o[22]), o[23], o[24],
      o[25] === null ? null : d(o[25]), o[26] ? now - o[26] * 86400_000 : null, u.denis, now - 40 * 86400_000, now - Math.max(o[26], 1) * 3600_000,
    );
  }
  const link = db.prepare("UPDATE contacts SET organization_id = ? WHERE id = ?");
  for (const [c, o] of [["tobias", "isarvest"], ["maja", "northbridge"], ["henrik", "sommer"], ["lena", "hoffmann"], ["sven", "brokerhub"]] as const) link.run(og[o], ct[c]);
  const insOrgCt = db.prepare(
    "INSERT INTO contacts (id, name, email, company, position, category, stage, owner_id, organization_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)",
  );
  for (const [name, email, pos, o, kind, owner] of [
    ["Priya Nair", "priya@baylight-ventures.example", "Partner", "baylight", "investor", "denis"],
    ["Eva Brunner", "eva.brunner@berlin-seed-fund.example", "Investment Manager", "ibbdemo", "investor", "denis"],
    ["Mark Olsen", "m.olsen@quotestream-data.example", "Sales Engineer", "marketdata", "partner", "carlo"],
  ] as const) {
    insOrgCt.run(newId(), name, email, ({ baylight: "Baylight Ventures", ibbdemo: "Berlin Seed Fund (demo)", marketdata: "QuoteStream Data" } as Record<string, string>)[o], pos, kind, u[owner], og[o], u.denis, now - 30 * 86400_000, now - 30 * 86400_000);
  }
  for (const id of Object.values(og)) refit(db, id);
  const insOrgAct = db.prepare("INSERT INTO org_activities (id, org_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  insOrgAct.run(newId(), og.isarvest, u.denis, "meeting", "Intro meeting with Tobias. Likes the agent approach; wants to see the flow builder live before the partner meeting.", now - 4 * 86400_000);
  insOrgAct.run(newId(), og.isarvest, u.denis, "status", "Status: First meeting → Due diligence", now - 3 * 86400_000);
  insOrgAct.run(newId(), og.sommer, u.denis, "anruf", "Commitment of €100k on the round's terms. Would like to join the advisory board.", now - 2 * 86400_000);
  insOrgAct.run(newId(), og.brokerhub, u.mira, "dokument", "Sandbox credentials and API documentation received.", now - 5 * 86400_000);
  db.prepare("INSERT INTO settings (key, value) VALUES ('investor_round', ?) ON CONFLICT(key) DO NOTHING").run(JSON.stringify({ name: "Pre-seed round", targetMio: 0.75, preMoneyMio: 4, committedExtraMio: null }));

  const insTask = db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_id, created_by, due_date, priority, status, milestone_id, contact_id, sort_order, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tasks: [string, string, string, number | null, "hoch" | "mittel" | "niedrig", "offen" | "in_arbeit" | "erledigt", string | null, string | null, string][] = [
    ["Send cap table and use of funds to Isarvest", "For the partner meeting on Friday.", "denis", 1, "hoch", "in_arbeit", "preseed", "tobias", "carlo"],
    ["Align the investment agreement with the law firm", "", "denis", 6, "mittel", "offen", "preseed", "lena", "denis"],
    ["Send the monthly investor update", "Product progress, waitlist, pipeline, next steps.", "denis", 3, "mittel", "offen", "preseed", null, "denis"],
    ["Grant Northbridge data room access", "", "denis", 2, "mittel", "offen", "preseed", "maja", "denis"],
    ["Review the agent's drafts for the Bay Area batch", "20 first mails – check every personal note before sending.", "denis", 0, "hoch", "offen", "preseed", null, "denis"],
    ["Finish the EXIST financial plan", "", "denis", 5, "hoch", "in_arbeit", "exist", null, "carlo"],
    ["Flow builder: conditions node with AND/OR", "", "carlo", 4, "hoch", "in_arbeit", "mvp", null, "carlo"],
    ["Paper trading: order routing through BrokerHub sandbox", "", "mira", 8, "hoch", "in_arbeit", "broker", "sven", "carlo"],
    ["Write the waitlist launch post", "", "leo", 4, "niedrig", "offen", "waitlist", null, "denis"],
    ["Prepare the case study for applicant Paul Riedel", "", "carlo", 6, "mittel", "offen", null, "paul", "carlo"],
    ["Feedback call with beta user Anna", "", "leo", 2, "mittel", "offen", "waitlist", "anna", "leo"],
    ["Set up Zoho mailboxes for the team", "", "carlo", 1, "hoch", "erledigt", null, null, "denis"],
  ];
  tasks.forEach((t, i) => {
    const done = t[5] === "erledigt";
    insTask.run(newId(), t[0], t[1], u[t[2]], u[t[8]], t[3] === null ? null : d(t[3]), t[4], t[5], t[6] ? ms[t[6]] : null, t[7] ? ct[t[7]] : null, i, now - (20 - i) * 3600_000, now, done ? now - 3600_000 : null);
  });
  const insOrgTask = db.prepare(
    "INSERT INTO tasks (id, title, description, assignee_id, created_by, due_date, priority, status, milestone_id, organization_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?)",
  );
  insOrgTask.run(newId(), "Send the investment agreement to Dr. Sommer", "Draft from the law firm, terms as in the term sheet.", u.denis, u.denis, d(3), "hoch", ms.preseed, og.sommer, 901, now, now);
  insOrgTask.run(newId(), "Compare QuoteStream pricing with alternatives", "", u.carlo, u.carlo, d(8), "mittel", ms.mvp, og.marketdata, 902, now, now);

  const insNews = db.prepare("INSERT INTO news (id, author_id, title, body, category, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const news = [
    [
      "denis",
      "Welcome to the nalpia intranet",
      "From today, **news, tasks, milestones, investors, partners and your mailbox** come together in one place.\n\nHow to get started:\n\n1. Complete your profile (role, phone number, responsibilities)\n2. Connect your own Zoho mailbox under *Mail* – only you can see your e-mails\n3. Turn on two-factor authentication in the settings\n\nThe fundraising agent lives under *Agent*: it researches investors, drafts personal first mails and tracks replies. In review mode nothing leaves the house before one of us has looked at it.",
      "allgemein",
      1,
      2,
    ],
    [
      "denis",
      "Pre-seed round: €750k at €4m pre-money",
      "We are raising **€750k** from business angels and pre-seed funds. The first commitment is in; the agent is working through the Bay Area list. Please add every investor conversation to the CRM so the round stays in one picture.",
      "fundraising",
      0,
      20,
    ],
    [
      "carlo",
      "Flow builder: first end-to-end run",
      "An idea in plain language becomes a visual flow of **signals, conditions and orders** and runs in the paper account. Next: conditions with AND/OR and a pause switch per strategy.",
      "produkt",
      0,
      48,
    ],
    [
      "leo",
      "Waitlist opens next week",
      "Landing page and the first three posts are ready. Share the link with people who already trade on their own – they give the best feedback.",
      "vertrieb",
      0,
      96,
    ],
  ] as const;
  for (const n of news) {
    const id = newId();
    insNews.run(id, u[n[0]], n[1], n[2], n[3], n[4], now - n[5] * 3600_000, now - n[5] * 3600_000);
    db.prepare("INSERT INTO news_reads (news_id, user_id, read_at) VALUES (?, ?, ?)").run(id, u[n[0]], now);
    if (n[1].startsWith("Welcome")) {
      db.prepare("INSERT INTO news_reactions (news_id, user_id, emoji, created_at) VALUES (?, ?, '🎉', ?)").run(id, u.carlo, now);
      db.prepare("INSERT INTO news_reactions (news_id, user_id, emoji, created_at) VALUES (?, ?, '👍', ?)").run(id, u.leo, now);
      db.prepare("INSERT INTO news_comments (id, news_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
        newId(),
        id,
        u.carlo,
        "Connecting the mailbox works for me. If you need help, just let me know.",
        now - 3600_000,
      );
    }
  }
  console.log(`[demo] Demo data created. Sign in e.g. with denis@nalpia.demo / ${DEMO_PASSWORD}`);
}
