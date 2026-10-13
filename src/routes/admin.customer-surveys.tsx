import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Metric, PanelHeader } from "@/components/ab/AppShell";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { formatStoredRating, type RatingField } from "@/domain/customer-survey";
import {
  deleteCustomerSurveyFn,
  exportCustomerSurveysFn,
  exportPrizeDrawEntriesFn,
  getCustomerSurveyDashboardFn,
  getCustomerSurveyResponseFn,
  importWordpressSurveysFn,
} from "@/server/surveys/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/customer-surveys")({
  head: () => ({ meta: [{ title: "Customer Surveys — Automotive Brands Admin" }] }),
  component: CustomerSurveyAdminPage,
});

type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;

async function loadDashboard(from: string, to: string) {
  const result = await getCustomerSurveyDashboardFn({
    data: {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      page: 1,
      pageSize: 25,
    },
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function CustomerSurveyAdminPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadDetail>> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function refresh(nextFrom = from, nextTo = to) {
    try {
      setData(await loadDashboard(nextFrom, nextTo));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load surveys");
    }
  }

  useEffect(() => {
    void refresh();
    // Initial load only. Date filters apply from the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(kind: "responses" | "prize") {
    const payload = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const result =
      kind === "responses"
        ? await exportCustomerSurveysFn({ data: payload })
        : await exportPrizeDrawEntriesFn({ data: payload });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const blob = new Blob([result.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = kind === "responses" ? "customer-surveys.csv" : "prize-draw-entries.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PanelHeader
        title="Customer Surveys"
        sub="Satisfaction responses, follow-up requests and prize draw entries"
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
              onClick={() => void download("responses")}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
              onClick={() => void download("prize")}
            >
              Export prize draw
            </button>
          </div>
        }
      />
      <div className="space-y-6 px-4 py-5 sm:px-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void refresh();
          }}
        >
          <label className="text-xs font-semibold">
            From
            <input
              type="date"
              className="mt-1 block h-10 rounded-md border border-border px-2"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold">
            To
            <input
              type="date"
              className="mt-1 block h-10 rounded-md border border-border px-2"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
          >
            Apply
          </button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Total responses" value={String(data.total)} />
              <Metric
                label="Average satisfaction"
                value={data.averageOverall == null ? "—" : `${data.averageOverall}/5`}
                hint="N/A excluded"
              />
              <Metric
                label="Average recommendation"
                value={
                  data.averageRecommendation == null ? "—" : `${data.averageRecommendation}/10`
                }
              />
              <Metric
                label="Net Promoter Score"
                value={data.netPromoterScore == null ? "—" : String(data.netPromoterScore)}
                hint="Separate from the average"
              />
            </div>
            <p className="text-xs text-muted-foreground">{data.netPromoterScoreLabel}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.categories.map((category) => (
                <div key={category.id} className="border border-border p-3 text-sm">
                  <div className="font-semibold">{category.label}</div>
                  <div className="mt-1">
                    {category.average == null ? "—" : `${category.average}/5`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {category.responses} scored answers, N/A excluded
                  </div>
                </div>
              ))}
            </div>
            <section>
              <h2 className="font-display text-sm font-semibold uppercase">Response trend</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {data.trends.length === 0 ? <li>No responses in this period.</li> : null}
                {data.trends.map((point) => (
                  <li
                    key={point.date}
                    className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2"
                  >
                    <span>{point.date}</span>
                    <span
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.max(8, point.count * 12)}px` }}
                    />
                    <span>{point.count}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="grid gap-4 lg:grid-cols-2">
              <div>
                <h2 className="font-display text-sm font-semibold uppercase">Contact requests</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {data.contactRequests.length === 0 ? <li>No follow-up requests.</li> : null}
                  {data.contactRequests.map((row) => (
                    <li key={row.id} className="border border-border p-2">
                      <button
                        type="button"
                        className="font-semibold underline"
                        onClick={() => void openDetail(row.id, setDetail)}
                      >
                        {row.reference}
                      </button>
                      <div>
                        {row.customerName || "—"} · {row.customerEmail || "—"} ·{" "}
                        {row.customerPhone || "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold uppercase">Prize draw</h2>
                <p className="mt-2 text-sm">
                  {data.prizeDraw.requested} requested · {data.prizeDraw.accepted} eligible entries
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Eligible entries are accepted submissions inside the published window. Winners are
                  not selected here.
                </p>
              </div>
            </section>
            <section>
              <h2 className="font-display text-sm font-semibold uppercase">Written feedback</h2>
              <ul className="mt-2 space-y-3 text-sm">
                {data.feedback.length === 0 ? <li>No written comments.</li> : null}
                {data.feedback.map((row) => (
                  <li key={row.id} className="border border-border p-3">
                    <div className="font-semibold">{row.reference}</div>
                    {row.doWell ? (
                      <p className="mt-1">
                        <strong>Does well:</strong> {row.doWell}
                      </p>
                    ) : null}
                    {row.couldImprove ? (
                      <p className="mt-1">
                        <strong>Could improve:</strong> {row.couldImprove}
                      </p>
                    ) : null}
                    {row.productRequests ? (
                      <p className="mt-1">
                        <strong>Requests:</strong> {row.productRequests}
                      </p>
                    ) : null}
                    {row.additionalComments ? (
                      <p className="mt-1">
                        <strong>Other:</strong> {row.additionalComments}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase">
                    <th className="py-2">Date</th>
                    <th>Overall</th>
                    <th>Recommend</th>
                    <th>Contact</th>
                    <th>Prize draw</th>
                    <th>Email</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-b border-border/70">
                      <td className="py-2">{row.submittedAt.slice(0, 16).replace("T", " ")}</td>
                      <td>{formatStoredRating("overallSatisfaction", row.overallSatisfaction)}</td>
                      <td>
                        {formatStoredRating(
                          "recommendationScore" as RatingField,
                          row.recommendationScore,
                        )}
                      </td>
                      <td>{row.contactPermission}</td>
                      <td>
                        {row.prizeDrawAccepted
                          ? "Accepted"
                          : row.prizeDrawRequested
                            ? "Not accepted"
                            : "No"}
                      </td>
                      <td>
                        {row.customerEmail || "—"}
                        <div className="text-xs text-muted-foreground">{row.ackEmailStatus}</div>
                      </td>
                      <td className="space-x-2 text-right">
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void openDetail(row.id, setDetail)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="text-destructive underline"
                          onClick={() => setDeleteId(row.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail ? (
              <article className="border border-border p-4 text-sm">
                <h2 className="font-semibold">{detail.reference}</h2>
                <ul className="mt-3 space-y-2">
                  {detail.answers.map((answer) => (
                    <li key={`${answer.number}-${answer.prompt}`}>
                      <strong>{answer.prompt}</strong> {answer.value}
                    </li>
                  ))}
                </ul>
                <p className="mt-3">
                  <strong>Sales support:</strong> {detail.salesHelp.join(", ") || "—"}
                </p>
                <p className="mt-2">
                  <strong>Contact:</strong> {detail.customerName || "—"} ·{" "}
                  {detail.customerEmail || "—"} · {detail.customerPhone || "—"}
                </p>
                <p>
                  <strong>Business:</strong> {detail.businessName || "—"}
                </p>
                <p>
                  <strong>Prize draw:</strong>{" "}
                  {detail.prizeDrawAccepted
                    ? "Accepted"
                    : detail.prizeDrawRequested
                      ? `Not accepted (${detail.prizeDrawRejectionReason ?? "—"})`
                      : "No"}
                </p>
              </article>
            ) : null}
            <section className="border border-border p-4 text-sm">
              <h2 className="font-semibold">Import historic WordPress CSV</h2>
              <p className="mt-1 text-muted-foreground">
                Existing WordPress ids are skipped. Imported rows do not send acknowledgement emails
                and are not marked as eligible prize draw entries.
              </p>
              <input
                className="mt-3 block text-sm"
                type="file"
                accept=".csv,text/csv"
                disabled={importing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setImporting(true);
                  void file.text().then(async (csv) => {
                    const result = await importWordpressSurveysFn({ data: { csv } });
                    setImporting(false);
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(
                      `Imported ${result.data.imported}, skipped ${result.data.skipped}, invalid ${result.data.invalid}`,
                    );
                    await refresh();
                  });
                }}
              />
            </section>
          </>
        ) : null}
      </div>
      <ConfirmAction
        open={deleteId != null}
        title="Delete survey submission"
        description="This permanently deletes the submission and its prize draw claim. This cannot be undone."
        confirmLabel="Delete"
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={() => {
          if (!deleteId) return;
          void deleteCustomerSurveyFn({ data: { id: deleteId } }).then((result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Survey submission deleted");
            setDetail(null);
            void refresh();
          });
        }}
      />
    </div>
  );
}

async function loadDetail(id: string) {
  const result = await getCustomerSurveyResponseFn({ data: { id } });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function openDetail(
  id: string,
  setDetail: (detail: Awaited<ReturnType<typeof loadDetail>> | null) => void,
) {
  try {
    setDetail(await loadDetail(id));
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : "Unable to open the response");
  }
}
