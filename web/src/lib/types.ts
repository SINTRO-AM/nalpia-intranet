export type Role = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  title: string;
  phone: string;
  location: string;
  responsibilities: string[];
  avatarColor: string;
  avatarUrl: string | null;
  department: string;
  managerId: string | null;
  bio: string;
  linkedin: string;
  sortOrder: number;
  role: Role;
  status: "invited" | "active" | "disabled";
  openTasks?: number;
}

export interface TeamExternal {
  id: string;
  name: string;
  role: string;
  note: string;
  group: string;
}

export interface SelfUser extends User {
  totpEnabled: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface Prefs {
  signature?: string;
  aiStyle?: string;
  salutation?: "du" | "sie" | "auto";
  theme?: "system" | "light" | "dark";
  fromAddress?: string;
  autoSuggest?: boolean;
  assistant?: boolean;
  /** Interface language */
  lang?: "en" | "de";
}

export interface ReplySuggestions {
  needsReply: boolean;
  suggestions: { label: string; gist: string; text: string }[];
  cached?: boolean;
}

export interface Me {
  user: SelfUser | null;
  prefs?: Prefs;
  org: { name: string; require2fa: boolean };
  features: { mail: boolean; ai: boolean; smtp: boolean; demo: boolean };
  mustSetup2fa?: boolean;
}

export type TaskStatus = "offen" | "in_arbeit" | "wartet" | "erledigt";
export type Priority = "hoch" | "mittel" | "niedrig";

export interface SourceMail {
  ownerId: string;
  messageId: string;
  folderId: string;
  subject: string;
  from: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  createdBy: string | null;
  dueDate: string | null;
  priority: Priority;
  status: TaskStatus;
  milestoneId: string | null;
  milestoneTitle: string | null;
  topicId: string | null;
  topicTitle: string | null;
  topicKind: TopicKind | null;
  topicStage: TopicStage | null;
  /** Who/what the task is waiting on (status "wartet") */
  waitingOn: string;
  contactId: string | null;
  contactName: string | null;
  contactCompany: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationKind: OrgKind | null;
  sourceMail: SourceMail | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  commentCount: number;
}

export interface Comment {
  id: string;
  userId: string | null;
  body: string;
  createdAt: number;
}

export type HistoryEvent =
  | { t: "status"; from: TaskStatus; to: TaskStatus }
  | { t: "assignee"; from: string | null; to: string | null }
  | { t: "due"; from: string | null; to: string | null }
  | { t: "priority"; from: Priority; to: Priority }
  | { t: "topic"; from: string | null; to: string | null }
  | { t: "stage"; from: TopicStage; to: TopicStage }
  | { t: "owner"; from: string | null; to: string | null }
  | { t: "follow_up"; from: string | null; to: string | null }
  | { t: "waiting"; from: string; to: string }
  | { t: "task_done"; taskId: string; title: string }
  | { t: "task_added"; taskId: string; title: string };

export interface EventEntry {
  id: string;
  userId: string | null;
  createdAt: number;
  event: HistoryEvent;
}

export interface TaskDetail extends Task {
  comments: Comment[];
  events: EventEntry[];
}

export type TopicKind = "intern" | "extern";
export type TopicStage = "idee" | "geplant" | "in_arbeit" | "wartet" | "erledigt" | "verworfen";

export interface Topic {
  id: string;
  title: string;
  description: string;
  kind: TopicKind;
  stage: TopicStage;
  area: string;
  ownerId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationKind: OrgKind | null;
  counterpart: string;
  waitingOn: string;
  waitingSince: number | null;
  nextStep: string;
  followUp: string | null;
  dueDate: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  taskTotal: number;
  taskDone: number;
  taskOverdue: number;
  nextTask: { id: string; title: string; dueDate: string | null; assigneeId: string | null } | null;
  commentCount: number;
  lastActivity: number;
}

export interface TopicDetail extends Topic {
  tasks: Task[];
  updates: Comment[];
  events: EventEntry[];
}

export type MilestoneStatus = "geplant" | "aktiv" | "erreicht" | "verschoben";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  ownerId: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  area: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  taskTotal: number;
  taskDone: number;
  progress: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  userIds: string[];
}

export interface NewsItem {
  id: string;
  authorId: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  commentCount: number;
  reactions: Reaction[];
}

export interface NewsDetail extends NewsItem {
  comments: Comment[];
}

export type ContactCategory = "investor" | "partner" | "kunde" | "bewerber" | "stakeholder" | "sonstige";

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  position: string;
  category: ContactCategory;
  stage: string;
  ownerId: string | null;
  phone: string;
  linkedin: string;
  tags: string[];
  notes: string;
  nextStep: string;
  nextDate: string | null;
  lastContactAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  openTasks: number;
  organizationId: string | null;
  organizationName: string | null;
  organizationKind: OrgKind | null;
  /** Reserved: relevance of the person (not used for nalpia yet) */
  fitScore: number | null;
}

export interface Activity {
  id: string;
  userId: string | null;
  kind: "notiz" | "mail" | "anruf" | "meeting" | "status";
  body: string;
  mailRef: { messageId: string; folderId: string; subject: string; ownerId: string; date?: number } | null;
  createdAt: number;
}

export interface ContactDetail extends Contact {
  activities: Activity[];
  tasks: Task[];
}

export interface ContactLookup {
  id: string;
  name: string;
  company: string;
  category: ContactCategory;
  stage: string;
  ownerId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationKind: OrgKind | null;
}

/* ---------- Investors & partners ---------- */

export type OrgKind = "investor" | "partner";
export type OutreachStatus = "" | "draft" | "needs_note" | "approved" | "sent" | "followup" | "replied" | "declined" | "bounced" | "paused" | "done";

export interface Org {
  id: string;
  kind: OrgKind;
  name: string;
  type: string;
  stage: string;
  priority: Priority;
  ownerId: string | null;
  website: string;
  linkedin: string;
  city: string;
  country: string;
  aumMio: number | null;
  potentialMio: number | null;
  ticketMinMio: number | null;
  ticketMaxMio: number | null;
  committedMio: number | null;
  probability: number | null;
  focus: string;
  /** Investors: thematic focus ids, stage focus ids, regional focus text */
  focusTags: string[];
  stageFocus: string[];
  regionFocus: string;
  /** Investors: fit for nalpia (0–100) and why (reasons only in the detail view) */
  fitScore: number | null;
  fitReasons: string[];
  /** What happened before nalpia (e.g. with SINTRO): outcome id and a short history line */
  priorOutcome: string;
  history: string;
  /** Fundraising agent: current outreach state */
  outreachStatus: OutreachStatus;
  outreachAt: number | null;
  source: string;
  tags: string[];
  notes: string;
  nextStep: string;
  nextDate: string | null;
  lastContactAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  contactCount: number;
  primaryContact: string | null;
  primaryEmail: string | null;
  openTasks: number;
  /** Priority was set by hand – the automatic fit no longer changes it */
  priorityManual: boolean;
}

export interface OrgActivity {
  id: string;
  userId: string | null;
  kind: "notiz" | "mail" | "anruf" | "meeting" | "status" | "dokument";
  body: string;
  createdAt: number;
  contactId: string | null;
  contactName: string | null;
  mailRef: Activity["mailRef"];
  source: "org" | "contact";
}

export interface OrgDetail extends Org {
  contacts: { id: string; name: string; email: string; phone: string; position: string; linkedin: string; lastContactAt: number | null; fitScore: number | null }[];
  activities: OrgActivity[];
  tasks: Task[];
  outreach: OutreachBrief[];
}

export interface StageDef {
  id: string;
  label: string;
  won?: boolean;
  closed?: boolean;
}

export interface OrgMeta {
  types: Record<OrgKind, Record<string, string>>;
  stages: Record<OrgKind, StageDef[]>;
  focusTags: Record<string, string>;
  stageFocus: Record<string, string>;
  priorOutcomes: Record<string, string>;
  outreachStatus: Record<string, string>;
}

/* ---------- Fundraising agent ---------- */

export type AgentMode = "review" | "autopilot";

export interface AgentSettings {
  enabled: boolean;
  mode: AgentMode;
  ownerEmail: string;
  dailyDrafts: number;
  dailyCap: number;
  maxOpen: number;
  countries: string[];
  priorityCities: string[];
  minFit: number;
  includePriorDeclined: boolean;
  onePerFirm: boolean;
  followUpDays: number[];
  sendWindow: { from: string; to: string; tz: string };
  draftHour: number;
  workdaysOnly: boolean;
  autoReply: boolean;
  webResearch: boolean;
  subject: string;
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

export interface AgentRun {
  id: string;
  kind: "inbox" | "followups" | "drafts" | "send";
  status: "running" | "ok" | "error";
  triggeredBy?: string | null;
  startedAt: number;
  finishedAt: number | null;
  summary: string;
  log?: { ts: number; t: string }[];
  counts: Record<string, number>;
}

export interface AgentStatus {
  settings: AgentSettings;
  state: { inboxTs: number; day: string; draftsToday: number; sentToday: number; lastInboxRun: number; lastDraftRun: number; lastFollowupRun: number; lastSendRun: number; lastError: string };
  owner: { id: string; name: string; email: string } | null;
  mail: { connected: boolean; needsReconnect: boolean; email: string | null; mode: string } | null;
  ai: "claude" | "demo" | "off";
  model: string;
  running: string[];
  counts: {
    draft: number;
    needsNote: number;
    approved: number;
    open: number;
    replied: number;
    declined: number;
    bounced: number;
    paused: number;
    done: number;
    sentTotal: number;
    yes: number;
    questions: number;
    responseRate: number | null;
    pendingMessages: number;
  };
  candidates: { total: number; priority: number };
  runs: AgentRun[];
}

export type OutreachRowStatus = Exclude<OutreachStatus, ""> | "discarded";

export interface OutreachBrief {
  id: string;
  status: OutreachRowStatus;
  lang: "en" | "de";
  toEmail: string;
  toName: string;
  subject: string;
  personal: string;
  body: string;
  research: string;
  quality: number | null;
  sequenceStep: number;
  nextActionAt: number | null;
  sentAt: number | null;
  repliedAt: number | null;
  replyKind: string;
  replySummary: string;
  createdAt: number;
  updatedAt: number;
}

export interface Outreach extends OutreachBrief {
  orgId: string;
  orgName: string;
  orgCity: string;
  orgCountry: string;
  orgStage: string;
  orgType: string;
  fitScore: number | null;
  contactId: string | null;
  ownerId: string | null;
  error: string;
  pendingMessages: number;
}

export interface AgentMessage {
  id: string;
  outreachId: string;
  dir: "out" | "in";
  kind: "first" | "followup" | "reply" | "auto_reply" | "manual";
  status: "draft" | "sent" | "received" | "discarded";
  subject: string;
  body: string;
  mailRef: { messageId: string; folderId: string; subject: string; date: number; ownerId: string } | null;
  createdAt: number;
  /** list view only */
  toName?: string;
  toEmail?: string;
  orgId?: string;
  orgName?: string;
  replyKind?: string;
  replySummary?: string;
}

export interface OutreachDetail extends Outreach {
  messages: AgentMessage[];
}

export interface AgentCandidate {
  orgId: string;
  name: string;
  type: string;
  city: string;
  country: string;
  fitScore: number | null;
  priority: Priority;
  priorOutcome: string;
  contact: { id: string; name: string; email: string; position: string };
}

export interface Address {
  name: string;
  email: string;
}

export interface MailFolder {
  id: string;
  name: string;
  type: "inbox" | "sent" | "drafts" | "spam" | "trash" | "outbox" | "templates" | "snoozed" | "archive" | "custom";
  path: string;
}

export interface MailSummary {
  id: string;
  folderId: string;
  threadId: string | null;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: number;
  snippet: string;
  unread: boolean;
  hasAttachment: boolean;
  flagged: boolean;
  /** Only in the "Important" folder: why the mail counts as important */
  importance?: { kind: "investor" | "partner" | "kunde" | "stakeholder"; label: string; via: "kontakt" | "domain"; orgId: string | null; contactId: string | null };
}

export interface MailMessage extends MailSummary {
  html: string;
  attachments: { id: string; name: string; size: number }[];
}

export interface MailStatus {
  available: boolean;
  mode: "zoho" | "imap" | "demo" | "off";
  providerName: string;
  calendar: boolean;
  connected: boolean;
  email?: string;
  displayName?: string;
  addresses?: string[];
  needsReconnect?: boolean;
  connectedAt?: number;
}

export interface Notification {
  id: string;
  actorId: string | null;
  kind: string;
  title: string;
  link: string;
  createdAt: number;
  readAt: number | null;
}

export interface HomeData {
  today: string;
  tasks: Task[];
  stats: { open: number; overdue: number; doneThisWeek: number };
  milestones: Milestone[];
  horizon: {
    start: string;
    end: string;
    tasks: { id: string; title: string; dueDate: string; assigneeId: string | null; priority: Priority }[];
    milestones: { id: string; title: string; dueDate: string; ownerId: string | null; status: MilestoneStatus }[];
  };
  news: { id: string; title: string; body: string; category: string; pinned: boolean; createdAt: number; authorId: string; read: boolean }[];
  newsUnread: number;
  followUps: { id: string; name: string; company: string; category: ContactCategory | "topic"; stage: string; nextStep: string; nextDate: string; href: string; source: "contact" | "org" | "topic" }[];
  topics: Topic[];
}

export interface MailSummaryAI {
  summary: string;
  keyPoints: string[];
  actions: { title: string; due: string | null }[];
  needsReply: boolean;
  urgency: "hoch" | "normal" | "niedrig";
}

export type MailDir = "in" | "out" | null;
export interface DashCard {
  id: string;
  name: string;
  type: string;
  stage: string;
  priority: "hoch" | "mittel" | "niedrig";
  ownerId: string | null;
  city: string;
  contact: string | null;
  nextStep: string;
  nextDate: string | null;
  lastIn: number | null;
  lastOut: number | null;
  last: { kind: string; dir: MailDir; text: string; at: number; contactName: string | null } | null;
}
export type DashLane = "antwort" | "faellig" | "gespraech" | "wartet" | "gewonnen";
export interface OrgDashboard {
  today: string;
  kpis: {
    total: number;
    backlog: number;
    active: number;
    won: number;
    closed: number;
    contacted: number;
    replied: number;
    responseRate: number | null;
    sent7: number;
    sentPrev7: number;
    received7: number;
    receivedPrev7: number;
  };
  lanes: Record<DashLane, { total: number; items: DashCard[] }>;
  funnel: { stage: string; label: string; current: number; reached: number }[];
  weekly: { week: string; sent: number; received: number; other: number }[];
  byType: { type: string; total: number; active: number; won: number }[];
  recent: { orgId: string; orgName: string; kind: string; dir: MailDir; text: string; at: number; contactName: string | null; userId: string | null }[];
  tasks: Task[];
}
