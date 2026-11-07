import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { cn } from "@/lib/utils";
import {
  confirmBulkCustomerGroupAssignFn,
  listCustomerGroupsFn,
  previewBulkCustomerGroupAssignFn,
  resolveAllCompaniesForBulkCustomerGroupAssignFn,
  searchCompaniesForBulkCustomerGroupAssignFn,
} from "@/server/phase2/fns";

type GroupRow = { id: string; name: string; active: boolean; companyCount: number };
type SearchItem = Extract<
  Awaited<ReturnType<typeof searchCompaniesForBulkCustomerGroupAssignFn>>,
  { ok: true }
>["data"]["items"][number];
type Preview = Extract<
  Awaited<ReturnType<typeof previewBulkCustomerGroupAssignFn>>,
  { ok: true }
>["data"];
type ConfirmResult = Extract<
  Awaited<ReturnType<typeof confirmBulkCustomerGroupAssignFn>>,
  { ok: true }
>["data"];

const STATUS_OPTIONS = [
  "ALL",
  "ACTIVE",
  "PROSPECT",
  "PENDING_APPROVAL",
  "ON_HOLD",
  "SUSPENDED",
  "CLOSED",
] as const;

export function BulkAssignCustomerGroupPanel({
  initialGroupId,
}: {
  initialGroupId?: string | undefined;
}) {
  const [open, setOpen] = useState(Boolean(initialGroupId));
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [targetGroupId, setTargetGroupId] = useState(initialGroupId ?? "");
  const [q, setQ] = useState("VERTU");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
  const [membership, setMembership] = useState<"ALL" | "UNGROUPED" | "OTHER_GROUP" | "TARGET">(
    "ALL",
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [allowReassignment, setAllowReassignment] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const pageSize = 50;

  useEffect(() => {
    void listCustomerGroupsFn({ data: { includeInactive: false } }).then((res) => {
      if (!res.ok) return;
      setGroups(res.data.items);
      if (!targetGroupId && res.data.items[0]) setTargetGroupId(res.data.items[0].id);
    });
  }, []);

  async function loadPage(nextPage = page) {
    if (!targetGroupId) return;
    setBusy(true);
    setError(null);
    const res = await searchCompaniesForBulkCustomerGroupAssignFn({
      data: {
        targetGroupId,
        q: q.trim() || null,
        status,
        membership,
        page: nextPage,
        pageSize,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setItems([]);
      setTotal(0);
      return;
    }
    setItems(res.data.items);
    setTotal(res.data.total);
    setPage(res.data.page);
  }

  useEffect(() => {
    if (!open || !targetGroupId) return;
    void loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetGroupId, status, membership]);

  function toggle(id: string) {
    setPreview(null);
    setResult(null);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function togglePage(select: boolean) {
    setPreview(null);
    setResult(null);
    setSelected((prev) => {
      const next = { ...prev };
      for (const row of items) {
        if (select) next[row.id] = true;
        else delete next[row.id];
      }
      return next;
    });
  }

  async function selectAllMatches() {
    if (!targetGroupId) return;
    setBusy(true);
    setError(null);
    const res = await resolveAllCompaniesForBulkCustomerGroupAssignFn({
      data: { targetGroupId, q: q.trim() || null, status, membership },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    const next: Record<string, true> = {};
    for (const id of res.data.companyIds) next[id] = true;
    setSelected(next);
    setPreview(null);
    setResult(null);
    toast.success(`Selected ${res.data.total} matching companies`);
  }

  async function runPreview() {
    if (!targetGroupId || selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await previewBulkCustomerGroupAssignFn({
      data: {
        targetGroupId,
        companyIds: selectedIds,
        allowReassignment,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setPreview(res.data);
    setResult(null);
  }

  async function runConfirm() {
    if (!preview || !targetGroupId) return;
    setBusy(true);
    setError(null);
    const res = await confirmBulkCustomerGroupAssignFn({
      data: {
        targetGroupId,
        companyIds: selectedIds,
        allowReassignment,
        previewToken: preview.previewToken,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setResult(res.data);
    toast.success(
      `Assigned ${res.data.summary.assigned} · already ${res.data.summary.alreadyAssigned} · skipped ${res.data.summary.skipped}`,
    );
    setPreview(null);
    void loadPage(page);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-bold uppercase"
      >
        Bulk assign customers
      </button>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="grid gap-4 rounded-md border border-border p-4 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold uppercase">Bulk assign customers</h2>
          <p className="mt-1 text-steel">
            Assign existing companies to a Customer Group for consolidated reporting. This does not
            merge companies, change Autopart mappings, verify sales codes, activate customers, or
            send invitations.
          </p>
        </div>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>

      {error ? <p className="text-bad">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Target group">
          <select
            className={inputClass}
            value={targetGroupId}
            onChange={(e) => {
              setTargetGroupId(e.target.value);
              setSelected({});
              setPreview(null);
              setResult(null);
            }}
          >
            <option value="">Select group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.companyCount})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search name or Autopart code">
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. VERTU"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void loadPage(1);
              }
            }}
          />
        </Field>
        <Field label="Customer status">
          <select
            className={inputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
          >
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "ALL" ? "All statuses" : value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Current membership">
          <select
            className={inputClass}
            value={membership}
            onChange={(e) =>
              setMembership(e.target.value as "ALL" | "UNGROUPED" | "OTHER_GROUP" | "TARGET")
            }
          >
            <option value="ALL">All</option>
            <option value="UNGROUPED">Ungrouped only</option>
            <option value="OTHER_GROUP">In another group</option>
            <option value="TARGET">Already in target</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !targetGroupId}
          className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
          onClick={() => void loadPage(1)}
        >
          Search
        </button>
        <button
          type="button"
          disabled={busy || !targetGroupId || total === 0}
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
          onClick={() => void selectAllMatches()}
        >
          Select all {total || ""} matches
        </button>
        <button
          type="button"
          disabled={busy || items.length === 0}
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
          onClick={() => togglePage(true)}
        >
          Select page
        </button>
        <button
          type="button"
          disabled={busy || selectedIds.length === 0}
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
          onClick={() => {
            setSelected({});
            setPreview(null);
            setResult(null);
          }}
        >
          Clear selection
        </button>
      </div>

      <p className="text-steel">
        Selected {selectedIds.length} · Matches {total}
        {q.trim() ? ` · Query “${q.trim()}”` : ""}
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-left text-[12px]">
          <thead className="border-b border-border bg-surface/60 text-[10px] uppercase tracking-wide text-steel">
            <tr>
              <th className="px-3 py-2">Select</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Autopart</th>
              <th className="px-3 py-2">Group</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-border/50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.id])}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    to="/admin/customers/$id"
                    params={{ id: row.id }}
                    className="font-medium underline"
                  >
                    {row.name}
                  </Link>
                  {row.needsReview ? (
                    <div className="text-warn">No Autopart code linked — review manually</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">{row.status.replaceAll("_", " ")}</td>
                <td className="px-3 py-2 font-mono">
                  {row.autopartAccountCodes.length
                    ? row.autopartAccountCodes.join(", ")
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {row.membership === "TARGET"
                    ? "Already in target"
                    : row.membership === "OTHER_GROUP"
                      ? row.customerGroupName ?? "Other group"
                      : "Ungrouped"}
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-steel">
                  No companies match. Create or link Autopart accounts before assigning groups.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || page <= 1}
          className="h-9 rounded-md border border-border px-3 disabled:opacity-50"
          onClick={() => void loadPage(page - 1)}
        >
          Previous
        </button>
        <span className="text-steel">
          Page {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={busy || page >= pageCount}
          className="h-9 rounded-md border border-border px-3 disabled:opacity-50"
          onClick={() => void loadPage(page + 1)}
        >
          Next
        </button>
      </div>

      <label className="flex items-start gap-2 text-steel">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={allowReassignment}
          onChange={(e) => {
            setAllowReassignment(e.target.checked);
            setPreview(null);
          }}
        />
        <span>
          Allow reassignment from another Customer Group. Without this, other-group members are
          skipped as conflicts.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || selectedIds.length === 0}
          className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase disabled:opacity-50"
          onClick={() => void runPreview()}
        >
          Preview assignment
        </button>
        <button
          type="button"
          disabled={busy || !preview || preview.counts.assignable === 0}
          className={cn(
            "h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50",
          )}
          onClick={() => void runConfirm()}
        >
          Confirm assignment
        </button>
      </div>

      {preview ? (
        <div className="grid gap-2 rounded-md border border-border bg-surface/40 p-3">
          <p className="font-medium">
            Preview for {preview.targetGroup.name}: assign {preview.counts.assignable}, already{" "}
            {preview.counts.alreadyInTarget}, conflicts {preview.counts.conflicts}, no Autopart code{" "}
            {preview.counts.needsReview}
          </p>
          {preview.conflicts.length ? (
            <p className="text-warn">
              Conflicts excluded unless reassignment is enabled:{" "}
              {preview.conflicts.map((c) => c.name).join(", ")}
            </p>
          ) : null}
          <ul className="max-h-48 overflow-auto text-[12px]">
            {preview.assignable.map((c) => (
              <li key={c.id}>
                {c.name} · {c.autopartAccountCodes.join(", ") || "no Autopart code"}
                {c.currentGroupName ? ` · from ${c.currentGroupName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-1 rounded-md border border-good/40 bg-good/10 p-3">
          <p className="font-medium">
            Bulk operation {result.bulkOperationId}: assigned {result.summary.assigned}, already{" "}
            {result.summary.alreadyAssigned}, skipped {result.summary.skipped}, failed{" "}
            {result.summary.failed}, moved {result.summary.moved}
          </p>
          <p className="text-steel">
            Group sales summaries and SI Customer Group reporting will include these companies on
            the next load. Per-company Sales Enquiry remains company-scoped.
          </p>
        </div>
      ) : null}
    </section>
  );
}
