import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Contact, Org, OrgKind, Task } from "./types";

export interface ComposeDefaults {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  reply?: { messageId: string; folderId: string; subject: string; from: string; to: string[]; cc?: string[] };
  /** Start straight away with an AI draft */
  autoDraft?: boolean;
  /** Accepted AI reply suggestion (label) – opens the AI chat for refining */
  suggestion?: string;
}

export type Overlay =
  | { kind: "task"; id?: string; defaults?: Partial<Task> }
  | { kind: "milestone"; id?: string }
  | { kind: "news"; id?: string }
  | { kind: "contact"; id?: string; defaults?: Partial<Contact> }
  | { kind: "org"; orgKind: OrgKind; id?: string; defaults?: Partial<Org> }
  | { kind: "compose"; defaults: ComposeDefaults }
  | { kind: "palette" }
  | { kind: "notifications" };

interface Ctx {
  stack: Overlay[];
  open: (o: Overlay) => void;
  close: (kind?: Overlay["kind"]) => void;
}

const OverlayCtx = createContext<Ctx | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Overlay[]>([]);
  const open = useCallback((o: Overlay) => setStack((s) => [...s.filter((x) => x.kind !== o.kind), o]), []);
  const close = useCallback((kind?: Overlay["kind"]) => setStack((s) => (kind ? s.filter((x) => x.kind !== kind) : s.slice(0, -1))), []);
  const value = useMemo(() => ({ stack, open, close }), [stack, open, close]);
  return <OverlayCtx.Provider value={value}>{children}</OverlayCtx.Provider>;
}

export function useOverlays() {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("OverlayProvider missing");
  return c;
}

export function useOverlay<K extends Overlay["kind"]>(kind: K) {
  const { stack } = useOverlays();
  return stack.find((o) => o.kind === kind) as Extract<Overlay, { kind: K }> | undefined;
}
