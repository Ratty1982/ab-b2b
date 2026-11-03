/**
 * Browser stand-in for the database package.
 * Named values used by server modules resolve, and calling them fails.
 */
function unavailable(): never {
  throw new Error("Database access cannot run in the browser.");
}

const lazy: unknown = new Proxy(function prismaBrowserStub() {
  unavailable();
}, {
  get(_target, key) {
    if (key === "__esModule") return true;
    if (key === "then") return undefined;
    return lazy;
  },
  apply() {
    unavailable();
  },
  construct() {
    unavailable();
  },
});

export const Prisma = lazy;
export const PrismaClient = lazy;
export default lazy;
