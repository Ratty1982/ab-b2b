import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { listCmsMediaFn, uploadCmsMediaFn } from "@/server/phase2/fns";

export type CmsMediaListItem = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  altText: string | null;
  createdAt: string;
  src: string;
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

export function MediaLibraryPanel({
  onPick,
  autoLoad = true,
}: {
  onPick?: (item: CmsMediaListItem) => void;
  autoLoad?: boolean;
}) {
  const [items, setItems] = useState<CmsMediaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await listCmsMediaFn();
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
        },
      });
      if (!r.ok) {
        setError(r.error);
        setUploading(false);
        return;
      }
      setItems((prev) => [r.data, ...prev.filter((i) => i.id !== r.data.id)]);
      onPick?.(r.data);
    } catch {
      setError("Upload failed");
    }
    setUploading(false);
  }

  return (
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
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-ink text-[13px] font-semibold uppercase tracking-wide hover:border-steel disabled:opacity-50"
      >
        {uploading ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="size-4" aria-hidden />
        )}
        {uploading ? "Uploading…" : "Upload image"}
      </button>

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
          <p className="text-sm text-steel">No images yet. Upload the first one.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              {onPick ? (
                <button
                  type="button"
                  className="w-full overflow-hidden rounded-md border border-border bg-ink text-left hover:border-primary"
                  onClick={() => onPick(item)}
                >
                  <img src={item.src} alt={item.altText || item.filename} className="aspect-square w-full object-cover" />
                  <div className="truncate px-2 py-1.5 text-[11px] text-steel">{item.filename}</div>
                </button>
              ) : (
                <div className="overflow-hidden rounded-md border border-border bg-ink">
                  <img src={item.src} alt={item.altText || item.filename} className="aspect-square w-full object-cover" />
                  <div className="truncate px-2 py-1.5 text-[11px] text-steel">{item.filename}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
