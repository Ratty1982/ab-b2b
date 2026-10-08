import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getPortalAutopartHistoryFn } from "@/server/companies/autopart-master-fns";

export const Route = createFileRoute("/portal/autopart-history")({
  head: () => ({
    meta: [{ title: "Historical purchases — Automotive Brands" }],
  }),
  component: PortalAutopartHistoryPage,
});

type History = Extract<
  Awaited<ReturnType<typeof getPortalAutopartHistoryFn>>,
  { ok: true }
>["data"];

function PortalAutopartHistoryPage() {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPortalAutopartHistoryFn({ data: { page: 1 } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
  }, []);

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold uppercase">Historical purchases</h1>
      <p className="mt-2 text-sm text-steel">
        Autopart history stays hidden until an administrator enables it for your account.
      </p>
      {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}
      {data && !data.enabled ? (
        <p className="mt-6 border border-border px-4 py-4 text-sm text-steel">
          Historical Autopart records are not enabled.
        </p>
      ) : null}
      {data?.enabled && data.items.length === 0 ? (
        <p className="mt-6 text-sm text-steel">
          No approved historical product lines are available.
        </p>
      ) : null}
      {data?.enabled && data.items.length > 0 ? (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-steel">
            <tr>
              <th className="py-2">Reference</th>
              <th>Part</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Historical sales</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-t border-border/70">
                <td className="py-2 font-mono text-[12px]">{item.rawInvAndLn}</td>
                <td>{item.partNumber}</td>
                <td>{item.description || "—"}</td>
                <td className="tabular-nums">{item.quantity}</td>
                <td className="tabular-nums">{item.salesAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
