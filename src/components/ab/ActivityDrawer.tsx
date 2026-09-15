import { useState } from "react";
import {
  CalendarClock,
  CheckSquare,
  Mail,
  MapPin,
  Phone,
  StickyNote,
} from "lucide-react";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";

export type ActivityKind = "Call" | "Note" | "Visit" | "Email" | "Task" | "Follow-up";

export const activityKinds: { kind: ActivityKind; icon: typeof Phone; label: string }[] = [
  { kind: "Call", icon: Phone, label: "Log call" },
  { kind: "Note", icon: StickyNote, label: "Add note" },
  { kind: "Visit", icon: MapPin, label: "Log visit" },
  { kind: "Email", icon: Mail, label: "Log email" },
  { kind: "Task", icon: CheckSquare, label: "Create task" },
  { kind: "Follow-up", icon: CalendarClock, label: "Schedule follow-up" },
];

const outcomes: Record<string, string[]> = {
  Call: ["Spoke to buyer", "Left voicemail", "No answer", "Call back requested"],
  Visit: ["Counter visit", "Stock check", "Range review", "Complaint resolved"],
  Email: ["Sent quote", "Sent price list", "Chased order", "General enquiry"],
};

/**
 * Fast in-context activity capture. Opens over any customer screen so the
 * salesperson never leaves the record they are working on.
 */
export function ActivityDrawer({
  open,
  onClose,
  company,
  kind,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  company: string;
  kind: ActivityKind;
  onLogged?: (entry: { kind: ActivityKind; body: string }) => void;
}) {
  const [active, setActive] = useState<ActivityKind>(kind);
  const [body, setBody] = useState("");

  const current = active !== kind && !body ? active : active;
  const needsOutcome = Boolean(outcomes[current]);
  const isTask = current === "Task" || current === "Follow-up";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${current} — ${company}`}
      sub="Saved to the customer timeline immediately"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onLogged?.({ kind: current, body: body || `${current} logged` });
              setBody("");
              onClose();
            }}
            className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Save {current.toLowerCase()}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold transition-colors hover:border-steel"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-px border border-border bg-border">
        {activityKinds.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => setActive(a.kind)}
            aria-pressed={current === a.kind}
            className={`flex flex-col items-center gap-1.5 p-3 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              current === a.kind
                ? "bg-primary text-primary-foreground"
                : "bg-surface/70 text-steel hover:text-foreground"
            }`}
          >
            <a.icon className="size-4" aria-hidden />
            {a.kind}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {needsOutcome ? (
          <Field label="Outcome">
            <select className={inputClass} defaultValue={outcomes[current]?.[0]}>
              {outcomes[current]?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Contact">
          <select className={inputClass} defaultValue="Karen Doyle">
            {["Karen Doyle", "Sue Marchant", "Tom Ashby", "Other / not recorded"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>

        <Field label={isTask ? "What needs doing" : "Details"}>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isTask
                ? "Take Power Maxed display stand to the counter and agree placement"
                : "Discussed Steel Seal volumes; buyer wants case pricing before the end of the month."
            }
            className={inputClass}
          />
        </Field>

        {isTask ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date">
              <input type="date" className={inputClass} defaultValue="2026-09-18" />
            </Field>
            <Field label="Priority">
              <select className={inputClass} defaultValue="Normal">
                {["High", "Normal", "Low"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <Field label="Create a follow-up task">
            <select className={inputClass} defaultValue="No follow-up">
              {["No follow-up", "Tomorrow", "In 3 days", "Next week", "In 2 weeks"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Drawer>
  );
}
