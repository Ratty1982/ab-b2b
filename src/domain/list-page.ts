/** Upper bound for page query parameters. Prevents huge OFFSET skips. */
export const MAX_LIST_PAGE = 10_000;

export function clampListPage(page: number | undefined | null, max = MAX_LIST_PAGE): number {
  if (page == null || !Number.isFinite(page)) return 1;
  const whole = Math.trunc(page);
  if (whole < 1) return 1;
  if (whole > max) return max;
  return whole;
}
