import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Search, Upload } from "lucide-react";
import {
  deleteCmsMediaFn,
  getCmsMediaStorageFn,
  listCmsMediaFn,
  updateCmsMediaFn,
  uploadCmsMediaFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { cn } from "@/lib/utils";
import { defaultMediaUsage, type MediaUploadUsage } from "@/domain/media-usage";
import { catalogueStageClass, mediaLibraryThumbClass } from "@/lib/media-presentation";

export type CmsMediaListItem = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  width?: number | null;
  height?: number | null;
  altText: string | null;
  createdAt: string;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  storageProvider?: string;
  src: string;
  inUse?: boolean;
  usageCount?: number;
};

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "";
}

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

function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibraryPanel({
  onPick,
  autoLoad = true,
  usage = defaultMediaUsage(),
}: {
  onPick?: (item: CmsMediaListItem) => void;
  autoLoad?: boolean;
  usage?: MediaUploadUsage;
}) {
  const [items, setItems] = useState<CmsMediaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CmsMediaListItem | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    const r = await listCmsMediaFn({ data: { q: search || undefined } });
    if (!r.ok) {
      setError(r.error);
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(r.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  useEffect(() => {
    void getCmsMediaStorageFn().then((r) => {
      if (r.ok) setStorageMessage(r.data.message);
    });
  }, []);

  useEffect(() => {
    if (selected) setAltDraft(selected.altText ?? "");
  }, [selected]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const r = await uploadCmsMediaFn({
        data: {
          filename: file.name,
          contentType: file.type || guessContentType(file.name),
          base64: dataUrl,
          usage,
        },
      });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        setUploading(false);
        return;
      }
      toast.success("Image uploaded");
      setItems((prev) => [r.data, ...prev.filter((i) => i.id !== r.data.id)]);
      setSelected(r.data);
      onPick?.(r.data);
    } catch {
      setError("Upload failed");
      toast.error("Upload failed");
    }
    setUploading(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid gap-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void onFile(file);
          }}
        />
        {storageMessage ? <p className="text-[12px] leading-relaxed text-steel">{storageMessage}</p> : null}
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void refresh(q);
              }}
              placeholder="Search filename or alt text"
              className={`${inputClass} pl-9`}
            />
          </div>
          <button
            type="button"
            className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
            onClick={() => void refresh(q)}
          >
            Search
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-ink px-4 text-[13px] font-semibold uppercase tracking-wide hover:border-steel disabled:opacity-50"
          >
            {uploading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {uploading ? "Uploading…" : "Upload image"}
          </button>
        </div>

        {error ? (
          <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</p>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-steel">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Loading library…
          </p>
        ) : items.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-md border border-dashed border-border px-4 py-12 text-center">
            <ImagePlus className="size-8 text-steel" aria-hidden />
            <p className="text-sm text-steel">No images yet. Upload JPEG, PNG, WebP or GIF up to 8 MB.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full overflow-hidden rounded-md border text-left hover:border-primary",
                    usage === "CMS_GENERAL" ? "bg-ink" : catalogueStageClass,
                    selected?.id === item.id ? "border-primary" : "border-border",
                  )}
                  onClick={() => {
                    setSelected(item);
                    if (onPick) onPick(item);
                  }}
                >
                  <img
                    src={item.src}
                    alt={item.altText || item.filename}
                    className={mediaLibraryThumbClass(usage)}
                  />
                  <div className="truncate px-2 py-1.5 text-[11px] text-steel">{item.filename}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="rounded-md border border-border bg-surface/40 p-3">
        {!selected ? (
          <p className="text-sm text-steel">Select an image to see details.</p>
        ) : (
          <div className="grid gap-3 text-[13px]">
            <div className={cn("overflow-hidden rounded-md", usage === "CMS_GENERAL" ? "bg-ink" : catalogueStageClass)}>
              <img
                src={selected.src}
                alt={selected.altText || selected.filename}
                className={cn("w-full object-contain", usage === "CMS_GENERAL" ? "" : catalogueStageClass)}
              />
            </div>
            <div className="font-medium">{selected.filename}</div>
            <dl className="grid gap-1 text-[12px] text-steel">
              <div>
                {selected.width && selected.height
                  ? `${selected.width} × ${selected.height}px`
                  : "Dimensions unknown"}
              </div>
              <div>{formatBytes(selected.sizeBytes)}</div>
              <div>{selected.contentType}</div>
              <div>Uploaded {new Date(selected.createdAt).toLocaleString()}</div>
              <div>{selected.uploadedByName ? `By ${selected.uploadedByName}` : "Uploader unknown"}</div>
              <div>
                {selected.inUse
                  ? `In use (${selected.usageCount} reference${selected.usageCount === 1 ? "" : "s"})`
                  : "Not referenced"}
              </div>
            </dl>
            <Field label="Alt text">
              <input value={altDraft} onChange={(e) => setAltDraft(e.target.value)} className={inputClass} />
            </Field>
            <button
              type="button"
              className="h-9 rounded-md border border-border text-[12px] font-semibold"
              onClick={() => {
                void (async () => {
                  const r = await updateCmsMediaFn({ data: { id: selected.id, altText: altDraft } });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success("Alt text saved");
                  setSelected(r.data);
                  setItems((prev) => prev.map((i) => (i.id === r.data.id ? r.data : i)));
                })();
              }}
            >
              Save alt text
            </button>
            <button
              type="button"
              disabled={Boolean(selected.inUse)}
              className="h-9 rounded-md border border-bad/40 text-[12px] font-semibold text-bad disabled:opacity-40"
              onClick={() => {
                if (selected.inUse) return;
                if (!window.confirm(`Delete ${selected.filename}? This cannot be undone.`)) return;
                void (async () => {
                  const r = await deleteCmsMediaFn({ data: { id: selected.id } });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success("Image deleted");
                  setItems((prev) => prev.filter((i) => i.id !== selected.id));
                  setSelected(null);
                })();
              }}
            >
              {selected.inUse ? "In use — cannot delete" : "Delete image"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
