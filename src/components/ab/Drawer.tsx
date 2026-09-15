import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Right-hand slide-over used across the CRM for fast, in-context work
 * (log activity, opportunity detail, quote preview) without losing the
 * underlying screen.
 */
export function Drawer({
  open,
  onClose,
  title,
  sub,
  width = "md",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  width?: "md" | "lg" | "xl";
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="flex-1 bg-ink/70 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "flex h-full w-full flex-col border-l border-border bg-surface shadow-2xl outline-none",
          width === "md" && "sm:w-[440px]",
          width === "lg" && "sm:w-[620px]",
          width === "xl" && "sm:w-[820px]",
        )}
      >
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold uppercase tracking-tight">
              {title}
            </h2>
            {sub ? <p className="truncate text-[12px] text-steel">{sub}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-md border border-border hover:border-steel"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <footer className="border-t border-border p-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-border bg-ink px-3 text-[14px] outline-none focus-visible:border-primary";
