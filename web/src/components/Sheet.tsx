import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { cx, IconButton } from "./ui";
import { tr } from "@/lib/i18n";

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Extra element on the right of the header (e.g. menu) */
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  /** "panel" = right side panel on desktop, "dialog" = centered */
  variant?: "panel" | "dialog";
  /** Full screen on mobile (e.g. mail editor) */
  fullMobile?: boolean;
}

/**
 * One interaction pattern, two forms: a bottom sheet on mobile (swipeable by the handle),
 * a side panel or dialog on desktop.
 */
export function Sheet({ open, onOpenChange, title, headerAction, footer, children, size = "md", variant = "panel", fullMobile }: SheetProps) {
  const desktop = useIsDesktop();
  const widths = { md: "w-[min(560px,100vw)]", lg: "w-[min(720px,100vw)]", xl: "w-[min(920px,100vw)]" };

  if (desktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#05224B]/30 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <Dialog.Content
            aria-describedby={undefined}
            className={cx(
              "fixed z-50 flex flex-col bg-bg shadow-pop outline-none",
              variant === "panel"
                ? cx("right-0 top-0 h-full border-l border-line data-[state=open]:animate-panel-in", widths[size])
                : cx("inset-x-0 top-[8vh] mx-auto max-h-[84vh] rounded-3xl border border-line data-[state=open]:animate-pop-in", widths[size]),
            )}
          >
            <div className={cx("flex items-center gap-3 border-b border-line bg-surface px-5 py-3", variant === "dialog" && "rounded-t-3xl")}>
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-bold">{title}</Dialog.Title>
              {headerAction}
              <Dialog.Close asChild>
                <IconButton label={tr("Close", "Schließen")} size="sm">
                  <X className="h-[18px] w-[18px]" />
                </IconButton>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className={cx("border-t border-line bg-surface px-5 py-3", variant === "dialog" && "rounded-b-3xl")}>{footer}</div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} handleOnly repositionInputs>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-[#05224B]/40" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cx(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[22px] bg-bg outline-none",
            fullMobile ? "h-[96dvh]" : "max-h-[92dvh]",
          )}
        >
          <div className="rounded-t-[22px] bg-surface">
            <Drawer.Handle className="!mt-2 !h-1.5 !w-10 !bg-line" />
            <div className="flex items-center gap-2 px-4 pb-2 pt-1.5">
              <Drawer.Title className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</Drawer.Title>
              {headerAction}
              <IconButton label={tr("Close", "Schließen")} size="sm" onClick={() => onOpenChange(false)}>
                <X className="h-[18px] w-[18px]" />
              </IconButton>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line px-4 py-4">{children}</div>
          {footer && <div className="safe-bottom border-t border-line bg-surface px-4 pt-3 [padding-bottom:max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
