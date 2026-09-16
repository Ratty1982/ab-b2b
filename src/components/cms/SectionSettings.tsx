import type { CmsSectionTypeKey } from "@/domain/cms";
import { brands } from "@/lib/data";
import { Field, inputClass } from "@/components/ab/Drawer";

const ALIGNMENTS = ["left", "center", "right"] as const;
const VARIANTS = ["standard", "wide", "split", "dark", "light"] as const;
const SPACINGS = ["compact", "standard", "relaxed"] as const;

function str(config: Record<string, unknown>, key: string, fallback = ""): string {
  const v = config[key];
  return typeof v === "string" ? v : fallback;
}

function num(config: Record<string, unknown>, key: string, fallback = 0): number {
  const v = config[key];
  return typeof v === "number" ? v : fallback;
}

function mediaAlt(config: Record<string, unknown>): string {
  const media = config["media"];
  if (media && typeof media === "object" && "alt" in media) {
    const alt = (media as { alt?: unknown }).alt;
    return typeof alt === "string" ? alt : "";
  }
  return "";
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SectionSettings({
  type,
  config,
  onChange,
}: {
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (type === "HERO") {
    return (
      <div className="grid gap-3">
        <Field label="Headline">
          <textarea
            rows={3}
            value={str(config, "headline")}
            onChange={(e) => onChange("headline", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Supporting text">
          <textarea
            rows={4}
            value={str(config, "supporting")}
            onChange={(e) => onChange("supporting", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="CTA label">
          <input
            value={str(config, "ctaLabel")}
            onChange={(e) => onChange("ctaLabel", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="CTA destination">
          <input
            value={str(config, "ctaHref", "/register")}
            onChange={(e) => onChange("ctaHref", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA label">
          <input
            value={str(config, "secondaryCtaLabel")}
            onChange={(e) => onChange("secondaryCtaLabel", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Secondary CTA destination">
          <input
            value={str(config, "secondaryCtaHref")}
            onChange={(e) => onChange("secondaryCtaHref", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Image alt text">
          <input
            value={mediaAlt(config)}
            onChange={(e) =>
              onChange("media", {
                ...(typeof config["media"] === "object" && config["media"]
                  ? (config["media"] as object)
                  : {}),
                alt: e.target.value,
              })
            }
            className={inputClass}
          />
        </Field>
        <p className="text-[11px] text-steel">
          Image uses the Automotive Brands hero asset unless a media library item is attached later.
        </p>
        <SelectField
          label="Alignment"
          value={str(config, "alignment", "left")}
          options={ALIGNMENTS}
          onChange={(v) => onChange("alignment", v)}
        />
        <SelectField
          label="Layout variant"
          value={str(config, "variant", "split")}
          options={VARIANTS}
          onChange={(v) => onChange("variant", v)}
        />
        <SelectField
          label="Spacing"
          value={str(config, "spacing", "standard")}
          options={SPACINGS}
          onChange={(v) => onChange("spacing", v)}
        />
      </div>
    );
  }

  if (type === "FEATURED_BRANDS") {
    const selected = Array.isArray(config["brandSlugs"])
      ? (config["brandSlugs"] as string[])
      : [];
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input
            value={str(config, "heading")}
            onChange={(e) => onChange("heading", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Eyebrow / supporting">
          <input
            value={str(config, "supporting")}
            onChange={(e) => onChange("supporting", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Display count">
          <input
            type="number"
            min={1}
            max={12}
            value={num(config, "displayCount", 5)}
            onChange={(e) => onChange("displayCount", Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-steel">
            Brands
          </div>
          <div className="grid gap-1">
            {brands.map((b) => {
              const on = selected.includes(b.slug);
              return (
                <label key={b.slug} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on
                        ? selected.filter((s) => s !== b.slug)
                        : [...selected, b.slug];
                      onChange("brandSlugs", next);
                    }}
                  />
                  {b.name}
                </label>
              );
            })}
          </div>
        </div>
        <SelectField
          label="Layout variant"
          value={str(config, "variant", "standard")}
          options={VARIANTS}
          onChange={(v) => onChange("variant", v)}
        />
      </div>
    );
  }

  if (type === "TRADE_CTA" || type === "BANNER" || type === "RICH_TEXT" || type === "SPACER") {
    return (
      <div className="grid gap-3">
        {type === "TRADE_CTA" ? (
          <>
            <Field label="Headline">
              <input
                value={str(config, "headline")}
                onChange={(e) => onChange("headline", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Supporting text">
              <textarea
                rows={3}
                value={str(config, "supporting")}
                onChange={(e) => onChange("supporting", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="CTA label">
              <input
                value={str(config, "ctaLabel")}
                onChange={(e) => onChange("ctaLabel", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="CTA destination">
              <input
                value={str(config, "ctaHref")}
                onChange={(e) => onChange("ctaHref", e.target.value)}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
        {type === "BANNER" ? (
          <Field label="Text">
            <input
              value={str(config, "text")}
              onChange={(e) => onChange("text", e.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        {type === "RICH_TEXT" ? (
          <Field label="Content">
            <textarea
              rows={10}
              value={str(config, "content")}
              onChange={(e) => onChange("content", e.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        {type === "SPACER" ? (
          <SelectField
            label="Size"
            value={str(config, "size", "md")}
            options={["sm", "md", "lg"]}
            onChange={(v) => onChange("size", v)}
          />
        ) : null}
        {type !== "SPACER" ? (
          <SelectField
            label="Spacing"
            value={str(config, "spacing", "standard")}
            options={SPACINGS}
            onChange={(v) => onChange("spacing", v)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {Object.entries(config).map(([key, value]) => {
        if (typeof value === "object") return null;
        return (
          <Field key={key} label={key}>
            <input
              value={String(value ?? "")}
              onChange={(e) => onChange(key, e.target.value)}
              className={inputClass}
            />
          </Field>
        );
      })}
    </div>
  );
}
