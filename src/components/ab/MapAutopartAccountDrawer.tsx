import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import { cn } from "@/lib/utils";
import {
  createCompanyAndMapAutopartAccountFn,
  getAutopartAccountMappingStatusFn,
  listSalesRepsFn,
  mapAutopartCustomerAccountFn,
  reprocessSkippedAutopartSalesFn,
  searchCompaniesForAutopartMappingFn,
} from "@/server/phase2/fns";

type SearchHit = Extract<
  Awaited<ReturnType<typeof searchCompaniesForAutopartMappingFn>>,
  { ok: true }
>["data"]["items"][number];

type Binding = {
  accountCode: string;
  kind: "PRIMARY" | "ALIAS";
  companyId: string;
  companyName: string;
};

/**
 * Shared Map Autopart Account workflow — used from import diagnostics and the
 * Autopart Account Mapping workspace.
 */
export function MapAutopartAccountDrawer({
  open,
  accountCode,
  importRunId,
  diagnosticId,
  onClose,
  onMapped,
}: {
  open: boolean;
  accountCode: string;
  importRunId?: string;
  diagnosticId?: string;
  onClose: () => void;
  onMapped?: (binding: Binding) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [allowReassign, setAllowReassign] = useState(false);
  const [mode, setMode] = useState<"search" | "create" | "recover">("search");
  const [mapped, setMapped] = useState<Binding | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createTrading, setCreateTrading] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createRepId, setCreateRepId] = useState("");
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [existingBinding, setExistingBinding] = useState<Binding | null>(null);

  useEffect(() => {
    if (!open || !accountCode) return;
    setQ("");
    setHits([]);
    setSelected(null);
    setConflict(null);
    setAllowReassign(false);
    setMode("search");
    setMapped(null);
    setRecoveryHint(null);
    setCreateName("");
    void getAutopartAccountMappingStatusFn({ data: { accountCode } }).then((r) => {
      if (r.ok && r.data.binding) {
        setExistingBinding(r.data.binding);
        setMapped(r.data.binding);
      } else {
        setExistingBinding(null);
      }
    });
    void listSalesRepsFn().then((r) => {
      if (r.ok) setReps(r.data);
    });
  }, [open, accountCode]);

  async function runSearch(term: string) {
    setBusy("search");
    const res = await searchCompaniesForAutopartMappingFn({ data: { q: term, limit: 25 } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setHits([...res.data.items]);
  }

  async function confirmMap(reassign = false) {
    if (!selected) return;
    setBusy("map");
    setConflict(null);
    const res = await mapAutopartCustomerAccountFn({
      data: {
        accountCode,
        companyId: selected.id,
        allowReassign: reassign || allowReassign,
        sourceContext: { importRunId, diagnosticId },
      },
    });
    setBusy(null);
    if (!res.ok) {
      if (res.error.includes("already mapped")) {
        setConflict(res.error);
        return;
      }
      toast.error(res.error);
      return;
    }
    toast.success(`Mapped ${accountCode} → ${res.data.binding.companyName}`);
    setMapped(res.data.binding);
    setRecoveryHint(res.data.recoveryHint);
    setMode("recover");
    onMapped?.(res.data.binding);
  }

  async function createAndMap() {
    if (!createName.trim()) return;
    setBusy("create");
    const res = await createCompanyAndMapAutopartAccountFn({
      data: {
        accountCode,
        name: createName.trim(),
        tradingName: createTrading.trim() || null,
        primaryEmail: createEmail.trim() || null,
        phone: createPhone.trim() || null,
        salesRepId: createRepId || null,
        sourceContext: { importRunId },
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Created ${res.data.company.name} and mapped ${accountCode}`);
    setMapped(res.data.mapping.binding);
    setRecoveryHint(res.data.mapping.recoveryHint);
    setMode("recover");
    onMapped?.(res.data.mapping.binding);
  }

  async function onReprocessFile(file: File | null) {
    if (!file) return;
    setBusy("reprocess");
    const text = await file.text();
    const res = await reprocessSkippedAutopartSalesFn({
      data: { text, filename: file.name, accountCode },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Reprocess complete — inserted ${res.data.rowsImported}, unchanged/updated ${res.data.rowsUpdated}, skipped ${res.data.rowsSkipped}` +
        (res.data.accountInserted
          ? ` (${res.data.accountInserted} for ${accountCode})`
          : ""),
    );
  }

  if (!open) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Map Autopart Account"
      sub={accountCode}
      width="lg"
      footer={
        <div className="flex flex-wrap gap-2">
          {mode === "search" && selected && !mapped ? (
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void confirmMap(false)}
            >
              Map account
            </button>
          ) : null}
          {mode === "create" && !mapped ? (
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              disabled={busy !== null || !createName.trim()}
              onClick={() => void createAndMap()}
            >
              Create &amp; map
            </button>
          ) : null}
          <button
            type="button"
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-1 text-[13px]">
        <div className="rounded-md border border-border bg-surface/40 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">
            Autopart account
          </div>
          <div className="mt-1 font-display text-lg font-semibold uppercase tracking-tight">
            {accountCode}
          </div>
          <p className="mt-2 text-[12px] text-steel">
            Link this Autopart customer account to an Automotive Brands customer. Future Autopart
            imports for this account will use the selected customer.
          </p>
        </div>

        {existingBinding && !mapped ? (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
            Already mapped to{" "}
            <a className="font-semibold text-cyan underline" href={`/admin/customers/${existingBinding.companyId}`}>
              {existingBinding.companyName}
            </a>{" "}
            ({existingBinding.kind}).
          </p>
        ) : null}

        {mapped ? (
          <div className="space-y-3 rounded-md border border-good/30 bg-good/5 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="good">Mapped</StatusBadge>
              <span>
                {mapped.accountCode} →{" "}
                <a className="font-semibold text-cyan underline" href={`/admin/customers/${mapped.companyId}`}>
                  {mapped.companyName}
                </a>
              </span>
            </div>
            <p className="text-[12px] text-steel">
              {recoveryHint ??
                "Re-upload the original TRM21QC or 504 report to import previously skipped lines. Raw report rows are not stored on the server after import."}
            </p>
            <Field label="Re-upload report to recover skipped lines">
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="text-[12px]"
                disabled={busy !== null}
                onChange={(e) => void onReprocessFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
        ) : null}

        {!mapped ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(
                  "h-8 rounded-md border px-3 text-[10px] font-semibold uppercase",
                  mode === "search" ? "border-primary bg-primary/10" : "border-border text-steel",
                )}
                onClick={() => setMode("search")}
              >
                Search existing
              </button>
              <button
                type="button"
                className={cn(
                  "h-8 rounded-md border px-3 text-[10px] font-semibold uppercase",
                  mode === "create" ? "border-primary bg-primary/10" : "border-border text-steel",
                )}
                onClick={() => setMode("create")}
              >
                Create new customer
              </button>
            </div>

            {mode === "search" ? (
              <div className="space-y-3">
                <Field label="Search companies">
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      value={q}
                      placeholder="Name, Autopart account, email, postcode, VAT…"
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void runSearch(q);
                      }}
                    />
                    <button
                      type="button"
                      className="h-10 shrink-0 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
                      disabled={busy !== null || q.trim().length < 2}
                      onClick={() => void runSearch(q)}
                    >
                      Search
                    </button>
                  </div>
                </Field>

                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left",
                          selected?.id === h.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-surface/50",
                        )}
                        onClick={() => {
                          setSelected(h);
                          setConflict(null);
                          setAllowReassign(false);
                        }}
                      >
                        <div className="font-semibold">{h.name}</div>
                        <div className="mt-0.5 text-[11px] text-steel">
                          {h.autopartCustomerCode
                            ? `Autopart ${h.autopartCustomerCode}${h.aliasCount ? ` +${h.aliasCount} alias` : ""}`
                            : h.aliasCount
                              ? `${h.aliasCount} alias${h.aliasCount === 1 ? "" : "es"}`
                              : "No Autopart account"}
                          {h.customerGroup ? ` · Group ${h.customerGroup.name}` : ""}
                          {h.salesperson ? ` · ${h.salesperson}` : ""}
                          {h.postcode ? ` · ${h.postcode}` : ""}
                          {h.primaryContact ? ` · ${h.primaryContact}` : ""}
                          {" · "}
                          {h.status}
                        </div>
                      </button>
                    </li>
                  ))}
                  {!hits.length && q.trim().length >= 2 && busy !== "search" ? (
                    <li className="text-[12px] text-steel">No companies found.</li>
                  ) : null}
                </ul>

                {selected ? (
                  <div className="rounded-md border border-border px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase text-steel">Will be linked to</div>
                    <div className="mt-1 font-semibold">{selected.name}</div>
                    {selected.customerGroup ? (
                      <div className="mt-1 text-[12px]">
                        Customer Group:{" "}
                        <span className="font-semibold">{selected.customerGroup.name}</span>
                      </div>
                    ) : null}
                    <div className="mt-1 text-[12px] text-steel">
                      Autopart account <span className="font-semibold text-foreground">{accountCode}</span>{" "}
                      → Company (not directly to a Customer Group)
                    </div>
                  </div>
                ) : null}

                {conflict ? (
                  <div className="space-y-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-3 text-[12px]">
                    <p>{conflict}</p>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allowReassign}
                        onChange={(e) => setAllowReassign(e.target.checked)}
                      />
                      I confirm reassignment to {selected?.name}
                    </label>
                    <button
                      type="button"
                      className="h-9 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-50"
                      disabled={!allowReassign || busy !== null || !selected}
                      onClick={() => void confirmMap(true)}
                    >
                      Confirm reassignment
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-[12px] text-steel">
                  Creates a new company and maps <span className="font-semibold">{accountCode}</span>.
                  Company details are not invented from Autopart report rows — enter them explicitly.
                </p>
                <Field label="Legal / company name">
                  <input
                    className={inputClass}
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Trading name">
                  <input
                    className={inputClass}
                    value={createTrading}
                    onChange={(e) => setCreateTrading(e.target.value)}
                  />
                </Field>
                <Field label="Primary email">
                  <input
                    type="email"
                    className={inputClass}
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputClass}
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                  />
                </Field>
                <Field label="Assigned salesperson">
                  <select
                    className={inputClass}
                    value={createRepId}
                    onChange={(e) => setCreateRepId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
