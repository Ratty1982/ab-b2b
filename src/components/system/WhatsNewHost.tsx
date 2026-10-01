import { useCallback, useEffect, useState } from "react";
import { WhatsNewModal, type WhatsNewViewModel } from "@/components/system/WhatsNewModal";
import { InstantText } from "@/components/ab/InstantText";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  acknowledgeWhatsNewFn,
  getPendingWhatsNewFn,
  getWhatsNewItemFn,
  listWhatsNewHistoryFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

/**
 * Internal-staff What's New: login modal + history opener.
 * Mount only in back-office shells (not trade portal).
 */
export function WhatsNewHost({
  enabled,
  historyOpen,
  onHistoryOpenChange,
  onUnreadChange,
}: {
  enabled: boolean;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [pending, setPending] = useState<WhatsNewViewModel | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<
    Array<WhatsNewViewModel & { acknowledged?: boolean }>
  >([]);
  const [reading, setReading] = useState<WhatsNewViewModel | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!enabled) return;
    const res = await listWhatsNewHistoryFn();
    if (res.ok) {
      onUnreadChange?.(res.data.unreadCount);
      setHistory(res.data.items);
    }
  }, [enabled, onUnreadChange]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const [pendingRes] = await Promise.all([getPendingWhatsNewFn(), refreshUnread()]);
      if (cancelled) return;
      if (pendingRes.ok && pendingRes.data) {
        setPending(pendingRes.data);
        setModalOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshUnread]);

  useEffect(() => {
    if (historyOpen && enabled) void refreshUnread();
  }, [historyOpen, enabled, refreshUnread]);

  async function acknowledge() {
    if (!pending || pending.isPreview) {
      setModalOpen(false);
      setPending(null);
      return;
    }
    setBusy(true);
    await acknowledgeWhatsNewFn({ data: { id: pending.id } });
    setBusy(false);
    setModalOpen(false);
    setPending(null);
    await refreshUnread();
  }

  async function openHistoryItem(id: string) {
    const res = await getWhatsNewItemFn({ data: { id } });
    if (res.ok) setReading(res.data);
  }

  if (!enabled) return null;

  return (
    <>
      <WhatsNewModal
        open={modalOpen && Boolean(pending)}
        update={pending}
        busy={busy}
        onAcknowledge={() => void acknowledge()}
        onOpenChange={(open) => {
          if (!open && pending && !pending.isPreview) {
            void acknowledge();
            return;
          }
          setModalOpen(open);
        }}
      />

      <Dialog open={historyOpen} onOpenChange={onHistoryOpenChange}>
        <DialogContent className="max-h-[min(90vh,36rem)] max-w-md overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className="font-display text-lg font-semibold uppercase">
              What&apos;s New
            </DialogTitle>
          </DialogHeader>
          <ul className="max-h-[28rem] overflow-y-auto divide-y divide-border">
            {history.length === 0 ? (
              <li className="px-5 py-8 text-center text-[13px] text-steel">
                No published updates yet.
              </li>
            ) : (
              history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 px-5 py-3 text-left hover:bg-surface/50"
                    onClick={() => void openHistoryItem(item.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] font-bold uppercase tracking-wide text-cyan">
                        Version {item.version}
                      </span>
                      {!item.acknowledged ? (
                        <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />
                      ) : null}
                    </span>
                    <span className="font-medium text-[14px]">{item.title}</span>
                    <span className="text-[12px] text-steel">
                      {item.publishedAt ? (
                        <InstantText value={item.publishedAt} variant="date" />
                      ) : (
                        "—"
                      )}
                      {item.summary ? ` · ${item.summary}` : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>

      <WhatsNewModal
        open={Boolean(reading)}
        update={reading}
        onAcknowledge={() => {
          if (reading) void acknowledgeWhatsNewFn({ data: { id: reading.id } }).then(refreshUnread);
          setReading(null);
        }}
        onOpenChange={(open) => {
          if (!open) setReading(null);
        }}
      />
    </>
  );
}

export function WhatsNewTriggerButton({
  unreadCount,
  collapsed,
  onClick,
}: {
  unreadCount: number;
  collapsed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mt-2 w-full rounded-md border border-sidebar-border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel hover:border-steel hover:text-foreground",
        collapsed && "px-0",
      )}
      aria-label={
        unreadCount > 0 ? `What's New, ${unreadCount} unread` : "What's New"
      }
    >
      {collapsed ? (
        <span className="relative inline-flex">
          New
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </span>
      ) : (
        <>
          What&apos;s New
          {unreadCount > 0 ? (
            <span className="ml-1 text-primary">· {unreadCount}</span>
          ) : null}
        </>
      )}
    </button>
  );
}
