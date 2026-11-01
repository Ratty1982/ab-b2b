# Microsoft To Do inbound synchronisation

CRM tasks stay in Automotive Brands. This document covers Microsoft To Do → CRM updates for mapped tasks in the dedicated **Automotive Brands CRM** list.

Production stays off. Set `MICROSOFT_365_TASK_INBOUND_ENABLED=false` until a pilot is approved. Turning on `MICROSOFT_365_CRM_ENABLED` or `MICROSOFT_365_TASK_OUTBOUND_ENABLED` does not turn inbound on.

## Phase 0 — Architecture findings (PR B)

Inspected `production/phase-1-auth-rbac` after PR #71.

- `MicrosoftSyncCursor` already exists with `@@unique([connectionId, resource])` and encrypted `deltaLinkEncrypted`. It was unused by outbound. Inbound uses resource `todo-inbound:{listId}`.
- Outbound uses durable `MicrosoftSyncJob` rows with kind `TODO_OUTBOUND`, leases, and payload flags (`createUncertain`, `authorizeCreateOnce`, `revisionDirty`, `taskRevision`).
- Task mutations live in `src/server/sales-intelligence/followup.ts` (`completeCrmTask`, `rescheduleCrmTask`, `patchCrmTask`) with `tasks.manage` and assignee/manage-all checks. There is no separate CRM domain mutation service.
- Token refresh in `refreshMicrosoftConnection` / `tokenForOutboundConnection` is reused for inbound.
- Independent inbound/outbound engines are required. Shared user preference `taskSyncEnabled` gates both; engine flags stay separate.
- Risks: echo loops if inbound CRM writes re-enqueue outbound; concurrent inbound/outbound writes on the same task; CRM cancellation vs Microsoft reopen; remote delete must never delete CRM rows.

## Gates

A Graph read or CRM apply requires all of:

1. `MICROSOFT_365_CRM_ENABLED` on
2. `MICROSOFT_365_TASK_INBOUND_ENABLED` on
3. Connected Microsoft account
4. `taskSyncEnabled`
5. Delegated `Tasks.ReadWrite`
6. CRM task assigned to that user
7. Microsoft task in the dedicated Automotive Brands CRM list
8. Active `MicrosoftTaskMapping` for that connection/user

Unrelated personal To Do tasks are ignored.

## Baseline

The first inbound round for a connection:

- Walks the initial Graph delta for the dedicated list
- Updates mapping etags/snapshots and records baseline differences
- Does **not** rewrite CRM task fields
- Stores the deltaLink only after the round finishes

Later rounds apply only subsequent Microsoft changes. An expired delta token clears the cursor and baseline marker so the next run baselines again instead of replaying history as fresh CRM edits.

## Supported updates

| Microsoft change | CRM effect |
| --- | --- |
| Completed | `DONE` when CRM is not cancelled |
| Reopened | `OPEN`, or `IN_PROGRESS` when `priorCrmStatus` was `IN_PROGRESS` |
| Due date | CRM `dueAt` |
| Importance | LOW / NORMAL / HIGH |
| Title / body | Title and description when eligible |

Never created from an unknown Microsoft task. Never changes customer, opportunity, creator, assignee, or related activities through inbound sync.

## Conflict policy

Not last-write-wins.

- Capture last synced field snapshot, CRM revision, and Microsoft etag on the mapping.
- If Microsoft and CRM both changed the same field since the last sync, keep the CRM value and record a conflict.
- CRM `CANCELLED` always wins over Microsoft reopen or completion.
- Reassignment stops inbound for the previous assignee.
- Running outbound for the same task defers inbound apply and keeps the deltaLink uncommitted until the staged page is finished.
- Inbound CRM writes run inside `withOutboundSuppressed` so they do not enqueue outbound echo jobs.

## Remote deletion

If Graph reports `@removed` for a mapped task:

- CRM task is kept
- Mapping becomes `REMOVED`
- UI shows the missing Microsoft task
- No automatic recreate
- Authorised users may unlink or queue an explicit outbound recreate

## Jobs and scheduler

Kind `TODO_INBOUND`, dedupe key `todo-inbound:{connectionId}`. The existing one-minute process timer also starts the inbound scheduler. Flag off → no claim, no Graph, no CRM write.

## Environment

```
MICROSOFT_365_CRM_ENABLED=false
MICROSOFT_365_TASK_OUTBOUND_ENABLED=false
MICROSOFT_365_TASK_INBOUND_ENABLED=false
```

## Deploy

1. Leave inbound (and outbound, unless already approved) unset or `false`.
2. Apply additive migration `20261101200000_microsoft_todo_inbound`.
3. Deploy and restart.
4. Confirm `/crm/microsoft` shows inbound engine off.

## Rollback

Set `MICROSOFT_365_TASK_INBOUND_ENABLED=false` and restart. CRM tasks already updated by inbound remain as written. Mappings, cursors, and columns stay in place. Disabling inbound stops further Graph delta reads and CRM applies; it does not undo history.

## Residual risks

- Microsoft administrator consent for `Tasks.ReadWrite` is still required before any live Graph call.
- A Microsoft change that arrives while outbound is rewriting the same task is deferred; a long outbound outage delays inbound.
- Field scrubbing of outbound CRM reference footers is best-effort.
- Outlook Calendar is not implemented.
