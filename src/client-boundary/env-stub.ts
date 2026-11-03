/**
 * Browser stand-in for server environment variables.
 * It has no default database URL and no default auth secret.
 */
export function getServerEnv(): never {
  throw new Error("Server environment cannot be read in the browser.");
}
