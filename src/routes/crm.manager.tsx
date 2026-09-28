import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Mail, Phone, Smartphone } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { MediaPicker } from "@/components/cms/MediaPicker";
import { ROUTES } from "@/lib/app-nav";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import {
  assignCompanyToSalesRepFn,
  createSalesRepFn,
  getSalesRepProfileFn,
  listLinkableUsersForSalesRepFn,
  listSalesRepProfilesFn,
  searchCompaniesForSalesAssignmentFn,
  unassignCompanyFromSalesRepFn,
  updateSalesRepProfileFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/crm/manager")({
  head: () => ({
    meta: [
      { title: "Sales Team — Automotive Brands" },
      {
        name: "description",
        content:
          "Manage sales representatives, customer assignments and customer-facing contact details.",
      },
      { property: "og:title", content: "Sales Team — Automotive Brands" },
    ],
  }),
  component: SalesTeamAdmin,
});

type ListItem = {
  id: string;
  code: string | null;
  active: boolean;
  customerContactEnabled: boolean;
  displayName: string | null;
  jobTitle: string | null;
  businessEmail: string | null;
  phone: string | null;
  mobile: string | null;
  resolvedName: string;
  resolvedJobTitle: string;
  resolvedEmail: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    roleLabels: string[];
  };
  photoSrc: string | null;
  customerCount: number;
  assignmentCount: number;
  openCallbackTasks: number;
  openQuotes: number;
  linkedTeamMember: { id: string; isPublic: boolean } | null;
};

type AssignedCompany = {
  assignmentId: string;
  companyId: string;
  companyName: string;
  accountNumber: string | null;
  status: string;
  isPrimary: boolean;
};

type Detail = ListItem & {
  photoMediaId: string | null;
  photoAlt: string | null;
  photoFocalX: number;
  photoFocalY: number;
  emailFallbackHint: string;
  customerPreview: {
    name: string;
    initials: string;
    jobTitle: string;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    photo: { src: string; alt: string; objectPosition: string } | null;
    mailtoHref: string | null;
    telHref: string | null;
    mobileTelHref: string | null;
    primaryContactHref: string | null;
    primaryContactLabel: string | null;
  } | null;
  assignments: AssignedCompany[];
};

type LinkableUser = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  roleLabels: string[];
};

type CompanyOption = {
  id: string;
  name: string;
  accountNumber: string | null;
  status: string;
  primarySalesRepId: string | null;
  primarySalesRepName: string | null;
};

function SalesTeamAdmin() {
  const session = useSession();
  const canEdit =
    session.signedIn &&
    (session.user.navPermissions.includes("users.manage") ||
      session.user.navPermissions.includes("admin.access"));

  const [rows, setRows] = useState<ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [customerContactEnabled, setCustomerContactEnabled] = useState(true);
  const [active, setActive] = useState(true);
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null);
  const [photoAlt, setPhotoAlt] = useState("");

  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [assigning, setAssigning] = useState(false);

  async function loadList() {
    setLoading(true);
    const result = await listSalesRepProfilesFn();
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error || "Could not load sales team");
      return;
    }
    setRows(result.data as ListItem[]);
  }

  async function loadDetail(id: string) {
    const result = await getSalesRepProfileFn({ data: { id } });
    if (!result.ok) {
      toast.error(result.error || "Could not load profile");
      return;
    }
    const d = result.data as Detail;
    setDetail(d);
    setDisplayName(d.displayName || "");
    setJobTitle(d.jobTitle || "");
    setBusinessEmail(d.businessEmail || "");
    setPhone(d.phone || "");
    setMobile(d.mobile || "");
    setCustomerContactEnabled(d.customerContactEnabled);
    setActive(d.active);
    setPhotoMediaId(d.photoMediaId);
    setPhotoAlt(d.photoAlt || "");
  }

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId]);

  useEffect(() => {
    if (!canEdit || companyQuery.trim().length < 2) {
      setCompanyOptions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        const result = await searchCompaniesForSalesAssignmentFn({
          data: { q: companyQuery.trim() },
        });
        if (result.ok) setCompanyOptions(result.data as CompanyOption[]);
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [companyQuery, canEdit]);

  async function onSave() {
    if (!detail) return;
    setSaving(true);
    const result = await updateSalesRepProfileFn({
      data: {
        id: detail.id,
        displayName,
        jobTitle,
        businessEmail,
        phone,
        mobile,
        customerContactEnabled,
        active,
        photoMediaId,
        photoAlt,
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error || "Could not save profile");
      return;
    }
    toast.success("Sales profile saved");
    setDetail(result.data as Detail);
    await loadList();
  }

  async function onAssign(companyId: string) {
    if (!detail) return;
    setAssigning(true);
    const result = await assignCompanyToSalesRepFn({
      data: { salesRepId: detail.id, companyId },
    });
    setAssigning(false);
    if (!result.ok) {
      toast.error(result.error || "Could not assign company");
      return;
    }
    toast.success("Company assigned");
    setDetail(result.data as Detail);
    setCompanyQuery("");
    setCompanyOptions([]);
    await loadList();
  }

  async function onUnassign(companyId: string) {
    if (!detail) return;
    setAssigning(true);
    const result = await unassignCompanyFromSalesRepFn({
      data: { salesRepId: detail.id, companyId },
    });
    setAssigning(false);
    if (!result.ok) {
      toast.error(result.error || "Could not remove assignment");
      return;
    }
    toast.success("Assignment removed");
    setDetail(result.data as Detail);
    await loadList();
  }

  const preview = detail?.customerPreview;

  return (
    <div>
      <PanelHeader
        title="Sales Team"
        sub="Manage sales representatives, customer assignments and customer-facing contact details."
        crumbs={[{ label: "Operations" }, { label: "Sales Team", to: ROUTES.crmManager }]}
        actions={
          canEdit ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Add sales representative
            </button>
          ) : null
        }
      />

      {!selectedId ? (
        <div className="p-4 sm:p-6">
          {loading ? (
            <p className="text-sm text-steel">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
              <h2 className="font-display text-xl font-semibold uppercase tracking-tight">
                No sales representatives
              </h2>
              <p className="mx-auto mt-2 max-w-md text-[14px] text-steel">
                Add your sales team to assign account managers to trade customers.
              </p>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
                >
                  Add sales representative
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Job title</th>
                    <th className="px-3 py-2.5 font-semibold">Email</th>
                    <th className="px-3 py-2.5 font-semibold">Telephone</th>
                    <th className="px-3 py-2.5 font-semibold">Mobile</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Customers</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Customer contact</th>
                    <th className="px-3 py-2.5 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.id}
                      className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          {row.photoSrc ? (
                            <img
                              src={row.photoSrc}
                              alt=""
                              className="size-8 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold">
                              {initials(row.resolvedName)}
                            </div>
                          )}
                          <span className="font-semibold">{row.resolvedName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-steel">{row.resolvedJobTitle}</td>
                      <td className="px-3 py-3">
                        {row.resolvedEmail ? (
                          <span className="truncate">{row.resolvedEmail}</span>
                        ) : (
                          <span className="text-steel">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{row.phone || <span className="text-steel">—</span>}</td>
                      <td className="px-3 py-3">{row.mobile || <span className="text-steel">—</span>}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">
                        {row.customerCount}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={row.active ? "good" : "neutral"}>
                          {row.active ? "Active" : "Inactive"}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={row.customerContactEnabled ? "good" : "warn"}>
                          {row.customerContactEnabled ? "Enabled" : "Off"}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className="text-[12px] font-bold uppercase tracking-wide text-primary hover:underline"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border p-4 sm:p-6">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-steel hover:text-foreground"
          >
            ← Back to sales team
          </button>

          {!detail ? (
            <p className="text-sm text-steel">Loading profile…</p>
          ) : (
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-8">
                <div>
                  <h2 className="font-display text-2xl font-semibold uppercase tracking-tight">
                    {detail.resolvedName}
                  </h2>
                  <p className="mt-1 text-[13px] text-steel">
                    {detail.resolvedJobTitle}
                    {detail.code ? ` · ${detail.code}` : ""}
                    {" · "}
                    {detail.customerCount} active customer
                    {detail.customerCount === 1 ? "" : "s"}
                    {detail.openCallbackTasks > 0
                      ? ` · ${detail.openCallbackTasks} open callback task${detail.openCallbackTasks === 1 ? "" : "s"}`
                      : ""}
                    {detail.openQuotes > 0
                      ? ` · ${detail.openQuotes} open quote${detail.openQuotes === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>

                <section className="space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    Customer-facing profile
                  </h3>
                  <p className="text-[13px] text-steel">
                    These details appear on the Trade Portal account-manager card, quotes and
                    callback routing when customer contact is enabled.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name">
                      <input
                        className={inputClass}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        disabled={!canEdit || saving}
                        placeholder={detail.user.name || detail.user.email}
                        maxLength={120}
                      />
                      <Hint>Leave blank to use the linked user name.</Hint>
                    </Field>
                    <Field label="Job title">
                      <input
                        className={inputClass}
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        disabled={!canEdit || saving}
                        placeholder="Account Manager"
                        maxLength={120}
                      />
                    </Field>
                    <Field label="Business email">
                      <input
                        className={inputClass}
                        type="email"
                        value={businessEmail}
                        onChange={(e) => setBusinessEmail(e.target.value)}
                        disabled={!canEdit || saving}
                        placeholder={detail.user.email}
                        maxLength={320}
                      />
                      <Hint>{detail.emailFallbackHint}</Hint>
                    </Field>
                    <Field label="Telephone">
                      <input
                        className={inputClass}
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        disabled={!canEdit || saving}
                        placeholder="01234 567890"
                        maxLength={40}
                      />
                    </Field>
                    <Field label="Mobile">
                      <input
                        className={inputClass}
                        type="tel"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        disabled={!canEdit || saving}
                        placeholder="07123 456789"
                        maxLength={40}
                      />
                    </Field>
                    <Field label="Profile photo">
                      <div className="flex items-center gap-3">
                        {photoMediaId ? (
                          <img
                            src={cmsMediaPublicPath(photoMediaId)}
                            alt={photoAlt || detail.resolvedName}
                            className="size-14 rounded-full object-cover"
                          />
                        ) : (
                          <div className="grid size-14 place-items-center rounded-full bg-ink text-[12px] font-semibold">
                            {initials(detail.resolvedName)}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={!canEdit || saving}
                            onClick={() => setPickerOpen(true)}
                          >
                            Choose photo
                          </button>
                          {photoMediaId ? (
                            <button
                              type="button"
                              className={btnSecondary}
                              disabled={!canEdit || saving}
                              onClick={() => setPhotoMediaId(null)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <input
                        className={cn(inputClass, "mt-2")}
                        value={photoAlt}
                        onChange={(e) => setPhotoAlt(e.target.value)}
                        disabled={!canEdit || saving || !photoMediaId}
                        placeholder="Photo alt text"
                        maxLength={200}
                      />
                    </Field>
                  </div>

                  <div className="flex flex-wrap gap-6">
                    <Toggle
                      label="Active"
                      checked={active}
                      onChange={setActive}
                      disabled={!canEdit || saving}
                    />
                    <Toggle
                      label="Show contact details to assigned customers"
                      checked={customerContactEnabled}
                      onChange={setCustomerContactEnabled}
                      disabled={!canEdit || saving}
                    />
                  </div>
                  <Hint>
                    When contact details are off, the portal still shows the account manager name
                    but hides email/telephone/mobile and falls back to the trade-team contact for
                    the CTA.
                  </Hint>

                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void onSave()}
                      disabled={saving}
                      className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Save profile"}
                    </button>
                  ) : (
                    <p className="text-[13px] text-steel">
                      View only. Users with user-management permission can edit sales profiles.
                    </p>
                  )}
                </section>

                <section className="space-y-3 border-t border-border pt-6">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    System user
                  </h3>
                  <div className="rounded-lg border border-border bg-surface/40 px-4 py-3">
                    <div className="font-semibold">{detail.user.name || detail.user.email}</div>
                    <div className="text-[13px] text-steel">{detail.user.email}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {detail.user.roleLabels.map((label) => (
                        <StatusBadge key={label} tone="neutral">
                          {label}
                        </StatusBadge>
                      ))}
                      <StatusBadge tone={detail.user.status === "ACTIVE" ? "good" : "warn"}>
                        {detail.user.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-2 text-[12px] text-steel">
                      Login, role, password and deactivation are managed in Operations → Users.
                    </p>
                    <Link
                      to={ROUTES.adminRoles}
                      className="mt-3 inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
                    >
                      Manage user
                    </Link>
                  </div>
                  {detail.linkedTeamMember ? (
                    <p className="text-[12px] text-steel">
                      Linked Meet the Team profile
                      {detail.linkedTeamMember.isPublic ? " (public)" : " (not public)"}. Public site
                      visibility stays separate from this customer account-manager profile.
                    </p>
                  ) : null}
                </section>

                <section className="space-y-3 border-t border-border pt-6">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    Assigned customers
                  </h3>
                  {detail.assignments.length === 0 ? (
                    <p className="text-[13px] text-steel">No companies assigned yet.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[480px] text-[13px]">
                        <thead>
                          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                            <th className="px-3 py-2 font-semibold">Company</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                            <th className="px-3 py-2 font-semibold">Primary</th>
                            {canEdit ? <th className="px-3 py-2 font-semibold">Action</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.assignments.map((a) => (
                            <tr key={a.assignmentId} className="border-b border-border/60 last:border-0">
                              <td className="px-3 py-2.5">
                                <div className="font-medium">{a.companyName}</div>
                                {a.accountNumber ? (
                                  <div className="text-[11px] text-steel">{a.accountNumber}</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5">
                                <StatusBadge tone={a.status === "ACTIVE" ? "good" : "neutral"}>
                                  {a.status.replace(/_/g, " ")}
                                </StatusBadge>
                              </td>
                              <td className="px-3 py-2.5 text-steel">
                                {a.isPrimary ? "Yes" : "No"}
                              </td>
                              {canEdit ? (
                                <td className="px-3 py-2.5">
                                  <button
                                    type="button"
                                    disabled={assigning}
                                    onClick={() => void onUnassign(a.companyId)}
                                    className="text-[12px] font-semibold uppercase tracking-wide text-steel hover:text-foreground disabled:opacity-60"
                                  >
                                    Remove
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit ? (
                    <div className="space-y-2">
                      <Field label="Assign company">
                        <input
                          className={inputClass}
                          value={companyQuery}
                          onChange={(e) => setCompanyQuery(e.target.value)}
                          placeholder="Search company name or account number"
                          disabled={assigning}
                        />
                      </Field>
                      {companyOptions.length > 0 ? (
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {companyOptions.map((c) => (
                            <li
                              key={c.id}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
                            >
                              <span>
                                <span className="font-medium">{c.name}</span>
                                <span className="ml-2 text-steel">
                                  {c.status.replace(/_/g, " ")}
                                  {c.primarySalesRepName
                                    ? ` · currently ${c.primarySalesRepName}`
                                    : ""}
                                </span>
                              </span>
                              <button
                                type="button"
                                disabled={assigning || c.primarySalesRepId === detail.id}
                                onClick={() => void onAssign(c.id)}
                                className="shrink-0 text-[12px] font-bold uppercase tracking-wide text-primary hover:underline disabled:opacity-50"
                              >
                                {c.primarySalesRepId && c.primarySalesRepId !== detail.id
                                  ? "Reassign"
                                  : c.primarySalesRepId === detail.id
                                    ? "Assigned"
                                    : "Assign"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>

              <aside className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  Customer view
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
                  Your account manager
                </div>
                {preview ? (
                  <div className="mt-4">
                    <div className="flex items-start gap-3">
                      {preview.photo ? (
                        <img
                          src={preview.photo.src}
                          alt={preview.photo.alt}
                          className="size-14 shrink-0 rounded-full object-cover"
                          style={{ objectPosition: preview.photo.objectPosition }}
                        />
                      ) : (
                        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-semibold">
                          {preview.initials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-display text-lg font-semibold uppercase leading-tight">
                          {preview.name}
                        </div>
                        <div className="text-[12px] text-steel">{preview.jobTitle}</div>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-[13px]">
                      {preview.email ? (
                        <li className="flex items-center gap-2">
                          <Mail className="size-3.5 text-primary" aria-hidden />
                          <span className="truncate">{preview.email}</span>
                        </li>
                      ) : null}
                      {preview.phone ? (
                        <li className="flex items-center gap-2">
                          <Phone className="size-3.5 text-primary" aria-hidden />
                          <span>{preview.phone}</span>
                        </li>
                      ) : null}
                      {preview.mobile ? (
                        <li className="flex items-center gap-2">
                          <Smartphone className="size-3.5 text-primary" aria-hidden />
                          <span>{preview.mobile}</span>
                        </li>
                      ) : null}
                    </ul>
                    {preview.primaryContactHref ? (
                      <div className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground">
                        {preview.primaryContactLabel}
                      </div>
                    ) : (
                      <p className="mt-4 text-[12px] text-steel">
                        No customer contact CTA — trade-team fallback will be used in the portal.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] text-steel">
                    Inactive or unavailable for customer display.
                  </p>
                )}
              </aside>
            </div>
          )}
        </div>
      )}

      {createOpen ? (
        <CreateSalesRepDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => {
            setCreateOpen(false);
            await loadList();
            setSelectedId(id);
          }}
        />
      ) : null}

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          setPhotoMediaId(item.id);
          if (!photoAlt && item.altText) setPhotoAlt(item.altText);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function CreateSalesRepDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [users, setUsers] = useState<LinkableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("Account Manager");
  const [businessEmail, setBusinessEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [customerContactEnabled, setCustomerContactEnabled] = useState(true);
  const [active, setActive] = useState(true);

  useEffect(() => {
    void (async () => {
      const result = await listLinkableUsersForSalesRepFn();
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error || "Could not load users");
        return;
      }
      setUsers(result.data as LinkableUser[]);
    })();
  }, []);

  async function onSubmit() {
    if (!userId) {
      toast.error("Select a linked user");
      return;
    }
    setSaving(true);
    const result = await createSalesRepFn({
      data: {
        userId,
        displayName,
        jobTitle,
        businessEmail,
        phone,
        mobile,
        customerContactEnabled,
        active,
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error || "Could not create sales representative");
      return;
    }
    toast.success("Sales representative created");
    await onCreated((result.data as Detail).id);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-6">
      <div
        role="dialog"
        aria-labelledby="create-sr-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-background p-5 sm:rounded-xl"
      >
        <h2 id="create-sr-title" className="font-display text-xl font-semibold uppercase">
          Add sales representative
        </h2>
        <p className="mt-1 text-[13px] text-steel">
          Link an existing staff user. Login credentials are not created here — manage access in
          Operations → Users.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-steel">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="mt-4 text-sm text-steel">
            No internal users without a SalesRep profile. Create a staff user first in Operations →
            Users.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            <Field label="Linked user">
              <select
                className={inputClass}
                value={userId}
                onChange={(e) => {
                  const id = e.target.value;
                  setUserId(id);
                  const u = users.find((x) => x.id === id);
                  if (u) {
                    if (!displayName) setDisplayName(u.name || "");
                    if (!businessEmail) setBusinessEmail(u.email);
                  }
                }}
              >
                <option value="">Select user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.name || u.email) + " · " + u.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Customer-facing name">
              <input
                className={inputClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Job title">
              <input
                className={inputClass}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Business email">
              <input
                className={inputClass}
                type="email"
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                maxLength={320}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telephone">
                <input
                  className={inputClass}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={40}
                />
              </Field>
              <Field label="Mobile">
                <input
                  className={inputClass}
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  maxLength={40}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <Toggle label="Active" checked={active} onChange={setActive} />
              <Toggle
                label="Customer contact enabled"
                checked={customerContactEnabled}
                onChange={setCustomerContactEnabled}
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loading || !userId}
            onClick={() => void onSubmit()}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
      {label}
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-steel">{children}</p>;
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border"
      />
      <span className="font-medium normal-case tracking-normal">{label}</span>
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-ink px-3 text-[14px] font-normal normal-case tracking-normal text-foreground outline-none focus-visible:border-primary disabled:opacity-60";

const btnSecondary =
  "inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide transition hover:border-steel disabled:opacity-60";
