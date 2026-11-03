/**
 * Browser stand-in for the database singleton.
 * Importing it does not load the database driver.
 */
function unavailable(): never {
  throw new Error("The database client cannot run in the browser.");
}

export const prisma = new Proxy(
  {},
  {
    get() {
      unavailable();
    },
  },
);
