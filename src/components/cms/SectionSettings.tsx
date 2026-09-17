import { useState } from "react";
import type { CmsSectionTypeKey } from "@/domain/cms";
import { brands } from "@/lib/data";
import { cmsMediaDisplaySrc } from "@/lib/cms-media";
import { Field, inputClass } from "@/components/ab/Drawer";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import heroImage from "@/assets/hero-parts.jpg";

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

function mediaObject(config: Record<string, unknown>): Record<string, unknown> {
  const media = config["media"];
  if (media && typeof media === "object") return { ...(media as Record<string, unknown>) };
  return {};
}

function mediaAlt(config: Record<string, unknown>): string {
  const alt = mediaObject(config)["alt"];
  return typeof alt === "string" ? alt : "";
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

function MediaField({
  config,
  onChange,
  fallbackSrc,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  fallbackSrc?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = mediaObject(config);
  const preview = cmsMediaDisplaySrc(current) ?? fallbackSrc;
  const hasPicked = Boolean(
    (typeof current["mediaId"] === "string" && current["mediaId"]) ||
      (typeof current["src"] === "string" && current["src"]),
  );

  function applyItem(item: CmsMediaListItem) {
    onChange("media", {
      ...current,
      mediaId: item.id,
      src: item.src,
      alt: mediaAlt(config) || item.altText || "",
    });
  }

  return (
    <div className="grid gap-2">
      <Field label="Image">
        <div className="overflow-hidden rounded-md border border-border bg-ink">
          {preview ? (
            <img src={preview} alt={mediaAlt(config) || "Section image"} className="aspect-[6/4] w-full object-cover" />
          ) : (
            <div className="grid aspect-[6/4] place-items-center text-[12px] text-steel">No image selected</div>
          )}
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
        >
          Choose image
        </button>
        {hasPicked ? (
          <button
            type="button"
            onClick={() =>
              onChange("media", {
                alt: mediaAlt(config),
              })
            }
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
          >
            Use default
          </button>
        ) : null}
      </div>
      <Field label="Image alt text">
        <input
          value={mediaAlt(config)}
          onChange={(e) => onChange("media", { ...current, alt: e.target.value })}
          className={inputClass}
        />
      </Field>
      <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={applyItem} />
    </div>
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
        <MediaField config={config} onChange={onChange} fallbackSrc={heroImage} />
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

  if (type === "TEXT_IMAGE" || type === "IMAGE_TEXT") {
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input
            value={str(config, "heading")}
            onChange={(e) => onChange("heading", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Body">
          <textarea
            rows={6}
            value={str(config, "body")}
            onChange={(e) => onChange("body", e.target.value)}
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
        <MediaField config={config} onChange={onChange} />
        <SelectField
          label="Alignment"
          value={str(config, "alignment", "left")}
          options={ALIGNMENTS}
          onChange={(v) => onChange("alignment", v)}
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
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange("displayCount", Number.isFinite(n) && n > 0 ? n : 5);
            }}
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
