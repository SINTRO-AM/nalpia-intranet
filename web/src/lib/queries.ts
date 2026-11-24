import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, qs } from "./api";
import type {
  AgentCandidate,
  AgentMessage,
  AgentRun,
  AgentStatus,
  Contact,
  ContactDetail,
  HomeData,
  MailFolder,
  MailMessage,
  MailStatus,
  MailSummary,
  Me,
  Milestone,
  NewsDetail,
  NewsItem,
  Notification,
  Org,
  OrgDashboard,
  OrgDetail,
  OrgKind,
  OrgMeta,
  Outreach,
  OutreachDetail,
  Task,
  TaskDetail,
  User,
} from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000 });

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/api/users"), staleTime: 5 * 60_000 });
}

export function useUserMap() {
  const { data } = useUsers();
  return useMemo(() => new Map((data ?? []).map((u) => [u.id, u])), [data]);
}

export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>("/api/home"), refetchInterval: 120_000 });

export type TaskFilter = { assignee?: string; status?: "open" | "done" | "all"; milestone?: string; contact?: string; q?: string };
export const useTasks = (f: TaskFilter) =>
  useQuery({ queryKey: ["tasks", f], queryFn: () => api.get<Task[]>(`/api/tasks${qs(f)}`), placeholderData: keepPreviousData });

export const useTask = (id: string | null) =>
  useQuery({ queryKey: ["task", id], queryFn: () => api.get<TaskDetail>(`/api/tasks/${id}`), enabled: !!id });

export const useMilestones = () => useQuery({ queryKey: ["milestones"], queryFn: () => api.get<Milestone[]>("/api/milestones") });
export const useMilestone = (id: string | undefined) =>
  useQuery({ queryKey: ["milestone", id], queryFn: () => api.get<Milestone & { tasks: Task[] }>(`/api/milestones/${id}`), enabled: !!id });

export const useNews = (category?: string) =>
  useQuery({
    queryKey: ["news", category ?? "all"],
    queryFn: () => api.get<{ items: NewsItem[]; unread: number }>(`/api/news${qs({ category, limit: 100 })}`),
    placeholderData: keepPreviousData,
  });
export const useNewsItem = (id: string | undefined) =>
  useQuery({ queryKey: ["news-item", id], queryFn: () => api.get<NewsDetail>(`/api/news/${id}`), enabled: !!id });

export type ContactFilter = { q?: string; category?: string; owner?: string };
export const useContacts = (f: ContactFilter) =>
  useQuery({ queryKey: ["contacts", f], queryFn: () => api.get<Contact[]>(`/api/contacts${qs(f)}`), placeholderData: keepPreviousData });
export const useContact = (id: string | undefined) =>
  useQuery({ queryKey: ["contact", id], queryFn: () => api.get<ContactDetail>(`/api/contacts/${id}`), enabled: !!id });
export const useContactMeta = () =>
  useQuery({
    queryKey: ["contact-meta"],
    queryFn: () => api.get<{ categories: string[]; stages: Record<string, string[]>; stageLabels?: Record<string, string>; categoryLabels?: Record<string, string> }>("/api/contacts/meta"),
    staleTime: Infinity,
  });

export type OrgFilter = {
  kind: OrgKind;
  q?: string;
  stage?: string;
  type?: string;
  owner?: string;
  priority?: string;
  focus?: string;
  stageFocus?: string;
  country?: string;
  fit?: string;
  outreach?: string;
  prior?: string;
};
export const useOrgs = (f: OrgFilter) =>
  useQuery({ queryKey: ["orgs", f], queryFn: () => api.get<Org[]>(`/api/orgs${qs(f)}`), placeholderData: keepPreviousData });
export const useOrg = (id: string | undefined) => useQuery({ queryKey: ["org", id], queryFn: () => api.get<OrgDetail>(`/api/orgs/${id}`), enabled: !!id });
export const useOrgDashboard = (kind: OrgKind) =>
  useQuery({ queryKey: ["orgs", "dashboard", kind], queryFn: () => api.get<OrgDashboard>(`/api/orgs/dashboard?kind=${kind}`), refetchInterval: 120_000 });
export const useOrgMeta = () => useQuery({ queryKey: ["org-meta"], queryFn: () => api.get<OrgMeta>("/api/orgs/meta"), staleTime: Infinity });
export interface Round {
  name: string;
  targetMio: number | null;
  committedExtraMio: number | null;
  preMoneyMio: number | null;
}
export const useRound = () => useQuery({ queryKey: ["org-round"], queryFn: () => api.get<Round>("/api/orgs/round") });

/* ---------- Fundraising agent ---------- */

export const useAgentStatus = (enabled = true) =>
  useQuery({ queryKey: ["agent", "status"], queryFn: () => api.get<AgentStatus>("/api/agent/status"), enabled, refetchInterval: 30_000 });
export const useOutreach = (f: { status?: string; q?: string } = {}) =>
  useQuery({ queryKey: ["agent", "outreach", f], queryFn: () => api.get<Outreach[]>(`/api/agent/outreach${qs(f)}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });
export const useOutreachDetail = (id: string | undefined) =>
  useQuery({ queryKey: ["agent", "outreach-detail", id], queryFn: () => api.get<OutreachDetail>(`/api/agent/outreach/${id}`), enabled: !!id });
export const useAgentMessages = (status: "draft" | "sent" = "draft") =>
  useQuery({ queryKey: ["agent", "messages", status], queryFn: () => api.get<AgentMessage[]>(`/api/agent/messages?status=${status}`), refetchInterval: 60_000 });
export const useAgentRuns = () => useQuery({ queryKey: ["agent", "runs"], queryFn: () => api.get<AgentRun[]>("/api/agent/runs?limit=60"), refetchInterval: 30_000 });
export const useAgentCandidates = (enabled: boolean) =>
  useQuery({ queryKey: ["agent", "candidates"], queryFn: () => api.get<{ total: number; priority: number; next: AgentCandidate[] }>("/api/agent/candidates?limit=30"), enabled });

export const useNotifications = () =>
  useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
  });

export const useMailStatus = () => useQuery({ queryKey: ["mail", "status"], queryFn: () => api.get<MailStatus>("/api/mail/status"), staleTime: 60_000 });
export const useMailFolders = (enabled: boolean) =>
  useQuery({ queryKey: ["mail", "folders"], queryFn: () => api.get<MailFolder[]>("/api/mail/folders"), enabled, staleTime: 5 * 60_000 });
export const useMailList = (folderId: string | undefined, q: string, enabled: boolean) =>
  useQuery({
    queryKey: ["mail", "list", folderId, q],
    queryFn: () => api.get<{ items: MailSummary[]; nextStart: number | null }>(`/api/mail/messages${qs({ folderId, q, limit: 50 })}`),
    enabled: enabled && (!!folderId || !!q),
    placeholderData: keepPreviousData,
    refetchInterval: 90_000,
  });
type MailPage = { items: MailSummary[]; nextStart: number | null };

/** Mailbox list with "Load older" (pages of 50). */
export const useMailListInfinite = (folderId: string | undefined, q: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["mail", "list-inf", folderId, q],
    queryFn: ({ pageParam }) => api.get<MailPage>(`/api/mail/messages${qs({ folderId, q, limit: 50, start: pageParam })}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextStart ?? undefined,
    enabled: enabled && (!!folderId || !!q),
    refetchInterval: 90_000,
  });

/** Virtual "Important" folder: inbox filtered to senders from the CRM */
export const IMPORTANT_FOLDER = "wichtig";
export const useImportantMail = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["mail", "list-inf", IMPORTANT_FOLDER, ""],
    queryFn: ({ pageParam }) => api.get<MailPage & { scanned: number }>(`/api/mail/important${qs({ start: pageParam })}`),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextStart ?? undefined,
    enabled,
    refetchInterval: 120_000,
  });

/** Updates a mail in all loaded lists (e.g. read/unread). */
export function patchMailInLists(qc: QueryClient, id: string, patch: Partial<MailSummary>) {
  qc.setQueriesData<MailPage>({ queryKey: ["mail", "list"] }, (d) => (d ? { ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : d));
  qc.setQueriesData<InfiniteData<MailPage>>({ queryKey: ["mail", "list-inf"] }, (d) =>
    d ? { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) })) } : d,
  );
}

export const useMailMessage = (folderId: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: ["mail", "msg", folderId, id],
    queryFn: () => api.get<MailMessage>(`/api/mail/messages/${folderId}/${id}`),
    enabled: !!folderId && !!id,
    staleTime: 5 * 60_000,
  });
export const useMailUnread = (enabled = true) =>
  useQuery({
    queryKey: ["mail", "unread"],
    queryFn: () => api.get<{ connected: boolean; unread: number }>("/api/mail/unread"),
    refetchInterval: 90_000,
    enabled,
  });

export function invalidateWork(qc: QueryClient) {
  for (const k of ["tasks", "task", "home", "milestones", "milestone", "users", "contact", "contacts", "org", "orgs"]) qc.invalidateQueries({ queryKey: [k] });
}

/** Update a task – optimistically in all lists. */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => api.patch<Task>(`/api/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      for (const [key, list] of snapshots) {
        if (Array.isArray(list)) qc.setQueryData(key, list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      }
      const home = qc.getQueryData<HomeData>(["home"]);
      if (home) qc.setQueryData(["home"], { ...home, tasks: home.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
      return { snapshots, home };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([k, v]) => qc.setQueryData(k, v));
      if (ctx?.home) qc.setQueryData(["home"], ctx.home);
    },
    onSettled: () => invalidateWork(qc),
  });
}
