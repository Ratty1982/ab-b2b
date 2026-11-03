/**
 * Browser stand-in for the Better Auth server.
 * Vite serves this file only to the client environment.
 */
function unavailable(): never {
  throw new Error("Server authentication cannot run in the browser.");
}

export const auth = new Proxy(
  {},
  {
    get() {
      unavailable();
    },
  },
);
