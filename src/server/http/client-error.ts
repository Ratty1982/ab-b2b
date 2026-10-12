/**
 * Message safe to return from a server function.
 * Prisma and multiline driver errors stay on the server.
 */
export function clientSafeErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message) return null;
  const internal =
    error.name.startsWith("Prisma") ||
    error.message.includes("Invalid `prisma") ||
    error.message.includes("\n") ||
    error.message.length > 400;
  if (internal) return null;
  return error.message;
}
