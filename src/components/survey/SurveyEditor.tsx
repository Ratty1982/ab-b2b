import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CustomerSurveyForm } from "@/components/survey/CustomerSurveyForm";
import { PublishedSurveyForm } from "@/components/survey/PublishedSurveyForm";
import { isPrizeDrawOpen } from "@/domain/customer-survey";
import {
  newSurveyQuestion,
  usesLegacySurveyForm,
  type SurveyDocument,
  type SurveyQuestionDefinition,
  type SurveyQuestionKind,
} from "@/domain/survey-definition";
import {
  getSurveyEditorFn,
  previewSurveyDocumentFn,
  publishSurveyDraftFn,
  saveSurveyDraftFn,
} from "@/server/surveys/fns";

type Editor = Extract<Awaited<ReturnType<typeof getSurveyEditorFn>>, { ok: true }>["data"];

export function SurveyEditor({ mode }: { mode: "questions" | "settings" }) {
  const [state, setState] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<SurveyDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SurveyDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void getSurveyEditorFn().then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setState(result.data);
      setDraft(result.data.draft);
    });
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!draft || !state) return <p className="text-sm text-muted-foreground">Loading survey editor…</p>;

  const selected = draft.questions.find((question) => question.id === selectedId) ?? null;

  function updateQuestion(id: string, patch: Partial<SurveyQuestionDefinition>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question) =>
              question.id === id ? { ...question, ...patch } : question,
            ),
          }
        : current,
    );
    setPreview(null);
  }

  function move(id: string, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const questions = [...current.questions].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = questions.findIndex((question) => question.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= questions.length) return current;
      const swapped = questions[index]!;
      questions[index] = questions[next]!;
      questions[next] = swapped;
      return { ...current, questions: questions.map((question, order) => ({ ...question, sortOrder: order })) };
    });
    setPreview(null);
  }

  async function save() {
    setBusy(true);
    const result = await saveSurveyDraftFn({ data: draft });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      setError(result.error);
      return null;
    }
    setState(result.data);
    setDraft(result.data.draft);
    setError(null);
    toast.success("Draft saved. The published survey is unchanged.");
    return result.data;
  }

  async function publish() {
    const saved = await save();
    if (!saved) return;
    if (!window.confirm("Publish this draft as a new survey version? Existing responses stay on their original version.")) {
      return;
    }
    setBusy(true);
    const result = await publishSurveyDraftFn();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setState(result.data);
    setDraft(result.data.draft);
    setPreview(null);
    toast.success(`Published survey version ${result.data.publishedVersionNumber}.`);
  }

  async function previewDraft() {
    setBusy(true);
    const result = await previewSurveyDocumentFn({ data: draft });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      setError(result.error);
      return;
    }
    setError(null);
    setPreview(result.data);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Published version {state.publishedVersionNumber}
          {state.publishedAt ? ` · ${state.publishedAt.slice(0, 16).replace("T", " ")}` : ""}. Draft edits
          stay unpublished until you publish.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase" disabled={busy} onClick={() => void previewDraft()}>
            Preview
          </button>
          <button type="button" className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase" disabled={busy} onClick={() => void save()}>
            Save draft
          </button>
          <button type="button" className="h-10 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground" disabled={busy} onClick={() => void publish()}>
            Publish
          </button>
        </div>
      </div>
      {mode === "settings" ? (
        <SettingsFields draft={draft} onChange={setDraft} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-3">
            {draft.sections
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((section) => (
                <label key={section.id} className="block text-xs font-semibold">
                  Section heading
                  <input
                    className="mt-1 h-10 w-full rounded-md border border-border px-2 text-sm font-normal"
                    value={section.heading}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.map((item) =>
                          item.id === section.id ? { ...item, heading: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <textarea
                    className="mt-1 w-full rounded-md border border-border px-2 py-1 text-sm font-normal"
                    rows={2}
                    placeholder="Section description"
                    value={section.description}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.map((item) =>
                          item.id === section.id ? { ...item, description: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
              ))}
            <div className="space-y-1">
              {draft.questions
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    className={`block w-full rounded-md border px-2 py-2 text-left text-sm ${selectedId === question.id ? "border-primary" : "border-border"} ${question.enabled ? "" : "opacity-60"}`}
                    onClick={() => setSelectedId(question.id)}
                  >
                    {question.number}. {question.prompt || "Untitled question"}
                    <span className="mt-1 block text-[11px] uppercase text-muted-foreground">
                      {question.kind.replaceAll("_", " ")}
                      {question.required ? " · required" : ""}
                      {question.enabled ? "" : " · disabled"}
                    </span>
                  </button>
                ))}
            </div>
            <label className="block text-xs font-semibold">
              Add question
              <select
                className="mt-1 h-10 w-full rounded-md border border-border px-2 text-sm"
                defaultValue=""
                onChange={(event) => {
                  const kind = event.target.value as SurveyQuestionKind;
                  if (!kind) return;
                  const sectionId = draft.sections[0]?.id ?? "general";
                  const number = Math.max(0, ...draft.questions.map((question) => question.number)) + 1;
                  const created = newSurveyQuestion(kind, sectionId, number, draft.questions.length);
                  setDraft({ ...draft, questions: [...draft.questions, created] });
                  setSelectedId(created.id);
                  event.target.value = "";
                }}
              >
                <option value="">Choose a type…</option>
                <option value="rating">Rating</option>
                <option value="multiple_choice">Multiple choice</option>
                <option value="checkbox">Checkbox</option>
                <option value="yes_no">Yes / no</option>
                <option value="text">Free text</option>
              </select>
            </label>
          </div>
          {selected ? (
            <QuestionEditor
              question={selected}
              sections={draft.sections}
              onChange={(patch) => updateQuestion(selected.id, patch)}
              onMove={(direction) => move(selected.id, direction)}
              onRemove={() => {
                if (selected.lockedRole) return;
                setDraft({ ...draft, questions: draft.questions.filter((question) => question.id !== selected.id) });
                setSelectedId(null);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a question to edit its wording, choices and order.</p>
          )}
        </div>
      )}
      {preview ? (
        <div className="border border-border p-4">
          <h2 className="font-display text-lg font-semibold">{preview.title}</h2>
          {preview.introduction.map((paragraph) => (
            <p key={paragraph} className="mt-2 text-sm text-muted-foreground">
              {paragraph}
            </p>
          ))}
          <div className="mt-4">
            {usesLegacySurveyForm(preview) ? (
              <CustomerSurveyForm
                prizeDrawOpen={isPrizeDrawOpen(new Date())}
                preview
                thankYouTitle={preview.thankYouTitle}
                thankYouParagraphs={preview.thankYouParagraphs}
              />
            ) : (
              <PublishedSurveyForm document={preview} prizeDrawOpen={isPrizeDrawOpen(new Date())} preview />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsFields({
  draft,
  onChange,
}: {
  draft: SurveyDocument;
  onChange: (draft: SurveyDocument) => void;
}) {
  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <label className="block font-semibold">
        Survey title
        <input className="mt-1 h-10 w-full rounded-md border border-border px-2 font-normal" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </label>
      <label className="block font-semibold">
        Introduction
        <textarea
          className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal"
          rows={5}
          value={draft.introduction.join("\n\n")}
          onChange={(event) =>
            onChange({
              ...draft,
              introduction: event.target.value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label className="block font-semibold">
        Duration label
        <input className="mt-1 h-10 w-full rounded-md border border-border px-2 font-normal" value={draft.durationLabel} onChange={(event) => onChange({ ...draft, durationLabel: event.target.value })} />
      </label>
      <label className="block font-semibold">
        Thank-you heading
        <input className="mt-1 h-10 w-full rounded-md border border-border px-2 font-normal" value={draft.thankYouTitle} onChange={(event) => onChange({ ...draft, thankYouTitle: event.target.value })} />
      </label>
      <label className="block font-semibold">
        Thank-you message
        <textarea
          className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal"
          rows={4}
          value={draft.thankYouParagraphs.join("\n\n")}
          onChange={(event) =>
            onChange({
              ...draft,
              thankYouParagraphs: event.target.value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />
        Survey is open to respondents
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={draft.notifyOnSubmission}
          onChange={(event) => onChange({ ...draft, notifyOnSubmission: event.target.checked })}
        />
        Email the team when a response is submitted
      </label>
      <label className="block font-semibold">
        Notification recipients
        <textarea
          className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal"
          rows={3}
          placeholder="one email address per line"
          value={draft.notificationRecipients.join("\n")}
          onChange={(event) =>
            onChange({
              ...draft,
              notificationRecipients: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <p className="text-muted-foreground">
        Contact consent, the honeypot, submission limits, prize-draw eligibility and the approved prize-draw
        terms stay fixed. Publishing a survey cannot change those rules.
      </p>
    </div>
  );
}

function QuestionEditor({
  question,
  sections,
  onChange,
  onMove,
  onRemove,
}: {
  question: SurveyQuestionDefinition;
  sections: SurveyDocument["sections"];
  onChange: (patch: Partial<SurveyQuestionDefinition>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 border border-border p-4 text-sm">
      {question.lockedRole ? (
        <p className="text-muted-foreground">
          This question stays required. Prize-draw terms, eligibility declarations and contact consent rules are
          not edited here.
        </p>
      ) : null}
      <label className="block font-semibold">
        Question wording
        <textarea className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal" rows={3} value={question.prompt} onChange={(event) => onChange({ prompt: event.target.value })} />
      </label>
      <label className="block font-semibold">
        Description
        <textarea className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal" rows={2} value={question.description} onChange={(event) => onChange({ description: event.target.value })} />
      </label>
      <label className="block font-semibold">
        Section
        <select className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.sectionId} onChange={(event) => onChange({ sectionId: event.target.value })}>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.heading}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={question.required} disabled={Boolean(question.lockedRole)} onChange={(event) => onChange({ required: event.target.checked })} />
        Required
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={question.enabled} disabled={Boolean(question.lockedRole)} onChange={(event) => onChange({ enabled: event.target.checked })} />
        Enabled for future responses
      </label>
      {question.kind === "rating" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            Minimum
            <input type="number" className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.min} onChange={(event) => onChange({ min: Number(event.target.value) })} />
          </label>
          <label>
            Maximum
            <input type="number" className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.max} onChange={(event) => onChange({ max: Number(event.target.value) })} />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={question.allowNa} onChange={(event) => onChange({ allowNa: event.target.checked })} />
            Allow not applicable
          </label>
          {question.allowNa ? (
            <label className="sm:col-span-2">
              Not applicable label
              <input className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.naLabel} onChange={(event) => onChange({ naLabel: event.target.value })} />
            </label>
          ) : null}
        </div>
      ) : null}
      {question.kind === "multiple_choice" || question.kind === "checkbox" ? (
        <div className="space-y-2">
          {question.options.map((option, index) => (
            <div key={`${option.value}-${index}`} className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="h-10 rounded-md border border-border px-2"
                value={option.label}
                onChange={(event) =>
                  onChange({
                    options: question.options.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-destructive"
                onClick={() => onChange({ options: question.options.filter((_, itemIndex) => itemIndex !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="underline"
            onClick={() =>
              onChange({
                options: [...question.options, { value: `option_${question.options.length + 1}`, label: "New choice" }],
              })
            }
          >
            Add choice
          </button>
          {question.kind === "checkbox" ? (
            <label className="block">
              Maximum selections
              <input type="number" className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.maxSelections} onChange={(event) => onChange({ maxSelections: Number(event.target.value) })} />
            </label>
          ) : null}
        </div>
      ) : null}
      {question.kind === "yes_no" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            Yes label
            <input className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.yesLabel} onChange={(event) => onChange({ yesLabel: event.target.value })} />
          </label>
          <label>
            No label
            <input className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.noLabel} onChange={(event) => onChange({ noLabel: event.target.value })} />
          </label>
        </div>
      ) : null}
      {question.kind === "text" ? (
        <label className="block">
          Placeholder
          <input className="mt-1 h-10 w-full rounded-md border border-border px-2" value={question.placeholder} onChange={(event) => onChange({ placeholder: event.target.value })} />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="h-9 rounded-md border border-border px-3" onClick={() => onMove(-1)}>
          Move up
        </button>
        <button type="button" className="h-9 rounded-md border border-border px-3" onClick={() => onMove(1)}>
          Move down
        </button>
        {question.lockedRole ? null : (
          <button type="button" className="h-9 rounded-md border border-destructive/40 px-3 text-destructive" onClick={onRemove}>
            Remove from future versions
          </button>
        )}
      </div>
    </div>
  );
}
