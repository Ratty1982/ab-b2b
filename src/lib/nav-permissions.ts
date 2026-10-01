import type { SafeSessionUser } from "@/server/auth/session";
import {
  areaHomeLabel,
  areaHomePath,
  backOfficeNavForUser,
  navCtxFromUser,
  portalNavForUser,
  type VisibleNavSection,
} from "@/lib/app-nav";

export function shellUserFromSession(user: SafeSessionUser): {
  name: string;
  role: string;
  actorType: "INTERNAL" | "TRADE";
} {
  return {
    name: user.name,
    role: user.actingFor ? `Ordering for ${user.actingFor.companyName}` : user.displayRole,
    actorType: user.actorType,
  };
}

export function shellModelFromSession(user: SafeSessionUser): {
  sections: VisibleNavSection[];
  homeTo: string;
  areaLabel: string;
} {
  const ctx = navCtxFromUser(user);
  if (user.actorType === "TRADE") {
    return {
      sections: portalNavForUser(user),
      homeTo: areaHomePath(ctx),
      areaLabel: areaHomeLabel(ctx),
    };
  }
  return {
    sections: backOfficeNavForUser(user),
    homeTo: areaHomePath(ctx),
    areaLabel: areaHomeLabel(ctx),
  };
}
