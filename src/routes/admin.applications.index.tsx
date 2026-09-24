import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { InstantText } from "@/components/ab/InstantText";
import { ROUTES } from "@/lib/app-nav";
import {
  approveTradeApplicationFn,
  getTradeApplicationFn,
  listPriceListsFn,
  listSalesRepsFn,
  listTradeApplicationsFn,
  markTradeApplicationUnderReviewFn,
  rejectTradeApplicationFn,
  requestTradeApplicationMoreInfoFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/applications/")({
  head: () => ({
    meta: [{ title: "Trade Applications — Automotive Brands Admin" }],
  }),
  component: ApplicationsPage,
});

const filters = [
  "ALL",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
] as const;

type Row = {
  id: string;
  reference: string;
  status: string;
  companyName: string;
  businessType: string | null;
  contactEmail: string;
  applicantName: string;
  submittedAt: string;
  companyId: string | null;
  claimedAutopartCustomerCode: string | null;
  hasClaimedAccount: boolean;
  assignedRepName: string | null;
};

type Detail = {
  id: string;
  reference: string;
  status: string;
  companyName: string;
  tradingName?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  businessType?: string | null;
  website?: string | null;
  primaryContact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    role?: string;
  } | null;
  tradingAddress?: {
    line1?: string;
    line2?: string | null;
    town?: string;
    county?: string | null;
    postcode?: string;
    country?: string;
  } | null;
  brandsInterest?: string[];
  notes?: string | null;
  estimatedSpend?: string | null;
  howHeardAboutUs?: string | null;
  existingAccountClaim?: string | null;
  claimedAutopartCustomerCode?: string | null;
  customerMessage?: string | null;
  reviewNotes?: string | null;
  companyId?: string | null;
  company?: {
    id: string;
    name: string;
    autopartCustomerCode?: string | null;
    priceListId?: string | null;
    paymentTerms?: string | null;
  } | null;
  identityWarnings?: Array<{ code: string; message: string }>;
  possibleDuplicates?: Array<{
    id: string;
    reference: string;
    status: string;
    companyName: string;
    matchReasons: string[];
  }>;
  consentAcceptedAt?: string | null;
};

function ApplicationsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("ALL");
  const [q, setQ] = useState("");
  const [existingAccount, setExistingAccount] = useState<"all" | "claimed" | "none">("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [priceLists, setPriceLists] = useState<Array<{ id: string; name: string }>>([]);
  const [salesRepId, setSalesRepId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [confirmExistingUserLink, setConfirmExistingUserLink] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [activationPath, setActivationPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const r = await listTradeApplicationsFn({
      data: {
        status: filter,
        q: q || undefined,
        existingAccount: existingAccount === "all" ? undefined : existingAccount,
      },
    });
    if (r.ok) setRows(r.data as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, existingAccount]);

  useEffect(() => {
    void listSalesRepsFn().then((r) => {
      if (r.ok) setReps(r.data.map((x: { id: string; label: string }) => ({ id: x.id, label: x.label })));
    });
    void listPriceListsFn().then((r) => {
      if (r.ok) {
        setPriceLists(
          r.data.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setInviteToken(null);
      setActivationPath(null);
      return;
    }
    void getTradeApplicationFn({ data: { id: selected } }).then((r) => {
      if (r.ok) {
        setDetail(r.data as Detail);
        setReviewNotes((r.data as Detail).reviewNotes ?? "");
        setCustomerMessage((r.data as Detail).customerMessage ?? "");
        setConfirmExistingUserLink(false);
      }
    });
  }, [selected]);

  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const review = rows.filter((r) => r.status === "UNDER_REVIEW").length;
  const open = detail && detail.status !== "APPROVED" && detail.status !== "REJECTED";

  async function refreshDetail(id: string) {
    const d = await getTradeApplicationFn({ data: { id } });
    if (d.ok) setDetail(d.data as Detail);
    await load();
  }

  return (
    <div>
      <PanelHeader
        title="Trade applications"
        sub="Review, configure and approve new trade accounts"
        crumbs={[{ label: "Sales" }, { label: "Trade Applications", to: ROUTES.adminApplications }]}
      />
      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Metric label="In queue" value={String(rows.length)} />
        <Metric label="New / submitted" value={String(submitted)} tone="brand" />
        <Metric label="Under review" value={String(review)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "h-9 rounded-md border px-3 text-[12px] font-semibold",
              filter === f ? "border-primary bg-primary/10" : "border-border text-steel",
            )}
          >
            {f.replaceAll("_", " ")}
          </button>
        ))}
        <select
          className="h-9 rounded-md border border-border bg-ink px-2 text-[12px]"
          value={existingAccount}
          onChange={(e) => setExistingAccount(e.target.value as typeof existingAccount)}
          aria-label="Existing account filter"
        >
          <option value="all">All accounts</option>
          <option value="claimed">Claimed existing account</option>
          <option value="none">No claim</option>
        </select>
        <input
          className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-ink px-3 text-[13px] sm:max-w-xs"
          placeholder="Search company, email, reference…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
        />
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
          onClick={() => void load()}
        >
          Search
        </button>
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,460px)] sm:p-6">
        <div className="overflow-x-auto rounded-md border border-border">
          {loading ? (
            <div className="p-4 text-sm text-steel">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-steel">No applications in this filter</div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface/60 text-[11px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Company / applicant</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Claim</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "cursor-pointer border-b border-border/50 hover:bg-surface/40",
                      selected === r.id && "bg-primary/5",
                    )}
                    onClick={() => setSelected(r.id)}
                  >
                    <td className="num px-3 py-2 whitespace-nowrap">{r.reference}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.companyName}</div>
                      <div className="text-[12px] text-steel">
                        {r.applicantName || r.contactEmail}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-steel">{r.businessType ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.hasClaimedAccount ? (
                        <span className="num text-[12px] font-semibold text-primary">
                          {r.claimedAutopartCustomerCode}
                        </span>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          r.status === "APPROVED"
                            ? "good"
                            : r.status === "REJECTED"
                              ? "bad"
                              : "brand"
                        }
                      >
                        {r.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-steel">
                      <InstantText value={r.submittedAt} variant="date" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="border border-border bg-surface/40 p-4">
          {!detail ? (
            <p className="text-sm text-steel">Select an application to review</p>
          ) : (
            <div className="grid gap-4 text-[13px]">
              <div>
                <div className="font-display text-xl uppercase">{detail.companyName}</div>
                <div className="num mt-1 text-steel">{detail.reference}</div>
                <div className="mt-2">
                  <StatusBadge>{detail.status.replaceAll("_", " ")}</StatusBadge>
                </div>
              </div>

              <ReviewBlock title="Business details">
                <Row label="Trading name" value={detail.tradingName} />
                <Row label="Company number" value={detail.companyNumber} />
                <Row label="VAT" value={detail.vatNumber} />
                <Row label="Business type" value={detail.businessType} />
                <Row label="Website" value={detail.website} />
              </ReviewBlock>

              <ReviewBlock title="Contact">
                <Row
                  label="Name"
                  value={`${detail.primaryContact?.firstName ?? ""} ${detail.primaryContact?.lastName ?? ""}`.trim()}
                />
                <Row label="Job title" value={detail.primaryContact?.role} />
                <Row label="Email" value={detail.primaryContact?.email} />
                <Row label="Telephone" value={detail.primaryContact?.phone} />
              </ReviewBlock>

              <ReviewBlock title="Address">
                <Row label="Line 1" value={detail.tradingAddress?.line1} />
                <Row label="Line 2" value={detail.tradingAddress?.line2} />
                <Row label="Town" value={detail.tradingAddress?.town} />
                <Row label="County" value={detail.tradingAddress?.county} />
                <Row label="Postcode" value={detail.tradingAddress?.postcode} />
                <Row label="Country" value={detail.tradingAddress?.country} />
              </ReviewBlock>

              <ReviewBlock title="Existing account">
                <Row label="Claim" value={detail.existingAccountClaim ?? "—"} />
                {detail.claimedAutopartCustomerCode ? (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                      Claimed Autopart account — UNVERIFIED
                    </div>
                    <div className="num mt-1 font-semibold">{detail.claimedAutopartCustomerCode}</div>
                    <p className="mt-1 text-[12px] text-steel">
                      Claim only. Verify and link on the customer Commercial tab after approval —
                      never trust this value for pricing or access.
                    </p>
                  </div>
                ) : (
                  <p className="text-steel">No account number claimed.</p>
                )}
                {detail.company?.autopartCustomerCode ? (
                  <Row label="Verified on company" value={detail.company.autopartCustomerCode} />
                ) : null}
              </ReviewBlock>

              <ReviewBlock title="Trade information">
                <Row label="Estimated spend" value={detail.estimatedSpend} />
                <Row label="How heard" value={detail.howHeardAboutUs} />
                <Row
                  label="Brands interest"
                  value={(detail.brandsInterest ?? []).join(", ") || "—"}
                />
                <Row label="Notes" value={detail.notes} />
              </ReviewBlock>

              {(detail.possibleDuplicates?.length || detail.identityWarnings?.length) ? (
                <ReviewBlock title="Duplicate / match warnings">
                  {detail.identityWarnings?.map((w) => (
                    <div
                      key={w.code}
                      className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]"
                    >
                      <div className="font-semibold uppercase tracking-wide text-warn">Possible issue</div>
                      <p className="mt-1">{w.message}</p>
                    </div>
                  ))}
                  {detail.possibleDuplicates?.map((d) => (
                    <div key={d.id} className="rounded-md border border-border px-3 py-2 text-[12px]">
                      <div className="font-semibold">
                        Possible duplicate · {d.reference} · {d.companyName}
                      </div>
                      <div className="mt-1 text-steel">{d.matchReasons.join(" · ")}</div>
                    </div>
                  ))}
                </ReviewBlock>
              ) : null}

              {open ? (
                <ReviewBlock title="Internal commercial setup">
                  <Field label="Sales rep">
                    <select
                      className={inputClass}
                      value={salesRepId}
                      onChange={(e) => setSalesRepId(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Price list">
                    <select
                      className={inputClass}
                      value={priceListId}
                      onChange={(e) => setPriceListId(e.target.value)}
                    >
                      <option value="">Assign later</option>
                      {priceLists.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payment terms">
                    <input
                      className={inputClass}
                      placeholder="e.g. 30 days"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    />
                  </Field>
                  <Field label="Internal notes">
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                    />
                  </Field>
                  <Field label="Customer-facing message (more info / optional reject)">
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={customerMessage}
                      onChange={(e) => setCustomerMessage(e.target.value)}
                    />
                  </Field>
                  {detail.identityWarnings?.length ? (
                    <label className="flex items-start gap-2 text-[12px] text-steel">
                      <input
                        type="checkbox"
                        checked={confirmExistingUserLink}
                        onChange={(e) => setConfirmExistingUserLink(e.target.checked)}
                      />
                      I confirm linking despite the identity warnings above
                    </label>
                  ) : null}
                </ReviewBlock>
              ) : null}

              {inviteToken ? (
                <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-3 text-[12px]">
                  <div className="font-semibold uppercase tracking-wide">Activation (email deferred)</div>
                  <p className="mt-1 text-steel">
                    Outbound email is not configured. Copy the activation link for the applicant.
                  </p>
                  <code className="mt-2 block break-all rounded bg-ink/50 p-2 text-[11px]">
                    {activationPath}
                  </code>
                  <code className="mt-2 block break-all text-[11px] text-steel">Token: {inviteToken}</code>
                </div>
              ) : null}

              {detail.companyId ? (
                <Link
                  to="/admin/customers/$id"
                  params={{ id: detail.companyId }}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-border text-[12px] font-bold uppercase hover:border-steel"
                >
                  View customer
                </Link>
              ) : null}

              {open ? (
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await markTradeApplicationUnderReviewFn({ data: { id: detail.id } });
                        setBusy(false);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("Marked under review");
                          await refreshDetail(detail.id);
                        }
                      })();
                    }}
                  >
                    Under review
                  </button>
                  <button
                    type="button"
                    disabled={busy || !customerMessage.trim()}
                    className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await requestTradeApplicationMoreInfoFn({
                          data: {
                            id: detail.id,
                            customerMessage,
                            reviewNotes: reviewNotes || null,
                          },
                        });
                        setBusy(false);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success(
                            r.data.emailDeferred
                              ? "More information requested (email not sent — deferred)"
                              : "More information requested",
                          );
                          await refreshDetail(detail.id);
                        }
                      })();
                    }}
                  >
                    Request info
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md bg-good px-4 text-[11px] font-bold uppercase text-ink"
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await approveTradeApplicationFn({
                          data: {
                            id: detail.id,
                            reviewNotes: reviewNotes || null,
                            salesRepId: salesRepId || null,
                            priceListId: priceListId || null,
                            paymentTerms: paymentTerms || null,
                            confirmExistingUserLink,
                          },
                        });
                        setBusy(false);
                        if (!r.ok) {
                          toast.error(r.error);
                          return;
                        }
                        setInviteToken(r.data.inviteToken);
                        setActivationPath(r.data.activationPath);
                        toast.success(
                          r.data.created
                            ? "Approved — activation link ready (email deferred)"
                            : "Already approved (idempotent)",
                        );
                        await refreshDetail(detail.id);
                      })();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || !reviewNotes.trim()}
                    className="h-10 rounded-md border border-bad/50 px-4 text-[11px] font-bold uppercase text-bad"
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        const r = await rejectTradeApplicationFn({
                          data: {
                            id: detail.id,
                            reviewNotes,
                            customerMessage: customerMessage || null,
                          },
                        });
                        setBusy(false);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("Application rejected");
                          await refreshDetail(detail.id);
                        }
                      })();
                    }}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border/50 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <div className="text-steel">{label}</div>
      <div className="min-w-0 break-words">{value}</div>
    </div>
  );
}
