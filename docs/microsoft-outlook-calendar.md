# Microsoft Outlook Calendar synchronisation

CRM appointments stay in Automotive Brands. This release can copy an opted-in appointment into the organiser's own Outlook calendar and apply agreed scheduling changes from Outlook back to that CRM appointment. Ordinary CRM tasks never become calendar events.

Production stays off. Set `MICROSOFT_365_CALENDAR_SYNC_ENABLED=false` until a pilot is approved. Turning on `MICROSOFT_365_CRM_ENABLED` or either Microsoft To Do flag does not turn calendar sync on.

Automated tests use a mocked Graph client. They do not need a Microsoft account, administrator consent, or live invitations.

## What was already there

- Microsoft 365 connection, PKCE, token encryption, and optional `Calendars.ReadWrite` consent.
- Per-user `calendarSyncEnabled` preference (default off). It did not create Outlook events.
- Scaffold `MicrosoftCalendarMapping` (retargeted from optional Task to optional `CrmAppointment`).
- Microsoft To Do outbound and inbound workers on the same `MicrosoftSyncJob` table. Calendar uses separate job kinds and must not interfere with To Do.

## Appointment model

`CrmAppointment` is distinct from `Task`. Fields include type (`MEETING`, `CALL`, `CUSTOMER_VISIT`, `FOLLOW_UP`, `OTHER`), status (`SCHEDULED`, `COMPLETED`, `CANCELLED`), UTC `startAt`/`endAt`, intended IANA `timeZone` (default `Europe/London`), location, owner, optional customer/contact/opportunity/related task, reminder minutes, attendees JSON, and `syncToOutlook` (default **false**).

`teamsMeetingEnabled` is reserved for a later phase and stays false. Creating a task, logging a meeting activity, or setting a task due date never sets `syncToOutlook` and never enqueues a calendar job.

## When a real Graph call is allowed

All of these must be true:

1. `MICROSOFT_365_CRM_ENABLED` is on.
2. `MICROSOFT_365_CALENDAR_SYNC_ENABLED` is on.
3. The organiser has a `CONNECTED` Microsoft account.
4. That user has turned calendar synchronisation on.
5. Stored scopes include delegated `Calendars.ReadWrite`.
6. The CRM appointment is owned by that user.
7. The appointment has `syncToOutlook=true` (or an explicit opt-in / active mapping / release job).

If any check fails, workers return before calling Microsoft. While the calendar flag is off, queue helpers return before reading the database, and schedulers return before claiming jobs. If the flag is switched off mid-batch, further Graph activity stops safely.

Calendar and To Do flags are independent.

## Outbound CRM → Outlook

Job kind: `CALENDAR_OUTBOUND`.

- `POST /me/events` with `Prefer: IdType="ImmutableId"` and a `transactionId` for safer create retries.
- Identity is the mapping row plus CRM reference `ab-crm-appointment:{appointmentId}` in the body — never subject matching alone.
- Ambiguous creates become `NEEDS_REVIEW` with `createUncertain`. Ordinary retry does not authorise another POST.
- Updates use `PATCH /me/events/{id}` with changeKey/ETag when available.
- Cancellation marks the Outlook event cancelled where possible and tombstones the mapping. CRM history is kept.
- Attendees are included only after an explicit confirmation when invitations would leave the organiser's mailbox. The pilot should prefer zero attendees.

## Inbound Outlook → CRM

Job kind: `CALENDAR_INBOUND`.

- Uses `calendarView/delta` inside a bounded sliding window (30-day lookback, 365-day lookahead).
- One delta cursor does **not** cover the lifetime calendar. Mapped appointments outside the window are reconciled with `GET /me/events/{id}`.
- Only existing `MicrosoftCalendarMapping` rows are applied. Unrelated personal events are never imported.
- The first inbound round baselines without rewriting CRM history.
- Field-level conflicts use the last synced snapshot. CRM `CANCELLED` is not undone by Outlook. External Outlook deletion soft-cancels the CRM appointment and marks the mapping `REMOVED` without deleting CRM history.

## UI

- **CRM → Appointments** lists today / upcoming / past appointments with ownership and Outlook status.
- Customer CRM tab and the appointments page offer **Schedule appointment**. “Add to Outlook Calendar” defaults off.
- **CRM → Microsoft 365** shows calendar consent, preference, last sync, and (when wired) calendar job health alongside To Do.

## Admin consent

Maximum (IT) still needs to grant admin consent for the CRM Entra app delegated permissions, including `Calendars.ReadWrite` when the pilot includes calendar. Users without calendar consent can use **Allow Outlook Calendar** to reconnect with an upgraded consent request. Consent alone never silently enables calendar sync.

## Rollback

1. Keep or set `MICROSOFT_365_CALENDAR_SYNC_ENABLED=false` and restart the process.
2. Users can turn off calendar synchronisation on `/crm/microsoft`.
3. The additive migration can remain; empty appointment/mapping tables do not affect To Do, stock, orders, or pricing.
4. Do not roll back by rewriting published git history on the Lovable-connected branch.

## Not in this release

- Live Microsoft calls during CI
- Automatic Teams meetings
- Bulk invitations
- DNS / Coolify / Autopart / SDS Graph changes
- Enabling calendar sync in production
- Merge or deploy
