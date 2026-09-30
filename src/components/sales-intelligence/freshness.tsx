import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/datetime";
import { getSalesIntelligenceFreshnessFn } from "@/server/phase2/fns";

/** Compact freshness label for Sales Intelligence headers. */
export function useSalesIntelligenceFreshnessLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getSalesIntelligenceFreshnessFn();
      if (cancelled || !res.ok) return;
      const updated = res.data.salesDataUpdatedAt
        ? formatDateTime(res.data.salesDataUpdatedAt, { seconds: false, timeZoneName: false })
        : null;
      if (!updated) {
        setLabel("Sales data updated: historic baseline (no ongoing 504/TRM21QC yet)");
        return;
      }
      const alignNote = res.data.feedsAligned
        ? ""
        : res.data.lastSuccess504At && res.data.lastSuccessTrm21qcAt
          ? " · feeds not fully aligned"
          : !res.data.lastSuccess504At
            ? " · 504 missing"
            : " · TRM21QC missing";
      setLabel(`Sales data updated: ${updated}${alignNote}`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return label;
}
