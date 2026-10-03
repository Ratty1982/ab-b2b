/**
 * Super Admin Email Template Preview & Test Centre.
 * Nested under Admin → Settings → Email — not a sidebar item.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getEmailPreviewCentreFn,
  previewEmailTemplateFn,
  sendEmailTemplateTestFn,
} from "@/server/phase2/fns";

type TemplateMeta = {
  id: string;
  name: string;
  purpose: string;
  audience: "customer" | "internal" | "staff";
  description: string;
  group: "customer" | "internal";
  scenarios: Array<{ id: string; label: string }>;
};

type HistoryRow = {
  id: string;
  createdAtLabel: string;
  templateName: string;
  toEmail: string;
  status: string;
  sentBy: string;
};

type PreviewBodies = {
  templateId: string;
  scenarioId: string;
  name: string;
  purpose: string;
  audience: string;
  description: string;
  subject: string;
  preheader: string | null;
  text: string;
  html: string;
};

function audienceLabel(audience: string): string {
  if (audience === "internal") return "Internal";
  if (audience === "staff") return "Staff";
  return "Customer";
}

export function EmailTemplatePreviewCentre() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [actorEmail, setActorEmail] = useState("");
  const [scenarioByTemplate, setScenarioByTemplate] = useState<Record<string, string>>({});

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewBodies | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTemplate, setSendTemplate] = useState<TemplateMeta | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const result = await getEmailPreviewCentreFn();
    if (!result.ok) {
      setVisible(false);
      setLoading(false);
      return;
    }
    setVisible(true);
    setTemplates(result.data.templates);
    setHistory(result.data.recentTests);
    setActorEmail(result.data.actorEmail);
    setScenarioByTemplate((prev) => {
      const next = { ...prev };
      for (const t of result.data.templates) {
        if (!next[t.id]) next[t.id] = t.scenarios[0]?.id ?? "default";
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customer = useMemo(() => templates.filter((t) => t.group === "customer"), [templates]);
  const internal = useMemo(() => templates.filter((t) => t.group === "internal"), [templates]);

  async function openPreview(template: TemplateMeta) {
    setPreviewLoading(true);
    setPreviewOpen(true);
    setViewport("desktop");
    const scenarioId = scenarioByTemplate[template.id] ?? template.scenarios[0]?.id;
    const result = await previewEmailTemplateFn({
      data: { templateId: template.id, ...(scenarioId ? { scenarioId } : {}) },
    });
    setPreviewLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      setPreviewOpen(false);
      return;
    }
    setPreview(result.data);
  }

  function openSend(template: TemplateMeta) {
    setSendTemplate(template);
    setSendTo(actorEmail);
    setSendOpen(true);
  }

  async function confirmSend() {
    if (!sendTemplate || !sendTo.trim()) return;
    setSending(true);
    const scenarioId = scenarioByTemplate[sendTemplate.id] ?? sendTemplate.scenarios[0]?.id;
    const result = await sendEmailTemplateTestFn({
      data: {
        templateId: sendTemplate.id,
        toEmail: sendTo.trim(),
        ...(scenarioId ? { scenarioId } : {}),
      },
    });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data.ok) {
      toast.success(`Test sent to ${result.data.toEmail}`);
      setSendOpen(false);
      await load();
    } else {
      toast.error(result.data.message);
      await load();
    }
  }

  if (loading || !visible) return null;

  return (
    <div
      data-admin-section="email-template-preview"
      className="space-y-4 border-t border-border pt-5"
    >
      <div>
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">
          Email preview &amp; test centre
        </h3>
        <p className="mt-1 max-w-3xl text-[13px] text-steel">
          Preview every live transactional template with sample data, or send a labelled TEST copy
          to yourself. This never creates orders, applications, quotes or CRM records, and never
          emails the sample customer.
        </p>
      </div>

      <Gallery
        title="Customer emails"
        templates={customer}
        scenarioByTemplate={scenarioByTemplate}
        onScenario={(id, scenarioId) =>
          setScenarioByTemplate((prev) => ({ ...prev, [id]: scenarioId }))
        }
        onPreview={(t) => void openPreview(t)}
        onSend={openSend}
      />
      <Gallery
        title="Internal emails"
        templates={internal}
        scenarioByTemplate={scenarioByTemplate}
        onScenario={(id, scenarioId) =>
          setScenarioByTemplate((prev) => ({ ...prev, [id]: scenarioId }))
        }
        onPreview={(t) => void openPreview(t)}
        onSend={openSend}
      />

      <div className="space-y-2">
        <h4 className="font-display text-[12px] font-semibold uppercase tracking-wide text-steel">
          Recent template tests
        </h4>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-border bg-ink/50 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Date/time</th>
                <th className="px-3 py-2 font-semibold">Template</th>
                <th className="px-3 py-2 font-semibold">Sent to</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Sent by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-steel">
                    No template tests yet
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-2">{row.createdAtLabel}</td>
                    <td className="px-3 py-2">{row.templateName}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2">{row.toEmail}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          row.status === "SENT" ? "good" : row.status === "FAILED" ? "bad" : "neutral"
                        }
                      >
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">{row.sentBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,920px)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{preview?.name ?? "Email preview"}</DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.purpose} · ${audienceLabel(preview.audience)}`
                : "Loading template"}
            </DialogDescription>
          </DialogHeader>
          {previewLoading || !preview ? (
            <p className="text-[13px] text-steel">Rendering production template…</p>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-steel">Subject</dt>
                  <dd className="mt-0.5">{preview.subject}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-steel">Preheader</dt>
                  <dd className="mt-0.5">{preview.preheader ?? "—"}</dd>
                </div>
              </dl>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-md px-3 text-[12px] font-semibold uppercase tracking-wide ${
                    viewport === "desktop" ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                  onClick={() => setViewport("desktop")}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-md px-3 text-[12px] font-semibold uppercase tracking-wide ${
                    viewport === "mobile" ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                  onClick={() => setViewport("mobile")}
                >
                  Mobile
                </button>
              </div>
              <div className="overflow-auto rounded-md border border-border bg-[#e8eaef] p-4">
                <iframe
                  title={`${preview.name} preview`}
                  sandbox=""
                  srcDoc={preview.html}
                  className="mx-auto block border-0 bg-white"
                  style={{
                    width: viewport === "mobile" ? 375 : 600,
                    minHeight: 640,
                    height: 720,
                  }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send test email</DialogTitle>
            <DialogDescription>
              A labelled TEST copy of this template. No customer or order is affected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[13px]">
              <span className="text-steel">Template:</span> {sendTemplate?.name}
            </p>
            <Field label="Send test to">
              <input
                className={inputClass}
                type="email"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
              />
            </Field>
            <button
              type="button"
              disabled={sending || !sendTo.trim()}
              onClick={() => void confirmSend()}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send test"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Gallery({
  title,
  templates,
  scenarioByTemplate,
  onScenario,
  onPreview,
  onSend,
}: {
  title: string;
  templates: TemplateMeta[];
  scenarioByTemplate: Record<string, string>;
  onScenario: (id: string, scenarioId: string) => void;
  onPreview: (t: TemplateMeta) => void;
  onSend: (t: TemplateMeta) => void;
}) {
  return (
    <div className="space-y-2">
      <h4 className="font-display text-[12px] font-semibold uppercase tracking-wide text-steel">
        {title}
      </h4>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => (
          <article key={template.id} className="space-y-3 rounded-md border border-border bg-ink/30 p-3">
            <div>
              <p className="font-display text-[13px] font-semibold uppercase tracking-wide">
                {template.name}
              </p>
              <p className="mt-1 text-[12px] text-steel">
                {template.purpose} · {audienceLabel(template.audience)}
              </p>
              <p className="mt-1 text-[13px]">{template.description}</p>
            </div>
            {template.scenarios.length > 1 ? (
              <Field label="Scenario">
                <select
                  className={inputClass}
                  value={scenarioByTemplate[template.id] ?? template.scenarios[0]?.id}
                  onChange={(e) => onScenario(template.id, e.target.value)}
                >
                  {template.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[12px] font-bold uppercase tracking-wide text-primary-foreground"
                onClick={() => onPreview(template)}
              >
                Preview
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide"
                onClick={() => onSend(template)}
              >
                Send test
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
