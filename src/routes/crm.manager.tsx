import { createFileRoute } from "@tanstack/react-router";
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
  getSalesRepProfileFn,
  listSalesRepProfilesFn,
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
          "Manage customer-facing SalesRep contact profiles: job title, business email, telephone, mobile and photo.",
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
  user: { id: string; name: string | null; email: string; status: string };
  photoSrc: string | null;
  assignmentCount: number;
  linkedTeamMember: { id: string; isPublic: boolean } | null;
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

  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [customerContactEnabled, setCustomerContactEnabled] = useState(true);
  const [active, setActive] = useState(true);
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null);
  const [photoAlt, setPhotoAlt] = useState("");

  async function loadList() {
    setLoading(true);
    const result = await listSalesRepProfilesFn();
    if (!result.ok) {
      toast.error(result.error);
      setLoading(false);
      return;
    }
    setRows(result.data as ListItem[]);
    if (!selectedId && result.data[0]) setSelectedId(result.data[0].id);
    setLoading(false);
  }

  async function loadDetail(id: string) {
    const result = await getSalesRepProfileFn({ data: { id } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const d = result.data as Detail;
    setDetail(d);
    setDisplayName(d.displayName ?? "");
    setJobTitle(d.jobTitle ?? "");
    setBusinessEmail(d.businessEmail ?? "");
    setPhone(d.phone ?? "");
    setMobile(d.mobile ?? "");
    setCustomerContactEnabled(d.customerContactEnabled);
    setActive(d.active);
    setPhotoMediaId(d.photoMediaId);
    setPhotoAlt(d.photoAlt ?? "");
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  async function onSave() {
    if (!detail || !canEdit) return;
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
      toast.error(result.error);
      return;
    }
    toast.success("Sales profile saved");
    setDetail(result.data as Detail);
    await loadList();
  }

  const preview = detail?.customerPreview;

  return (
    <div>
      <PanelHeader
        title="Sales Team"
        sub="Customer-facing SalesRep profiles for the Trade Portal, Quotes and callbacks"
        crumbs={[{ label: "Operations" }, { label: "Sales Team", to: ROUTES.crmManager }]}
      />

      <div className="grid gap-0 border-t border-border lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-border lg:border-b-0 lg:border-r">
          <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-steel">
            Representatives
          </div>
          {loading ? (
            <p className="p-4 text-sm text-steel">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-steel">
              No SalesRep records yet. Assign the Sales Representative role in Operations → Users.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/60",
                      selectedId === row.id && "bg-surface/80",
                    )}
                  >
                    {row.photoSrc ? (
                      <img
                        src={row.photoSrc}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold">
                        {row.resolvedName
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{row.resolvedName}</span>
                      <span className="block truncate text-[11px] text-steel">
                        {row.resolvedJobTitle}
                        {row.code ? ` · ${row.code}` : ""}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <StatusBadge tone={row.active ? "good" : "neutral"}>
                          {row.active ? "Active" : "Inactive"}
                        </StatusBadge>
                        {!row.customerContactEnabled ? (
                          <StatusBadge tone="warn">Contact off</StatusBadge>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="min-w-0 p-4 sm:p-6">
          {!detail ? (
            <p className="text-sm text-steel">Select a sales representative.</p>
          ) : (
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold uppercase tracking-tight">
                    {detail.resolvedName}
                  </h2>
                  <p className="mt-1 text-[13px] text-steel">
                    Linked user: {detail.user.name || detail.user.email} · {detail.user.email}
                    {detail.code ? ` · Code ${detail.code}` : ""}
                    {" · "}
                    {detail.assignmentCount} assigned compan
                    {detail.assignmentCount === 1 ? "y" : "ies"}
                  </p>
                  {detail.linkedTeamMember ? (
                    <p className="mt-1 text-[12px] text-steel">
                      Linked Meet the Team profile
                      {detail.linkedTeamMember.isPublic ? " (public)" : " (not public)"}. Public site
                      visibility stays separate from this customer profile.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Customer-facing name">
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
                          —
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
                    label="Customer contact enabled"
                    checked={customerContactEnabled}
                    onChange={setCustomerContactEnabled}
                    disabled={!canEdit || saving}
                  />
                </div>
                <Hint>
                  When customer contact is off, the portal still shows the account manager name but
                  hides email/telephone/mobile and falls back to the trade-team contact for the CTA.
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
              </div>

              <aside className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  Customer profile preview
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
        </section>
      </div>

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
      <span className="font-medium">{label}</span>
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-ink px-3 text-[14px] font-normal normal-case tracking-normal text-foreground outline-none focus-visible:border-primary disabled:opacity-60";

const btnSecondary =
  "inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide transition hover:border-steel disabled:opacity-60";
