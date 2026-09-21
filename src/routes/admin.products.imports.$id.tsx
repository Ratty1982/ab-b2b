import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { PRODUCT_IMPORT_FIELDS, type ProductImportField } from "@/domain/product-import";
import {
  confirmProductImportFn,
  getProductImportFn,
  previewProductImportFn,
  productImportErrorsFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products/imports/$id")({
  head: () => ({ meta: [{ title: "Import job — Automotive Brands Admin" }] }),
  component: ImportJobPage,
});

type Job = Awaited<Extract<Awaited<ReturnType<typeof getProductImportFn>>, { ok: true }>["data"]>;

function ImportJobPage() {
  const { id } = Route.useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "updates" | "warnings" | "errors">("new");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const r = await getProductImportFn({ data: { id } });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setJob(r.data);
    if (r.data.status === "UPLOADED") {
      const previewed = await previewProductImportFn({ data: { id } });
      if (previewed.ok) setJob(previewed.data);
      else toast.error(previewed.error);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function runPreview(mapping = job?.mapping) {
    const r = await previewProductImportFn({
      data: {
        id,
        mapping,
        brandActions: job?.unknownBrands,
        categoryActions: job?.unknownCategories,
      },
    });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setJob(r.data);
  }

  if (error) return <p className="p-6 text-sm">{error}</p>;
  if (!job) return <p className="p-6 text-[13px] text-steel">Loading import…</p>;

  const mapping = (job.mapping ?? {}) as Record<string, number | null>;
  const headers = job.headers ?? [];

  return (
    <div>
      <PanelHeader
        title={job.filename}
        sub="Empty cells are ignored. Unmapped columns are never written. SKU matches existing products."
      />
      <div className="space-y-8 p-4 sm:p-6">
        <section>
          <h2 className="font-display text-lg font-semibold uppercase">1. Field mapping</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {PRODUCT_IMPORT_FIELDS.map((field) => (
              <Field key={field} label={field}>
                <select
                  className={inputClass}
                  value={mapping[field] ?? ""}
                  disabled={job.status === "APPLIED"}
                  onChange={(e) => {
                    const next = { ...mapping, [field]: e.target.value === "" ? null : Number(e.target.value) };
                    setJob({ ...job, mapping: next });
                  }}
                >
                  <option value="">Not mapped</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          {job.status !== "APPLIED" ? (
            <button type="button" className="mt-4 h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase" onClick={() => void runPreview()}>
              Validate & preview
            </button>
          ) : null}
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold uppercase">2. Unknown brands & categories</h2>
          <p className="mt-1 text-[13px] text-steel">Exact names match case-insensitively. Everything else is listed here.</p>
          <TaxonomyActions
            title="Brands"
            rows={(job.unknownBrands as Array<{ name: string; action: string; mapToId?: string | null }>) ?? []}
            disabled={job.status === "APPLIED"}
            onChange={(unknownBrands) => setJob({ ...job, unknownBrands })}
          />
          <TaxonomyActions
            title="Categories"
            rows={(job.unknownCategories as Array<{ name: string; action: string; mapToId?: string | null }>) ?? []}
            disabled={job.status === "APPLIED"}
            onChange={(unknownCategories) => setJob({ ...job, unknownCategories })}
          />
        </section>

        {job.summary ? (
          <section>
            <h2 className="font-display text-lg font-semibold uppercase">3. Preview</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="New products" value={job.summary.newCount} />
              <Stat label="Updates" value={job.summary.updateCount} />
              <Stat label="New brands" value={job.summary.newBrandCount} />
              <Stat label="Invalid rows" value={job.summary.invalidCount} />
              <Stat label="Duplicate SKUs" value={job.summary.duplicateSkuCount} />
              <Stat label="Will deactivate" value={job.summary.deactivateCount} />
            </div>
            <div className="mt-4 flex gap-2">
              {(["new", "updates", "warnings", "errors"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`h-8 rounded-md border px-3 text-[12px] font-semibold ${tab === t ? "border-primary" : "border-border"}`}>
                  {t}
                </button>
              ))}
            </div>
            <ul className="mt-3 max-h-80 overflow-auto rounded-lg border border-border text-[13px]">
              {tab === "new"
                ? job.changes.filter((c) => c.kind === "new").map((c) => <li key={c.sku} className="border-b border-border/60 px-3 py-2">{c.sku}</li>)
                : null}
              {tab === "updates"
                ? job.changes.filter((c) => c.kind === "update").map((c) => (
                    <li key={c.sku} className="border-b border-border/60 px-3 py-2">
                      <div className="font-medium">{c.sku}</div>
                      {c.fields.map((f) => (
                        <div key={f.field} className="text-steel">{f.field}: {f.from || "—"} → {f.to}</div>
                      ))}
                    </li>
                  ))
                : null}
              {tab === "warnings"
                ? job.issues.filter((i) => i.level === "warning").map((i, idx) => <li key={idx} className="px-3 py-2">Line {i.line}: {i.message}</li>)
                : null}
              {tab === "errors"
                ? job.issues.filter((i) => i.level === "error").map((i, idx) => <li key={idx} className="px-3 py-2">Line {i.line}: {i.message}</li>)
                : null}
            </ul>
          </section>
        ) : null}

        {job.status !== "APPLIED" ? (
          <button
            type="button"
            disabled={confirming || job.status === "UPLOADED"}
            className="h-11 rounded-md bg-primary px-6 text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setConfirming(true);
                await runPreview();
                const r = await confirmProductImportFn({ data: { id } });
                setConfirming(false);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Import applied");
                setJob(r.data);
              })();
            }}
          >
            {confirming ? "Importing…" : "Confirm import"}
          </button>
        ) : (
          <section>
            <h2 className="font-display text-lg font-semibold uppercase">Results</h2>
            <p className="mt-2 text-[13px]">Created {job.createdCount} · Updated {job.updatedCount} · Skipped {job.skippedCount} · Failed {job.errorCount}</p>
            {job.hasErrorReport ? (
              <button
                type="button"
                className="mt-3 h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => void productImportErrorsFn({ data: { id } }).then((r) => {
                  if (!r.ok) return;
                  const blob = new Blob([r.data], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${job.filename}-results.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                })}
              >
                Download results CSV
              </button>
            ) : null}
          </section>
        )}
        <Link to="/admin/products/imports" className="inline-block text-[13px] font-semibold text-primary">Back to imports</Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <div className="text-[11px] uppercase text-steel">{label}</div>
      <div className="num text-xl font-semibold">{value}</div>
    </div>
  );
}

function TaxonomyActions({
  title,
  rows,
  disabled,
  onChange,
}: {
  title: string;
  rows: Array<{ name: string; action: string; mapToId?: string | null }>;
  disabled: boolean;
  onChange: (rows: Array<{ name: string; action: string; mapToId?: string | null }>) => void;
}) {
  if (!rows.length) return <p className="mt-3 text-[13px] text-steel">No unknown {title.toLowerCase()}.</p>;
  return (
    <div className="mt-3">
      <h3 className="text-[12px] font-semibold uppercase">{title}</h3>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {rows.map((row, i) => (
          <li key={row.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
            <span>{row.name}</span>
            <select
              disabled={disabled}
              className={inputClass + " max-w-[200px]"}
              value={row.action}
              onChange={(e) => {
                const next = rows.map((r, idx) => idx === i ? { ...r, action: e.target.value } : r);
                onChange(next);
              }}
            >
              <option value="create">Create new</option>
              <option value="map">Map to existing (set id in preview if needed)</option>
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

void 0 as unknown as ProductImportField;
