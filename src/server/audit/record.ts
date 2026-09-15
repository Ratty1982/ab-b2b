import { prisma } from "@/infra/database/client";
import type { AuditEventInput } from "./types";
import type { Prisma } from "@prisma/client";

const SECRET_KEY_PATTERN = /(password|token|secret|authorization|cookie|credential|hash)/i;

function scrub(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = scrub(nested);
  }
  return out;
}

/**
 * Persist an audit event. Failures are logged but do not break the primary flow
 * except when callers explicitly await and rethrow.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const data: Prisma.AuditEventUncheckedCreateInput = {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      companyId: input.companyId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    if (input.metadata) {
      data.metadata = scrub(input.metadata) as Prisma.InputJsonValue;
    }
    if (input.before) {
      data.before = scrub(input.before) as Prisma.InputJsonValue;
    }
    if (input.after) {
      data.after = scrub(input.after) as Prisma.InputJsonValue;
    }

    await prisma.auditEvent.create({ data });
  } catch (error) {
    console.error("[ab:audit] Failed to record event", {
      action: input.action,
      entityType: input.entityType,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
