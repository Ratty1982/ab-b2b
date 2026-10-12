/**
 * Spreadsheet formula guard for exported CSV.
 * A leading = + - @ tab or carriage return is treated as a formula by Excel
 * and LibreOffice. Plain signed numbers such as -12.50 stay numeric.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function neutralizeSpreadsheetFormula(value: string): string {
  if (PLAIN_NUMBER.test(value)) return value;
  if (FORMULA_PREFIX.test(value)) return `'${value}`;
  return value;
}

export function csvFormulaSafeCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  const safe = neutralizeSpreadsheetFormula(raw);
  if (safe !== raw || /[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}
