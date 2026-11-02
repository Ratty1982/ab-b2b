# Microsoft Outlook Calendar — Phase 0 architecture audit

CRM remains the authority for appointments, ownership, relationships, and permissions. This audit records what already exists before any Appointment model, calendar workers, or schema changes land.

## Existing Microsoft 365 stack (To Do)

| Piece | Finding |
| --- | --- |
| Connection | `MicrosoftAccountConnection` already stores encrypted tokens, `taskSyncEnabled`, `calendarSyncEnabled` (default false), scopes, and `todoListId`. |
| OAuth | Dedicated CRM Entra app (not SDS). PKCE, single-tenant GUID, RS256 ID token checks in `microsoft-365-crm.ts`. |
| Scopes | Base: `User.Read` + `Tasks.ReadWrite`. `Calendars.ReadWrite` is requested only when the user opts into calendar consent (`scopesForConnect(includeCalendar)`). Mail and tenant-wide task scopes are refused. |
| Outbound To Do | Domain policy in `microsoft-todo-outbound.ts`; workers enqueue `MicrosoftSyncJob` kind `TODO_OUTBOUND` with leases, `createUncertain`, and `authorizeCreateOnce`. |
| Inbound To Do | Domain policy in `microsoft-todo-inbound.ts`; delta on the dedicated **Automotive Brands CRM** list; cursor resource `todo-inbound:{listId}` on `MicrosoftSyncCursor`. |
| Flags | `MICROSOFT_365_CRM_ENABLED`, `MICROSOFT_365_TASK_OUTBOUND_ENABLED`, `MICROSOFT_365_TASK_INBOUND_ENABLED`. Each direction requires the CRM flag plus its own flag. Neither task flag implies calendar. |
| Graph security | `resolveMicrosoftGraphUrl` + path allowlists. To Do asserts refuse `/me/events`. Calendar policy must reverse that and refuse todo/mail/drives. |
| SDS isolation | Existing Graph client for Safety Data Sheets stays application-only and read-only. CRM Microsoft traffic must keep using the separate delegated token path. |

## Appointment model — absent

- There is **no** `Appointment` Prisma model, enum, or migration.
- `MicrosoftCalendarMapping` exists as a scaffold only. It currently links `taskId` (optional) → `microsoftEventId`, with `externalAttendees`, sync status, and uniqueness on `(connectionId, microsoftEventId)` and `(userId, taskId)`.
- Docs (`microsoft-365-crm.md`) state calendar preference does not create Outlook appointments yet.
- CRM `Task` remains the only synchronised work item. Calendar must not treat “related task exists” as sync eligibility.

## Calendar-specific constraints (from To Do lessons)

1. **Opt-in gates.** Require `MICROSOFT_365_CRM_ENABLED` and a dedicated calendar sync flag (`MICROSOFT_365_CALENDAR_SYNC_ENABLED`). Independent of `TASK_*` flags.
2. **Uncertain creates.** Graph POST is not idempotent; reuse the To Do `createUncertain` / `authorizeCreateOnce` / ordinary-retry exclusion pattern with CRM reference `ab-crm-appointment:{id}`.
3. **Ownership.** Sync only when the connection user owns the appointment. Release/scrub previous owner copies on reassignment; never delete CRM rows because Outlook deleted an event.
4. **Attendees.** External invites need explicit confirmation. Default `syncToOutlook = false`. Do not create Teams / `isOnlineMeeting` by default.
5. **Conflict policy.** Field-level merge with last synced snapshot. CRM `CANCELLED` wins over Outlook reopen. Not last-write-wins.
6. **Bounded delta.** `calendarView` / `calendarView/delta` is a sliding window (30-day lookback, 365-day lookahead). Out-of-window mapped events need `GET /me/events/{id}` via `microsoftEventId`. One cursor does not cover the lifetime calendar. Cursor resource is connection-scoped: `calendar-inbound:{connectionId}`.
7. **Timezone.** Storage is UTC. Presentation and Graph wall clocks default to `Europe/London`, including DST spring-forward gaps and autumn ambiguity.
8. **Job kinds.** Planned: `CALENDAR_OUTBOUND` / `CALENDAR_INBOUND` on the existing `MicrosoftSyncJob` table. No second scheduler process.

## Schema work (out of scope for this phase)

Do **not** change Prisma in this domain-policy commit. A later change set must introduce an Appointment model (types, status, owner, range, location, attendees, `syncToOutlook`), retarget or extend `MicrosoftCalendarMapping` off `taskId` toward `appointmentId`, and wire env parsing for `MICROSOFT_365_CALENDAR_SYNC_ENABLED`. Until then, domain modules and this audit stay pure.

## Not in Phase 0

- Sync workers, queue enqueue from CRM mutations, UI, or Graph integration tests against a live tenant
- Opening a pull request for calendar workers
- SDS Graph client changes
