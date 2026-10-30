import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { InstantText } from "@/components/ab/InstantText";
import { inputClass } from "@/components/ab/Drawer";
import { AutopartHistoryImport } from "@/components/ab/autopart/AutopartHistoryImport";
import { AutopartRecentSales } from "@/components/ab/autopart/AutopartRecentSales";
import {
  autopartPrimaryActionLabel,
  autopartStageStateLabel,
  type AutopartPrimaryAction,
  type AutopartStageState,
} from "@/domain/customer-autopart-workspace";
import { companyStatusLabel } from "@/domain/company-status-actions";
import {
  getCustomerAutopartWorkspaceFn,
  listCustomerAutopartImportActivityFn,
  listCustomerAutopartImportDetailsFn,
} from "@/server/workspace/fns";
import {
  clearCompanyAutopartCustomerCodeFn,
  listCompanyAutopartAccountsFn,
  setCompanyAutopartCustomerCodeFn,
  unmapAutopartCustomerAccountFn,
  verifyCompanyAutopartCustomerCodeFn,
} from "@/server/phase2/fns";

type Workspace = Extract<Awaited<ReturnType<typeof getCustomerAutopartWorkspaceFn>>, { ok: true }>["data"];
type Activity = Extract<Awaited<ReturnType<typeof listCustomerAutopartImportActivityFn>>, { ok: true }>["data"]["items"][number];

const STAGE_TONE: Record<AutopartStageState, Tone> = {
  COMPLETE: "good",
  ACTION_REQUIRED: "warn",
  UNDER_REVIEW: "info",
  NOT_STARTED: "neutral",
};

function scrollToAction(action: AutopartPrimaryAction) {
  const id =
    action === "verify"
      ? "autopart-account"
      : action === "import-history" || action === "review-exceptions"
        ? "autopart-history"
        : action === "import-current"
          ? "autopart-current"
          : "autopart-enquiry";
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function CustomerAutopartWorkspace({
  companyId,
  onOpenOverview,
}: {
  companyId: string;
  onOpenOverview: () => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [detailFilter, setDetailFilter] = useState("ALL");
  const [details, setDetails] = useState<Extract<Awaited<ReturnType<typeof listCustomerAutopartImportDetailsFn>>, { ok: true }>["data"] | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);

  async function reload() {
    const [snapshot, runs] = await Promise.all([
      getCustomerAutopartWorkspaceFn({ data: { companyId } }),
      listCustomerAutopartImportActivityFn({ data: { companyId } }),
    ]);
    if (!snapshot.ok) {
      setError(snapshot.error);
      setWorkspace(null);
      return;
    }
    setError(null);
    setWorkspace(snapshot.data);
    setActivity(runs.ok ? runs.data.items : []);
  }

  useEffect(() => {
    void reload();
  }, [companyId]);

  if (error) return <p className="text-[13px] text-bad">{error}</p>;
  if (!workspace) return <p className="text-[13px] text-steel">Loading customer sales position…</p>;

  const statusTone: Tone =
    workspace.company.status === "ACTIVE"
      ? "good"
      : workspace.company.status === "SUSPENDED" || workspace.company.status === "ON_HOLD" || workspace.company.status === "CLOSED"
        ? "warn"
        : "brand";
  const enquiryHref = `/sales/sales-intelligence?mode=customers&period=ALL&companyId=${encodeURIComponent(companyId)}${
    workspace.salesAccount.code ? `&accountCode=${encodeURIComponent(workspace.salesAccount.code)}` : ""
  }`;
  const coverage =
    workspace.history.kind === "NO_HISTORICAL_SALES"
      ? "Recorded as having no historical purchases."
      : workspace.history.kind === "PRELAUNCH_HISTORY_DISCARDED"
        ? "Recorded from a new sales baseline."
        : workspace.coverage.productLineCount > 0 || workspace.coverage.documentCount > 0
          ? `${workspace.coverage.productLineCount} product ${workspace.coverage.productLineCount === 1 ? "line" : "lines"} and ${workspace.coverage.documentCount} ${workspace.coverage.documentCount === 1 ? "document" : "documents"} are stored${
              workspace.history.from ? ` from ${workspace.history.from} to ${workspace.history.to ?? workspace.history.from}` : ""
            }.`
          : "No imported sales are stored for this customer yet.";

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg uppercase">{workspace.company.name}</h2>
            <p className="mt-1 text-[13px] text-steel">
              {workspace.company.accountNumber ? `Customer number ${workspace.company.accountNumber}` : "Customer number not set"}
            </p>
          </div>
          <StatusBadge tone={statusTone}>{companyStatusLabel(workspace.company.status)}</StatusBadge>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryItem label="Verified sales account" value={workspace.salesAccount.verified ? workspace.salesAccount.code ?? "—" : "Not verified"} />
          <SummaryItem
            label="407EXP master"
            value={workspace.master.restricted ? "Hidden" : workspace.master.linked ? "Linked" : "Not linked"}
          />
          <SummaryItem label="Historical sales" value={workspace.history.label} />
          <SummaryItem
            label="Historical sales covered through"
            value={workspace.history.coveredThrough ?? workspace.history.to ?? "—"}
          />
        </dl>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryItem
            label="Automatic polling"
            value={workspace.ongoing.pollingEnabled || workspace.automaticImportEnabled ? "Enabled" : "Disabled"}
          />
          <div className="text-[13px]">
            <dt className="text-steel">Latest successful 504</dt>
            <dd>
              {workspace.ongoing.latest504At ? (
                <InstantText value={workspace.ongoing.latest504At} variant="audit" />
              ) : (
                "None yet"
              )}
            </dd>
          </div>
          <div className="text-[13px]">
            <dt className="text-steel">Latest successful TRM21QC</dt>
            <dd>
              {workspace.ongoing.latestTrm21qcAt ? (
                <InstantText value={workspace.ongoing.latestTrm21qcAt} variant="audit" />
              ) : (
                "None yet"
              )}
            </dd>
          </div>
          <div className="text-[13px]">
            <dt className="text-steel">Outstanding import issues</dt>
            <dd>{workspace.ongoing.outstandingIssue ?? "None"}</dd>
          </div>
        </dl>
        {workspace.ongoing.companionNote ? (
          <p className="mt-3 text-[13px] text-steel">{workspace.ongoing.companionNote}</p>
        ) : null}
        <p className="mt-3 max-w-3xl text-[12px] text-steel">
          The verified sales account is the code used for this customer's files. The 407EXP master is a
          separate customer-list link. One can be present without the other. Historical coverage dates
          are not the same as ongoing 504/TRM21QC freshness.
          {workspace.salesAccount.ownershipNote ? ` ${workspace.salesAccount.ownershipNote}` : ""}
        </p>
      </section>

      <section className="rounded-lg border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base uppercase">Sales setup</h2>
          <div className="flex flex-wrap items-center gap-2">
            {workspace.primaryAction === "activate" ? (
              <button type="button" className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground" onClick={onOpenOverview}>
                {autopartPrimaryActionLabel(workspace.primaryAction)}
              </button>
            ) : workspace.primaryAction === "view-enquiry" ? (
              <>
                <a href={enquiryHref} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground">
                  {autopartPrimaryActionLabel(workspace.primaryAction)}
                </a>
                <button
                  type="button"
                  className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
                  onClick={() => scrollToAction("import-current")}
                >
                  {autopartPrimaryActionLabel("import-current")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
                onClick={() => {
                  if (workspace.primaryAction === "verify") setAccountsOpen(true);
                  scrollToAction(workspace.primaryAction);
                }}
              >
                {autopartPrimaryActionLabel(workspace.primaryAction)}
              </button>
            )}
          </div>
        </div>
        <ol className="mt-4 grid gap-2 lg:grid-cols-5">
          {workspace.stages.map((stage, index) => (
            <li key={stage.id} className="rounded-md border border-border px-3 py-2">
              <div className="text-[11px] text-steel">{index + 1}</div>
              <div className="mt-1 text-[13px] font-semibold">{stage.label}</div>
              <div className="mt-2">
                <StatusBadge tone={STAGE_TONE[stage.state]}>{autopartStageStateLabel(stage.state)}</StatusBadge>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <AutopartHistoryImport
        companyId={companyId}
        canImport={workspace.canImport}
        blocked={
          workspace.salesAccount.ownershipAmbiguous
            ? "This sales account is also connected to another customer. Resolve that before importing history."
            : !workspace.salesAccount.verified
              ? "Verify the sales account before importing history. A 407EXP master link is not required."
              : workspace.company.status !== "ACTIVE"
                ? "Activate the customer before importing history."
                : null
        }
        historyStatus={workspace.history.status}
        historyKind={workspace.history.kind}
        onChanged={reload}
      />
      <AutopartRecentSales
        companyId={companyId}
        canImport={workspace.canImport}
        accountCode={workspace.salesAccount.code}
        aliases={workspace.salesAccount.aliases}
        historyStatus={workspace.history.status}
        companyStatus={workspace.company.status}
        verified={workspace.salesAccount.verified}
        automaticImportEnabled={workspace.ongoing.pollingEnabled || workspace.automaticImportEnabled}
        outstandingIssue={workspace.ongoing.outstandingIssue}
        companionNote={workspace.ongoing.companionNote}
        onChanged={reload}
      />

      <section id="autopart-enquiry" className="rounded-lg border border-border p-4 sm:p-5">
        <h2 className="font-display text-base uppercase">Sales Enquiry</h2>
        <p className="mt-2 max-w-3xl text-[13px] text-steel">{coverage}</p>
        <a href={enquiryHref} className="mt-3 inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase">
          Open Sales Enquiry
        </a>
      </section>

      <section className="rounded-lg border border-border p-4 sm:p-5">
        <h2 className="font-display text-base uppercase">Import activity</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-[13px] text-steel">No saved imports for this customer.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="text-[11px] uppercase text-steel">
                <tr>
                  {["File", "Type", "By", "When", "Status", "New", "Updated", "Skipped", ""].map((heading) => (
                    <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activity.map((run) => (
                  <tr key={run.id} className="border-t border-border/60">
                    <td className="py-2 pr-3">{run.filename}</td>
                    <td className="py-2 pr-3">{importTypeLabel(run.type)}</td>
                    <td className="py-2 pr-3">{run.importedBy}</td>
                    <td className="py-2 pr-3"><InstantText value={run.at} variant="audit" /></td>
                    <td className="py-2 pr-3">{importStatusLabel(run.status)}</td>
                    <td className="py-2 pr-3">{run.imported}</td>
                    <td className="py-2 pr-3">{run.updated}</td>
                    <td className="py-2 pr-3">{run.skipped}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="font-semibold uppercase"
                        onClick={() => {
                          setOpenRun(run.id);
                          setDetailFilter("ALL");
                          void listCustomerAutopartImportDetailsFn({ data: { companyId, runId: run.id, filter: "ALL" } }).then((result) => {
                            if (!result.ok) toast.error(result.error);
                            else setDetails(result.data);
                          });
                        }}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openRun && details ? (
          <div className="mt-4 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold">Import details</h3>
              <button type="button" className="text-[12px] font-semibold uppercase" onClick={() => { setOpenRun(null); setDetails(null); }}>
                Close
              </button>
            </div>
            {details.hasRowDiagnostics ? (
              <div className="mt-3 overflow-x-auto">
                <div className="mb-2 flex flex-wrap gap-2">
                  {(["ALL", "REJECTED", "SKIPPED"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`h-8 rounded-md border px-2 text-[11px] font-semibold uppercase ${detailFilter === value ? "border-primary text-foreground" : "border-border text-steel"}`}
                      onClick={() => {
                        setDetailFilter(value);
                        void listCustomerAutopartImportDetailsFn({ data: { companyId, runId: openRun, filter: value } }).then((result) => {
                          if (!result.ok) toast.error(result.error);
                          else setDetails(result.data);
                        });
                      }}
                    >
                      {value === "ALL" ? "View all" : value === "REJECTED" ? "Rejected" : "Skipped"}
                    </button>
                  ))}
                </div>
                {details.items.length === 0 ? (
                  <p className="text-[13px] text-steel">No rows in this filter.</p>
                ) : (
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead className="text-[11px] uppercase text-steel">
                      <tr>
                        {["Row", "Document", "Account", "Result", "Reason"].map((heading) => (
                          <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {details.items.map((item) => (
                        <tr key={item.id} className="border-t border-border/60">
                          <td className="py-2 pr-3">{item.rowNumber ?? "—"}</td>
                          <td className="py-2 pr-3 font-mono">{item.documentReference || "—"}</td>
                          <td className="py-2 pr-3 font-mono">{item.customerAccount || "—"}</td>
                          <td className="py-2 pr-3">{item.status === "ERROR" ? "Rejected" : item.status === "SKIPPED" ? "Skipped" : item.status === "INSERTED" ? "New" : item.status === "UPDATED" ? "Updated" : item.status}</td>
                          <td className="py-2 pr-3">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {detailFilter === "ALL" && details.total > details.items.length ? (
                  <p className="mt-2 text-[12px] text-steel">Showing {details.items.length} of {details.total} stored rows.</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-steel">
                {details.storedIssue ?? "This import did not keep a row-by-row list. Nothing has been reconstructed."}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <AccountMapping
        companyId={companyId}
        workspace={workspace}
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        onChanged={reload}
      />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-border/70 px-3 py-2">
      <dt className="text-[11px] uppercase text-steel">{label}</dt>
      <dd className="mt-1 text-[13px] font-semibold">{value || "—"}</dd>
    </div>
  );
}

function importTypeLabel(type: string): string {
  if (type === "HISTORY_561L_SLRB") return "Sales history";
  if (type === "ONGOING_504") return "Invoices and credits";
  if (type === "ONGOING_TRM21QC") return "Product sales";
  return type;
}

function importStatusLabel(status: string): string {
  if (status === "COMMITTED") return "Saved";
  if (status === "FAILED") return "Failed";
  if (status === "BLOCKED") return "Blocked";
  if (status === "PROCESSING") return "In progress";
  return status;
}

function AccountMapping({
  companyId,
  workspace,
  open,
  onOpenChange,
  onChanged,
}: {
  companyId: string;
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [code, setCode] = useState(workspace.salesAccount.code ?? "");
  const [accounts, setAccounts] = useState<Array<{ accountCode: string; kind: string; verified?: boolean }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCode(workspace.salesAccount.code ?? "");
  }, [workspace.salesAccount.code]);

  useEffect(() => {
    if (!open) return;
    void listCompanyAutopartAccountsFn({ data: { companyId } }).then((result) => {
      if (result.ok) setAccounts(result.data.accounts);
    });
  }, [open, companyId, workspace.salesAccount.code, workspace.salesAccount.verified]);

  return (
    <section id="autopart-account" className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span>
          <span className="block font-display text-base uppercase">Account mapping</span>
          <span className="mt-1 block text-[12px] text-steel">
            Sales account {workspace.salesAccount.code ?? "not set"}
            {workspace.salesAccount.verified ? " · verified" : " · not verified"}
            {" · "}
            407EXP {workspace.master.linked ? "linked" : "not linked"}
          </span>
        </span>
        <span className="text-[12px] font-semibold uppercase">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:px-5">
          <p className="max-w-3xl text-[13px] text-steel">
            Verify the sales account when this customer's files should use that code. Link a 407EXP
            master only when the customer-list record should be attached. A missing master link does
            not block sales import once the sales account is uniquely verified.
          </p>
          {workspace.salesAccount.ownershipNote ? (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">{workspace.salesAccount.ownershipNote}</p>
          ) : null}
          <label className="grid max-w-sm gap-1 text-[12px] font-semibold">
            Sales account code
            <input value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} autoComplete="off" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
              onClick={() => {
                setSaving(true);
                void setCompanyAutopartCustomerCodeFn({ data: { companyId, code: code.trim() ? code : null } }).then(async (result) => {
                  setSaving(false);
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(result.data.code ? "Sales account saved" : "Sales account cleared");
                    await onChanged();
                  }
                });
              }}
            >
              Save code
            </button>
            <button
              type="button"
              disabled={saving}
              className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
              onClick={() => {
                setSaving(true);
                void verifyCompanyAutopartCustomerCodeFn({ data: { companyId } }).then(async (result) => {
                  setSaving(false);
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success("Sales account verified");
                    await onChanged();
                  }
                });
              }}
            >
              Verify account
            </button>
            <button
              type="button"
              disabled={saving}
              className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
              onClick={() => {
                setSaving(true);
                void clearCompanyAutopartCustomerCodeFn({ data: { companyId } }).then(async (result) => {
                  setSaving(false);
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success("Sales account cleared");
                    await onChanged();
                  }
                });
              }}
            >
              Clear
            </button>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold">Mapped accounts</h3>
            {accounts.length === 0 ? (
              <p className="mt-2 text-[13px] text-steel">No mapped accounts yet.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {accounts.map((account) => (
                  <li key={`${account.kind}-${account.accountCode}`} className="flex flex-wrap items-center justify-between gap-2 border border-border px-3 py-2 text-[13px]">
                    <span>
                      <span className="font-mono font-semibold">{account.accountCode}</span>
                      <span className="ml-2 text-steel">{account.kind}{account.verified ? " · verified" : ""}</span>
                    </span>
                    {account.kind === "ALIAS" ? (
                      <button
                        type="button"
                        className="text-[12px] font-semibold uppercase"
                        onClick={() => {
                          void unmapAutopartCustomerAccountFn({ data: { companyId, accountCode: account.accountCode } }).then(async (result) => {
                            if (!result.ok) toast.error(result.error);
                            else {
                              toast.success("Account removed");
                              await onChanged();
                            }
                          });
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-[13px] font-semibold">407EXP master</h3>
            {workspace.master.restricted ? (
              <p className="mt-2 text-[13px] text-steel">You do not have access to the customer master list.</p>
            ) : workspace.master.accounts.length === 0 ? (
              <p className="mt-2 text-[13px] text-steel">No 407EXP master account is linked. The verified sales account can still be used.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {workspace.master.accounts.map((account) => (
                  <li key={account.id} className="border border-border px-3 py-2 text-[13px]">
                    <div className="font-mono font-semibold">{account.code}</div>
                    <div>{account.name || "—"}</div>
                    <div className="text-[12px] text-steel">Area {account.areaCode || "—"} · Rep {account.repCode || "—"}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
