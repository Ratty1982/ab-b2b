/** Narrow fetch used by the Microsoft 365 flow. Redirects are explicit. */
export type MicrosoftFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: HeadersInit;
    body?: string | URLSearchParams;
    redirect?: "manual" | "error" | "follow";
  },
) => Promise<Response>;
