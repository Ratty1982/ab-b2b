import { useState, type ReactNode } from "react";
import { Field, inputClass } from "@/components/ab/Drawer";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import { cmsMediaDisplaySrc } from "@/lib/cms-media";

const BENEFIT_ICONS = [
  { value: "pricing", label: "Pricing" },
  { value: "account", label: "Account" },
  { value: "case", label: "Case" },
  { value: "stock", label: "Stock" },
  { value: "order", label: "Order" },
  { value: "support", label: "Support" },
] as const;

function str(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => asRecord(row));
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-border/70 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{title}</div>
      {children}
    </div>
  );
}

function moveRow(items: Record<string, unknown>[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const copy = items.slice();
  const [row] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, row!);
  return copy;
}

function RowActions({
  index,
  total,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold uppercase disabled:opacity-40"
      >
        Move up
      </button>
      <button
        type="button"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
        className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold uppercase disabled:opacity-40"
      >
        Move down
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold uppercase"
      >
        Remove
      </button>
    </div>
  );
}

function MediaSlot({
  label,
  slot,
  media,
  onMedia,
  note,
}: {
  label: string;
  slot: string;
  media: Record<string, unknown>;
  onMedia: (next: Record<string, unknown>) => void;
  note: string;
}) {
  const [open, setOpen] = useState(false);
  const preview = cmsMediaDisplaySrc(media);
  const alt = typeof media["alt"] === "string" ? media["alt"] : "";
  const focalX = typeof media["focalX"] === "number" ? media["focalX"] : 50;
  const focalY = typeof media["focalY"] === "number" ? media["focalY"] : 50;

  function applyItem(item: CmsMediaListItem) {
    onMedia({
      ...media,
      mediaId: item.id,
      src: item.src,
      alt: alt || item.altText || "",
      fit: "fill",
      focalX,
      focalY,
    });
  }

  return (
    <div className="grid gap-2" data-media-slot={slot}>
      <Field label={label}>
        <div className="overflow-hidden rounded-md border border-border bg-ink">
          {preview ? (
            <img
              src={preview}
              alt={alt || label}
              className="aspect-video w-full object-cover"
              style={{ objectPosition: `${focalX}% ${focalY}%` }}
            />
          ) : (
            <div className="grid aspect-video place-items-center px-4 text-center text-[12px] text-steel">{note}</div>
          )}
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
        >
          {preview ? "Replace image" : "Choose image"}
        </button>
        {preview ? (
          <button
            type="button"
            onClick={() => onMedia({ alt })}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
          >
            Remove image
          </button>
        ) : null}
      </div>
      <Field label="Focal position (horizontal)">
        <input
          type="range"
          min={0}
          max={100}
          value={focalX}
          onChange={(event) => onMedia({ ...media, focalX: Number(event.target.value), focalY })}
        />
      </Field>
      <Field label="Focal position (vertical)">
        <input
          type="range"
          min={0}
          max={100}
          value={focalY}
          onChange={(event) => onMedia({ ...media, focalX, focalY: Number(event.target.value) })}
        />
      </Field>
      <Field label="Image alt text">
        <input value={alt} onChange={(event) => onMedia({ ...media, alt: event.target.value })} className={inputClass} />
      </Field>
      <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={applyItem} />
    </div>
  );
}

export function TradeSolutionsSectionSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const hero = asRecord(config["hero"]);
  const portal = asRecord(config["portal"]);
  const benefits = asRecord(config["benefits"]);
  const steps = asRecord(config["steps"]);
  const brands = asRecord(config["brands"]);
  const faq = asRecord(config["faq"]);
  const close = asRecord(config["close"]);
  const points = asRows(hero["points"]);
  const benefitItems = asRows(benefits["items"]);
  const stepItems = asRows(steps["items"]);
  const faqs = asRows(config["faqs"]);
  const steelSeal = asRecord(brands["steelSeal"]);
  const powerMaxed = asRecord(brands["powerMaxed"]);

  return (
    <div className="grid gap-3" data-cms-editor="trade-solutions">
      <p className="text-[12px] leading-relaxed text-steel">
        This template edits the public Trade Solutions page. Steel Seal stays first and Power Maxed second. Page SEO
        title and meta description are edited in page settings.
      </p>
      <Group title="Hero">
        <Field label="Eyebrow">
          <input
            value={str(hero, "eyebrow")}
            onChange={(event) => onChange("hero", { ...hero, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <textarea
            rows={3}
            value={str(hero, "headline")}
            onChange={(event) => onChange("hero", { ...hero, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(hero, "highlight")}
            onChange={(event) => onChange("hero", { ...hero, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={4}
            value={str(hero, "description")}
            onChange={(event) => onChange("hero", { ...hero, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA label">
          <input
            value={str(hero, "ctaLabel")}
            onChange={(event) => onChange("hero", { ...hero, ctaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA link">
          <input
            value={str(hero, "ctaHref")}
            onChange={(event) => onChange("hero", { ...hero, ctaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA label">
          <input
            value={str(hero, "secondaryCtaLabel")}
            onChange={(event) => onChange("hero", { ...hero, secondaryCtaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA link">
          <input
            value={str(hero, "secondaryCtaHref")}
            onChange={(event) => onChange("hero", { ...hero, secondaryCtaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-2">
          {points.map((point, index) => (
            <div key={`point-${index}`} className="grid gap-2 rounded-md border border-border/70 p-2">
              <Field label={`Highlight ${index + 1}`}>
                <input
                  value={str(point, "title")}
                  onChange={(event) => {
                    const next = points.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, title: event.target.value } : row,
                    );
                    onChange("hero", { ...hero, points: next });
                  }}
                  className={inputClass}
                />
              </Field>
              <RowActions
                index={index}
                total={points.length}
                onMove={(direction) => onChange("hero", { ...hero, points: moveRow(points, index, direction) })}
                onRemove={() => onChange("hero", { ...hero, points: points.filter((_, rowIndex) => rowIndex !== index) })}
              />
            </div>
          ))}
          {points.length < 4 ? (
            <button
              type="button"
              className="h-9 rounded-md border border-border text-[12px] font-semibold"
              onClick={() => onChange("hero", { ...hero, points: [...points, { title: "New highlight", body: "" }] })}
            >
              Add highlight
            </button>
          ) : null}
        </div>
        <MediaSlot
          label="Hero photograph"
          slot="hero"
          media={asRecord(hero["media"])}
          onMedia={(media) => onChange("hero", { ...hero, media })}
          note="Choose a licensed workshop photograph. The page uses a dark panel until one is selected."
        />
      </Group>
      <Group title="Trade portal">
        <Field label="Eyebrow">
          <input
            value={str(portal, "eyebrow")}
            onChange={(event) => onChange("portal", { ...portal, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <textarea
            rows={3}
            value={str(portal, "headline")}
            onChange={(event) => onChange("portal", { ...portal, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(portal, "highlight")}
            onChange={(event) => onChange("portal", { ...portal, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={4}
            value={str(portal, "description")}
            onChange={(event) => onChange("portal", { ...portal, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="CTA label">
          <input
            value={str(portal, "ctaLabel")}
            onChange={(event) => onChange("portal", { ...portal, ctaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="CTA link">
          <input
            value={str(portal, "ctaHref")}
            onChange={(event) => onChange("portal", { ...portal, ctaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <MediaSlot
          label="Portal screenshot"
          slot="portal"
          media={asRecord(portal["media"])}
          onMedia={(media) => onChange("portal", { ...portal, media })}
          note="Use a screenshot of the real trade portal. Do not upload sample products, prices or customer data."
        />
      </Group>
      <Group title="Benefits">
        <Field label="Eyebrow">
          <input
            value={str(benefits, "eyebrow")}
            onChange={(event) => onChange("benefits", { ...benefits, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(benefits, "headline")}
            onChange={(event) => onChange("benefits", { ...benefits, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(benefits, "highlight")}
            onChange={(event) => onChange("benefits", { ...benefits, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        {benefitItems.map((item, index) => (
          <div key={`benefit-${index}`} className="grid gap-2 rounded-md border border-border/70 p-2">
            <Field label="Icon">
              <select
                value={str(item, "icon", "pricing")}
                onChange={(event) => {
                  const next = benefitItems.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, icon: event.target.value } : row,
                  );
                  onChange("benefits", { ...benefits, items: next });
                }}
                className={inputClass}
              >
                {BENEFIT_ICONS.map((icon) => (
                  <option key={icon.value} value={icon.value}>
                    {icon.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <input
                value={str(item, "title")}
                onChange={(event) => {
                  const next = benefitItems.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, title: event.target.value } : row,
                  );
                  onChange("benefits", { ...benefits, items: next });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                value={str(item, "body")}
                onChange={(event) => {
                  const next = benefitItems.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, body: event.target.value } : row,
                  );
                  onChange("benefits", { ...benefits, items: next });
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={benefitItems.length}
              onMove={(direction) =>
                onChange("benefits", { ...benefits, items: moveRow(benefitItems, index, direction) })
              }
              onRemove={() =>
                onChange("benefits", {
                  ...benefits,
                  items: benefitItems.filter((_, rowIndex) => rowIndex !== index),
                })
              }
            />
          </div>
        ))}
        {benefitItems.length < 8 ? (
          <button
            type="button"
            className="h-9 rounded-md border border-border text-[12px] font-semibold"
            onClick={() =>
              onChange("benefits", {
                ...benefits,
                items: [...benefitItems, { icon: "pricing", title: "New benefit", body: "" }],
              })
            }
          >
            Add benefit
          </button>
        ) : null}
      </Group>
      <Group title="How it works">
        <Field label="Eyebrow">
          <input
            value={str(steps, "eyebrow")}
            onChange={(event) => onChange("steps", { ...steps, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(steps, "headline")}
            onChange={(event) => onChange("steps", { ...steps, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={2}
            value={str(steps, "description")}
            onChange={(event) => onChange("steps", { ...steps, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        {stepItems.map((item, index) => (
          <div key={`step-${index}`} className="grid gap-2 rounded-md border border-border/70 p-2">
            <Field label={`Step ${String(index + 1).padStart(2, "0")} title`}>
              <input
                value={str(item, "title")}
                onChange={(event) => {
                  const next = stepItems.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, title: event.target.value } : row,
                  );
                  onChange("steps", { ...steps, items: next });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={2}
                value={str(item, "body")}
                onChange={(event) => {
                  const next = stepItems.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, body: event.target.value } : row,
                  );
                  onChange("steps", { ...steps, items: next });
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={stepItems.length}
              onMove={(direction) => onChange("steps", { ...steps, items: moveRow(stepItems, index, direction) })}
              onRemove={() =>
                onChange("steps", { ...steps, items: stepItems.filter((_, rowIndex) => rowIndex !== index) })
              }
            />
          </div>
        ))}
        {stepItems.length < 4 ? (
          <button
            type="button"
            className="h-9 rounded-md border border-border text-[12px] font-semibold"
            onClick={() =>
              onChange("steps", { ...steps, items: [...stepItems, { title: "New step", body: "" }] })
            }
          >
            Add step
          </button>
        ) : null}
      </Group>
      <Group title="Two specialist brands">
        <p className="text-[12px] leading-relaxed text-steel">
          Steel Seal is always shown first. Power Maxed is always second. Logos stay the approved brand marks.
        </p>
        <Field label="Eyebrow">
          <input
            value={str(brands, "eyebrow")}
            onChange={(event) => onChange("brands", { ...brands, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(brands, "headline")}
            onChange={(event) => onChange("brands", { ...brands, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={4}
            value={str(brands, "description")}
            onChange={(event) => onChange("brands", { ...brands, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA label">
          <input
            value={str(brands, "ctaLabel")}
            onChange={(event) => onChange("brands", { ...brands, ctaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA link">
          <input
            value={str(brands, "ctaHref")}
            onChange={(event) => onChange("brands", { ...brands, ctaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA label">
          <input
            value={str(brands, "secondaryCtaLabel")}
            onChange={(event) => onChange("brands", { ...brands, secondaryCtaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA link">
          <input
            value={str(brands, "secondaryCtaHref")}
            onChange={(event) => onChange("brands", { ...brands, secondaryCtaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <MediaSlot
          label="Steel Seal photography"
          slot="steel-seal"
          media={asRecord(steelSeal["media"])}
          onMedia={(media) => onChange("brands", { ...brands, steelSeal: { ...steelSeal, media } })}
          note="No photograph selected. The published page keeps a dark panel and the Steel Seal logo."
        />
        <MediaSlot
          label="Power Maxed photography"
          slot="power-maxed"
          media={asRecord(powerMaxed["media"])}
          onMedia={(media) => onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, media } })}
          note="No photograph selected. The published page keeps a dark panel and the Power Maxed logo."
        />
      </Group>
      <Group title="Frequently asked questions">
        <Field label="Eyebrow">
          <input
            value={str(faq, "eyebrow")}
            onChange={(event) => onChange("faq", { ...faq, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(faq, "headline")}
            onChange={(event) => onChange("faq", { ...faq, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(faq, "highlight")}
            onChange={(event) => onChange("faq", { ...faq, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        {faqs.map((item, index) => (
          <div key={`faq-${index}`} className="grid gap-2 rounded-md border border-border/70 p-2" data-faq-editor-row={index}>
            <Field label="Question">
              <input
                value={str(item, "question")}
                onChange={(event) => {
                  const next = faqs.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, question: event.target.value } : row,
                  );
                  onChange("faqs", next);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Answer">
              <textarea
                rows={3}
                value={str(item, "answer")}
                onChange={(event) => {
                  const next = faqs.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, answer: event.target.value } : row,
                  );
                  onChange("faqs", next);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Review note (editors only)">
              <input
                value={str(item, "reviewNote")}
                onChange={(event) => {
                  const next = faqs.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, reviewNote: event.target.value } : row,
                  );
                  onChange("faqs", next);
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={faqs.length}
              onMove={(direction) => onChange("faqs", moveRow(faqs, index, direction))}
              onRemove={() => onChange("faqs", faqs.filter((_, rowIndex) => rowIndex !== index))}
            />
          </div>
        ))}
        {faqs.length < 20 ? (
          <button
            type="button"
            className="h-9 rounded-md border border-border text-[12px] font-semibold"
            onClick={() =>
              onChange("faqs", [
                ...faqs,
                { question: "New question", answer: "", reviewNote: "Review this answer before publishing." },
              ])
            }
          >
            Add question
          </button>
        ) : null}
      </Group>
      <Group title="Closing call to action">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={close["enabled"] === true}
            onChange={(event) => onChange("close", { ...close, enabled: event.target.checked })}
          />
          Show a closing section after the questions
        </label>
        <Field label="Heading">
          <textarea
            rows={2}
            value={str(close, "headline")}
            onChange={(event) => onChange("close", { ...close, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={3}
            value={str(close, "description")}
            onChange={(event) => onChange("close", { ...close, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA label">
          <input
            value={str(close, "ctaLabel")}
            onChange={(event) => onChange("close", { ...close, ctaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Primary CTA link">
          <input
            value={str(close, "ctaHref")}
            onChange={(event) => onChange("close", { ...close, ctaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA label">
          <input
            value={str(close, "secondaryCtaLabel")}
            onChange={(event) => onChange("close", { ...close, secondaryCtaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA link">
          <input
            value={str(close, "secondaryCtaHref")}
            onChange={(event) => onChange("close", { ...close, secondaryCtaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
      </Group>
    </div>
  );
}
