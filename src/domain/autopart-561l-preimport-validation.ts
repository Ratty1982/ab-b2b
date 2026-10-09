/**
 * Dry-run financial checks for a complete 561L invoice file.
 *
 * Totals use scaled Money. Account matching is the exact 407EXP account code
 * already stored on AutopartAccount. Customer names are never compared.
 * Nothing here writes invoice lines, accounts, stock, or orders.
 *
 * Source identities follow the importer across the whole file, not per chunk:
 * sha256(account, Inv & Ln, part, quantity, sales, occurrence). The occurrence
 * counts every accepted copy of that natural key. A repeated identity blocks
 * the import instead of overwriting an earlier line.
 */
import { createHash } from "node:crypto";
import type {
  CanonicalColumn,
  CsvRowRejection,
  CsvScanRecord,
  ParsedInvoiceCsvRow,
} from "@/domain/autopart-bulk-csv";
import { moneyField } from "@/domain/autopart-bulk-csv";
import { parseInvAndLn } from "@/domain/autopart-561l";
import { addMoney, moneyToString, moneyZero, parseMoney, type Money } from "@/domain/money";

/** Must stay equal to the invoice flush size in the Autopart master importer. */
export const INVOICE_IMPORT_CHUNK = 200;
export const PREVIEW_EXCEPTION_LIMIT = 40;
export const DOWNLOAD_EXCEPTION_LIMIT = 100_000;

export type ValidationOutcome = "PASS" | "WARNING" | "FAIL";

export type ValidationCheck = {
  id: string;
  label: string;
  outcome: ValidationOutcome;
  summary: string;
};

export type ValidationException = {
  checkId: string;
  outcome: ValidationOutcome;
  rowNumber: number | null;
  accountCode: string | null;
  invoiceReference: string | null;
  partNumber: string | null;
  quantity: string | null;
  salesAmount: string | null;
  detail: string;
};

export type InvoicePreimportValidation = {
  salesMeasure: "NET_EX_VAT";
  dryRun: true;
  accountMatchRule: "exact_account_code";
  nameMatching: "never";
  masterAccounts: number;
  acceptedLines: number;
  netSales: string;
  positiveSales: string;
  positiveCount: number;
  negativeSales: string;
  negativeCount: number;
  zeroCount: number;
  matchedLines: number;
  unmatchedLines: number;
  distinctUnmatchedAccounts: number;
  unmatchedSales: string;
  recoveredLines: number;
  recoveredFieldFailures: number;
  mergedLineFailures: number;
  preservedSeparateLines: number;
  identityCollisions: number;
  missingAccounts: number;
  missingInvoiceReferences: number;
  invalidAmounts: number;
  ambiguousRecovered: number;
  otherRejected: number;
  checks: ValidationCheck[];
  exceptions: ValidationException[];
  exceptionSampleTruncated: boolean;
  exceptionsOmitted: number;
};

type InterpretedInvoice = { row: ParsedInvoiceCsvRow } | { reject: CsvRowRejection };

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function gbp(value: Money): string {
  return moneyToString(value, 2);
}

function parsedSales(amount: string): Money | null {
  return parseMoney(amount);
}

function signOf(value: Money): -1 | 0 | 1 {
  if (value.minor < 0n) return -1;
  if (value.minor > 0n) return 1;
  return 0;
}

function cell(cells: string[], index: number | undefined): string {
  if (index == null) return "";
  return cells[index] ?? "";
}

function invoiceReferenceTokens(raw: string): string[] {
  const found = raw.match(/(?:^|[\n,])"?([IC]\/[A-Za-z0-9][A-Za-z0-9._-]*\/\d*)/gi) ?? [];
  return found.map((token) => token.replace(/^[\n,"]+/, "").toUpperCase());
}

function continuationIsInvoiceLine(line: string): boolean {
  const comma = line.indexOf(",");
  if (comma < 0) return false;
  const inv = line
    .slice(comma + 1)
    .trim()
    .replace(/^"/, "");
  return /^[IC]\//i.test(inv);
}

export function invoiceNaturalKey(row: {
  accountCode: string;
  rawInvAndLn: string;
  partNumber: string;
  quantity: string;
  salesAmount: string;
}): string {
  return [row.accountCode, row.rawInvAndLn, row.partNumber, row.quantity, row.salesAmount].join(
    "\u001e",
  );
}

export function invoiceLineSourceIdentity(natural: string, occurrence: number): string {
  return createHash("sha256")
    .update(`${natural}\u001e${String(occurrence)}`)
    .digest("hex");
}

export function nextInvoiceSourceIdentity(
  occurrences: Map<string, number>,
  row: {
    accountCode: string;
    rawInvAndLn: string;
    partNumber: string;
    quantity: string;
    salesAmount: string;
  },
): string {
  const natural = invoiceNaturalKey(row);
  const occurrence = (occurrences.get(natural) ?? 0) + 1;
  occurrences.set(natural, occurrence);
  return invoiceLineSourceIdentity(natural, occurrence);
}

function sameMoneyText(left: string, right: string): boolean {
  const a = parseMoney(left);
  const b = parseMoney(right);
  if (!a || !b) return left === right;
  return a.minor === b.minor;
}

export function sameInvoiceNatural(
  left: {
    accountCode: string;
    rawInvAndLn: string;
    partNumber: string;
    quantity: string;
    salesAmount: string;
  },
  right: {
    accountCode: string;
    rawInvAndLn: string;
    partNumber: string;
    quantity: string;
    salesAmount: string;
  },
): boolean {
  return (
    left.accountCode === right.accountCode &&
    left.rawInvAndLn === right.rawInvAndLn &&
    left.partNumber === right.partNumber &&
    sameMoneyText(left.quantity, right.quantity) &&
    sameMoneyText(left.salesAmount, right.salesAmount)
  );
}

export function failedValidationChecks(report: InvoicePreimportValidation): ValidationCheck[] {
  return report.checks.filter((check) => check.outcome === "FAIL");
}

export function validationCsvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  const safe = PLAIN_NUMBER.test(raw) || !FORMULA_PREFIX.test(raw) ? raw : `'${raw}`;
  if (safe !== raw || /[",\r\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

function csvRow(values: Array<string | number | null>): string {
  return values.map((value) => validationCsvCell(value)).join(",");
}

export function invoiceValidationReportCsv(report: InvoicePreimportValidation): string {
  const header = [
    "section",
    "check",
    "outcome",
    "row_number",
    "account_code",
    "invoice_reference",
    "part_number",
    "quantity",
    "sales_amount",
    "detail",
  ];
  const lines = [header.join(",")];
  const outcomeFor = (id: string): ValidationOutcome =>
    report.checks.find((check) => check.id === id)?.outcome ?? "PASS";
  const summary = (check: string, amount: string, detail: string) => {
    lines.push(
      csvRow(["summary", check, outcomeFor(check), null, null, null, null, null, amount, detail]),
    );
  };
  summary("signed_net_sales", report.netSales, "NET_EX_VAT across accepted invoice lines");
  summary("positive_sales", report.positiveSales, `${report.positiveCount} lines`);
  summary("negative_sales", report.negativeSales, `${report.negativeCount} lines`);
  summary("zero_value_lines", "0.00", `${report.zeroCount} lines`);
  summary(
    "account_master_match",
    report.unmatchedSales,
    `${report.unmatchedLines} lines across ${report.distinctUnmatchedAccounts} account codes. Exact account code only. Names are not matched.`,
  );
  for (const check of report.checks) {
    lines.push(
      csvRow(["check", check.id, check.outcome, null, null, null, null, null, null, check.summary]),
    );
  }
  for (const exception of report.exceptions) {
    lines.push(
      csvRow([
        "exception",
        exception.checkId,
        exception.outcome,
        exception.rowNumber,
        exception.accountCode,
        exception.invoiceReference,
        exception.partNumber,
        exception.quantity,
        exception.salesAmount,
        exception.detail,
      ]),
    );
  }
  if (report.exceptionSampleTruncated) {
    lines.push(
      csvRow([
        "summary",
        "exception_log",
        "WARNING",
        null,
        null,
        null,
        null,
        null,
        null,
        `${report.exceptionsOmitted} further exception rows were omitted. Totals still include the whole file.`,
      ]),
    );
  }
  return lines.join("\n");
}

export function createInvoicePreimportValidation(input: {
  knownAccountCodes: ReadonlySet<string>;
  exceptionLimit: number;
}) {
  let acceptedLines = 0;
  let net = moneyZero();
  let positive = moneyZero();
  let negative = moneyZero();
  let positiveCount = 0;
  let negativeCount = 0;
  let zeroCount = 0;
  let matchedLines = 0;
  let unmatchedLines = 0;
  let unmatchedSales = moneyZero();
  let recoveredLines = 0;
  let recoveredFieldFailures = 0;
  let mergedLineFailures = 0;
  let preservedSeparateLines = 0;
  let identityCollisions = 0;
  let missingAccounts = 0;
  let missingInvoiceReferences = 0;
  let invalidAmounts = 0;
  let ambiguousRecovered = 0;
  let otherRejected = 0;
  let arithmeticFailures = 0;
  let exceptionsOmitted = 0;
  const unmatchedCodes = new Set<string>();
  const invoiceLines = new Map<string, number>();
  const seenIdentity = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const exceptions: ValidationException[] = [];

  const pushException = (exception: ValidationException) => {
    if (exceptions.length < input.exceptionLimit) {
      exceptions.push(exception);
      return;
    }
    exceptionsOmitted += 1;
    if (exception.outcome !== "FAIL") return;
    const warningIndex = exceptions.findIndex((item) => item.outcome === "WARNING");
    if (warningIndex < 0) return;
    exceptions.splice(warningIndex, 1);
    exceptions.push(exception);
  };

  const observeAccepted = (
    record: CsvScanRecord,
    row: ParsedInvoiceCsvRow,
    map: Partial<Record<CanonicalColumn, number>>,
  ) => {
    acceptedLines += 1;
    const sales = parsedSales(row.salesAmount);
    if (!sales) {
      arithmeticFailures += 1;
      pushException({
        checkId: "signed_net_sales",
        outcome: "FAIL",
        rowNumber: row.rowNumber,
        accountCode: row.accountCode,
        invoiceReference: row.rawInvAndLn || null,
        partNumber: row.partNumber,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        detail: "Accepted sales amount could not be summed with decimal arithmetic.",
      });
    } else {
      net = addMoney(net, sales);
      const sign = signOf(sales);
      if (sign > 0) {
        positive = addMoney(positive, sales);
        positiveCount += 1;
      } else if (sign < 0) {
        negative = addMoney(negative, sales);
        negativeCount += 1;
      } else {
        zeroCount += 1;
      }
    }

    if (input.knownAccountCodes.has(row.accountCode)) {
      matchedLines += 1;
    } else {
      unmatchedLines += 1;
      unmatchedCodes.add(row.accountCode);
      if (sales) unmatchedSales = addMoney(unmatchedSales, sales);
      pushException({
        checkId: "account_master_match",
        outcome: "WARNING",
        rowNumber: row.rowNumber,
        accountCode: row.accountCode,
        invoiceReference: row.rawInvAndLn || null,
        partNumber: row.partNumber,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        detail:
          "Account code is not in the imported 407EXP customer master. It stays quarantined for manual mapping and is not matched by name.",
      });
    }

    const reference = parseInvAndLn(row.rawInvAndLn);
    if (!row.rawInvAndLn.trim() || !reference.ok || !reference.documentReference) {
      missingInvoiceReferences += 1;
      pushException({
        checkId: "missing_invoice_references",
        outcome: "FAIL",
        rowNumber: row.rowNumber,
        accountCode: row.accountCode,
        invoiceReference: row.rawInvAndLn || null,
        partNumber: row.partNumber,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        detail: reference.issue ?? "Invoice reference is missing.",
      });
    }

    if (record.recovered) {
      recoveredLines += 1;
      const account = cell(record.cells, map.account).trim();
      const inv = cell(record.cells, map.invLn).trim();
      const part = cell(record.cells, map.part).trim();
      const unitsRaw = cell(record.cells, map.units);
      const salesRaw = cell(record.cells, map.sales);
      const units = moneyField(unitsRaw);
      const recoveredSales = moneyField(salesRaw);
      const parsedInv = parseInvAndLn(inv);
      const unitsMoney = units.value ? parsedSales(units.value) : null;
      const rowUnits = parsedSales(row.quantity);
      const recoveredSalesMoney = recoveredSales.value ? parsedSales(recoveredSales.value) : null;
      const rowSales = parsedSales(row.salesAmount);
      const fieldsMatch =
        account === row.accountCode &&
        part === row.partNumber &&
        parsedInv.ok &&
        parsedInv.documentReference === row.documentReference &&
        parsedInv.sourceLineNumber === row.sourceLineNumber &&
        unitsMoney != null &&
        rowUnits != null &&
        unitsMoney.minor === rowUnits.minor &&
        recoveredSalesMoney != null &&
        rowSales != null &&
        recoveredSalesMoney.minor === rowSales.minor;
      if (!fieldsMatch) {
        recoveredFieldFailures += 1;
        pushException({
          checkId: "recovered_fields",
          outcome: "FAIL",
          rowNumber: row.rowNumber,
          accountCode: row.accountCode,
          invoiceReference: row.rawInvAndLn || null,
          partNumber: row.partNumber,
          quantity: row.quantity,
          salesAmount: row.salesAmount,
          detail:
            "Recovered account, invoice reference, part, signed quantity, or signed sales amount does not match the source cells.",
        });
      }
    }

    const references = invoiceReferenceTokens(record.raw);
    const joinedRecord = record.raw
      .split("\n")
      .slice(1)
      .some((line) => continuationIsInvoiceLine(line));
    const uniqueRefs = new Set(references);
    if (uniqueRefs.size > 1 || joinedRecord) {
      mergedLineFailures += 1;
      pushException({
        checkId: "no_merged_lines",
        outcome: "FAIL",
        rowNumber: row.rowNumber,
        accountCode: row.accountCode,
        invoiceReference: row.rawInvAndLn || null,
        partNumber: row.partNumber,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        detail:
          "This record contains more than one invoice line. Consecutive lines must stay separate.",
      });
    }

    const invoiceKey = `${row.accountCode}\u001e${row.rawInvAndLn}`;
    const seenOnInvoice = invoiceLines.get(invoiceKey) ?? 0;
    if (seenOnInvoice > 0) preservedSeparateLines += 1;
    invoiceLines.set(invoiceKey, seenOnInvoice + 1);

    const identity = nextInvoiceSourceIdentity(occurrences, row);
    const firstRow = seenIdentity.get(identity);
    if (firstRow != null) {
      identityCollisions += 1;
      pushException({
        checkId: "unexpected_duplicate_identities",
        outcome: "FAIL",
        rowNumber: row.rowNumber,
        accountCode: row.accountCode,
        invoiceReference: row.rawInvAndLn || null,
        partNumber: row.partNumber,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        detail: `This line repeats the source identity first used on row ${firstRow}. Import is blocked so the earlier line is not overwritten.`,
      });
    } else {
      seenIdentity.set(identity, row.rowNumber);
    }
  };

  return {
    observe(
      record: CsvScanRecord,
      interpreted: InterpretedInvoice,
      map: Partial<Record<CanonicalColumn, number>>,
    ) {
      if ("reject" in interpreted) {
        const issue = interpreted.reject.issueType;
        if (issue === "MISSING_ACCOUNT") {
          missingAccounts += 1;
          pushException({
            checkId: "missing_account_codes",
            outcome: "FAIL",
            rowNumber: interpreted.reject.rowNumber,
            accountCode: null,
            invoiceReference: null,
            partNumber: null,
            quantity: null,
            salesAmount: null,
            detail: interpreted.reject.explanation,
          });
        } else if (issue === "INVALID_MONEY" || issue === "INVALID_QUANTITY") {
          invalidAmounts += 1;
          pushException({
            checkId: "invalid_numeric_amounts",
            outcome: "FAIL",
            rowNumber: interpreted.reject.rowNumber,
            accountCode: null,
            invoiceReference: null,
            partNumber: null,
            quantity: null,
            salesAmount: null,
            detail: interpreted.reject.explanation,
          });
        } else if (interpreted.reject.explanation.includes("Ambiguous")) {
          ambiguousRecovered += 1;
          pushException({
            checkId: "ambiguous_recovered",
            outcome: "FAIL",
            rowNumber: interpreted.reject.rowNumber,
            accountCode: null,
            invoiceReference: null,
            partNumber: null,
            quantity: null,
            salesAmount: null,
            detail: interpreted.reject.explanation,
          });
        } else {
          otherRejected += 1;
          pushException({
            checkId: "other_rejected_rows",
            outcome: "WARNING",
            rowNumber: interpreted.reject.rowNumber,
            accountCode: null,
            invoiceReference: null,
            partNumber: null,
            quantity: null,
            salesAmount: null,
            detail: interpreted.reject.explanation,
          });
        }
      } else {
        observeAccepted(record, interpreted.row, map);
      }
    },
    finish(): InvoicePreimportValidation {
      const netText = gbp(net);
      const positiveText = gbp(positive);
      const negativeText = gbp(negative);
      const summed = gbp(addMoney(positive, negative));
      const arithmeticOk = arithmeticFailures === 0 && summed === netText;
      const checks: ValidationCheck[] = [
        {
          id: "signed_net_sales",
          label: "Signed net sales excluding VAT",
          outcome: arithmeticOk ? (acceptedLines > 0 ? "PASS" : "WARNING") : "FAIL",
          summary: arithmeticOk
            ? `${acceptedLines.toLocaleString("en-GB")} accepted lines total ${netText} NET_EX_VAT.`
            : "Accepted sales could not be summed with decimal arithmetic.",
        },
        {
          id: "positive_sales",
          label: "Positive sales",
          outcome: arithmeticOk ? "PASS" : "FAIL",
          summary: `${positiveCount.toLocaleString("en-GB")} lines total ${positiveText}.`,
        },
        {
          id: "negative_sales",
          label: "Negative sales and credits",
          outcome: arithmeticOk ? "PASS" : "FAIL",
          summary: `${negativeCount.toLocaleString("en-GB")} lines total ${negativeText}.`,
        },
        {
          id: "zero_value_lines",
          label: "Zero-value lines",
          outcome: "PASS",
          summary: `${zeroCount.toLocaleString("en-GB")} accepted lines have a sales amount of 0.00.`,
        },
        {
          id: "recovered_fields",
          label: "Recovered CSV fields",
          outcome: recoveredFieldFailures > 0 ? "FAIL" : "PASS",
          summary:
            recoveredFieldFailures > 0
              ? `${recoveredFieldFailures.toLocaleString("en-GB")} recovered rows do not match their source account, invoice reference, part, quantity, or sales amount.`
              : `${recoveredLines.toLocaleString("en-GB")} recovered rows keep the source account, invoice reference, part, signed quantity, and signed sales amount.`,
        },
        {
          id: "no_merged_lines",
          label: "Consecutive lines stay separate",
          outcome: mergedLineFailures > 0 ? "FAIL" : "PASS",
          summary:
            mergedLineFailures > 0
              ? `${mergedLineFailures.toLocaleString("en-GB")} records contain more than one invoice line.`
              : "No accepted record contains a second invoice line.",
        },
        {
          id: "legitimate_duplicate_lines",
          label: "Legitimate duplicate invoice lines",
          outcome: identityCollisions > 0 ? "FAIL" : "PASS",
          summary:
            identityCollisions > 0
              ? `${identityCollisions.toLocaleString("en-GB")} source identities would overwrite an earlier line. ${preservedSeparateLines.toLocaleString("en-GB")} extra lines on a shared invoice reference were still read.`
              : `${preservedSeparateLines.toLocaleString("en-GB")} extra accepted lines share an invoice reference and stay separate.`,
        },
        {
          id: "account_master_match",
          label: "407EXP account codes",
          outcome: unmatchedLines > 0 ? "WARNING" : "PASS",
          summary:
            unmatchedLines > 0
              ? `${unmatchedLines.toLocaleString("en-GB")} lines and ${gbp(unmatchedSales)} belong to ${unmatchedCodes.size.toLocaleString("en-GB")} account codes that are not in the customer master. They stay quarantined. Names are not used.`
              : `${matchedLines.toLocaleString("en-GB")} accepted lines match an imported account code exactly.`,
        },
        {
          id: "missing_account_codes",
          label: "Missing account codes",
          outcome: missingAccounts > 0 ? "FAIL" : "PASS",
          summary:
            missingAccounts > 0
              ? `${missingAccounts.toLocaleString("en-GB")} rows have no account code and stay rejected.`
              : "Every data row has an account code.",
        },
        {
          id: "missing_invoice_references",
          label: "Missing invoice references",
          outcome: missingInvoiceReferences > 0 ? "FAIL" : "PASS",
          summary:
            missingInvoiceReferences > 0
              ? `${missingInvoiceReferences.toLocaleString("en-GB")} accepted lines have a missing or unreadable Inv & Ln.`
              : "Every accepted line has an invoice reference.",
        },
        {
          id: "invalid_numeric_amounts",
          label: "Invalid numeric amounts",
          outcome: invalidAmounts > 0 ? "FAIL" : "PASS",
          summary:
            invalidAmounts > 0
              ? `${invalidAmounts.toLocaleString("en-GB")} rows have a quantity or sales amount that is not numeric. They stay rejected.`
              : "Every accepted quantity and sales amount is numeric.",
        },
        {
          id: "unexpected_duplicate_identities",
          label: "Unexpected duplicate source identities",
          outcome: identityCollisions > 0 ? "FAIL" : "PASS",
          summary:
            identityCollisions > 0
              ? `${identityCollisions.toLocaleString("en-GB")} lines repeat a source identity. Import is blocked.`
              : "No accepted line repeats a source identity.",
        },
        {
          id: "ambiguous_recovered",
          label: "Ambiguous recovered records",
          outcome: ambiguousRecovered > 0 ? "FAIL" : "PASS",
          summary:
            ambiguousRecovered > 0
              ? `${ambiguousRecovered.toLocaleString("en-GB")} rows were quarantined because the quantity could not be identified.`
              : "No recovered row has an ambiguous quantity.",
        },
        {
          id: "other_rejected_rows",
          label: "Other rejected rows",
          outcome: otherRejected > 0 ? "WARNING" : "PASS",
          summary:
            otherRejected > 0
              ? `${otherRejected.toLocaleString("en-GB")} rows were rejected for another parsing reason and are excluded from the sales total.`
              : "No other rows were rejected.",
        },
      ];
      return {
        salesMeasure: "NET_EX_VAT",
        dryRun: true,
        accountMatchRule: "exact_account_code",
        nameMatching: "never",
        masterAccounts: input.knownAccountCodes.size,
        acceptedLines,
        netSales: netText,
        positiveSales: positiveText,
        positiveCount,
        negativeSales: negativeText,
        negativeCount,
        zeroCount,
        matchedLines,
        unmatchedLines,
        distinctUnmatchedAccounts: unmatchedCodes.size,
        unmatchedSales: gbp(unmatchedSales),
        recoveredLines,
        recoveredFieldFailures,
        mergedLineFailures,
        preservedSeparateLines,
        identityCollisions,
        missingAccounts,
        missingInvoiceReferences,
        invalidAmounts,
        ambiguousRecovered,
        otherRejected,
        checks,
        exceptions,
        exceptionSampleTruncated: exceptionsOmitted > 0,
        exceptionsOmitted,
      };
    },
  };
}
