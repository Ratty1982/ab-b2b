import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MARKETING_CHANNELS,
  PRIZE_DRAW_CLOSE_LABEL,
  PRIZE_DRAW_OPEN_LABEL,
  SALES_HELP_OPTIONS,
  SURVEY_QUESTIONS,
  SURVEY_SECTIONS,
  requiredSurveyFieldCount,
  surveyLayout,
  surveyProgress,
  type SalesHelpValue,
  type SurveyQuestion,
} from "@/domain/customer-survey";
import { SURVEY_PRIVACY_PARAGRAPHS } from "@/domain/survey-definition";
import { submitCustomerSurveyFn } from "@/server/surveys/fns";
import { cn } from "@/lib/utils";

type AnswerState = Record<string, number | "yes" | "no" | undefined>;

function numericAnswer(answers: AnswerState, field: string): number | undefined {
  const value = answers[field];
  return typeof value === "number" ? value : undefined;
}

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

function questionAnswered(
  question: SurveyQuestion,
  answers: AnswerState,
  salesHelp: string[],
): boolean {
  if (question.kind === "rating" || question.kind === "yesNo")
    return answers[question.field] != null;
  if (question.kind === "salesHelp") return true;
  if (question.kind === "text") return true;
  return true;
}

export function CustomerSurveyForm({
  prizeDrawOpen,
  thankYouTitle = "Thank you for your feedback",
  thankYouParagraphs = [
    "We really appreciate you taking the time to share your experience with Automotive Brands.",
    "Your feedback helps us understand what we are doing well and where we can continue to improve.",
  ],
  preview = false,
}: {
  prizeDrawOpen: boolean;
  thankYouTitle?: string;
  thankYouParagraphs?: string[];
  preview?: boolean;
}) {
  const [answers, setAnswers] = useState<AnswerState>({});
  const [salesHelp, setSalesHelp] = useState<SalesHelpValue[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [ukResident, setUkResident] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    reference: string | null;
    prizeDrawMessage: string | null;
  } | null>(null);

  const wantsContact = answers["contactPermission"] === "yes";
  const wantsPrize = answers["prizeDrawEntry"] === "yes" && prizeDrawOpen;
  const showContact = wantsContact || wantsPrize;

  const answered = useMemo(() => {
    return SURVEY_QUESTIONS.filter(
      (question) => question.kind === "rating" || question.kind === "yesNo",
    ).filter((question) => questionAnswered(question, answers, salesHelp)).length;
  }, [answers, salesHelp]);
  const total = requiredSurveyFieldCount();
  const progress = surveyProgress(answered, total);

  function setRating(field: string, value: number | "yes" | "no") {
    setAnswers((current) => ({ ...current, [field]: value }));
  }

  function toggleSalesHelp(value: SalesHelpValue) {
    setSalesHelp((current) => {
      if (value === "none") return current.includes("none") ? [] : ["none"];
      const withoutNone = current.filter((item) => item !== "none");
      if (withoutNone.includes(value)) return withoutNone.filter((item) => item !== value);
      if (withoutNone.length >= 3) return withoutNone;
      return [...withoutNone, value];
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) {
      setError("This is a preview. Responses are not saved.");
      return;
    }
    if (submitting || done) return;
    setError(null);
    setFieldErrors({});
    const missing = SURVEY_QUESTIONS.find(
      (question) =>
        (question.kind === "rating" || question.kind === "yesNo") &&
        answers[question.field] == null,
    );
    if (missing) {
      setError("Please complete all required questions before submitting the survey.");
      document
        .getElementById(`survey-${"field" in missing ? missing.field : "form"}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (showContact && (!name.trim() || !email.trim())) {
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
        ...Object.fromEntries(
          SURVEY_QUESTIONS.filter((question) => question.kind === "rating").map((question) => [
            question.field,
            answers[question.field],
          ]),
        ),
        salesHelpOptions: salesHelp,
        doWell: textValue("doWell"),
        couldImprove: textValue("couldImprove"),
        productRequests: textValue("productRequests"),
        additionalComments: textValue("additionalComments"),
        contactPermission: answers["contactPermission"],
        prizeDrawEntry: prizeDrawOpen ? answers["prizeDrawEntry"] : "no",
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
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      return;
    }
    window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
    setDone({ reference: result.reference, prizeDrawMessage: result.prizeDrawMessage });
  }

  function textValue(field: string): string {
    const node = document.getElementById(field);
    return node instanceof HTMLTextAreaElement ? node.value : "";
  }

  if (done) {
    return (
      <section className={cn(surveyLayout.section, "text-center")} aria-live="polite">
        <p className="text-3xl text-primary" aria-hidden="true">
          ✓
        </p>
        <h2 className="mt-3 font-display text-2xl font-semibold">{thankYouTitle}</h2>
        {thankYouParagraphs.map((paragraph) => (
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
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Return to Automotive Brands
        </Link>
      </section>
    );
  }

  const sections = SURVEY_SECTIONS.map((section) => ({
    section,
    questions: SURVEY_QUESTIONS.filter(
      (question) =>
        (question.section === section && question.kind !== "rating") ||
        (question.section === section &&
          question.kind === "rating" &&
          (question.number !== 9 || question.field === "marketingChannelWebsite")),
    ),
  }));

  return (
    <form
      id="sscs-form"
      className="space-y-6"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
    >
      <div className="sticky top-0 z-10 border border-border bg-background/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Survey progress"
        >
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div
        className="sscs-honeypot absolute left-[-9999px] h-0 w-0 overflow-hidden"
        aria-hidden="true"
      >
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>

      {sections.map(({ section, questions }) => (
        <section key={section} className={surveyLayout.section}>
          <h2 className="font-display text-lg font-semibold">{section}</h2>
          <div className="mt-4 space-y-6">
            {questions.map((question) => (
              <QuestionBlock
                key={`${question.number}-${"field" in question ? question.field : question.kind}`}
                question={question}
                answers={answers}
                salesHelp={salesHelp}
                prizeDrawOpen={prizeDrawOpen}
                onRating={setRating}
                onSalesHelp={toggleSalesHelp}
              />
            ))}
          </div>
        </section>
      ))}

      {showContact ? (
        <section className={surveyLayout.section} id="survey-contact">
          <h2 className="font-display text-lg font-semibold">Your contact details</h2>
          <p className="mt-1 text-sm text-muted-foreground">Please provide your details below.</p>
          <label className="mt-4 block text-sm font-semibold" htmlFor="customer_name">
            Name
            <input
              id="customer_name"
              className={cn(surveyLayout.control, "mt-1")}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {fieldErrors["customerName"] ? (
            <p className="mt-1 text-sm text-destructive">{fieldErrors["customerName"]}</p>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="customer_email">
            Email address
            <input
              id="customer_email"
              type="email"
              className={cn(surveyLayout.control, "mt-1")}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {fieldErrors["customerEmail"] ? (
            <p className="mt-1 text-sm text-destructive">{fieldErrors["customerEmail"]}</p>
          ) : null}
          <label className="mt-3 block text-sm font-semibold" htmlFor="customer_phone">
            Telephone number <span className="font-normal text-muted-foreground">(optional)</span>
            <input
              id="customer_phone"
              className={cn(surveyLayout.control, "mt-1")}
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          {wantsPrize ? (
            <div className="mt-4 space-y-3 text-sm">
              <label className="block font-semibold" htmlFor="business_name">
                Business name
                <input
                  id="business_name"
                  className={cn(surveyLayout.control, "mt-1")}
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                />
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={ukResident}
                  onChange={(event) => setUkResident(event.target.checked)}
                />
                <span>I confirm I am a resident of the United Kingdom aged 18 or over.</span>
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={notConnected}
                  onChange={(event) => setNotConnected(event.target.checked)}
                />
                <span>
                  I am not an employee of the Promoter, an immediate family member, an agent, or
                  anyone else connected with the administration of the prize draw.
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
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
        <p
          id="sscs-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        id="sscs-submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? "Submitting..." : preview ? "Preview only" : "Submit My Feedback"}
      </button>
    </form>
  );
}

function QuestionBlock({
  question,
  answers,
  salesHelp,
  prizeDrawOpen,
  onRating,
  onSalesHelp,
}: {
  question: SurveyQuestion;
  answers: AnswerState;
  salesHelp: SalesHelpValue[];
  prizeDrawOpen: boolean;
  onRating: (field: string, value: number | "yes" | "no") => void;
  onSalesHelp: (value: SalesHelpValue) => void;
}) {
  if (question.kind === "text") {
    return (
      <div>
        <label htmlFor={question.field} className="block">
          <span className="font-medium">{question.prompt}</span>
          <textarea
            id={question.field}
            name={question.field}
            rows={4}
            placeholder={question.placeholder}
            className={surveyLayout.textArea}
          />
        </label>
      </div>
    );
  }

  if (question.kind === "salesHelp") {
    const noneSelected = salesHelp.includes("none");
    return (
      <fieldset>
        <legend className="font-medium">{question.prompt}</legend>
        <p className="mt-1 text-sm text-muted-foreground">
          {noneSelected ? "1/3 selected" : `${salesHelp.length}/3 selected`}
        </p>
        <div className={surveyLayout.ratingGroup}>
          {SALES_HELP_OPTIONS.map((option) => {
            const checked = salesHelp.includes(option.value);
            const disabled =
              !checked &&
              (noneSelected ||
                (!noneSelected && option.value !== "none" && salesHelp.length >= 3) ||
                (noneSelected && option.value !== "none"));
            return (
              <label
                key={option.value}
                className={cn(
                  surveyLayout.control,
                  disabled && "opacity-50",
                  checked && "border-primary",
                )}
              >
                <input
                  type="checkbox"
                  name="sales_help_options"
                  value={option.value}
                  checked={checked}
                  disabled={disabled && option.value !== "none"}
                  onChange={() => onSalesHelp(option.value)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (question.kind === "yesNo") {
    const closedPrize = question.field === "prizeDrawEntry" && !prizeDrawOpen;
    return (
      <fieldset id={`survey-${question.field}`}>
        <legend className="font-medium">{question.prompt}</legend>
        {question.help ? (
          <p className="mt-1 text-sm text-muted-foreground">{question.help}</p>
        ) : null}
        {question.field === "prizeDrawEntry" ? (
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
          <label
            className={cn(
              surveyLayout.control,
              answers[question.field] === "yes" && "border-primary",
              closedPrize && "opacity-50",
            )}
          >
            <input
              type="radio"
              name={question.field}
              value="yes"
              disabled={closedPrize}
              checked={answers[question.field] === "yes"}
              onChange={() => onRating(question.field, "yes")}
            />
            <span>{question.yesLabel}</span>
          </label>
          <label
            className={cn(
              surveyLayout.control,
              answers[question.field] === "no" && "border-primary",
            )}
          >
            <input
              type="radio"
              name={question.field}
              value="no"
              checked={answers[question.field] === "no"}
              onChange={() => onRating(question.field, "no")}
            />
            <span>{question.noLabel}</span>
          </label>
        </div>
      </fieldset>
    );
  }

  if (question.number === 9 && question.field === "marketingChannelWebsite") {
    return (
      <div>
        <h3 className="font-medium">
          9. Our marketing channels — How useful are the following Automotive Brands marketing
          channels to your business?
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          For each channel, select a usefulness rating or “Haven't seen or used this”.
        </p>
        <div className="mt-4 space-y-4">
          {MARKETING_CHANNELS.map((channel) => {
            const channelQuestion = SURVEY_QUESTIONS.find(
              (item) => item.kind === "rating" && item.field === channel.field,
            );
            if (!channelQuestion || channelQuestion.kind !== "rating") return null;
            return (
              <RatingControl
                key={channel.field}
                name={channel.field}
                legend={channel.label}
                question={channelQuestion}
                value={numericAnswer(answers, channel.field)}
                onChange={(value) => onRating(channel.field, value)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (question.kind === "rating" && question.number === 9) return null;

  return (
    <RatingControl
      name={question.field}
      legend={question.prompt}
      {...(question.help ? { help: question.help } : {})}
      question={question}
      value={numericAnswer(answers, question.field)}
      onChange={(value) => onRating(question.field, value)}
    />
  );
}

function RatingControl({
  name,
  legend,
  help,
  question,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  help?: string;
  question: Extract<SurveyQuestion, { kind: "rating" }>;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  const scores =
    question.field === "recommendationScore"
      ? Array.from({ length: 11 }, (_, score) => score)
      : [5, 4, 3, 2, 1];
  return (
    <fieldset id={`survey-${name}`}>
      <legend className="font-medium">{legend}</legend>
      {help ? <p className="mt-1 text-sm text-muted-foreground">{help}</p> : null}
      <div
        className={
          question.field === "recommendationScore"
            ? "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6"
            : surveyLayout.ratingGroup
        }
      >
        {scores.map((score) => (
          <label
            key={score}
            className={cn(surveyLayout.control, value === score && "border-primary")}
          >
            <input
              type="radio"
              name={name}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
            />
            <span>
              <strong>{score}</strong>
              {question.field === "recommendationScore" ? null : (
                <small className="ml-2 text-muted-foreground">{question.labels[score]}</small>
              )}
            </span>
          </label>
        ))}
        {question.allowNa ? (
          <label className={cn(surveyLayout.control, value === 0 && "border-primary")}>
            <input
              type="radio"
              name={name}
              value={0}
              checked={value === 0}
              onChange={() => onChange(0)}
            />
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
