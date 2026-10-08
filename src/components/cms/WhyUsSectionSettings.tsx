import { useState, type ReactNode } from "react";
import { Field, inputClass } from "@/components/ab/Drawer";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import { cmsMediaDisplaySrc } from "@/lib/cms-media";

const SUPPORT_ICONS = [
  { value: "distribution", label: "Distribution" },
  { value: "development", label: "Product development" },
  { value: "marketing", label: "Marketing" },
  { value: "partnership", label: "Partnership" },
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

function ShowToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
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

export function WhyUsSectionSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const hero = asRecord(config["hero"]);
  const stats = asRecord(config["stats"]);
  const story = asRecord(config["story"]);
  const support = asRecord(config["support"]);
  const testimonials = asRecord(config["testimonials"]);
  const brands = asRecord(config["brands"]);
  const team = asRecord(config["team"]);
  const close = asRecord(config["close"]);
  const statItems = asRows(stats["items"]);
  const supportItems = asRows(support["items"]);
  const quotes = asRows(testimonials["items"]);
  const steelSeal = asRecord(brands["steelSeal"]);
  const powerMaxed = asRecord(brands["powerMaxed"]);

  return (
    <div className="grid gap-3" data-cms-editor="why-us">
      <p className="text-[12px] leading-relaxed text-steel">
        This template edits the public Why Automotive Brands page. Steel Seal stays first and Power Maxed second. Page
        SEO title and meta description are edited in page settings. Review notes stay in the editor.
      </p>

      <Group title="Hero">
        <ShowToggle
          label="Show hero"
          checked={hero["enabled"] !== false}
          onChange={(checked) => onChange("hero", { ...hero, enabled: checked })}
        />
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
        <MediaSlot
          label="Hero image"
          slot="hero"
          media={asRecord(hero["media"])}
          onMedia={(media) => onChange("hero", { ...hero, media })}
          note="Choose a warehouse or brand photograph. Do not present it as a named Automotive Brands building unless that is confirmed."
        />
      </Group>

      <Group title="Company statistics">
        <ShowToggle
          label="Show company statistics"
          checked={stats["enabled"] !== false}
          onChange={(checked) => onChange("stats", { ...stats, enabled: checked })}
        />
        {statItems.map((item, index) => (
          <div key={`stat-${index}`} className="grid gap-2 rounded-md border border-border/70 p-3">
            <Field label="Value">
              <input
                value={str(item, "value")}
                onChange={(event) => {
                  const items = statItems.slice();
                  items[index] = { ...item, value: event.target.value };
                  onChange("stats", { ...stats, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Label">
              <input
                value={str(item, "label")}
                onChange={(event) => {
                  const items = statItems.slice();
                  items[index] = { ...item, label: event.target.value };
                  onChange("stats", { ...stats, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Supporting text">
              <textarea
                rows={2}
                value={str(item, "body")}
                onChange={(event) => {
                  const items = statItems.slice();
                  items[index] = { ...item, body: event.target.value };
                  onChange("stats", { ...stats, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Review note (editors only)">
              <textarea
                rows={2}
                value={str(item, "reviewNote")}
                onChange={(event) => {
                  const items = statItems.slice();
                  items[index] = { ...item, reviewNote: event.target.value };
                  onChange("stats", { ...stats, items });
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={statItems.length}
              onMove={(direction) => onChange("stats", { ...stats, items: moveRow(statItems, index, direction) })}
              onRemove={() => onChange("stats", { ...stats, items: statItems.filter((_, row) => row !== index) })}
            />
          </div>
        ))}
        <button
          type="button"
          className="h-9 rounded-md border border-border text-[12px] font-semibold"
          onClick={() =>
            onChange("stats", {
              ...stats,
              items: [...statItems, { value: "", label: "", body: "", reviewNote: "Confirm this figure before publishing." }],
            })
          }
        >
          Add statistic
        </button>
      </Group>

      <Group title="Who we are">
        <ShowToggle
          label="Show who we are"
          checked={story["enabled"] !== false}
          onChange={(checked) => onChange("story", { ...story, enabled: checked })}
        />
        <Field label="Eyebrow">
          <input
            value={str(story, "eyebrow")}
            onChange={(event) => onChange("story", { ...story, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <textarea
            rows={3}
            value={str(story, "headline")}
            onChange={(event) => onChange("story", { ...story, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(story, "highlight")}
            onChange={(event) => onChange("story", { ...story, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Body">
          <textarea
            rows={5}
            value={str(story, "body")}
            onChange={(event) => onChange("story", { ...story, body: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Review note (editors only)">
          <textarea
            rows={2}
            value={str(story, "reviewNote")}
            onChange={(event) => onChange("story", { ...story, reviewNote: event.target.value })}
            className={inputClass}
          />
        </Field>
        <MediaSlot
          label="Who we are image"
          slot="story"
          media={asRecord(story["media"])}
          onMedia={(media) => onChange("story", { ...story, media })}
          note="Choose approved product or company photography. Do not upload invented branded packaging."
        />
      </Group>

      <Group title="Trade partner support">
        <ShowToggle
          label="Show trade partner support"
          checked={support["enabled"] !== false}
          onChange={(checked) => onChange("support", { ...support, enabled: checked })}
        />
        <Field label="Eyebrow">
          <input
            value={str(support, "eyebrow")}
            onChange={(event) => onChange("support", { ...support, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(support, "headline")}
            onChange={(event) => onChange("support", { ...support, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        {supportItems.map((item, index) => (
          <div key={`support-${index}`} className="grid gap-2 rounded-md border border-border/70 p-3">
            <Field label="Icon">
              <select
                value={str(item, "icon", "partnership")}
                onChange={(event) => {
                  const items = supportItems.slice();
                  items[index] = { ...item, icon: event.target.value };
                  onChange("support", { ...support, items });
                }}
                className={inputClass}
              >
                {SUPPORT_ICONS.map((icon) => (
                  <option key={icon.value} value={icon.value}>
                    {icon.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Heading">
              <input
                value={str(item, "title")}
                onChange={(event) => {
                  const items = supportItems.slice();
                  items[index] = { ...item, title: event.target.value };
                  onChange("support", { ...support, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                value={str(item, "body")}
                onChange={(event) => {
                  const items = supportItems.slice();
                  items[index] = { ...item, body: event.target.value };
                  onChange("support", { ...support, items });
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={supportItems.length}
              onMove={(direction) => onChange("support", { ...support, items: moveRow(supportItems, index, direction) })}
              onRemove={() =>
                onChange("support", { ...support, items: supportItems.filter((_, row) => row !== index) })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="h-9 rounded-md border border-border text-[12px] font-semibold"
          onClick={() =>
            onChange("support", {
              ...support,
              items: [...supportItems, { icon: "partnership", title: "Support", body: "" }],
            })
          }
        >
          Add support card
        </button>
      </Group>

      <Group title="Testimonials">
        <ShowToggle
          label="Show testimonials"
          checked={testimonials["enabled"] !== false}
          onChange={(checked) => onChange("testimonials", { ...testimonials, enabled: checked })}
        />
        <p className="text-[12px] leading-relaxed text-steel">
          Publish a quote only when the wording and attribution are confirmed. The public page shows the first three
          published quotes and hides the section when none are published.
        </p>
        <Field label="Eyebrow">
          <input
            value={str(testimonials, "eyebrow")}
            onChange={(event) => onChange("testimonials", { ...testimonials, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(testimonials, "headline")}
            onChange={(event) => onChange("testimonials", { ...testimonials, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        {quotes.map((item, index) => (
          <div key={`quote-${index}`} className="grid gap-2 rounded-md border border-border/70 p-3">
            <ShowToggle
              label="Publish this testimonial"
              checked={item["published"] === true}
              onChange={(checked) => {
                const items = quotes.slice();
                items[index] = { ...item, published: checked };
                onChange("testimonials", { ...testimonials, items });
              }}
            />
            <Field label="Quote">
              <textarea
                rows={4}
                value={str(item, "quote")}
                onChange={(event) => {
                  const items = quotes.slice();
                  items[index] = { ...item, quote: event.target.value };
                  onChange("testimonials", { ...testimonials, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Name">
              <input
                value={str(item, "name")}
                onChange={(event) => {
                  const items = quotes.slice();
                  items[index] = { ...item, name: event.target.value };
                  onChange("testimonials", { ...testimonials, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Business">
              <input
                value={str(item, "business")}
                onChange={(event) => {
                  const items = quotes.slice();
                  items[index] = { ...item, business: event.target.value };
                  onChange("testimonials", { ...testimonials, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Country">
              <input
                value={str(item, "country")}
                onChange={(event) => {
                  const items = quotes.slice();
                  items[index] = { ...item, country: event.target.value };
                  onChange("testimonials", { ...testimonials, items });
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Review note (editors only)">
              <textarea
                rows={2}
                value={str(item, "reviewNote")}
                onChange={(event) => {
                  const items = quotes.slice();
                  items[index] = { ...item, reviewNote: event.target.value };
                  onChange("testimonials", { ...testimonials, items });
                }}
                className={inputClass}
              />
            </Field>
            <RowActions
              index={index}
              total={quotes.length}
              onMove={(direction) =>
                onChange("testimonials", { ...testimonials, items: moveRow(quotes, index, direction) })
              }
              onRemove={() =>
                onChange("testimonials", { ...testimonials, items: quotes.filter((_, row) => row !== index) })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="h-9 rounded-md border border-border text-[12px] font-semibold"
          onClick={() =>
            onChange("testimonials", {
              ...testimonials,
              items: [
                ...quotes,
                {
                  quote: "",
                  name: "",
                  business: "",
                  country: "",
                  published: false,
                  reviewNote: "Confirm the exact quote and attribution before publishing.",
                },
              ],
            })
          }
        >
          Add testimonial
        </button>
      </Group>

      <Group title="Brands">
        <ShowToggle
          label="Show brands"
          checked={brands["enabled"] !== false}
          onChange={(checked) => onChange("brands", { ...brands, enabled: checked })}
        />
        <p className="text-[12px] leading-relaxed text-steel">
          Steel Seal is always first. Power Maxed is always second. This template cannot add another public brand.
        </p>
        <Field label="Steel Seal heading">
          <input
            value={str(steelSeal, "heading")}
            onChange={(event) => onChange("brands", { ...brands, steelSeal: { ...steelSeal, heading: event.target.value } })}
            className={inputClass}
          />
        </Field>
        <Field label="Steel Seal description">
          <textarea
            rows={3}
            value={str(steelSeal, "description")}
            onChange={(event) =>
              onChange("brands", { ...brands, steelSeal: { ...steelSeal, description: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Steel Seal button">
          <input
            value={str(steelSeal, "ctaLabel")}
            onChange={(event) =>
              onChange("brands", { ...brands, steelSeal: { ...steelSeal, ctaLabel: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Steel Seal catalogue link">
          <input
            value={str(steelSeal, "ctaHref")}
            onChange={(event) =>
              onChange("brands", { ...brands, steelSeal: { ...steelSeal, ctaHref: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <MediaSlot
          label="Steel Seal photography"
          slot="steel-seal"
          media={asRecord(steelSeal["media"])}
          onMedia={(media) => onChange("brands", { ...brands, steelSeal: { ...steelSeal, media } })}
          note="Use the approved Steel Seal photograph."
        />
        <Field label="Power Maxed heading">
          <input
            value={str(powerMaxed, "heading")}
            onChange={(event) =>
              onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, heading: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Power Maxed description">
          <textarea
            rows={3}
            value={str(powerMaxed, "description")}
            onChange={(event) =>
              onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, description: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Power Maxed button">
          <input
            value={str(powerMaxed, "ctaLabel")}
            onChange={(event) =>
              onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, ctaLabel: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <Field label="Power Maxed catalogue link">
          <input
            value={str(powerMaxed, "ctaHref")}
            onChange={(event) =>
              onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, ctaHref: event.target.value } })
            }
            className={inputClass}
          />
        </Field>
        <MediaSlot
          label="Power Maxed photography"
          slot="power-maxed"
          media={asRecord(powerMaxed["media"])}
          onMedia={(media) => onChange("brands", { ...brands, powerMaxed: { ...powerMaxed, media } })}
          note="Use the approved Power Maxed photograph."
        />
      </Group>

      <Group title="Meet the team">
        <ShowToggle
          label="Show Meet the Team on Website"
          checked={team["enabled"] === true}
          onChange={(checked) => onChange("team", { ...team, enabled: checked })}
        />
        <p className="text-[12px] leading-relaxed text-steel">
          Profiles, names, roles, photographs and order are managed in Website → Team. The public Why Us page shows a
          profile only when this control is on and the profile is published with a photograph. Placeholder portraits
          are not shown.
        </p>
      </Group>

      <Group title="Closing call to action">
        <ShowToggle
          label="Show closing call to action"
          checked={close["enabled"] !== false}
          onChange={(checked) => onChange("close", { ...close, enabled: checked })}
        />
        <Field label="Eyebrow">
          <input
            value={str(close, "eyebrow")}
            onChange={(event) => onChange("close", { ...close, eyebrow: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Heading">
          <input
            value={str(close, "headline")}
            onChange={(event) => onChange("close", { ...close, headline: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Yellow highlight">
          <input
            value={str(close, "highlight")}
            onChange={(event) => onChange("close", { ...close, highlight: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Supporting copy">
          <textarea
            rows={3}
            value={str(close, "description")}
            onChange={(event) => onChange("close", { ...close, description: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Button label">
          <input
            value={str(close, "ctaLabel")}
            onChange={(event) => onChange("close", { ...close, ctaLabel: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Button link">
          <input
            value={str(close, "ctaHref")}
            onChange={(event) => onChange("close", { ...close, ctaHref: event.target.value })}
            className={inputClass}
          />
        </Field>
      </Group>
    </div>
  );
}
