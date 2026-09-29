import { useEffect, useId, useState } from "react";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { CALL_OUTCOMES } from "@/domain/crm";
import { listCompaniesFn, logCrmActivityFn } from "@/server/phase2/fns";

export function LogActivityDrawer({
  open,
  onClose,
  onLogged,
  companyId,
  leadId,
  opportunityId,
  defaultType = "CALL",
}: {
  open: boolean;
  onClose: () => void;
  onLogged?: () => void;
  companyId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  defaultType?: "CALL" | "EMAIL" | "MEETING" | "NOTE";
}) {
  const id = useId();
  const [type, setType] = useState(defaultType);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("Connected");
  const [followUp, setFollowUp] = useState(false);
  const [followUpDue, setFollowUpDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedCompanyId, setPickedCompanyId] = useState(companyId ?? "");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    setType(defaultType);
    setPickedCompanyId(companyId ?? "");
  }, [defaultType, companyId, open]);

  useEffect(() => {
    if (!open || companyId || leadId) return;
    void listCompaniesFn({ data: { page: 1, pageSize: 100 } }).then((r) => {
      if (r.ok) {
        const items = (r.data as { items?: Array<{ id: string; name: string }> }).items ?? [];
        setCompanies(items.map((c) => ({ id: c.id, name: c.name })));
      }
    });
  }, [open, companyId, leadId]);

  async function submit() {
    setSaving(true);
    setError(null);
    const resolvedCompanyId = companyId || pickedCompanyId || null;
    if (!resolvedCompanyId && !leadId) {
      setSaving(false);
      setError("Select a customer or open from a lead.");
      return;
    }
    const r = await logCrmActivityFn({
      data: {
        type,
        companyId: resolvedCompanyId,
        leadId: leadId ?? null,
        opportunityId: opportunityId ?? null,
        subject: subject.trim() || null,
        body: body.trim() || null,
        outcome: type === "CALL" ? outcome : null,
        createFollowUpTask: followUp && Boolean(resolvedCompanyId),
        followUpDueDate: followUp && followUpDue ? followUpDue : null,
      },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSubject("");
    setBody("");
    onLogged?.();
    onClose();
  }

  const title =
    type === "CALL"
      ? "Log call"
      : type === "EMAIL"
        ? "Log email"
        : type === "MEETING"
          ? "Log meeting"
          : "Add note";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      sub={type === "EMAIL" ? "Manual log — does not send email" : "CRM activity"}
      width="md"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : title}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
          >
            Cancel
          </button>
        </div>
      }
    >
      {error ? (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {!companyId && !leadId ? (
          <Field label="Customer" htmlFor={`${id}-co`}>
            <select
              id={`${id}-co`}
              className={inputClass}
              value={pickedCompanyId}
              onChange={(e) => setPickedCompanyId(e.target.value)}
            >
              <option value="">Select customer…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Type" htmlFor={`${id}-type`}>
          <select
            id={`${id}-type`}
            className={inputClass}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="CALL">Call</option>
            <option value="EMAIL">Email (logged)</option>
            <option value="MEETING">Meeting</option>
            <option value="NOTE">Note</option>
          </select>
        </Field>

        {type === "CALL" ? (
          <Field label="Outcome" htmlFor={`${id}-outcome`}>
            <select
              id={`${id}-outcome`}
              className={inputClass}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label={type === "EMAIL" ? "Subject / summary" : "Subject"} htmlFor={`${id}-subject`}>
          <input
            id={`${id}-subject`}
            className={inputClass}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>

        <Field label="Notes" htmlFor={`${id}-body`}>
          <textarea
            id={`${id}-body`}
            className={inputClass}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        {companyId || pickedCompanyId ? (
          <div className="space-y-2 rounded-md border border-border/70 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={followUp}
                onChange={(e) => setFollowUp(e.target.checked)}
              />
              Create follow-up task
            </label>
            {followUp ? (
              <Field label="Follow-up due" htmlFor={`${id}-due`}>
                <input
                  id={`${id}-due`}
                  type="date"
                  className={inputClass}
                  value={followUpDue}
                  onChange={(e) => setFollowUpDue(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
