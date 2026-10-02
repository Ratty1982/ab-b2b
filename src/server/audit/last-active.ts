import { prisma } from "@/infra/database/client";

/** Minimum gap between lastActiveAt writes per user (presence metadata only). */
export const LAST_ACTIVE_THROTTLE_MS = 12 * 60 * 1000;

/**
 * Update User.lastActiveAt at most once every LAST_ACTIVE_THROTTLE_MS.
 * Never writes AuditEvent rows — heartbeats must not grow the audit log.
 */
export async function touchLastActive(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, actorType: true, status: true, lastActiveAt: true },
    });
    if (!user || user.actorType !== "INTERNAL" || user.status === "DISABLED") return;

    const now = Date.now();
    if (user.lastActiveAt && now - user.lastActiveAt.getTime() < LAST_ACTIVE_THROTTLE_MS) {
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });
  } catch (error) {
    console.error("[ab:last-active] Failed to touch lastActiveAt", {
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Fire-and-forget helper for route guards — never blocks navigation. */
export function scheduleTouchLastActive(userId: string | null | undefined): void {
  if (!userId) return;
  void touchLastActive(userId);
}
