-- Additive durable Outlook invitation consent on CRM appointments.
-- Fingerprint-scoped: a later attendee-list change invalidates prior consent.
-- Does not alter Tasks, To Do sync, stock, pricing, or orders.

ALTER TABLE "CrmAppointment"
  ADD COLUMN "inviteConsentFingerprint" TEXT,
  ADD COLUMN "inviteConsentRevision" TEXT,
  ADD COLUMN "inviteConsentedAt" TIMESTAMP(3),
  ADD COLUMN "inviteConsentedById" TEXT;
