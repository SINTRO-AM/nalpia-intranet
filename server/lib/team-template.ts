/**
 * nalpia team as a template: creates missing team members as invited accounts (without sending a
 * link) and fills in org chart details. Existing accounts (same e-mail) keep everything already
 * maintained – only empty fields are filled.
 */
import type { DB } from "../db/index.js";
import { getSetting, setSetting } from "../db/index.js";
import { audit } from "./audit.js";
import { tr } from "./i18n.js";
import { newId } from "./util.js";

export interface TeamMember {
  key: string;
  name: string;
  email: string;
  /** Address not confirmed yet (no known mailbox of their own) */
  emailUnconfirmed?: boolean;
  title: string;
  department: string;
  manager?: string;
  responsibilities: string[];
  bio?: string;
  color: string;
  sort: number;
}

export interface External {
  id: string;
  name: string;
  role: string;
  note: string;
  group: string;
}

/** Built per call: titles, departments, bios and responsibilities follow the language of the admin applying the template */
export const nalpiaTeam = (): TeamMember[] => [
  {
    key: "denis",
    name: "Denis Keller",
    email: "denis@nalpia.com",
    title: "CEO & Co-Founder",
    department: tr("Management", "Geschäftsführung"),
    responsibilities: [tr("Product", "Produkt"), "Fundraising", tr("Investor relations", "Investor Relations"), tr("Partnerships", "Partnerschaften")],
    bio: tr(
      "Founder and managing director. Previously CEO of SINTRO Asset Management (systematic strategies for institutional investors), quantitative models at XTP, " +
        "quantitative strategies at ODDO BHF, institutional product structures at Deutsche Bank Asset Management and risk management at DekaBank. " +
        "M.Sc. in Financial Mathematics (Nova SBE, Lisbon), B.Sc. in Economics (Goethe University Frankfurt), trained banker.",
      "Gründer und Geschäftsführer. Zuvor CEO von SINTRO Asset Management (systematische Strategien für institutionelle Investoren), quantitative Modelle bei XTP, " +
        "quantitative Strategien bei ODDO BHF, institutionelle Produktstrukturen bei Deutsche Bank Asset Management und Risikomanagement bei der DekaBank. " +
        "M.Sc. Finanzmathematik (Nova SBE, Lissabon), B.Sc. VWL (Goethe-Universität Frankfurt), Bankkaufmann.",
    ),
    color: "navy",
    sort: 1,
  },
  {
    key: "carlo",
    name: "Carlo Elwinger",
    email: "carlo@nalpia.com",
    emailUnconfirmed: true,
    title: "Co-Founder",
    department: tr("Management", "Geschäftsführung"),
    responsibilities: [tr("Engineering", "Engineering"), tr("Agent platform", "Agenten-Plattform"), tr("Systems", "Systeme")],
    bio: tr(
      "Co-founder. Systems engineer with a background in autonomous systems (Daimler Truck, Torc Robotics) – builds the agent platform that turns an investment idea into an executable flow.",
      "Mitgründer. Systemingenieur mit Hintergrund in autonomen Systemen (Daimler Truck, Torc Robotics) – baut die Agenten-Plattform, die aus einer Anlageidee einen ausführbaren Ablauf macht.",
    ),
    color: "teal",
    sort: 2,
  },
];

export const nalpiaExternals = (): External[] => {
  const advisors = tr("Advisory board & advisors", "Beirat & Berater");
  return [
    { id: "advisor-brokerage", name: tr("Advisor – brokerage & distribution", "Advisor – Brokerage & Vertrieb"), role: "Advisor", note: tr("Fill in name and company in Admin → Team.", "Name und Firma unter Admin → Team eintragen."), group: advisors },
    { id: "advisor-science", name: tr("Scientific advisor", "Wissenschaftlicher Advisor"), role: tr("Scientific advisor (in discussion)", "Wissenschaftlicher Advisor (in Abstimmung)"), note: tr("Capital markets research – fill in in Admin → Team.", "Kapitalmarktforschung – unter Admin → Team eintragen."), group: advisors },
    { id: "sintro", name: "SINTRO Asset Management", role: tr("Sister company", "Schwesterunternehmen"), note: tr("Systematic strategies for institutional investors; shared research and infrastructure.", "Systematische Strategien für institutionelle Investoren; gemeinsame Forschung und Infrastruktur."), group: tr("External", "Extern") },
  ];
};

export interface TeamTemplateResult {
  dryRun: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  unconfirmedEmails: { name: string; email: string }[];
  /** Status values (not display text): "gesetzt" = set, "unverändert" = unchanged */
  externals: "gesetzt" | "unverändert";
}

class Rollback extends Error {}

export function applyTeamTemplate(
  db: DB,
  opts: {
    actorId: string | null;
    dryRun?: boolean;
    ip?: string;
    /** Apply title, department, order and manager from the template – even if something is already maintained */
    overwriteStructure?: boolean;
  },
): TeamTemplateResult {
  const res: TeamTemplateResult = { dryRun: !!opts.dryRun, created: [], updated: [], unchanged: [], unconfirmedEmails: [], externals: "unverändert" };
  const now = Date.now();
  const team = nalpiaTeam();
  const run = db.transaction(() => {
    const ids = new Map<string, string>();
    const byEmail = db.prepare("SELECT * FROM users WHERE email = ?");
    for (const m of team) {
      const u = byEmail.get(m.email) as Record<string, unknown> | undefined;
      if (!u) {
        const id = newId();
        db.prepare(
          `INSERT INTO users (id, email, name, title, responsibilities, avatar_color, role, status, department, bio, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'member', 'invited', ?, ?, ?, ?, ?)`,
        ).run(id, m.email, m.name, m.title, JSON.stringify(m.responsibilities), m.color, m.department, m.bio ?? "", m.sort, now, now);
        ids.set(m.key, id);
        res.created.push(m.name);
        if (m.emailUnconfirmed) res.unconfirmedEmails.push({ name: m.name, email: m.email });
        continue;
      }
      ids.set(m.key, u.id as string);
      const empty = (col: string) => u[col] === "" || u[col] === null || u[col] === "[]" || (col === "sort_order" && u[col] === 0);
      const sets: string[] = [];
      const args: unknown[] = [];
      const structural = new Set(["title", "department", "sort_order"]);
      const fill = (col: string, val: unknown) => {
        const force = opts.overwriteStructure && structural.has(col) && u[col] !== val;
        if ((force || empty(col)) && val !== "" && val !== undefined) {
          sets.push(`${col} = ?`);
          args.push(val);
        }
      };
      fill("title", m.title);
      fill("department", m.department);
      fill("bio", m.bio ?? "");
      fill("responsibilities", JSON.stringify(m.responsibilities));
      fill("sort_order", m.sort);
      if (sets.length) {
        db.prepare(`UPDATE users SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...args, now, u.id);
        res.updated.push(m.name);
      } else res.unchanged.push(m.name);
    }
    // Set managers only once all accounts exist – otherwise only where nobody is set yet
    for (const m of team) {
      if (!m.manager && !opts.overwriteStructure) continue;
      const id = ids.get(m.key)!;
      const mgr = m.manager ? ids.get(m.manager)! : null;
      const r = opts.overwriteStructure
        ? db.prepare("UPDATE users SET manager_id = ? WHERE id = ? AND manager_id IS NOT ?").run(mgr, id, mgr)
        : db.prepare("UPDATE users SET manager_id = ? WHERE id = ? AND manager_id IS NULL").run(mgr, id);
      if (r.changes && !res.created.includes(m.name) && !res.updated.includes(m.name)) {
        res.updated.push(m.name);
        res.unchanged = res.unchanged.filter((n) => n !== m.name);
      }
    }
    if (!getSetting<External[] | null>(db, "team_externals", null)) {
      setSetting(db, "team_externals", nalpiaExternals());
      res.externals = "gesetzt";
    }
    audit(db, { userId: opts.actorId, action: "team.template", ip: opts.ip, meta: { created: res.created, updated: res.updated } });
    if (opts.dryRun) throw new Rollback();
  });
  try {
    run();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}
