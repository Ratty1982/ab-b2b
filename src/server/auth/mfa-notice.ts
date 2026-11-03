/**
 * Tell the account holder that an administrator reset their authenticator.
 * The message never includes a secret, a recovery code, or a setup link with a token.
 */
export function authenticatorResetNotice(): { subject: string; text: string } {
  return {
    subject: "Automotive Brands account security update",
    text: [
      "An administrator reset the authenticator on your Automotive Brands account.",
      "",
      "Sign in with your password and set up the authenticator again if you still need it.",
      "Your old recovery codes no longer work.",
      "If you did not ask for this, contact Automotive Brands.",
    ].join("\n"),
  };
}

export async function sendAuthenticatorResetNotice(to: string): Promise<boolean> {
  const { buildSmtpTransportForAdapter, loadSmtpRuntimeConfig } = await import(
    "@/server/email/settings"
  );
  const config = await loadSmtpRuntimeConfig();
  if (!config) return false;
  const message = authenticatorResetNotice();
  const transport = buildSmtpTransportForAdapter(config);
  const result = await transport.send({ to, subject: message.subject, text: message.text });
  return result.ok;
}
