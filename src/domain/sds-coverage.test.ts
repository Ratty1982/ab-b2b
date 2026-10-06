import { describe, expect, it } from "vitest";
import {
  classifySdsCoverage,
  finaliseSdsCoverageCounts,
  formatSdsCoveragePercent,
  isSdsCoverageSatisfied,
  sdsCoveragePercent,
  sdsDocumentMetaLabel,
  toUtf8Csv,
} from "@/domain/sds-coverage";

describe("SDS coverage definitions", () => {
  it("classifies current / missing / archived only / not required", () => {
    expect(
      classifySdsCoverage({ sdsRequirement: "REQUIRED", hasCurrentSds: true, hasArchivedSds: false }),
    ).toBe("CURRENT");
    expect(
      classifySdsCoverage({ sdsRequirement: "REQUIRED", hasCurrentSds: false, hasArchivedSds: false }),
    ).toBe("MISSING");
    expect(
      classifySdsCoverage({ sdsRequirement: "REQUIRED", hasCurrentSds: false, hasArchivedSds: true }),
    ).toBe("ARCHIVED_ONLY");
    expect(
      classifySdsCoverage({ sdsRequirement: "NOT_REQUIRED", hasCurrentSds: false, hasArchivedSds: false }),
    ).toBe("NOT_REQUIRED");
  });

  it("treats Not Required as covered even when documents exist or are absent", () => {
    expect(
      isSdsCoverageSatisfied(
        classifySdsCoverage({
          sdsRequirement: "NOT_REQUIRED",
          hasCurrentSds: false,
          hasArchivedSds: true,
        }),
      ),
    ).toBe(true);
    expect(isSdsCoverageSatisfied("CURRENT")).toBe(true);
    expect(isSdsCoverageSatisfied("MISSING")).toBe(false);
    expect(isSdsCoverageSatisfied("ARCHIVED_ONLY")).toBe(false);
  });

  it("calculates coverage as (current + not required) / active products", () => {
    const counts = finaliseSdsCoverageCounts({
      activeProducts: 412,
      currentSds: 287,
      archivedOnly: 7,
      notRequired: 15,
    });
    expect(counts.missingSds).toBe(103);
    expect(counts.coveragePercent).toBe(73.3);
    expect(formatSdsCoveragePercent(counts.coveragePercent)).toBe("73.3%");
    expect(sdsCoveragePercent(287, 15, 412)).toBe(73.3);
    expect(sdsCoveragePercent(0, 0, 0)).toBe(0);
  });

  it("does not invent a revision date when only an upload timestamp exists", () => {
    const withRev = sdsDocumentMetaLabel({
      filename: "PMAPC500.pdf",
      revision: "3.1",
      documentDateLabel: "01/06/2026",
      uploadedLabel: "06/10/2026",
    });
    expect(withRev.detail).toBe("Revision 3.1 · 01/06/2026");
    const uploadedOnly = sdsDocumentMetaLabel({
      filename: "PMAPC500.pdf",
      revision: null,
      documentDateLabel: null,
      uploadedLabel: "06/10/2026",
    });
    expect(uploadedOnly.detail).toBe("Uploaded 06/10/2026");
  });

  it("writes UTF-8 CSV with a BOM", () => {
    const csv = toUtf8Csv(["Product", "SKU"], [["All Purpose Cleaner", "PMAPC500"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Product,SKU");
    expect(csv).toContain("All Purpose Cleaner,PMAPC500");
  });
});
