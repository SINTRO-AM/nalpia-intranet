import { getLang, tr } from "./i18n";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public fields: Record<string, string> = {},
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
export function onUnauthenticated(fn: Listener) {
  unauthListeners.add(fn);
  return () => {
    unauthListeners.delete(fn);
  };
}

async function request<T>(method: string, url: string, body?: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-requested-with": "nalpia-intranet",
        "x-lang": getLang(),
        ...(body instanceof Blob ? { "content-type": body.type || "application/octet-stream" } : body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, tr("Can't reach the server. Check your internet connection.", "Keine Verbindung zum Server. Prüfe deine Internetverbindung."), "network");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  if (!res.ok) {
    // Only the server's "not signed in" answer ends the session in the interface – never an error of the
    // mailbox, calendar or another connected service that happens to use 401.
    if (res.status === 401 && data.code === "unauthenticated" && !url.startsWith("/api/auth/")) unauthListeners.forEach((l) => l());
    throw new ApiError(
      res.status,
      typeof data.error === "string" ? data.error : tr(`Error ${res.status}`, `Fehler ${res.status}`),
      typeof data.code === "string" ? data.code : "error",
      (data.fields as Record<string, string>) ?? {},
      data,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, opts?: { signal?: AbortSignal }) => request<T>("GET", url, undefined, opts),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  /** Upload raw data (e.g. profile photo) */
  put: <T>(url: string, blob: Blob) => request<T>("PUT", url, blob),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** POST with a server-sent events response (for AI drafts). */
export async function streamPost(
  url: string,
  body: unknown,
  handlers: {
    onDelta: (t: string) => void;
    onDone: (t: string) => void;
    onError: (msg: string) => void;
    /** Other events (e.g. the assistant's tool status) */
    onEvent?: (event: string, data: Record<string, unknown>) => void;
  },
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-requested-with": "nalpia-intranet", "x-lang": getLang() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    handlers.onError(tr("Can't reach the server.", "Keine Verbindung zum Server."));
    return;
  }
  if (!res.ok || !res.body) {
    let msg = tr(`Error ${res.status}`, `Fehler ${res.status}`);
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    handlers.onError(msg);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data) as { text?: string; message?: string } & Record<string, unknown>;
        if (event === "delta") handlers.onDelta(parsed.text ?? "");
        else if (event === "done") handlers.onDone(parsed.text ?? "");
        else if (event === "error") handlers.onError(parsed.message ?? tr("Error", "Fehler"));
        else handlers.onEvent?.(event, parsed);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") handlers.onError(tr("The connection was interrupted.", "Die Verbindung wurde unterbrochen."));
  }
}
