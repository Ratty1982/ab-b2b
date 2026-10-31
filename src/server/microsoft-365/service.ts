/**
 * Staff-facing Microsoft 365 connection service.
 * Reads the feature flag on each call. Does not start a scheduler or export tasks.
 */
import {
  Microsoft365Error,
  readMicrosoft365Gate,
  type Microsoft365Actor,
  type Microsoft365Gate,
} from "@/domain/microsoft-365-crm";
import { prisma } from "@/infra/database/client";
import { grants, hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  beginMicrosoftConnect,
  completeMicrosoftCallback,
  disconnectMicrosoftAccount,
  getMicrosoft365Status,
  refreshMicrosoftConnection,
  updateMicrosoft365Preferences,
} from "@/server/microsoft-365/flow";
import { createPrismaMicrosoft365Store } from "@/server/microsoft-365/prisma-store";

const store = createPrismaMicrosoft365Store();

export function currentMicrosoft365Gate(): Microsoft365Gate {
  return readMicrosoft365Gate({
    enabledFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    tenantId: process.env["MICROSOFT_365_TENANT_ID"],
    clientId: process.env["MICROSOFT_365_CLIENT_ID"],
    clientSecret: process.env["MICROSOFT_365_CLIENT_SECRET"],
    redirectUri: process.env["MICROSOFT_365_REDIRECT_URI"],
    appUrl: process.env["APP_URL"],
  });
}

async function actorFromProfile(userId: string): Promise<Microsoft365Actor> {
  const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Microsoft 365 is available to staff only", "FORBIDDEN", 403);
  }
  return {
    userId,
    actorType: "INTERNAL",
    canConnect:
      hasPermission(profile, "tasks.manage") ||
      grants(profile, "crm.activities.create", "crm.manage", "admin.access"),
    canViewAdminHealth: grants(profile, "admin.access", "crm.manage"),
  };
}

function asAuth(error: unknown): never {
  if (error instanceof Microsoft365Error) {
    const status = error.code === "FORBIDDEN" ? 403 : 400;
    throw new AuthError(error.message, error.code, status);
  }
  throw error;
}

export async function microsoft365StatusFor(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    return await getMicrosoft365Status(actor, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365BeginConnect(userId: string, includeCalendar: boolean) {
  try {
    const actor = await actorFromProfile(userId);
    return await beginMicrosoftConnect(actor, includeCalendar, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365Disconnect(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    return await disconnectMicrosoftAccount(actor, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365UpdatePreferences(
  userId: string,
  prefs: { taskSyncEnabled: boolean; calendarSyncEnabled: boolean },
) {
  try {
    const actor = await actorFromProfile(userId);
    return await updateMicrosoft365Preferences(actor, prefs, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365RefreshOwnConnection(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    return await refreshMicrosoftConnection(actor, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365CompleteCallback(input: {
  userId: string | null;
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<string> {
  const result = await completeMicrosoftCallback(
    input.userId ? { userId: input.userId } : null,
    { code: input.code, state: input.state, error: input.error },
    currentMicrosoft365Gate(),
    { store },
  );
  return result.location;
}

/** Confirms the signed-in user still exists before the OAuth callback stores a connection. */
export async function microsoft365CallbackUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, actorType: true } });
  if (!user || user.actorType !== "INTERNAL") return null;
  return user.id;
}
