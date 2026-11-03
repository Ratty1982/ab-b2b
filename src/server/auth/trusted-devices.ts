import { prisma } from "@/infra/database/client";

/**
 * Remove trusted-browser records for one account.
 * Better Auth stores them as verification rows whose identifier starts with
 * `trust-device-` and whose value is the user id. Password-reset tokens use
 * a different identifier and are left alone.
 */
export async function revokeTrustedDevices(userId: string): Promise<void> {
  await prisma.authVerification.deleteMany({
    where: {
      value: userId,
      identifier: { startsWith: "trust-device-" },
    },
  });
}
