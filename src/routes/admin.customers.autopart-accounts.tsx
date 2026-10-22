import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { MapAutopartAccountDrawer } from "@/components/ab/MapAutopartAccountDrawer";
import { InstantText } from "@/components/ab/InstantText";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { listAutopartAccountMappingWorkspaceFn, previewAutopartAccountVerificationFn, applyAutopartAccountVerificationFn } from "@/server/phase2/fns";
import { AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION } from "@/domain/autopart-account-verification";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/customers/autopart-accounts")({
  head: () => ({
    meta: [{ title: "Autopart Account Mapping — Automotive Brands Admin" }],
  }),
  component: AutopartAccountMappingPage,
});

type Workspace = Extract<
  Awaited<ReturnType<typeof listAutopartAccountMappingWorkspaceFn>>,
  { ok: true }
>["data"];

function AutopartAccountMappingPage() {
  const [status, setStatus] = useState("UNMAPPED");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("netSales");
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapAccount, setMapAccount] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    Extract<Awaited<ReturnType<typeof previewAutopartAccountVerificationFn>>, { ok: true }>["data"] | null
  >(null);
  const [confirmation, setConfirmation] = useState("");
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    const res = await listAutopartAccountMappingWorkspaceFn({
      data: { status, q, sort, page: 1, pageSize: 100 },
    });
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setError(null);
    setData(res.data);
  }, [status, q, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader
        title="Autopart Account Mapping"
        sub="Resolve unmapped Autopart customer accounts from ongoing 504 / TRM21QC imports"
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Autopart accounts" },
        ]}
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        <section className="space-y-3 rounded-md border border-border p-4">
          <h2 className="font-display text-sm font-semibold uppercase">Verify assigned Autopart IDs</h2>
          <p className="text-[12px] text-steel">
            Unique assigned IDs can be recorded as verified. This does not approve trade applications,
            enable portal access, change pricing or credit, or move invoices, orders, or sales history.
            It does not run during deployment.
          </p>
          <button
            type="button"
            className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
            onClick={() => {
              void previewAutopartAccountVerificationFn().then((res) => {
                if (!res.ok) {
                  toast.error(res.error);
                  setPreview(null);
                  return;
                }
                setPreview(res.data);
              });
            }}
          >
            Preview
          </button>
          {preview ? (
            <dl className="grid gap-1 text-[12px] sm:grid-cols-2">
              <div>Companies with an assigned ID: {preview.companiesWithAssignedIds}</div>
              <div>Already verified: {preview.alreadyVerified}</div>
              <div>Eligible for automatic verification: {preview.eligible}</div>
              <div>Linked 407EXP accounts: {preview.linked407exp}</div>
              <div>Conflicting or ambiguous IDs: {preview.conflicts}</div>
              <div>Manual review: {preview.manualReview}</div>
            </dl>
          ) : null}
          {preview && preview.samples.conflicts.length > 0 ? (
            <div className="text-[12px]">
              <div className="font-semibold">Conflicting IDs left unchanged</div>
              <ul className="mt-1 space-y-1 text-steel">
                {preview.samples.conflicts.map((row, index) => (
                  <li key={`${row.companyId}-${row.code}-${index}`}>
                    {row.companyName || row.companyId}: {row.code} — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview && preview.samples.manualReview.length > 0 ? (
            <div className="text-[12px]">
              <div className="font-semibold">Needs manual review</div>
              <ul className="mt-1 space-y-1 text-steel">
                {preview.samples.manualReview.map((row) => (
                  <li key={`${row.companyId}-${row.code}`}>
                    {row.companyName || row.companyId}: {row.code} — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Field label="Confirmation">
            <input
              className={inputClass}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION}
              autoComplete="off"
            />
          </Field>
          <button
            type="button"
            disabled={verifying || confirmation !== AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION}
            className="h-9 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              setVerifying(true);
              void applyAutopartAccountVerificationFn({ data: { confirmation } }).then((res) => {
                setVerifying(false);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`Recorded automatic verification for ${res.data.applied} companies`);
                setConfirmation("");
                void previewAutopartAccountVerificationFn().then((next) => {
                  if (next.ok) setPreview(next.data);
                });
              });
            }}
          >
            {verifying ? "Recording…" : "Record verification"}
          </button>
        </section>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Status">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="UNMAPPED">Unmapped</option>
              <option value="MAPPED">Mapped</option>
              <option value="REVIEW">Review</option>
              <option value="ALL">All</option>
            </select>
          </Field>
          <Field label="Sort">
            <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="netSales">Net sales affected</option>
              <option value="lines">Lines</option>
              <option value="documents">Documents</option>
              <option value="latest">Latest activity</option>
              <option value="account">Account code</option>
            </select>
          </Field>
          <Field label="Search">
            <input
              className={cn(inputClass, "min-w-56")}
              value={q}
              placeholder="Autopart account or name…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
            />
          </Field>
          <button
            type="button"
            className="h-10 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        {data ? (
          <p className="text-[12px] text-steel">
            Showing {data.items.length} of {data.total} · Unmapped in view filter set:{" "}
            {data.summary.unmappedAccounts}
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[12px]">
            <thead className="border-b border-border bg-surface/60 text-[10px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2">Autopart account</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Customer Group</th>
                <th className="px-3 py-2">Docs</th>
                <th className="px-3 py-2">Lines</th>
                <th className="px-3 py-2">Net sales</th>
                <th className="px-3 py-2">First seen</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.length ? (
                data.items.map((row) => (
                  <tr key={row.accountCode} className="border-b border-border/70">
                    <td className="px-3 py-2 font-semibold">{row.accountCode}</td>
                    <td className="px-3 py-2 text-steel">
                      {row.mappedCompanyId && row.mappedCompanyName ? (
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: row.mappedCompanyId }}
                          className="text-cyan underline"
                        >
                          {row.mappedCompanyName}
                        </Link>
                      ) : (
                        (row.customerNameSnapshot ?? "—")
                      )}
                    </td>
                    <td className="px-3 py-2 text-steel">
                      {row.customerGroupId && row.customerGroupName ? (
                        <Link
                          to="/admin/customers/groups/$groupId"
                          params={{ groupId: row.customerGroupId }}
                          className="text-cyan underline"
                        >
                          {row.customerGroupName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num px-3 py-2">{row.unmappedDocuments}</td>
                    <td className="num px-3 py-2">{row.unmappedLines}</td>
                    <td className="num px-3 py-2">
                      {row.netSalesAffected == null ? "—" : `£${row.netSalesAffected}`}
                    </td>
                    <td className="px-3 py-2 text-steel">
                      <InstantText value={row.firstSeenAt} variant="audit" />
                    </td>
                    <td className="px-3 py-2 text-steel">
                      <InstantText value={row.lastSeenAt} variant="audit" />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          row.status === "MAPPED"
                            ? "good"
                            : row.status === "REVIEW"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "UNMAPPED" || row.status === "REVIEW" ? (
                        <button
                          type="button"
                          className="h-8 rounded-md bg-primary px-3 text-[10px] font-bold uppercase text-primary-foreground"
                          onClick={() => setMapAccount(row.accountCode)}
                        >
                          Map account
                        </button>
                      ) : row.mappedCompanyId ? (
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: row.mappedCompanyId }}
                          className="text-[11px] font-semibold text-cyan underline"
                        >
                          Open company
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-steel">
                    No Autopart accounts match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-steel">
          Net sales are NET / EX VAT (credits negative). Mapping does not rewrite historic financial
          lines — re-upload the source TRM21QC/504 report after mapping to recover skipped lines
          idempotently.
        </p>
      </div>

      <MapAutopartAccountDrawer
        open={Boolean(mapAccount)}
        accountCode={mapAccount ?? ""}
        onClose={() => setMapAccount(null)}
        onMapped={() => {
          void load();
        }}
      />
    </div>
  );
}
