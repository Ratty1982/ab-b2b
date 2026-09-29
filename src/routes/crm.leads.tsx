import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { LogActivityDrawer } from "@/components/crm/LogActivityDrawer";
import {
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  leadSourceLabel,
  leadStatusLabel,
} from "@/domain/crm";
import {
  convertCrmLeadFn,
  createCrmLeadFn,
  getCrmLeadFn,
  listCrmLeadsFn,
  markCrmLeadLostFn,
  searchCompaniesForLeadConvertFn,
  updateCrmLeadFn,
} from "@/server/phase2/fns";

type Search = { leadId?: string };

export const Route = createFileRoute("/crm/leads")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {};
    if (typeof s["leadId"] === "string" && s["leadId"]) out.leadId = s["leadId"];
    return out;
  },
  head: () => ({
    meta: [{ title: "Leads — CRM — Automotive Brands" }],
  }),
  component: CrmLeadsPage,
});

type ListData = Extract<Awaited<ReturnType<typeof listCrmLeadsFn>>, { ok: true }>["data"];
type Detail = Extract<Awaited<ReturnType<typeof getCrmLeadFn>>, { ok: true }>["data"];

function CrmLeadsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [data, setData] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  function reload() {
    void listCrmLeadsFn({ data: { q: q.trim() || null, status, pageSize: 50 } }).then((r) => {
      if (!r.ok) setError(r.error);
      else {
        setError(null);
        setData(r.data);
      }
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  useEffect(() => {
    if (!search.leadId) {
      setDetail(null);
      return;
    }
    void getCrmLeadFn({ data: { leadId: search.leadId } }).then((r) => {
      if (!r.ok) setError(r.error);
      else setDetail(r.data);
    });
  }, [search.leadId]);

  return (
    <div>
      <PanelHeader
        title="Leads"
        sub="Prospective trade customers before they become established accounts"
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground"
          >
            New lead
          </button>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <input
          className="h-10 min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Search business, contact, email, telephone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="ACTIVE">Active</option>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="CONVERTED">Converted</option>
          <option value="DISQUALIFIED">Lost</option>
          <option value="ALL">All</option>
        </select>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-destructive sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="px-4 py-6 text-sm text-steel sm:px-6">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="mx-4 my-6 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-steel sm:mx-6">
          No leads yet. New leads will appear here when they are created.
        </p>
      ) : (
        <div className="overflow-x-auto px-4 py-4 sm:px-6">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="pb-2 pr-3 font-semibold">Lead</th>
                <th className="pb-2 pr-3 font-semibold">Contact</th>
                <th className="pb-2 pr-3 font-semibold">Owner</th>
                <th className="pb-2 pr-3 font-semibold">Status</th>
                <th className="pb-2 pr-3 font-semibold">Source</th>
                <th className="pb-2 font-semibold">Next action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-t border-border/60 hover:bg-muted/30"
                  onClick={() => void navigate({ search: { leadId: l.id } })}
                >
                  <td className="py-2.5 pr-3 font-semibold">{l.companyName}</td>
                  <td className="py-2.5 pr-3 text-steel">{l.contactName ?? "—"}</td>
                  <td className="py-2.5 pr-3">{l.ownerName ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <StatusBadge>{leadStatusLabel(l.status)}</StatusBadge>
                  </td>
                  <td className="py-2.5 pr-3 text-steel">{leadSourceLabel(l.source)}</td>
                  <td className="py-2.5 tabular-nums text-steel">
                    {l.nextActionAt
                      ? new Date(l.nextActionAt).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={Boolean(detail)}
        onClose={() => void navigate({ search: {} })}
        title={detail?.companyName ?? "Lead"}
        {...(detail?.contactName ? { sub: detail.contactName } : {})}
        width="lg"
        footer={
          detail && detail.status !== "CONVERTED" && detail.status !== "DISQUALIFIED" ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-10 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                onClick={() => setLogOpen(true)}
              >
                Log call
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                onClick={() =>
                  void updateCrmLeadFn({
                    data: { leadId: detail.id, status: "QUALIFIED" },
                  }).then(() => {
                    void getCrmLeadFn({ data: { leadId: detail.id } }).then((r) => {
                      if (r.ok) setDetail(r.data);
                    });
                    reload();
                  })
                }
              >
                Qualify
              </button>
              <button
                type="button"
                className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
                onClick={() => setConvertOpen(true)}
              >
                Convert
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-border px-3 text-[12px] font-bold uppercase text-steel"
                onClick={() => setLostOpen(true)}
              >
                Mark lost
              </button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <StatusBadge>{leadStatusLabel(detail.status)}</StatusBadge>
              <span className="text-steel">{leadSourceLabel(detail.source)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[10px] uppercase text-steel">Owner</dt>
                <dd>{detail.owner?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Email</dt>
                <dd>{detail.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Phone</dt>
                <dd>{detail.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Company</dt>
                <dd>
                  {detail.company ? (
                    <Link
                      to="/sales/customers/$id"
                      params={{ id: detail.company.id }}
                      className="text-primary hover:underline"
                    >
                      {detail.company.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
            {detail.notes ? <p className="whitespace-pre-wrap text-steel">{detail.notes}</p> : null}
            {detail.lostReason ? <p className="text-steel">Lost reason: {detail.lostReason}</p> : null}
            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">
                Activity
              </h3>
              {detail.activities.length === 0 ? (
                <p className="text-steel">No activity recorded for this lead.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.activities.map((a) => (
                    <li key={a.id} className="rounded border border-border/60 px-3 py-2">
                      <div className="flex justify-between text-[11px] text-steel">
                        <span>{a.actorName}</span>
                        <time dateTime={a.occurredAt}>
                          {new Date(a.occurredAt).toLocaleString("en-GB", {
                            timeZone: "Europe/London",
                            hour12: false,
                          })}
                        </time>
                      </div>
                      <p className="font-medium">{a.subject}</p>
                      {a.body ? <p className="text-steel">{a.body}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      <CreateLeadDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
      />

      <LogActivityDrawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        leadId={detail?.id ?? null}
        companyId={detail?.company?.id ?? null}
        defaultType="CALL"
        onLogged={() => {
          if (detail) {
            void getCrmLeadFn({ data: { leadId: detail.id } }).then((r) => {
              if (r.ok) setDetail(r.data);
            });
          }
          reload();
        }}
      />

      {detail && convertOpen ? (
        <ConvertLeadDrawer
          lead={detail}
          onClose={() => setConvertOpen(false)}
          onDone={(companyId) => {
            setConvertOpen(false);
            reload();
            void getCrmLeadFn({ data: { leadId: detail.id } }).then((r) => {
              if (r.ok) setDetail(r.data);
            });
            if (companyId) {
              // stay on lead detail showing converted
            }
          }}
        />
      ) : null}

      {detail && lostOpen ? (
        <LostLeadDrawer
          leadId={detail.id}
          onClose={() => setLostOpen(false)}
          onDone={() => {
            setLostOpen(false);
            reload();
            void navigate({ search: {} });
          }}
        />
      ) : null}
    </div>
  );
}

function CreateLeadDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const id = useId();
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("SALES_REP");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const r = await createCrmLeadFn({
      data: { companyName, contactName, email, phone, source, notes },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCompanyName("");
    setContactName("");
    setEmail("");
    setPhone("");
    setNotes("");
    onCreated();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New lead"
      width="md"
      footer={
        <button
          type="button"
          disabled={saving || !companyName.trim()}
          onClick={() => void submit()}
          className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          Create lead
        </button>
      }
    >
      {error ? <p className="mb-2 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="space-y-3">
        <Field label="Business name" htmlFor={`${id}-co`}>
          <input id={`${id}-co`} className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </Field>
        <Field label="Contact" htmlFor={`${id}-ct`}>
          <input id={`${id}-ct`} className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor={`${id}-em`}>
          <input id={`${id}-em`} className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Telephone" htmlFor={`${id}-ph`}>
          <input id={`${id}-ph`} className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Source" htmlFor={`${id}-src`}>
          <select id={`${id}-src`} className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {leadSourceLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" htmlFor={`${id}-notes`}>
          <textarea id={`${id}-notes`} className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

function ConvertLeadDrawer({
  lead,
  onClose,
  onDone,
}: {
  lead: Detail;
  onClose: () => void;
  onDone: (companyId: string | null) => void;
}) {
  const [mode, setMode] = useState<"LINK_EXISTING" | "CREATE_NEW">("CREATE_NEW");
  const [q, setQ] = useState(lead.companyName);
  const [matches, setMatches] = useState<Array<{ id: string; name: string; autopartCustomerCode: string | null }>>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [createOpp, setCreateOpp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== "LINK_EXISTING" || q.trim().length < 2) {
      setMatches([]);
      return;
    }
    void searchCompaniesForLeadConvertFn({ data: { q } }).then((r) => {
      if (r.ok) setMatches(r.data.items);
    });
  }, [q, mode]);

  async function submit() {
    setSaving(true);
    const r = await convertCrmLeadFn({
      data: {
        leadId: lead.id,
        mode,
        companyId: mode === "LINK_EXISTING" ? companyId : null,
        createOpportunity: createOpp,
      },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDone(r.data.companyId);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Convert lead"
      sub="Choose carefully — do not create duplicates"
      width="md"
      footer={
        <button
          type="button"
          disabled={saving || (mode === "LINK_EXISTING" && !companyId)}
          onClick={() => void submit()}
          className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          Convert
        </button>
      }
    >
      {error ? <p className="mb-2 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "CREATE_NEW"} onChange={() => setMode("CREATE_NEW")} />
          Create new company
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "LINK_EXISTING"} onChange={() => setMode("LINK_EXISTING")} />
          Link existing company
        </label>
        {mode === "LINK_EXISTING" ? (
          <>
            <input
              className={inputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company name, email, Autopart account"
            />
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`w-full rounded border px-3 py-2 text-left ${
                      companyId === m.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => setCompanyId(m.id)}
                  >
                    {m.name}
                    {m.autopartCustomerCode ? (
                      <span className="ml-2 font-mono text-[11px] text-steel">
                        {m.autopartCustomerCode}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={createOpp} onChange={(e) => setCreateOpp(e.target.checked)} />
          Also create opportunity (optional)
        </label>
      </div>
    </Drawer>
  );
}

function LostLeadDrawer({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string>(LEAD_LOST_REASONS[0]!);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Drawer
      open
      onClose={onClose}
      title="Mark lead lost"
      width="md"
      footer={
        <button
          type="button"
          className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
          onClick={() => {
            void markCrmLeadLostFn({ data: { leadId, reason, notes } }).then((r) => {
              if (!r.ok) setError(r.error);
              else onDone();
            });
          }}
        >
          Confirm lost
        </button>
      }
    >
      {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
      <div className="space-y-3">
        <Field label="Reason" htmlFor="lost-reason">
          <select id="lost-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
            {LEAD_LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes (optional)" htmlFor="lost-notes">
          <textarea id="lost-notes" className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
