import type { ListOptions, MailboxClient, MailFolder, MailMessage, MailSummary, SendInput } from "./types.js";
import { MailError } from "./types.js";
import { escapeHtml, htmlToText } from "../lib/util.js";
import { tr } from "../lib/i18n.js";

/**
 * Demo mailbox (DEMO_MODE / tests): fictitious senders, kept in memory only.
 * Every person gets their own separate demo mailbox.
 */
const FOLDERS = (): MailFolder[] => [
  { id: "1001", name: tr("Inbox", "Posteingang"), type: "inbox", path: "/Inbox" },
  { id: "1002", name: tr("Sent", "Gesendet"), type: "sent", path: "/Sent" },
  { id: "1003", name: tr("Drafts", "Entwürfe"), type: "drafts", path: "/Drafts" },
  { id: "1004", name: tr("Archive", "Archiv"), type: "archive", path: "/Archive" },
  { id: "1005", name: "Spam", type: "spam", path: "/Spam" },
];

interface Seed {
  from: [string, string];
  subject: string;
  hoursAgo: number;
  unread?: boolean;
  attachment?: boolean;
  body: string;
}

const SEEDS: Seed[] = [
  {
    from: ["Clara Weiß", "clara.weiss@nordlicht-family-office.example"],
    subject: "Re: [Nordlicht/nalpia] Pre-seed <> Agentic Finance for Retail Investors",
    hoursAgo: 1.5,
    unread: true,
    body: `<p>Hi Denis,</p><p>thanks for reaching out – the idea of turning a plain-language idea into an executable flow is interesting. Two questions before we talk:</p><ol><li>How do you handle execution and custody – do you hold a licence yourselves or work through a broker?</li><li>What does the first version look like for a user who has never traded systematically?</li></ol><p>Happy to do a short call next week – Tuesday or Thursday afternoon works for us.</p><p>Best<br>Clara Weiß<br>Nordlicht Family Office</p>`,
  },
  {
    from: ["Tobias Brandt", "t.brandt@isarvest-capital.example"],
    subject: "Re: Pre-seed round – materials for the partner meeting",
    hoursAgo: 4,
    unread: true,
    attachment: true,
    body: `<p>Hi,</p><p>thanks for the deck. For our partner meeting on Friday I would still need the current cap table and a short overview of the use of funds.</p><p>Could you send them by Thursday 12:00?</p><p>Best<br>Tobias</p>`,
  },
  {
    from: ["EXIST Programme Team", "noreply@exist-gruenderstipendium.example"],
    subject: "Reminder: application deadline approaching",
    hoursAgo: 20,
    body: `<p>Dear applicant,</p><p>this is a reminder that the application window closes in 9 days. Please make sure that the business plan, team description and financial plan are uploaded in time.</p><p>Kind regards<br>EXIST Programme Team</p>`,
  },
  {
    from: ["Lena Hoffmann", "lena.hoffmann@kanzlei-hoffmann.example"],
    subject: "Draft investment agreement – comments",
    hoursAgo: 28,
    attachment: true,
    body: `<p>Good afternoon,</p><p>please find attached our comments on the draft investment agreement. The main points concern the valuation clause (§ 4) and the information rights (§ 7). We are happy to go through them by phone.</p><p>Kind regards<br>Lena Hoffmann</p>`,
  },
  {
    from: ["Sven Okafor", "sven.okafor@brokerhub.example"],
    subject: "Sandbox access and API documentation",
    hoursAgo: 50,
    body: `<p>Hello,</p><p>your sandbox credentials are active. The order routing endpoints are documented in the developer portal; let us know once the first paper orders go through and we schedule the contract call.</p><p>Best regards<br>Sven Okafor<br>BrokerHub</p>`,
  },
  {
    from: ["FinTech Weekly", "newsletter@fintech-weekly.example"],
    subject: "The week in review: AI agents in consumer fintech",
    hoursAgo: 75,
    body: `<p>The most important fintech news of the week – this time focusing on AI agents, neobrokers and retail investing.</p><p><img src="https://example.com/tracking.gif" width="1" height="1" alt=""></p>`,
  },
];

export class MockMailbox implements MailboxClient {
  private msgs: MailMessage[] = [];
  private seq = 9_000_000_000_000_000_000n;
  constructor(private owner: { email: string; name: string }) {
    const now = Date.now();
    this.msgs = SEEDS.map((s, i) => ({
      id: String(this.seq + BigInt(i * 7919)),
      folderId: "1001",
      threadId: null,
      subject: s.subject,
      from: { name: s.from[0], email: s.from[1] },
      to: [{ name: owner.name, email: owner.email }],
      cc: [],
      date: now - s.hoursAgo * 3600_000,
      snippet: htmlToText(s.body).replace(/\s+/g, " ").slice(0, 200),
      unread: !!s.unread,
      hasAttachment: !!s.attachment,
      flagged: false,
      html: s.body,
      attachments: s.attachment ? [{ id: String(5000 + i), name: i === 1 ? "Cap_Table_Draft.xlsx" : "Comments_Investment_Agreement.pdf", size: 48_211 + i * 1000 }] : [],
    }));
  }

  async folders() {
    return FOLDERS();
  }

  async list(o: ListOptions): Promise<MailSummary[]> {
    let arr = this.msgs.filter((m) => (o.search ? true : m.folderId === (o.folderId ?? "1001")));
    if (o.search) {
      const q = o.search.toLowerCase();
      arr = arr.filter((m) => (m.subject + m.from.name + m.from.email + htmlToText(m.html)).toLowerCase().includes(q));
    }
    if (o.unreadOnly) arr = arr.filter((m) => m.unread);
    arr.sort((a, b) => b.date - a.date);
    return arr.slice(o.start - 1, o.start - 1 + o.limit).map(({ html: _h, attachments: _a, ...s }) => s);
  }

  async get(folderId: string, messageId: string) {
    const m = this.msgs.find((x) => x.id === messageId && x.folderId === folderId);
    if (!m) throw new MailError(tr("This message was not found.", "Diese Nachricht wurde nicht gefunden."), "not_found", 404);
    return m;
  }

  async setRead(ids: string[], read: boolean) {
    for (const m of this.msgs) if (ids.includes(m.id)) m.unread = !read;
  }

  async send(input: SendInput) {
    const id = String(this.seq + BigInt(this.msgs.length * 104729 + 17));
    this.msgs.push({
      id,
      folderId: input.mode === "draft" ? "1003" : "1002",
      threadId: null,
      subject: input.subject,
      from: { name: this.owner.name, email: input.from },
      to: input.to.map((e) => ({ name: "", email: e })),
      cc: input.cc.map((e) => ({ name: "", email: e })),
      date: Date.now(),
      snippet: htmlToText(input.html).slice(0, 200),
      unread: false,
      hasAttachment: false,
      flagged: false,
      html: input.html,
      attachments: [],
    });
    return { ok: true as const };
  }

  async attachment(_f: string, _m: string, attachmentId: string) {
    const text = tr(`Demo attachment ${escapeHtml(attachmentId)} – there are no real files in demo mode.`, `Demo-Anhang ${escapeHtml(attachmentId)} – im Demo-Modus gibt es keine echten Dateien.`);
    return { body: new TextEncoder().encode(text).buffer as ArrayBuffer, type: "text/plain; charset=utf-8", name: `demo-attachment-${attachmentId}.txt` };
  }

  async unreadCount(folderId?: string) {
    return this.msgs.filter((m) => m.folderId === (folderId ?? "1001") && m.unread).length;
  }
}
