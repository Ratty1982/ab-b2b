const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{2,64}$/i;

/**
 * Best-effort client address for rate-limit buckets.
 * A missing or malformed address becomes "unknown" and is not used as an IP
 * bucket, so a proxy that does not send an address cannot lock every user
 * into one shared IP limit.
 *
 * These headers are only trustworthy when the reverse proxy overwrites them.
 * That production proxy behaviour was not inspected from this repository.
 */
export function clientAddress(headers: Headers): string {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const value = raw?.trim() ?? "";
    if (!value || value.length > 64) continue;
    if (IP_RE.test(value)) return value;
  }
  return "unknown";
}
