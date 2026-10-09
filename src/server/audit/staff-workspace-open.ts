import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";

/** Throttle workspace-open audits so refresh/filter churn does not flood AuditEvent. */
export const WORKSPACE_OPEN_THROTTLE_MS = 15 * 60 * 1000;

export type StaffWorkspaceOpenAction =
  | "si.daily_brief.opened"
  | "si.portfolio.opened"
  | "si.enquiry.opened"
  | "si.global_history.opened"
  | "si.gaps.opened"
  | "si.opportunities.opened"
  | "si.rebate.opened";

/**
 * Record a single Sales Intelligence workspace-open event when the user has not
 * recorded the same action within WORKSPACE_OPEN_THROTTLE_MS.
 */
export async function recordStaffWorkspaceOpen(input: {
  actorUserId: string;
  action: StaffWorkspaceOpenAction;
  detail?: string;
}): Promise<void> {
  try {
    const since = new Date(Date.now() - WORKSPACE_OPEN_THROTTLE_MS);
    const recent = await prisma.auditEvent.findFirst({
      where: {
        actorUserId: input.actorUserId,
        action: input.action,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) return;

    await recordAuditEvent({
      action: input.action,
      entityType: "SalesIntelligence",
      entityId: input.action,
      actorUserId: input.actorUserId,
      metadata: {
        detail: input.detail ?? "Opened workspace",
      },
    });
  } catch (error) {
    console.error("[ab:staff-activity] Failed to record workspace open", {
      action: input.action,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
