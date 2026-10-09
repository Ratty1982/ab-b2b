/**
 * Shared Sales Intelligence → CRM follow-up drawer.
 * Human-initiated only; evidence is validated server-side.
 */
import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import {
  createSalesIntelligenceFollowUpFn,
  previewSalesIntelligenceFollowUpFn,
} from "@/server/phase2/fns";
import type { SiFollowupReason, SiFollowupSourceModule } from "@/domain/sales-followup";

export type FollowUpRequest = {
  sourceModule: SiFollowupSourceModule;
  sourceReason?: SiFollowupReason;
  companyId: string;
  sku?: string | null;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  compare?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
  opportunityPeriod?: string | null;
  historySource?: "dated" | "global";
};

type PreviewData = Extract<
  Awaited<ReturnType<typeof previewSalesIntelligenceFollowUpFn>>,
  { ok: true }
>["data"];

export function CreateFollowUpDrawer({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: FollowUpRequest | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<"LOW" | "NORMAL" | "HIGH">("NORMAL");
  const [duePreset, setDuePreset] = useState<"TODAY" | "TOMORROW" | "IN_3_DAYS" | "IN_1_WEEK" | "CUSTOM">(
    "IN_3_DAYS",
  );
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState<{
    id: string;
    href: string;
    dueDate: string;
    assigneeName: string | null;
  } | null>(null);
  const [duplicateAck, setDuplicateAck] = useState(false);

  useEffect(() => {
    if (!open || !request) {
      setPreview(null);
      setCreated(null);
      setError(null);
      setDuplicateAck(false);
      return;
    }
    setLoading(true);
    setCreated(null);
    setDuplicateAck(false);
    void previewSalesIntelligenceFollowUpFn({ data: request }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        setPreview(null);
      } else {
        setError(null);
        setPreview(r.data);
        setTitle(r.data.title);
        setAssigneeId(r.data.defaultAssignee.id);
        setPriority(r.data.defaultPriority);
        setNotes("");
      }
      setLoading(false);
    });
  }, [open, request]);

  async function submit(allowDuplicate = false) {
    if (!request || !preview) return;
    setSaving(true);
    setError(null);
    const r = await createSalesIntelligenceFollowUpFn({
      data: {
        ...request,
        sourceReason: preview.snapshot.sourceReason,
        title,
        notes: notes.trim() || null,
        assigneeId,
        priority,
        duePreset,
        dueDate: duePreset === "CUSTOM" ? dueDate || null : null,
        allowDuplicate,
      },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!r.data.created) {
      setPreview({
        ...preview,
        duplicate: r.data.duplicate,
      });
      setDuplicateAck(false);
      return;
    }
    setCreated({
      id: r.data.task.id,
      href: r.data.task.href,
      dueDate: r.data.task.dueDate,
      assigneeName: r.data.task.assigneeName,
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Create follow-up"
      sub={preview ? `${preview.sourceLabel} · ${preview.snapshot.companyName}` : "Sales Intelligence"}
      width="lg"
      footer={
        created ? (
          <div className="flex flex-wrap gap-2">
            <Link
              to={ROUTES.crmTasks}
              search={{ taskId: created.id }}
              className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
            >
              View task
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Continue reviewing
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || loading || !preview}
              onClick={() => void submit(duplicateAck)}
              className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Creating…" : duplicateAck ? "Create another" : "Create follow-up"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Cancel
            </button>
          </div>
        )
      }
    >
      {error ? (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-steel">Loading context…</p> : null}

      {created ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-good">Follow-up created</p>
          <p>
            Due: {new Date(`${created.dueDate}T12:00:00Z`).toLocaleDateString("en-GB")}
          </p>
          <p>Assigned to: {created.assigneeName ?? "—"}</p>
        </div>
      ) : null}

      {preview && !created ? (
        <div className="space-y-4">
          {preview.duplicate && !duplicateAck ? (
            <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm" role="status">
              <p className="font-medium">An open follow-up already exists for this customer/product.</p>
              <p className="mt-1 text-steel">{preview.duplicate.title}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  to={ROUTES.crmTasks}
                  search={{ taskId: preview.duplicate.id }}
                  className="text-[11px] font-bold uppercase tracking-wide text-primary"
                >
                  View existing
                </Link>
                <button
                  type="button"
                  className="text-[11px] font-bold uppercase tracking-wide text-steel"
                  onClick={() => setDuplicateAck(true)}
                >
                  Create another
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-[13px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">
              Captured context
            </p>
            <p className="mt-1 font-medium">{preview.snapshot.companyName}</p>
            {preview.snapshot.productName || preview.snapshot.sku ? (
              <p>
                {preview.snapshot.productName ?? preview.snapshot.sku}
                {preview.snapshot.sku ? (
                  <span className="font-mono text-[11px] text-steel"> · {preview.snapshot.sku}</span>
                ) : null}
                {preview.snapshot.historicOnly ? (
                  <span className="ml-2 text-[11px] text-steel">Historic only</span>
                ) : preview.snapshot.productKindLabel &&
                  preview.snapshot.productKindLabel !== "Catalogue" ? (
                  <span className="ml-2 text-[11px] text-steel">{preview.snapshot.productKindLabel}</span>
                ) : null}
              </p>
            ) : null}
            <p className="mt-1">
              {preview.sourceLabel} · {preview.reasonLabel}
            </p>
            <p className="text-steel">Period: {preview.snapshot.selectedPeriod.label}</p>
            {preview.snapshot.comparisonPeriod ? (
              <p className="text-steel">Comparison: {preview.snapshot.comparisonPeriod.label}</p>
            ) : null}
            <dl className="mt-2 grid grid-cols-2 gap-1">
              {Object.entries(preview.snapshot.metrics).map(([k, v]) =>
                v == null || v === "" ? null : (
                  <div key={k}>
                    <dt className="text-[10px] uppercase text-steel">{k}</dt>
                    <dd className="tabular-nums">{String(v)}</dd>
                  </div>
                ),
              )}
            </dl>
          </div>

          {!(preview.duplicate && !duplicateAck) ? (
            <>
              <Field label="Subject" htmlFor={`${titleId}-subject`}>
                <input
                  id={`${titleId}-subject`}
                  className={inputClass}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Assigned to" htmlFor={`${titleId}-assignee`}>
                <select
                  id={`${titleId}-assignee`}
                  className={inputClass}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  {preview.assigneeOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Due date" htmlFor={`${titleId}-due`}>
                  <select
                    id={`${titleId}-due`}
                    className={inputClass}
                    value={duePreset}
                    onChange={(e) => setDuePreset(e.target.value as typeof duePreset)}
                  >
                    <option value="TODAY">Today</option>
                    <option value="TOMORROW">Tomorrow</option>
                    <option value="IN_3_DAYS">In 3 days</option>
                    <option value="IN_1_WEEK">In 1 week</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </Field>
                <Field label="Priority" htmlFor={`${titleId}-priority`}>
                  <select
                    id={`${titleId}-priority`}
                    className={inputClass}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </select>
                </Field>
              </div>
              {duePreset === "CUSTOM" ? (
                <Field label="Custom due date" htmlFor={`${titleId}-custom-due`}>
                  <input
                    id={`${titleId}-custom-due`}
                    type="date"
                    className={inputClass}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Notes (optional)" htmlFor={`${titleId}-notes`}>
                <textarea
                  id={`${titleId}-notes`}
                  rows={3}
                  className={inputClass}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional salesperson notes"
                />
              </Field>
            </>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

export function SiCreateFollowUpButton({
  onClick,
  label = "Create follow-up",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
    >
      {label}
    </button>
  );
}
