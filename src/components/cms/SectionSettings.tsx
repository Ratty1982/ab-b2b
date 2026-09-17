import { useState, type ReactNode } from "react";
import { CMS_IMAGE_FITS, CMS_IMAGE_FIT_LABELS, type CmsSectionTypeKey } from "@/domain/cms";
import {
  DEFAULT_FEATURED_BRANDS_INTRO,
  featuredBrandsIntro,
  featuredBrandsSyncFields,
  hydrateFeaturedBrandCards,
  type FeaturedBrandCard,
} from "@/domain/featured-brands";
import { brands } from "@/lib/data";
import { cmsMediaDisplaySrc, type BrandLogoRef } from "@/lib/cms-media";
import { Field, inputClass } from "@/components/ab/Drawer";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import heroImage from "@/assets/hero-parts.jpg";
import { heroRecommendedCopy } from "@/lib/hero-image";

const ALIGNMENTS = ["left", "center", "right"] as const;
const POSITIONS = ["top", "middle", "bottom"] as const;
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-border/70 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{title}</div>
      {children}
    </div>
  );
}

function MediaField({
  config,
  onChange,
  fallbackSrc,
  hero,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  fallbackSrc?: string;
  hero?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = mediaObject(config);
  const preview = cmsMediaDisplaySrc(current) ?? fallbackSrc;
  const hasPicked = Boolean(
    (typeof current["mediaId"] === "string" && current["mediaId"]) ||
      (typeof current["src"] === "string" && current["src"]),
  );
  const fit = typeof current["fit"] === "string" ? current["fit"] : hero ? "fill" : "content";
  const focalX = typeof current["focalX"] === "number" ? current["focalX"] : 50;
  const focalY = typeof current["focalY"] === "number" ? current["focalY"] : 50;

  function applyItem(item: CmsMediaListItem) {
    onChange("media", {
      ...current,
      mediaId: item.id,
      src: item.src,
      alt: mediaAlt(config) || item.altText || "",
      fit,
      focalX,
      focalY,
    });
  }

  return (
    <div className="grid gap-2">
      <Field label="Image">
        <div className="overflow-hidden rounded-md border border-border bg-ink">
          {preview ? (
            <img
              src={preview}
              alt={mediaAlt(config) || "Section image"}
              className="aspect-[25/21] w-full object-cover"
              style={{ objectPosition: `${focalX}% ${focalY}%` }}
            />
          ) : (
            <div className="grid aspect-[25/21] place-items-center text-[12px] text-steel">No image selected</div>
          )}
        </div>
      </Field>
      {hero ? <p className="text-[11px] leading-relaxed text-steel">{heroRecommendedCopy()} Photographic images use Fill Area and are cropped, never stretched.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
        >
          {hasPicked ? "Replace image" : "Choose image"}
        </button>
        {hasPicked ? (
          <button
            type="button"
            onClick={() =>
              onChange("media", {
                alt: mediaAlt(config),
                fit,
                focalX,
                focalY,
              })
            }
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold uppercase tracking-wide hover:border-steel"
          >
            Use default
          </button>
        ) : null}
      </div>
      <Field label="How the image fits">
        <select
          value={fit}
          onChange={(e) => onChange("media", { ...current, fit: e.target.value })}
          className={inputClass}
        >
          {CMS_IMAGE_FITS.map((option) => (
            <option key={option} value={option}>
              {CMS_IMAGE_FIT_LABELS[option]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Focal position (horizontal)">
        <input
          type="range"
          min={0}
          max={100}
          value={focalX}
          onChange={(e) => onChange("media", { ...current, focalX: Number(e.target.value) })}
        />
      </Field>
      <Field label="Focal position (vertical)">
        <input
          type="range"
          min={0}
          max={100}
          value={focalY}
          onChange={(e) => onChange("media", { ...current, focalY: Number(e.target.value) })}
        />
      </Field>
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

export function BrandLogoPicker({
  label,
  logo,
  onChange,
}: {
  label: string;
  logo: BrandLogoRef | undefined;
  onChange: (next: BrandLogoRef | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const preview = cmsMediaDisplaySrc(logo);
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 rounded-md border border-border bg-ink/40 p-2">
      <div className="grid size-[72px] place-items-center overflow-hidden rounded border border-border bg-ink">
        {preview ? (
          <img src={preview} alt={logo?.alt || label} className="max-h-[64px] max-w-[64px] object-contain" />
        ) : (
          <span className="px-1 text-center text-[10px] uppercase leading-tight text-steel">No logo</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold uppercase">{label}</div>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold uppercase hover:border-steel"
          >
            {preview ? "Change logo" : "Add logo"}
          </button>
          {preview ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex h-8 items-center rounded-md border border-border px-2 text-[11px] font-semibold uppercase hover:border-steel"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(item) =>
          onChange({
            mediaId: item.id,
            src: item.src,
            alt: logo?.alt || item.altText || `${label} logo`,
          })
        }
      />
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
        <Group title="Content">
          <Field label="Eyebrow / small heading">
            <input
              value={str(config, "eyebrow")}
              onChange={(e) => onChange("eyebrow", e.target.value)}
              className={inputClass}
            />
          </Field>
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
          <Field label="Primary CTA label">
            <input
              value={str(config, "ctaLabel")}
              onChange={(e) => onChange("ctaLabel", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Primary CTA URL">
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
          <Field label="Secondary CTA URL">
            <input
              value={str(config, "secondaryCtaHref")}
              onChange={(e) => onChange("secondaryCtaHref", e.target.value)}
              className={inputClass}
            />
          </Field>
        </Group>
        <Group title="Image">
          <MediaField config={config} onChange={onChange} fallbackSrc={heroImage} hero />
        </Group>
        <Group title="Style">
          <SelectField
            label="Text alignment"
            value={str(config, "alignment", "left")}
            options={ALIGNMENTS}
            onChange={(v) => onChange("alignment", v)}
          />
          <SelectField
            label="Content position"
            value={str(config, "contentPosition", "middle")}
            options={POSITIONS}
            onChange={(v) => onChange("contentPosition", v)}
          />
          <SelectField
            label="Layout"
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
          <Field label="Overlay strength">
            <input
              type="range"
              min={0}
              max={80}
              value={num(config, "overlayStrength", 0)}
              onChange={(e) => onChange("overlayStrength", Number(e.target.value))}
            />
          </Field>
        </Group>
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
    const catalogue = brands.map((b) => ({ slug: b.slug, name: b.name }));
    const cards = hydrateFeaturedBrandCards(config, catalogue);
    function persistCards(next: FeaturedBrandCard[]) {
      const synced = featuredBrandsSyncFields(next);
      onChange("brandCards", synced.brandCards);
      onChange("brandSlugs", synced.brandSlugs);
      onChange("logos", synced.logos);
      if (typeof config["intro"] !== "string") onChange("intro", DEFAULT_FEATURED_BRANDS_INTRO);
    }
    function patchCard(slug: string, patch: Partial<FeaturedBrandCard>) {
      persistCards(cards.map((card) => (card.slug === slug ? { ...card, ...patch } : card)));
    }
    return (
      <div className="grid gap-3">
        <Group title="Section">
          <Field label="Section heading">
            <input
              value={str(config, "heading")}
              onChange={(e) => onChange("heading", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Intro / subheading (optional)">
            <textarea
              rows={3}
              value={featuredBrandsIntro(config)}
              onChange={(e) => onChange("intro", e.target.value)}
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
        </Group>
        <Group title="Brands">
          <p className="text-[12px] text-steel">
            Homepage marketing copy for each brand. Changing these fields does not update the brand
            catalogue record. Expand a brand to edit its heading, description, logo and link.
          </p>
          <Accordion type="single" collapsible className="rounded-md border border-border">
            {cards.map((card) => {
              const catalogueName = catalogue.find((b) => b.slug === card.slug)?.name ?? card.heading;
              return (
                <AccordionItem key={card.slug} value={card.slug} className="border-border px-3">
                  <AccordionTrigger className="py-3 text-[12px] font-semibold uppercase tracking-wide hover:no-underline">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{catalogueName}</span>
                      {!card.enabled ? (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-steel">
                          Hidden
                        </span>
                      ) : null}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-3 pb-2">
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={card.enabled}
                          onChange={(e) => patchCard(card.slug, { enabled: e.target.checked })}
                        />
                        Show this brand
                      </label>
                      <Field label="Display heading">
                        <input
                          value={card.heading}
                          onChange={(e) => patchCard(card.slug, { heading: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Description">
                        <textarea
                          rows={3}
                          value={card.description}
                          onChange={(e) => patchCard(card.slug, { description: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                      <BrandLogoPicker
                        label="Logo"
                        logo={card.logo ?? undefined}
                        onChange={(next) => patchCard(card.slug, { logo: next ?? { alt: "" } })}
                      />
                      <Field label="Link">
                        <input
                          value={card.href}
                          onChange={(e) => patchCard(card.slug, { href: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </Group>
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

  if (type === "CATEGORY_GRID") {
    const cats = Array.isArray(config["categories"])
      ? (config["categories"] as Array<{ name: string; href: string; imageAlt?: string }>)
      : [];
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input value={str(config, "heading")} onChange={(e) => onChange("heading", e.target.value)} className={inputClass} />
        </Field>
        {cats.map((cat, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-steel">Category {i + 1}</div>
              <button
                type="button"
                className="text-[12px] font-semibold text-bad"
                onClick={() => onChange("categories", cats.filter((_, idx) => idx !== i))}
              >
                Delete
              </button>
            </div>
            <Field label="Name">
              <input
                value={cat.name}
                onChange={(e) => {
                  const next = cats.map((row, idx) => (idx === i ? { ...row, name: e.target.value } : row));
                  onChange("categories", next);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="Link">
              <input
                value={cat.href}
                onChange={(e) => {
                  const next = cats.map((row, idx) => (idx === i ? { ...row, href: e.target.value } : row));
                  onChange("categories", next);
                }}
                className={inputClass}
              />
            </Field>
          </div>
        ))}
        <button
          type="button"
          className="h-9 rounded-md border border-border text-[12px] font-semibold"
          onClick={() => onChange("categories", [...cats, { name: "Category", href: "/products", imageAlt: "" }])}
        >
          Add category
        </button>
        <SelectField label="Spacing" value={str(config, "spacing", "standard")} options={SPACINGS} onChange={(v) => onChange("spacing", v)} />
      </div>
    );
  }

  if (type === "BENEFITS_GRID") {
    const items = Array.isArray(config["items"])
      ? (config["items"] as Array<{ title: string; body: string; icon?: string }>)
      : [];
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input value={str(config, "heading")} onChange={(e) => onChange("heading", e.target.value)} className={inputClass} />
        </Field>
        {items.map((item, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border p-2">
            <Field label={`Benefit ${i + 1}`}>
              <input
                value={item.title}
                onChange={(e) => {
                  const next = items.map((row, idx) => (idx === i ? { ...row, title: e.target.value } : row));
                  onChange("items", next);
                }}
                className={inputClass}
              />
            </Field>
            <textarea
              rows={2}
              value={item.body}
              onChange={(e) => {
                const next = items.map((row, idx) => (idx === i ? { ...row, body: e.target.value } : row));
                onChange("items", next);
              }}
              className={inputClass}
            />
          </div>
        ))}
        <SelectField label="Spacing" value={str(config, "spacing", "standard")} options={SPACINGS} onChange={(v) => onChange("spacing", v)} />
      </div>
    );
  }

  if (type === "FEATURED_PRODUCTS") {
    const skus = Array.isArray(config["productSkus"]) ? (config["productSkus"] as string[]) : [];
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input value={str(config, "heading")} onChange={(e) => onChange("heading", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Supporting">
          <input value={str(config, "supporting")} onChange={(e) => onChange("supporting", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Product SKUs (one per line)">
          <textarea
            rows={6}
            value={skus.join("\n")}
            onChange={(e) =>
              onChange(
                "productSkus",
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            className={inputClass}
          />
        </Field>
        <SelectField
          label="Layout"
          value={str(config, "layout", "grid")}
          options={["grid", "carousel"]}
          onChange={(v) => onChange("layout", v)}
        />
      </div>
    );
  }

  if (type === "BRAND_LOGO_STRIP") {
    const selected = Array.isArray(config["brandSlugs"]) ? (config["brandSlugs"] as string[]) : [];
    return (
      <div className="grid gap-3">
        <Field label="Heading">
          <input value={str(config, "heading")} onChange={(e) => onChange("heading", e.target.value)} className={inputClass} />
        </Field>
        {brands.map((b) => {
          const on = selected.includes(b.slug);
          return (
            <label key={b.slug} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange("brandSlugs", on ? selected.filter((s) => s !== b.slug) : [...selected, b.slug])}
              />
              {b.name}
            </label>
          );
        })}
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
