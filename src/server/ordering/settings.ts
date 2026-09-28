/**
 * Trade ordering settings — global backorder default.
 * Admin → Settings → Ordering. Singleton row; production default ALLOW.
 */

import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  DEFAULT_GLOBAL_BACKORDER_POLICY,
  type EffectiveBackorderPolicy,
} from "@/domain/backorder";

export const TRADE_ORDERING_SETTINGS_ID = "singleton";

export type TradeOrderingSettingsDto = {
  defaultBackorderPolicy: EffectiveBackorderPolicy;
  /** Convenience: true when global default is ALLOW. */
  allowBackordersByDefault: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
};

export async function getOrCreateTradeOrderingSettings(): Promise<{
  defaultBackorderPolicy: EffectiveBackorderPolicy;
  updatedAt: Date;
  updatedByUserId: string | null;
}> {
  const row = await prisma.tradeOrderingSettings.upsert({
    where: { id: TRADE_ORDERING_SETTINGS_ID },
    create: {
      id: TRADE_ORDERING_SETTINGS_ID,
      defaultBackorderPolicy: DEFAULT_GLOBAL_BACKORDER_POLICY,
    },
    update: {},
  });
  return {
    defaultBackorderPolicy: row.defaultBackorderPolicy,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

/** Authoritative global policy for resolveBackorderPolicy. */
export async function getGlobalBackorderPolicy(): Promise<EffectiveBackorderPolicy> {
  const row = await getOrCreateTradeOrderingSettings();
  return row.defaultBackorderPolicy === "DENY" ? "DENY" : "ALLOW";
}

export async function getTradeOrderingSettingsForActor(
  userId: string,
): Promise<TradeOrderingSettingsDto> {
  await requireSystemPermission(userId, "settings.edit");
  const row = await getOrCreateTradeOrderingSettings();
  return {
    defaultBackorderPolicy: row.defaultBackorderPolicy,
    allowBackordersByDefault: row.defaultBackorderPolicy === "ALLOW",
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}

export async function updateTradeOrderingSettings(
  userId: string,
  input: { allowBackordersByDefault: boolean },
): Promise<TradeOrderingSettingsDto> {
  await requireSystemPermission(userId, "settings.edit");
  if (typeof input.allowBackordersByDefault !== "boolean") {
    throw new AuthError("Invalid ordering settings", "VALIDATION", 400);
  }
  const next: EffectiveBackorderPolicy = input.allowBackordersByDefault ? "ALLOW" : "DENY";
  const row = await prisma.tradeOrderingSettings.upsert({
    where: { id: TRADE_ORDERING_SETTINGS_ID },
    create: {
      id: TRADE_ORDERING_SETTINGS_ID,
      defaultBackorderPolicy: next,
      updatedByUserId: userId,
    },
    update: {
      defaultBackorderPolicy: next,
      updatedByUserId: userId,
    },
  });
  await recordAuditEvent({
    action: "settings.trade_ordering_updated",
    entityType: "TradeOrderingSettings",
    entityId: TRADE_ORDERING_SETTINGS_ID,
    actorUserId: userId,
    metadata: { defaultBackorderPolicy: next },
  });
  return {
    defaultBackorderPolicy: row.defaultBackorderPolicy,
    allowBackordersByDefault: row.defaultBackorderPolicy === "ALLOW",
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}
