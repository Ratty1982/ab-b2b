import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PRIZE_DRAW_CLOSE_LABEL,
  PRIZE_DRAW_OPEN_LABEL,
  isSurveyEmail,
  surveyLayout,
  surveyProgress,
} from "@/domain/customer-survey";
import {
  SURVEY_PRIVACY_PARAGRAPHS,
  type SurveyDocument,
  type SurveyQuestionDefinition,
} from "@/domain/survey-definition";
import { submitCustomerSurveyFn } from "@/server/surveys/fns";
import { cn } from "@/lib/utils";

type AnswerValue = number | string | string[];

const TOKEN_KEY = "ab-customer-survey-token";
const IDEMPOTENCY_KEY = "ab-customer-survey-idempotency";

function storedToken(key: string): string {
  const existing = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  if (key === TOKEN_KEY) window.localStorage.setItem(key, created);
  else window.sessionStorage.setItem(key, created);
  return created;
}

function answered(question: SurveyQuestionDefinition, value: AnswerValue | undefined): boolean {
  if (!question.required) return true;
  if (question.kind === "rating") return typeof value === "number";
  if (question.kind === "yes_no") return value === "yes" || value === "no";
  if (question.kind === "text") return typeof value === "string" && value.trim().length > 0;
  if (question.kind === "multiple_choice") return typeof value === "string" && value.length > 0;
  return Array.isArray(value) && value.length > 0;
}

export function PublishedSurveyForm({
  document,
  prizeDrawOpen,
  preview = false,
}: {
  document: SurveyDocument;
  prizeDrawOpen: boolean;
  preview?: boolean;
}) {
  const questions = document.questions.filter((question) => question.enabled);
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [ukResident, setUkResident] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ reference: string | null; prizeDrawMessage: string | null } | null>(
    null,
  );

  const contact = questions.find((question) => question.lockedRole === "contact_permission");
  const prize = questions.find((question) => question.lockedRole === "prize_draw");
  const wantsContact = contact ? values[contact.id] === "yes" : false;
  const wantsPrize = prize ? values[prize.id] === "yes" && prizeDrawOpen : false;
  const showContact = wantsContact || wantsPrize;
  const required = questions.filter((question) => question.required);
  const progress = surveyProgress(
    required.filter((question) => answered(question, values[question.id])).length,
    required.length,
  );

  const sections = useMemo(
    () =>
      [...document.sections]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((section) => ({
          section,
          questions: questions
            .filter((question) => question.sectionId === section.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        }))
        .filter((section) => section.questions.length > 0),
    [document.sections, questions],
  );

  function setValue(id: string, value: AnswerValue) {
    setValues((current) => ({ ...current, [id]: value }));
  }

  function toggleCheck(question: SurveyQuestionDefinition, option: string) {
    const current = Array.isArray(values[question.id]) ? (values[question.id] as string[]) : [];
    if (question.exclusiveValues.includes(option)) {
      setValue(question.id, current.includes(option) ? [] : [option]);
      return;
    }
    const withoutExclusive = current.filter((item) => !question.exclusiveValues.includes(item));
    if (withoutExclusive.includes(option)) {
      setValue(
        question.id,
        withoutExclusive.filter((item) => item !== option),
      );
      return;
    }
    if (withoutExclusive.length >= question.maxSelections) return;
    setValue(question.id, [...withoutExclusive, option]);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) {
      setError("This is a preview. Responses are not saved.");
      return;
    }
    if (submitting || done) return;
    const missing = required.find((question) => !answered(question, values[question.id]));
    if (missing) {
      setError("Please complete all required questions before submitting the survey.");
      return;
    }
    if (showContact && (!name.trim() || !isSurveyEmail(email))) {
      setError("Please provide your name and email address so that we can contact you.");
      return;
    }
    if (wantsPrize && (!businessName.trim() || !ukResident || !notConnected || !termsAccepted)) {
      setError(
        "Please confirm the prize draw eligibility statements, accept the terms, and provide your business name.",
      );
      return;
    }
    setSubmitting(true);
    const result = await submitCustomerSurveyFn({
      data: {
        idempotencyKey: storedToken(IDEMPOTENCY_KEY),
        submissionToken: storedToken(TOKEN_KEY),
        website,
        answers: questions.map((question) => ({
          questionId: question.id,
          value:
            question.lockedRole === "prize_draw" && !prizeDrawOpen ? "no" : (values[question.id] ?? null),
        })),
        customerName: showContact ? name : "",
        customerEmail: showContact ? email : "",
        customerPhone: showContact ? phone : "",
        businessName: wantsPrize ? businessName : "",
        ukResidentAdultConfirmed: wantsPrize ? ukResident : false,
        notConnectedConfirmed: wantsPrize ? notConnected : false,
        termsAccepted: wantsPrize ? termsAccepted : false,
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
    setDone({ reference: result.reference, prizeDrawMessage: result.prizeDrawMessage });
  }

  if (done) {
    return (
      <section className={cn(surveyLayout.section, "text-center")} aria-live="polite">
        <h2 className="font-display text-2xl font-semibold">{document.thankYouTitle}</h2>
        {document.thankYouParagraphs.map((paragraph) => (
          <p key={paragraph} className="mt-3 text-sm text-muted-foreground">
            {paragraph}
          </p>
        ))}
        {done.reference ? (
          <p className="mt-4 text-sm">
            Survey reference <strong>{done.reference}</strong>
          </p>
        ) : null}
        {done.prizeDrawMessage ? <p className="mt-3 text-sm">{done.prizeDrawMessage}</p> : null}
      </section>
    );
  }

  const renderedGroups = new Set<string>();

  return (
    <form className="space-y-6" onSubmit={(event) => void onSubmit(event)} noValidate>
      {preview ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          Preview of unpublished changes. Responses are not saved.
        </p>
      ) : null}
      <div className="sticky top-0 z-10 border border-border bg-background/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="sscs-honeypot absolute left-[-9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} />
        </label>
      </div>
      {sections.map(({ section, questions: sectionQuestions }) => (
        <section key={section.id} className={surveyLayout.section}>
          <h2 className="font-display text-lg font-semibold">{section.heading}</h2>
          {section.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
          ) : null}
          <div className="mt-4 space-y-6">
            {sectionQuestions.map((question) => {
              if (question.groupId) {
                if (renderedGroups.has(question.groupId)) return null;
                renderedGroups.add(question.groupId);
                const grouped = questions.filter((item) => item.groupId === question.groupId);
                return (
                  <div key={question.groupId}>
                    <h3 className="font-medium">{question.groupPrompt || question.prompt}</h3>
                    {question.groupDescription ? (
                      <p className="mt-1 text-sm text-muted-foreground">{question.groupDescription}</p>
                    ) : null}
                    <div className="mt-4 space-y-4">
                      {grouped.map((item) => (
                        <QuestionFields
                          key={item.id}
                          question={item}
                          value={values[item.id]}
                          prizeDrawOpen={prizeDrawOpen}
                          onChange={setValue}
                          onToggle={toggleCheck}
                        />
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <QuestionFields
                  key={question.id}
                  question={question}
                  value={values[question.id]}
                  prizeDrawOpen={prizeDrawOpen}
                  onChange={setValue}
                  onToggle={toggleCheck}
                />
              );
            })}
          </div>
        </section>
      ))}
      {showContact ? (
        <section className={surveyLayout.section}>
          <h2 className="font-display text-lg font-semibold">Your contact details</h2>
          <label className="mt-4 block text-sm font-semibold">
            Name
            <input className={cn(surveyLayout.control, "mt-1")} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="mt-3 block text-sm font-semibold">
            Email address
            <input className={cn(surveyLayout.control, "mt-1")} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="mt-3 block text-sm font-semibold">
            Telephone number <span className="font-normal text-muted-foreground">(optional)</span>
            <input className={cn(surveyLayout.control, "mt-1")} value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          {wantsPrize ? (
            <div className="mt-4 space-y-3 text-sm">
              <label className="block font-semibold">
                Business name
                <input
                  className={cn(surveyLayout.control, "mt-1")}
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                />
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" className="mt-1 size-4" checked={ukResident} onChange={(event) => setUkResident(event.target.checked)} />
                <span>I confirm I am a resident of the United Kingdom aged 18 or over.</span>
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" className="mt-1 size-4" checked={notConnected} onChange={(event) => setNotConnected(event.target.checked)} />
                <span>
                  I am not an employee of the Promoter, an immediate family member, an agent, or anyone else
                  connected with the administration of the prize draw.
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" className="mt-1 size-4" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                <span>
                  I agree to the{" "}
                  <Link to="/free-prize-draw-terms-conditions" className="underline">
                    free prize draw terms and conditions
                  </Link>
                  .
                </span>
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="text-sm text-muted-foreground">
        {SURVEY_PRIVACY_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph} className="mt-2 first:mt-0">
            {paragraph}
          </p>
        ))}
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {preview ? "Preview only" : submitting ? "Submitting..." : "Submit My Feedback"}
      </button>
    </form>
  );
}

function QuestionFields({
  question,
  value,
  prizeDrawOpen,
  onChange,
  onToggle,
}: {
  question: SurveyQuestionDefinition;
  value: AnswerValue | undefined;
  prizeDrawOpen: boolean;
  onChange: (id: string, value: AnswerValue) => void;
  onToggle: (question: SurveyQuestionDefinition, option: string) => void;
}) {
  if (question.kind === "text") {
    return (
      <label className="block">
        <span className="font-medium">
          {question.prompt}
          {question.required ? "" : ""}
        </span>
        {question.description ? <p className="mt-1 text-sm text-muted-foreground">{question.description}</p> : null}
        <textarea
          className={surveyLayout.textArea}
          placeholder={question.placeholder}
          maxLength={question.maxLength}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(question.id, event.target.value)}
        />
      </label>
    );
  }
  if (question.kind === "yes_no") {
    const closedPrize = question.lockedRole === "prize_draw" && !prizeDrawOpen;
    return (
      <fieldset>
        <legend className="font-medium">{question.prompt}</legend>
        {question.description ? <p className="mt-1 text-sm text-muted-foreground">{question.description}</p> : null}
        {question.lockedRole === "prize_draw" ? (
          <p className="mt-1 text-sm">
            <Link to="/free-prize-draw-terms-conditions" className="underline">
              Prize draw terms and conditions
            </Link>
            {closedPrize
              ? ` The prize draw opens at ${PRIZE_DRAW_OPEN_LABEL} and closes at ${PRIZE_DRAW_CLOSE_LABEL} UK time.`
              : null}
          </p>
        ) : null}
        <div className={surveyLayout.ratingGroup}>
          {(["yes", "no"] as const).map((choice) => (
            <label
              key={choice}
              className={cn(surveyLayout.control, value === choice && "border-primary", closedPrize && choice === "yes" && "opacity-50")}
            >
              <input
                type="radio"
                name={question.id}
                disabled={closedPrize && choice === "yes"}
                checked={value === choice}
                onChange={() => onChange(question.id, choice)}
              />
              <span>{choice === "yes" ? question.yesLabel : question.noLabel}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.kind === "multiple_choice" || question.kind === "checkbox") {
    const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return (
      <fieldset>
        <legend className="font-medium">{question.prompt}</legend>
        {question.description ? <p className="mt-1 text-sm text-muted-foreground">{question.description}</p> : null}
        <div className={surveyLayout.ratingGroup}>
          {question.options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className={cn(surveyLayout.control, checked && "border-primary")}>
                <input
                  type={question.kind === "checkbox" ? "checkbox" : "radio"}
                  name={question.id}
                  checked={checked}
                  onChange={() =>
                    question.kind === "checkbox"
                      ? onToggle(question, option.value)
                      : onChange(question.id, option.value)
                  }
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }
  const low = question.allowNa ? Math.max(question.min, 1) : question.min;
  const descending = question.max - low <= 5;
  const ratingScores = descending
    ? Array.from({ length: question.max - low + 1 }, (_, index) => question.max - index)
    : Array.from({ length: question.max - question.min + 1 }, (_, index) => question.min + index);
  return (
    <fieldset>
      <legend className="font-medium">{question.prompt}</legend>
      {question.description ? <p className="mt-1 text-sm text-muted-foreground">{question.description}</p> : null}
      <div className={question.max > 5 ? "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6" : surveyLayout.ratingGroup}>
        {ratingScores.map((score) => (
          <label key={score} className={cn(surveyLayout.control, value === score && "border-primary")}>
            <input type="radio" name={question.id} checked={value === score} onChange={() => onChange(question.id, score)} />
            <span>
              <strong>{score}</strong>
              {question.labels[String(score)] ? (
                <small className="ml-2 text-muted-foreground">{question.labels[String(score)]}</small>
              ) : null}
            </span>
          </label>
        ))}
        {question.allowNa ? (
          <label className={cn(surveyLayout.control, value === 0 && "border-primary")}>
            <input type="radio" name={question.id} checked={value === 0} onChange={() => onChange(question.id, 0)} />
            <span>
              <strong>N/A</strong>
              <small className="ml-2 text-muted-foreground">{question.naLabel}</small>
            </span>
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}
