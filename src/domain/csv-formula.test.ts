import { describe, expect, it } from "vitest";

import { csvFormulaSafeCell, neutralizeSpreadsheetFormula } from "@/domain/csv-formula";
import { fbaIssuesCsv } from "@/domain/fba-stock";
import { clampListPage, MAX_LIST_PAGE } from "@/domain/list-page";
import { priceListExportCsv } from "@/domain/pricing-management";
import { resolveDisplayPrice } from "@/server/pricing/trade-price";
import { clientSafeErrorMessage } from "@/server/http/client-error";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import {
  autopartUploadBytesRejected,
  sanitizeAutopartUploadName,
} from "@/server/companies/autopart-master-import";

describe("spreadsheet formula guard", () => {
  it("neutralises formula text and keeps signed amounts numeric", () => {
    expect(neutralizeSpreadsheetFormula("=CMD()")).toBe("'=CMD()");
    expect(neutralizeSpreadsheetFormula("+cmd|'/c calc'!A0")).toBe("'+cmd|'/c calc'!A0");
    expect(neutralizeSpreadsheetFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeSpreadsheetFormula("-cmd")).toBe("'-cmd");
    expect(neutralizeSpreadsheetFormula("-12.50")).toBe("-12.50");
    expect(neutralizeSpreadsheetFormula("0.00")).toBe("0.00");
    expect(neutralizeSpreadsheetFormula("15")).toBe("15");
    expect(csvFormulaSafeCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvFormulaSafeCell("-8.98")).toBe("-8.98");
  });

  it("guards price-list and FBA export cells", () => {
    const prices = priceListExportCsv([
      {
        sku: "AB1",
        productName: '=HYPERLINK("http://evil")',
        baseTradePrice: "8.7000",
        priceListPrice: "-2.50",
      },
    ]);
    expect(prices).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(prices).toContain(",-2.50");
    expect(prices).not.toContain(",=HYPERLINK");

    const issues = fbaIssuesCsv([
      {
        line: 2,
        sku: "PAD",
        description: "=cmd|'/c calc'!A0",
        branch: null,
        reason: "invalid_avail",
        reasonLabel: "Invalid Avail",
        value: "-3",
      },
    ]);
    expect(issues).toContain("\"'=cmd|'/c calc'!A0\"");
    expect(issues).toContain(",-3");
  });
});

describe("list page bounds", () => {
  it("clamps missing, negative, and huge pages", () => {
    expect(clampListPage(undefined)).toBe(1);
    expect(clampListPage(0)).toBe(1);
    expect(clampListPage(-4)).toBe(1);
    expect(clampListPage(1.9)).toBe(1);
    expect(clampListPage(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampListPage(50_000)).toBe(MAX_LIST_PAGE);
  });
});

describe("client error redaction", () => {
  it("hides driver errors and keeps short validation text", () => {
    const prismaError = new Error("Invalid `prisma.user.findUnique()` invocation:\nsecret");
    prismaError.name = "PrismaClientValidationError";
    expect(clientSafeErrorMessage(prismaError)).toBeNull();
    expect(clientSafeErrorMessage(new Error("Brand is required"))).toBe("Brand is required");
  });
});

describe("anonymous trade prices", () => {
  it("does not return a trade price", () => {
    const price = resolveDisplayPrice({
      viewer: { kind: "anonymous" },
      tradePrice: "12.50",
      rrp: "20.00",
    });
    expect(price.trade).toBeNull();
    expect(price.source).toBe("hidden");
    expect(price.rrp).toBe(20);
  });
});

describe("unauthenticated guards", () => {
  it("rejects a missing actor before any company lookup", async () => {
    await expect(requireAuthenticatedUser(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    await expect(requireAuthenticatedUser(undefined)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Autopart upload names and content", () => {
  it("rejects traversal, binaries, and NUL bytes", () => {
    expect(sanitizeAutopartUploadName("../../etc/passwd")).toBeNull();
    expect(sanitizeAutopartUploadName("..\\windows.ini")).toBeNull();
    expect(sanitizeAutopartUploadName("561L-ALL.CSV")).toBe("561L-ALL.CSV");
    expect(autopartUploadBytesRejected(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(true);
    expect(autopartUploadBytesRejected(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(autopartUploadBytesRejected(Uint8Array.from([0x61, 0x00, 0x62]))).toBe(true);
    expect(autopartUploadBytesRejected(new TextEncoder().encode(".Acct.,Inv & Ln\n"))).toBe(false);
  });
});
