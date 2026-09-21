import { useState } from "react";
import { Drawer } from "@/components/ab/Drawer";
import { applyProductContentJsonFn, previewProductContentJsonFn } from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Preview = Extract<Awaited<ReturnType<typeof previewProductContentJsonFn>>, { ok: true }>["data"];
type ApplyResult = Extract<Awaited<ReturnType<typeof applyProductContentJsonFn>>, { ok: true }>["data"];

const SECTION_ORDER = ["identity", "content", "specifications", "commercial", "seo", "merchandising", "media", "source"] as const;

export function ImportProductJsonButton({
  productId,
  sku,
  onApplied,
}: {
  productId: string;
  sku: string;
  onApplied: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide"
      >
        Import product JSON
      </button>
      <ImportProductJsonDrawer
        open={open}
        onClose={() => setOpen(false)}
        productId={productId}
        sku={sku}
        onApplied={onApplied}
      />
    </>
  );
}

function ImportProductJsonDrawer({
  open,
  onClose,
  productId,
  sku,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  sku: string;
  onApplied: () => Promise<void>;
}) {
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  function reset() {
    setJsonText("");
    setPreview(null);
    setResult(null);
  }

  async function validate() {
    setBusy(true);
    setResult(null);
    const response = await previewProductContentJsonFn({ data: { productId, jsonText } });
    setBusy(false);
    if (!response.ok) {
      toast.error(response.error);
      return;
    }
    setPreview(response.data);
  }

  async function apply() {
    setBusy(true);
    const response = await applyProductContentJsonFn({ data: { productId, jsonText } });
    setBusy(false);
    if (!response.ok) {
      toast.error(response.error);
      return;
    }
    setResult(response.data);
    toast.success("Product updated");
    await onApplied();
  }

  return (
    <Drawer
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import product JSON"
      sub={`Editing SKU ${sku}. Nothing is saved until you apply.`}
      width="xl"
      footer={
        result ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase" onClick={validate} disabled={busy}>
              {busy ? "Working…" : "Validate JSON"}
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-40"
              onClick={() => void apply()}
              disabled={busy || !preview?.canApply}
            >
              Apply changes
            </button>
          </div>
        )
      }
    >
      {result ? (
        <div className="grid gap-3">
          <p className="font-display text-xl font-semibold uppercase">Product updated</p>
          <p className="text-sm text-steel">
            {result.updatedCount} fields updated · {result.unchangedCount} unchanged · {result.skippedCount} skipped · {result.errorCount} errors
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          <label className="grid gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Paste Product Content JSON v1.0</span>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setPreview(null);
              }}
              spellCheck={false}
              className="min-h-48 w-full rounded-md border border-border bg-ink p-3 font-mono text-[12px] outline-none focus-visible:border-primary"
              placeholder='{ "schemaVersion": "1.0", ... }'
            />
          </label>
          {preview ? <PreviewPanel preview={preview} /> : null}
        </div>
      )}
    </Drawer>
  );
}

function PreviewPanel({ preview }: { preview: Preview }) {
  const errors = preview.issues.filter((i) => i.level === "error");
  const rest = preview.issues.filter((i) => i.level !== "error");
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <StatusPill ok={preview.schemaValid} label="Schema valid" />
        <StatusPill ok={preview.skuMatched !== false} label="SKU matched" />
        <StatusPill ok={preview.brandMatched !== false} label="Brand matched" />
        <StatusPill ok={preview.categoryMatched !== false} label="Category matched" />
      </dl>
      {errors.length ? (
        <div className="rounded-md border border-bad/40 bg-bad/10 p-3 text-[13px]">
          {errors.map((issue) => (
            <p key={issue.code + issue.message}>{issue.message}</p>
          ))}
        </div>
      ) : null}
      {rest.length ? (
        <ul className="text-[12px] text-steel">
          {rest.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      {preview.unsupported.length ? (
        <p className="text-[12px] text-steel">Unsupported / deferred: {preview.unsupported.join(", ")}</p>
      ) : null}
      {preview.unresolved.length ? (
        <p className="text-[12px] text-steel">Unresolved: {preview.unresolved.join(", ")}</p>
      ) : null}
      {SECTION_ORDER.map((section) => {
        const rows = preview.changes.filter((change) => change.section === section);
        if (!rows.length) return null;
        return (
          <section key={section} className={cn("rounded-md border border-border p-3", section === "commercial" && "border-warn/50 bg-warn/5")}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">{section}</h3>
            <ul className="mt-2 grid gap-3">
              {rows.map((row) => (
                <li key={row.key}>
                  <p className="text-[12px] font-semibold uppercase tracking-wide">{row.label}</p>
                  <p className="text-[12px] text-steel">Current: {row.current}</p>
                  <p className="text-[13px]">Proposed: {row.proposed}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <details className="text-[12px] text-steel">
        <summary className="cursor-pointer font-semibold uppercase tracking-wide">Unchanged fields</summary>
        <p className="mt-2">{preview.skipped.join(", ") || "None listed"}</p>
      </details>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={cn("rounded-md border px-2 py-1.5", ok ? "border-good/40 text-good" : "border-bad/40 text-bad")}>
      {label}
    </div>
  );
}
