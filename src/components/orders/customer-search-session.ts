/** Decides whether a customer-search response may update the desk. */
export function customerSearchResponseIsCurrent(input: {
  mounted: boolean;
  responseSeq: number;
  currentSeq: number;
  responseQuery: string;
  currentQuery: string;
  responsePage: number;
  currentPage: number;
}): boolean {
  return (
    input.mounted &&
    input.responseSeq === input.currentSeq &&
    input.responseQuery === input.currentQuery &&
    input.responsePage === input.currentPage
  );
}

/** A new search term starts again at the first page. */
export function pageAfterQueryChange(previousQuery: string, nextQuery: string, page: number): number {
  return previousQuery === nextQuery ? page : 1;
}
