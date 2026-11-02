import { describe, expect, it } from "vitest";

import {
  attendeesFingerprint,
  hasValidInviteConsent,
  jobAttendeesConsentAllowsInvites,
  mustConfirmOutlookInvites,
  requiresExternalInviteConfirmation,
  resolveAttendeesInviteAuthorisation,
} from "@/domain/crm-appointments";
import { mergeCalendarOutboundPayload } from "@/server/microsoft-365/calendar-outbound-sync";

const buyer = [{ email: "buyer@example.com", name: "Buyer", type: "required" as const }];
const buyerAndOps = [
  { email: "buyer@example.com", name: "Buyer", type: "required" as const },
  { email: "ops@example.com", name: "Ops", type: "optional" as const },
];

describe("Outlook invitation consent", () => {
  it("requires confirmation whenever external attendees would be invited", () => {
    expect(requiresExternalInviteConfirmation(buyer, "owner@example.com")).toBe(true);
    expect(requiresExternalInviteConfirmation(buyer, "buyer@example.com")).toBe(false);
  });

  it("keeps durable consent valid only for the consented attendee fingerprint", () => {
    const fingerprint = attendeesFingerprint(buyer);
    expect(
      hasValidInviteConsent({ attendees: buyer, consentFingerprint: fingerprint }),
    ).toBe(true);
    expect(
      hasValidInviteConsent({
        attendees: buyerAndOps,
        consentFingerprint: fingerprint,
      }),
    ).toBe(false);
    expect(hasValidInviteConsent({ attendees: buyer, consentFingerprint: null })).toBe(false);
  });

  it("rejects bare job attendeesConfirmed flags and mismatched fingerprints/revisions", () => {
    expect(
      jobAttendeesConsentAllowsInvites({
        attendees: buyer,
        appointmentRevision: "2026-11-02T10:00:00.000Z",
        attendeesConfirmed: true,
      }),
    ).toBe(false);

    expect(
      jobAttendeesConsentAllowsInvites({
        attendees: buyer,
        appointmentRevision: "2026-11-02T10:00:00.000Z",
        attendeesConfirmed: true,
        attendeesConsentFingerprint: "other@example.com",
        attendeesConsentRevision: "2026-11-02T10:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      jobAttendeesConsentAllowsInvites({
        attendees: buyer,
        appointmentRevision: "2026-11-02T10:00:00.000Z",
        attendeesConfirmed: true,
        attendeesConsentFingerprint: attendeesFingerprint(buyer),
        attendeesConsentRevision: "2026-10-01T00:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      jobAttendeesConsentAllowsInvites({
        attendees: buyer,
        appointmentRevision: "2026-11-02T10:00:00.000Z",
        attendeesConfirmed: true,
        attendeesConsentFingerprint: attendeesFingerprint(buyer),
        attendeesConsentRevision: "2026-11-02T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows durable consent to authorise invites without a job flag", () => {
    expect(
      resolveAttendeesInviteAuthorisation({
        attendees: buyer,
        appointmentRevision: "2026-11-02T10:00:00.000Z",
        consentFingerprint: attendeesFingerprint(buyer),
        attendeesConfirmed: false,
      }),
    ).toBe(true);
  });

  it("does not merge invite consent across different attendee fingerprints", () => {
    const merged = mergeCalendarOutboundPayload(
      {
        appointmentId: "appt-1",
        attendeesConfirmed: true,
        attendeesConsentFingerprint: "buyer@example.com",
        attendeesConsentRevision: "2026-11-01T00:00:00.000Z",
      },
      {
        appointmentId: "appt-1",
        attendeesConsentFingerprint: "buyer@example.com,ops@example.com",
      },
    );
    expect(merged.attendeesConfirmed).toBeUndefined();
    expect(merged.attendeesConsentFingerprint).toBeUndefined();
  });

  it("keeps matching fingerprint consent when re-enqueued", () => {
    const merged = mergeCalendarOutboundPayload(
      {
        appointmentId: "appt-1",
        attendeesConfirmed: true,
        attendeesConsentFingerprint: "buyer@example.com",
        attendeesConsentRevision: "2026-11-01T00:00:00.000Z",
      },
      {
        appointmentId: "appt-1",
        explicit: true,
      },
    );
    expect(merged.attendeesConfirmed).toBe(true);
    expect(merged.attendeesConsentFingerprint).toBe("buyer@example.com");
  });

  it("blocks enabling Outlook on a CRM-only appointment with attendees until confirmed", () => {
    const gate = mustConfirmOutlookInvites({
      syncToOutlook: true,
      enablingOutlook: true,
      attendeesChanged: false,
      attendees: buyer,
      ownerEmail: "owner@example.com",
      existingConsentFingerprint: null,
      confirmExternalInvites: false,
    });
    expect(gate.required).toBe(true);
    expect(gate.blocked).toBe(true);
    expect(gate.emails).toEqual(["buyer@example.com"]);
  });

  it("blocks silent retry authorisation when durable consent is missing or stale", () => {
    const stale = mustConfirmOutlookInvites({
      syncToOutlook: true,
      attendees: buyerAndOps,
      ownerEmail: "owner@example.com",
      existingConsentFingerprint: attendeesFingerprint(buyer),
      confirmExternalInvites: false,
    });
    expect(stale.blocked).toBe(true);
    expect(stale.emails).toEqual(["buyer@example.com", "ops@example.com"]);

    const fresh = mustConfirmOutlookInvites({
      syncToOutlook: true,
      attendees: buyerAndOps,
      ownerEmail: "owner@example.com",
      existingConsentFingerprint: attendeesFingerprint(buyerAndOps),
      confirmExternalInvites: false,
    });
    expect(fresh.blocked).toBe(false);
  });

  it("allows appointment sync without attendees and without invite confirmation", () => {
    expect(
      mustConfirmOutlookInvites({
        syncToOutlook: true,
        enablingOutlook: true,
        attendees: [],
        ownerEmail: "owner@example.com",
        confirmExternalInvites: false,
      }),
    ).toEqual({ required: false, blocked: false, emails: [] });
  });
});
