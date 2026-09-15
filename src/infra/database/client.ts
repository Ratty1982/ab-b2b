/**
 * Prisma client singleton for Node / Coolify deployments.
 * Avoids exhausting connections during Vite HMR.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __abPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__abPrisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.__abPrisma = prisma;
}

export default prisma;
