const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function securityAlertRecipient(): string | null {
  const raw = process.env["SECURITY_ALERT_EMAIL"]?.trim() ?? "";
  if (!raw || raw.length > 320 || !EMAIL_RE.test(raw)) return null;
  return raw.toLowerCase();
}

export function buildSecurityAlertMessage(input: {
  kind: string;
  summary: string;
  occurredAt: Date;
}): { subject: string; text: string } {
  const subject = `Automotive Brands security alert: ${input.kind.replaceAll("_", " ").toLowerCase()}`;
  const text = [
    "This is an automatic security notice from the Automotive Brands website.",
    "",
    input.summary,
    "",
    `When: ${input.occurredAt.toISOString()}`,
    "This notice leaves out sign-in secrets and customer email addresses.",
    "Review Admin audit history for the matching SECURITY_ALERT row before taking action.",
    "If this is expected work by a member of staff, no further action is required.",
  ].join("\n");
  return { subject, text };
}
