import { describe, expect, it } from "vitest";

import { recordConfirmedPasswordFailure } from "@/server/security/password-failure";
import {
  appliedSecurityHold,
  releasedSecurityHold,
  securityHoldRefusal,
  securityHoldRefusalMessage,
} from "@/server/security/security-hold";

describe("administrator security hold", () => {
  it("refuses a missing account, the actor's own account, and the last administrator", () => {
    expect(
      securityHoldRefusal({
        actorUserId: "admin",
        targetUserId: "admin",
        targetFound: true,
        lastEffectiveSuperAdmin: false,
      }),
    ).toBe("self");
    expect(
      securityHoldRefusal({
        actorUserId: "admin",
        targetUserId: "missing",
        targetFound: false,
        lastEffectiveSuperAdmin: false,
      }),
    ).toBe("missing-account");
    expect(
      securityHoldRefusal({
        actorUserId: "admin",
        targetUserId: "last",
        targetFound: true,
        lastEffectiveSuperAdmin: true,
      }),
    ).toBe("last-administrator");
    expect(
      securityHoldRefusal({
        actorUserId: "admin",
        targetUserId: "staff",
        targetFound: true,
        lastEffectiveSuperAdmin: false,
      }),
    ).toBeNull();
    expect(securityHoldRefusalMessage("self")).not.toContain("@");
  });

  it("records an apply and a release without changing account status", () => {
    const at = new Date("2026-11-02T22:00:00.000Z");
    const applied = appliedSecurityHold({
      actorUserId: "admin",
      reason: "  Repeated sign-in attack  ",
      at,
    });
    expect(applied.active).toBe(true);
    expect(applied.reason).toBe("Repeated sign-in attack");
    expect(applied.releasedAt).toBeNull();
    expect(applied).not.toHaveProperty("status");
    const released = releasedSecurityHold({ actorUserId: "admin", at });
    expect(released.active).toBe(false);
    expect(released.releasedByUserId).toBe("admin");
    expect(released).not.toHaveProperty("status");
  });

  it("does not disable an account from the automatic password counter", () => {
    let state = null;
    for (let i = 0; i < 5; i += 1) {
      state = recordConfirmedPasswordFailure(state, 100).state;
    }
    expect(state).not.toHaveProperty("status");
    expect(state).not.toHaveProperty("active");
  });
});
