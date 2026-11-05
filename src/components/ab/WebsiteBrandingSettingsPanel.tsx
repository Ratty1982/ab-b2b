/**
 * Admin → Settings → General — Website Branding (header logo).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import {
  getSiteBrandingSettingsFn,
  resetSiteHeaderLogoFn,
  uploadSiteHeaderLogoFn,
} from "@/server/phase2/fns";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SITE_HEADER_LOGO_SRC,
  SITE_HEADER_LOGO_ACCEPT,
  SITE_HEADER_LOGO_MAX_BYTES,
  SITE_HEADER_LOGO_MAX_EDGE,
  SITE_HEADER_LOGO_MIN_EDGE,
  guessSiteHeaderLogoContentType,
  isSiteHeaderLogoContentType,
  looksLikeSvgUpload,
  validateSiteHeaderLogoDimensions,
  type SiteBrandingSettingsDto,
} from "@/domain/site-branding";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image dimensions"));
    };
    img.src = url;
  });
}

function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function validateLogoFileClient(file: File): Promise<string | null> {
  if (looksLikeSvgUpload({ filename: file.name, contentType: file.type })) {
    return "SVG uploads are not supported. Use PNG, JPG or WebP.";
  }
  const declared = file.type || guessSiteHeaderLogoContentType(file.name) || "";
  if (!isSiteHeaderLogoContentType(declared)) {
    return "Header logo must be a PNG, JPG or WebP file.";
  }
  if (file.size > SITE_HEADER_LOGO_MAX_BYTES) {
    return "Header logo must be 2 MB or smaller.";
  }
  try {
    const dims = await readImageDimensions(file);
    return validateSiteHeaderLogoDimensions(dims.width, dims.height);
  } catch {
    return "This file could not be read as an image.";
  }
}

export function WebsiteBrandingSettingsPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SiteBrandingSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getSiteBrandingSettingsFn();
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setState(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const clientError = await validateLogoFileClient(file);
    if (clientError) {
      toast.error(clientError);
      return;
    }
    setSaving(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const contentType = file.type || guessSiteHeaderLogoContentType(file.name) || "";
      const result = await uploadSiteHeaderLogoFn({
        data: {
          filename: file.name,
          contentType,
          base64: dataUrl,
          altText: "Automotive Brands",
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState(result.data);
      await router.invalidate();
      toast.success("Header logo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onReset() {
    setSaving(true);
    const result = await resetSiteHeaderLogoFn();
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setState(result.data);
    await router.invalidate();
    toast.success("Header logo reset to default");
  }

  const previewSrc = state?.headerLogoSrc ?? DEFAULT_SITE_HEADER_LOGO_SRC;
  const isCustom = Boolean(state?.isCustom);

  return (
    <section
      data-admin-section="website-branding"
      className="space-y-4 rounded-lg border border-border bg-surface/30 p-4 sm:p-5"
      aria-labelledby="website-branding-heading"
    >
      <div>
        <h2
          id="website-branding-heading"
          className="font-display text-lg font-semibold uppercase"
        >
          Website branding
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Header logo used across the public website, customer portal, and staff
          shells. Catalogue brand logos (Steel Seal, Power Maxed) stay under Admin →
          Brands. Email templates keep the static default mark.
        </p>
      </div>

      {loadError ? (
        <p className="text-[13px] text-warn" role="status">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-start">
        <div
          className="grid place-items-center rounded-md border border-border bg-white p-3"
          data-branding-preview="header-logo"
        >
          <img
            src={previewSrc}
            alt={state?.headerLogoAlt || "Automotive Brands header logo"}
            className={cn("h-14 w-auto max-h-14 max-w-[11rem]", mediaContainClass)}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <dl className="grid gap-1 text-[12px] text-steel">
            <div>
              <dt className="inline font-semibold uppercase tracking-wide text-foreground">
                Source:{" "}
              </dt>
              <dd className="inline" data-branding-source={isCustom ? "custom" : "default"}>
                {isCustom ? "Custom upload" : "Default (/brand/ab-logo.png)"}
              </dd>
            </div>
            {isCustom && state ? (
              <div>
                <dt className="inline font-semibold uppercase tracking-wide text-foreground">
                  File:{" "}
                </dt>
                <dd className="inline">
                  {state.filename ?? "logo"}
                  {state.width && state.height ? ` · ${state.width}×${state.height}` : ""}
                  {state.sizeBytes ? ` · ${formatBytes(state.sizeBytes)}` : ""}
                </dd>
              </div>
            ) : null}
            <div>
              Accepted: PNG, JPG, WebP · max {SITE_HEADER_LOGO_MAX_BYTES / (1024 * 1024)} MB ·{" "}
              {SITE_HEADER_LOGO_MIN_EDGE}–{SITE_HEADER_LOGO_MAX_EDGE}px. SVG is not supported.
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={SITE_HEADER_LOGO_ACCEPT}
              className="sr-only"
              disabled={!state || saving}
              onChange={(e) => void onFile(e.target.files?.[0])}
              data-branding-input="header-logo"
            />
            <button
              type="button"
              disabled={!state || saving}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
              data-branding-action="upload"
            >
              {saving ? "Saving…" : isCustom ? "Replace logo" : "Upload logo"}
            </button>
            <button
              type="button"
              disabled={!state || saving || !isCustom}
              onClick={() => void onReset()}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
              data-branding-action="reset"
            >
              Reset to default logo
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
