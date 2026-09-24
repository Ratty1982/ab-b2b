/**
 * Prisma client singleton for Node / Coolify deployments.
 * Avoids exhausting connections during Vite HMR.
 * Recreates the client if a generate ran after the process started (missing delegates).
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __abPrisma?: PrismaClient;
};

function createPrisma(): PrismaClient {
  return new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["error", "warn"] : ["error"],
  });
}

function isUsable(client: PrismaClient | undefined): client is PrismaClient {
  return (
    typeof client?.user?.findUnique === "function" &&
    typeof client?.cmsPage?.findUnique === "function" &&
    typeof client?.category?.findUnique === "function" &&
    typeof client?.teamDepartment?.findUnique === "function" &&
    typeof client?.teamMember?.findUnique === "function"
  );
}

function getPrisma(): PrismaClient {
  if (!isUsable(globalForPrisma.__abPrisma)) {
    globalForPrisma.__abPrisma = createPrisma();
  }
  return globalForPrisma.__abPrisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client) as unknown;
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});

export default prisma;
