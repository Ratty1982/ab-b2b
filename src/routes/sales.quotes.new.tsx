import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { createQuoteFn, listCompaniesFn } from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/sales/quotes/new")({
  validateSearch: (s: Record<string, unknown>): { companyId?: string } => {
    const companyId = typeof s["companyId"] === "string" ? (s["companyId"] as string) : "";
    return companyId ? { companyId } : {};
  },
  head: () => ({
    meta: [
      { title: "Create quote — Sales Portal — Automotive Brands" },
      {
        name: "description",
        content: "Start a trade quotation for an active Automotive Brands customer.",
      },
    ],
  }),
  component: NewQuote,
});

type CompanyRow = {
  id: string;
  name: string;
  status: string;
};

function NewQuote() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState(search.companyId ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listCompaniesFn({
      data: { q: q.trim() || undefined, status: "ACTIVE", page: 1, pageSize: 25 },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setCompanies(
      (result.data.items as Array<{ id: string; name: string; status: string }>).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
    );
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    if (!companyId) {
      toast.error("Select a company");
      return;
    }
    setCreating(true);
    const result = await createQuoteFn({ data: { companyId } });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Draft ${result.data.quoteNumber} created`);
    void navigate({ to: "/sales/quotes/$quoteId", params: { quoteId: result.data.id } });
  }

  return (
    <div>
      <PanelHeader
        title="New quote"
        sub="Choose an active trade company to start a draft quotation"
        actions={
          <Link
            to={ROUTES.salesQuotes}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold"
          >
            Back to quotes
          </Link>
        }
      />
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <Field label="Search companies">
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company name…"
          />
        </Field>
        <Field label="Company">
          <select
            className={inputClass}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">Select company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          disabled={!companyId || creating}
          onClick={() => void onCreate()}
          className="h-11 rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create draft quote"}
        </button>
      </div>
    </div>
  );
}
