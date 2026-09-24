import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { InstantText } from "@/components/ab/InstantText";
import {
  BUSINESS_TYPES,
  ESTIMATED_SPEND_RANGES,
  EXISTING_ACCOUNT_CLAIMS,
  HOW_HEARD_OPTIONS,
} from "@/domain/trade-application";
import { ROUTES } from "@/lib/app-nav";
import {
  approveTradeApplicationFn,
  deleteTradeApplicationFn,
  getTradeApplicationFn,
  listPriceListsFn,
  listSalesRepsFn,
  listTradeApplicationsFn,
  markTradeApplicationUnderReviewFn,
  rejectTradeApplicationFn,
  requestTradeApplicationMoreInfoFn,
  updateTradeApplicationDetailsFn,
  withdrawTradeApplicationFn,
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
  "WITHDRAWN",
] as const;

const actionBtn =
  "h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40";

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

type EditForm = {
  companyName: string;
  tradingName: string;
  companyNumber: string;
  vatNumber: string;
  businessType: string;
  businessTypeOther: string;
  website: string;
  line1: string;
  line2: string;
  town: string;
  county: string;
  postcode: string;
  country: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  existingAccountClaim: string;
  claimedAutopartCustomerCode: string;
  estimatedSpend: string;
  howHeardAboutUs: string;
  brandsInterest: string;
  notes: string;
};

function detailToEditForm(detail: Detail): EditForm {
  const storedType = detail.businessType ?? "Motor Factor";
  const otherMatch = storedType.match(/^Other\s*[—-]\s*(.+)$/i);
  return {
    companyName: detail.companyName ?? "",
    tradingName: detail.tradingName ?? "",
    companyNumber: detail.companyNumber ?? "",
    vatNumber: detail.vatNumber ?? "",
    businessType: otherMatch ? "Other" : (BUSINESS_TYPES as readonly string[]).includes(storedType)
      ? storedType
      : "Other",
    businessTypeOther: otherMatch?.[1] ?? (otherMatch ? "" : storedType.startsWith("Other") ? "" : ""),
    website: detail.website ?? "",
    line1: detail.tradingAddress?.line1 ?? "",
    line2: detail.tradingAddress?.line2 ?? "",
    town: detail.tradingAddress?.town ?? "",
    county: detail.tradingAddress?.county ?? "",
    postcode: detail.tradingAddress?.postcode ?? "",
    country: detail.tradingAddress?.country ?? "GB",
    firstName: detail.primaryContact?.firstName ?? "",
    lastName: detail.primaryContact?.lastName ?? "",
    role: detail.primaryContact?.role ?? "",
    email: detail.primaryContact?.email ?? "",
    phone: detail.primaryContact?.phone ?? "",
    existingAccountClaim: detail.existingAccountClaim ?? "no",
    claimedAutopartCustomerCode: detail.claimedAutopartCustomerCode ?? "",
    estimatedSpend: detail.estimatedSpend ?? "",
    howHeardAboutUs: detail.howHeardAboutUs ?? "",
    brandsInterest: (detail.brandsInterest ?? []).join(", "),
    notes: detail.notes ?? "",
  };
}

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
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

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
      setEditing(false);
      setEditForm(null);
      return;
    }
    void getTradeApplicationFn({ data: { id: selected } }).then((r) => {
      if (r.ok) {
        const next = r.data as Detail;
        setDetail(next);
        setReviewNotes(next.reviewNotes ?? "");
        setCustomerMessage(next.customerMessage ?? "");
        setConfirmExistingUserLink(false);
        setEditing(false);
        setEditForm(detailToEditForm(next));
      }
    });
  }, [selected]);

  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const review = rows.filter((r) => r.status === "UNDER_REVIEW").length;
  const open =
    detail &&
    detail.status !== "APPROVED" &&
    detail.status !== "REJECTED" &&
    detail.status !== "WITHDRAWN";

  async function refreshDetail(id: string) {
    const d = await getTradeApplicationFn({ data: { id } });
    if (d.ok) {
      const next = d.data as Detail;
      setDetail(next);
      setEditForm(detailToEditForm(next));
      setReviewNotes(next.reviewNotes ?? "");
      setCustomerMessage(next.customerMessage ?? "");
    }
    await load();
  }

  async function runAction(label: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-display text-xl uppercase">{detail.companyName}</div>
                  <div className="num mt-1 text-steel">{detail.reference}</div>
                  <div className="mt-2">
                    <StatusBadge>{detail.status.replaceAll("_", " ")}</StatusBadge>
                  </div>
                </div>
                {open ? (
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
                    onClick={() => {
                      if (!editing) setEditForm(detailToEditForm(detail));
                      setEditing((value) => !value);
                    }}
                  >
                    {editing ? "Cancel edit" : "Edit details"}
                  </button>
                ) : null}
              </div>

              {editing && editForm && open ? (
                <form
                  className="grid gap-3 border-t border-border/50 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction("Save details", async () => {
                      const r = await updateTradeApplicationDetailsFn({
                        data: {
                          id: detail.id,
                          companyName: editForm.companyName,
                          tradingName: editForm.tradingName || null,
                          companyNumber: editForm.companyNumber || null,
                          vatNumber: editForm.vatNumber || null,
                          businessType: editForm.businessType,
                          businessTypeOther: editForm.businessTypeOther || null,
                          website: editForm.website || null,
                          tradingAddress: {
                            line1: editForm.line1,
                            line2: editForm.line2 || null,
                            town: editForm.town,
                            county: editForm.county || null,
                            postcode: editForm.postcode,
                            country: editForm.country || "GB",
                          },
                          primaryContact: {
                            firstName: editForm.firstName,
                            lastName: editForm.lastName,
                            role: editForm.role || null,
                            email: editForm.email,
                            phone: editForm.phone,
                          },
                          existingAccountClaim: editForm.existingAccountClaim,
                          claimedAutopartCustomerCode: editForm.claimedAutopartCustomerCode || null,
                          estimatedSpend: editForm.estimatedSpend || null,
                          howHeardAboutUs: editForm.howHeardAboutUs || null,
                          brandsInterest: editForm.brandsInterest
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                          notes: editForm.notes || null,
                        },
                      });
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Application details saved");
                      setEditing(false);
                      await refreshDetail(detail.id);
                    });
                  }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">
                    Edit submitted details
                  </div>
                  <Field label="Legal / company name">
                    <input required className={inputClass} value={editForm.companyName} onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })} />
                  </Field>
                  <Field label="Trading name">
                    <input className={inputClass} value={editForm.tradingName} onChange={(e) => setEditForm({ ...editForm, tradingName: e.target.value })} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Company number">
                      <input className={inputClass} value={editForm.companyNumber} onChange={(e) => setEditForm({ ...editForm, companyNumber: e.target.value })} />
                    </Field>
                    <Field label="VAT">
                      <input className={inputClass} value={editForm.vatNumber} onChange={(e) => setEditForm({ ...editForm, vatNumber: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Business type">
                    <select className={inputClass} value={editForm.businessType} onChange={(e) => setEditForm({ ...editForm, businessType: e.target.value })}>
                      {BUSINESS_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  {editForm.businessType === "Other" ? (
                    <Field label="Business type (other)">
                      <input className={inputClass} value={editForm.businessTypeOther} onChange={(e) => setEditForm({ ...editForm, businessTypeOther: e.target.value })} />
                    </Field>
                  ) : null}
                  <Field label="Website">
                    <input className={inputClass} value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="First name">
                      <input required className={inputClass} value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                    </Field>
                    <Field label="Last name">
                      <input required className={inputClass} value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Job title">
                    <input className={inputClass} value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <input required type="email" className={inputClass} value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  </Field>
                  <Field label="Telephone">
                    <input required className={inputClass} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </Field>
                  <Field label="Address line 1">
                    <input required className={inputClass} value={editForm.line1} onChange={(e) => setEditForm({ ...editForm, line1: e.target.value })} />
                  </Field>
                  <Field label="Address line 2">
                    <input className={inputClass} value={editForm.line2} onChange={(e) => setEditForm({ ...editForm, line2: e.target.value })} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Town">
                      <input required className={inputClass} value={editForm.town} onChange={(e) => setEditForm({ ...editForm, town: e.target.value })} />
                    </Field>
                    <Field label="Postcode">
                      <input required className={inputClass} value={editForm.postcode} onChange={(e) => setEditForm({ ...editForm, postcode: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="County">
                    <input className={inputClass} value={editForm.county} onChange={(e) => setEditForm({ ...editForm, county: e.target.value })} />
                  </Field>
                  <Field label="Existing account claim">
                    <select className={inputClass} value={editForm.existingAccountClaim} onChange={(e) => setEditForm({ ...editForm, existingAccountClaim: e.target.value })}>
                      {EXISTING_ACCOUNT_CLAIMS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Claimed Autopart account">
                    <input className={inputClass} value={editForm.claimedAutopartCustomerCode} onChange={(e) => setEditForm({ ...editForm, claimedAutopartCustomerCode: e.target.value })} />
                  </Field>
                  <Field label="Estimated spend">
                    <select className={inputClass} value={editForm.estimatedSpend} onChange={(e) => setEditForm({ ...editForm, estimatedSpend: e.target.value })}>
                      <option value="">—</option>
                      {ESTIMATED_SPEND_RANGES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="How heard">
                    <select className={inputClass} value={editForm.howHeardAboutUs} onChange={(e) => setEditForm({ ...editForm, howHeardAboutUs: e.target.value })}>
                      <option value="">—</option>
                      {HOW_HEARD_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Brands interest (comma-separated)">
                    <input className={inputClass} value={editForm.brandsInterest} onChange={(e) => setEditForm({ ...editForm, brandsInterest: e.target.value })} />
                  </Field>
                  <Field label="Applicant notes">
                    <textarea className={inputClass} rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
                  </Field>
                  <button type="submit" disabled={busy} className="h-10 rounded-md bg-primary px-4 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-40">
                    Save details
                  </button>
                </form>
              ) : (
                <>
                  <ReviewBlock title="Business details">
                    <Row label="Trading name" value={detail.tradingName} />
                    <Row label="Company number" value={detail.companyNumber} />
                    <Row label="VAT" value={detail.vatNumber} />
                    <Row label="Business type" value={detail.businessType} />
                    <Row label="Website" value={detail.website} />
                  </ReviewBlock>
                  <ReviewBlock title="Contact">
                    <Row label="Name" value={`${detail.primaryContact?.firstName ?? ""} ${detail.primaryContact?.lastName ?? ""}`.trim()} />
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
                    <Row label="Brands interest" value={(detail.brandsInterest ?? []).join(", ") || "—"} />
                    <Row label="Notes" value={detail.notes} />
                  </ReviewBlock>
                </>
              )}

              {(detail.possibleDuplicates?.length || detail.identityWarnings?.length) ? (
                <ReviewBlock title="Duplicate / match warnings">
                  {detail.identityWarnings?.map((w) => (
                    <div key={w.code} className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
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
                    <select className={inputClass} value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Price list">
                    <select className={inputClass} value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
                      <option value="">Assign later</option>
                      {priceLists.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payment terms">
                    <input className={inputClass} placeholder="e.g. 30 days" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
                  </Field>
                  <Field label="Internal notes (required to reject)">
                    <textarea className={inputClass} rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
                  </Field>
                  <Field label="Customer-facing message (required to request info)">
                    <textarea className={inputClass} rows={3} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} />
                  </Field>
                  <p className="text-[12px] text-steel">
                    Request info needs a customer message. Reject needs internal notes. Under review and Approve
                    work without those fields.
                  </p>
                  {detail.identityWarnings?.length ? (
                    <label className="flex items-start gap-2 text-[12px] text-steel">
                      <input type="checkbox" checked={confirmExistingUserLink} onChange={(e) => setConfirmExistingUserLink(e.target.checked)} />
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
                  <code className="mt-2 block break-all rounded bg-ink/50 p-2 text-[11px]">{activationPath}</code>
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
                    className={actionBtn}
                    onClick={() =>
                      void runAction("Under review", async () => {
                        const r = await markTradeApplicationUnderReviewFn({ data: { id: detail.id } });
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success(r.data.already ? "Already under review" : "Marked under review");
                          await refreshDetail(detail.id);
                        }
                      })
                    }
                  >
                    Under review
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={actionBtn}
                    onClick={() =>
                      void runAction("Request info", async () => {
                        if (!customerMessage.trim()) {
                          toast.error("Add a customer-facing message before requesting info");
                          return;
                        }
                        const r = await requestTradeApplicationMoreInfoFn({
                          data: {
                            id: detail.id,
                            customerMessage,
                            reviewNotes: reviewNotes || null,
                          },
                        });
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success(
                            r.data.emailDeferred
                              ? "More information requested (email not sent — deferred)"
                              : "More information requested",
                          );
                          await refreshDetail(detail.id);
                        }
                      })
                    }
                  >
                    Request info
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md bg-good px-4 text-[11px] font-bold uppercase text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void runAction("Approve", async () => {
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
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md border border-bad/50 px-4 text-[11px] font-bold uppercase text-bad disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      void runAction("Reject", async () => {
                        if (!reviewNotes.trim()) {
                          toast.error("Add internal notes before rejecting");
                          return;
                        }
                        const r = await rejectTradeApplicationFn({
                          data: {
                            id: detail.id,
                            reviewNotes,
                            customerMessage: customerMessage || null,
                          },
                        });
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("Application rejected");
                          await refreshDetail(detail.id);
                        }
                      })
                    }
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md border border-bad px-4 text-[11px] font-bold uppercase text-bad disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </button>
                </div>
              ) : detail.status !== "APPROVED" ? (
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    className="h-10 rounded-md border border-bad px-4 text-[11px] font-bold uppercase text-bad disabled:opacity-40"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}

              <ConfirmAction
                open={deleteOpen}
                title={detail.companyId ? "Withdraw this application?" : "Delete this application?"}
                description={
                  detail.companyId
                    ? "This application is linked to a customer, so it will be withdrawn (soft-deleted) rather than permanently removed."
                    : "Permanently delete this unlinked application? This cannot be undone."
                }
                confirmLabel={detail.companyId ? "Withdraw" : "Delete"}
                onOpenChange={setDeleteOpen}
                onConfirm={() => {
                  void runAction("Delete application", async () => {
                    if (detail.companyId) {
                      const r = await withdrawTradeApplicationFn({
                        data: { id: detail.id, reviewNotes: reviewNotes || null },
                      });
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Application withdrawn");
                    } else {
                      const r = await deleteTradeApplicationFn({ data: { id: detail.id } });
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Application deleted");
                      setSelected(null);
                      setDetail(null);
                    }
                    setDeleteOpen(false);
                    await load();
                  });
                }}
              />

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
