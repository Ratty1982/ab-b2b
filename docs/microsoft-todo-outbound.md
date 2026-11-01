# Microsoft To Do outbound synchronisation

CRM tasks stay in Automotive Brands. This release can copy an eligible task into the assignee's own Microsoft To Do list. It does not read tasks back from Microsoft, and it does not create Outlook appointments.

Production stays off. Set `MICROSOFT_365_TASK_OUTBOUND_ENABLED=false` until a pilot is approved. Turning on `MICROSOFT_365_CRM_ENABLED` does not turn outbound on.

Automated tests use a mocked Graph client. They do not need a Microsoft account or administrator consent.

## What was already there

- `Task` is the only task record. Status is `OPEN`, `IN_PROGRESS`, `DONE`, or `CANCELLED`. Priority is `LOW`, `NORMAL`, or `HIGH`.
- Tasks are created from CRM activities, Sales Intelligence follow-ups, and trade callback requests. Completing and rescheduling already existed. A general edit, cancel, reopen, and explicit one-task export were added on those same permission checks.
- `MicrosoftAccountConnection`, `MicrosoftTaskMapping`, and `MicrosoftSyncJob` already existed and were unused. This release fills them. It does not add a second task table.
- Microsoft sign-in, token refresh, and `Tasks.ReadWrite` were already limited to the CRM Entra app. No scope was added. The SDS Graph client is unchanged.
- Background work already runs from `src/server.ts` on a one-minute timer. Outbound uses that same process. It does not start a second scheduler.

## When a real Graph call is allowed

All of these must be true:

1. `MICROSOFT_365_CRM_ENABLED` is on.
2. `MICROSOFT_365_TASK_OUTBOUND_ENABLED` is on.
3. The assignee has a `CONNECTED` Microsoft account.
4. That user has turned task synchronisation on.
5. The stored scopes include delegated `Tasks.ReadWrite`.
6. The CRM task is assigned to that user.
7. The task is inside the rollout window below.

If any check fails, the worker does not call Microsoft. While the outbound flag is off, queue helpers return before reading the database, and the scheduler returns before claiming jobs.

## Which tasks are copied

Turning task synchronisation on records `taskOutboundEnabledAt`. Tasks created after that moment, and assigned to that user, are eligible. Tasks that already have an active mapping stay eligible so later edits still update Microsoft.

Older tasks are not scanned and are not exported when the preference is saved, when the app deploys, or when a migration runs.

A salesperson can copy one older task with **Copy this task to Microsoft To Do** on that task. The server accepts this only from the assignee, and only with `tasks.manage`.

Reassigning one task in the CRM to a connected salesperson is treated as a new assignment and can enqueue that task. Deleting a staff user can move many tasks at once. Those moved tasks are not bulk-exported. The previous user's Microsoft copies are scrubbed first, when the flags are on and the tokens still exist. The new owner keeps the CRM task and can copy individual tasks later.

## Dedicated list

Each connection stores `todoListId`. The worker:

1. Uses the stored list id when it is already known.
2. Otherwise lists `/me/todo/lists` and reuses a list whose display name is exactly `Automotive Brands CRM`.
3. Ignores well-known personal lists, even if the name matches.
4. If several custom lists match, reuses the oldest and records `TODO_LIST_DUPLICATE`. It does not create another.
5. Creates the list only when none match.

A per-connection Postgres advisory lock covers that decision. If Microsoft accepts the list and the local save fails, the job is queued again. The next run lists lists and reuses the one Microsoft already has.

Personal task lists are never patched.

## Field mapping

| CRM | Microsoft To Do |
| --- | --- |
| Title | `title` |
| Description, with account codes, bank details, and spend lines removed | `body.content` |
| Due date | `dueDateTime` |
| `LOW` / `NORMAL` / `HIGH` | `low` / `normal` / `high` |
| `OPEN` | `notStarted` |
| `IN_PROGRESS` | `inProgress` |
| `DONE` | `completed` |
| `CANCELLED` | see cancellation |

Customer, contact, and opportunity links stay on the CRM task. The Microsoft body keeps a line `CRM reference: ab-crm-task:{taskId}`. After the mapping is stored, the worker also posts a `linkedResource` with that external id. A linked-resource failure does not fail the job. The body line remains the lookup key.

Date-only CRM due dates are stored at 12:00:00.000 UTC. Those are sent as `{ dateTime: "YYYY-MM-DDT00:00:00", timeZone: "UTC" }`, which To Do treats as a date. Any other instant is converted to the Europe/London wall clock, including British Summer Time, and sent with time zone `Europe/London`.

## Cancellation and reassignment

CRM ownership wins. Microsoft tasks are not deleted.

Cancellation patches the existing To Do task to title `Cancelled CRM task`, status `deferred`, no due date, and a short note that does not repeat the CRM description. The mapping is marked `TOMBSTONED`. Later CRM edits do not update that Microsoft task.

Reassignment does the same to the previous assignee's copy, with title `CRM task reassigned`, then stops. The previous assignee does not receive later customer text. If the scrub cannot be confirmed, the job is marked `NEEDS_REVIEW` and an event is stored. A new mapping is created for the new assignee only when that assignee is eligible.

Disconnecting Microsoft 365 cancels queued and running outbound jobs and leaves CRM tasks as they are. Mappings are kept so a later reconnect does not create a second To Do task for the same CRM task.

Deleting a staff user removes the connection and tokens. The scrub runs before that delete, and only when both flags are on. If the flags are off, or Microsoft cannot be reached, the previous To Do text can remain until someone removes it in Microsoft. The CRM task is still transferred or kept.

## Jobs

`MicrosoftSyncJob.kind` is `TODO_OUTBOUND`. `dedupeKey` is `todo:{userId}:{taskId}:upsert` or `:release`, and it is unique. A second event while the row is `QUEUED`, `RUNNING`, or `NEEDS_REVIEW` does not insert another row. `FAILED`, `SUCCEEDED`, and `CANCELLED` rows are reused.

Workers claim with `updateMany`. A second worker sees a count of zero. A running job whose lease is older than two minutes can be claimed again. Attempts stop at five, then the row is `FAILED`. Backoff is 30 seconds, 2 minutes, 8 minutes, then 30 minutes, unless Microsoft sends `Retry-After` (seconds or an HTTP date, capped at 24 hours).

`NEEDS_REVIEW` is not cleared by another CRM edit. **Retry failed sync** on `/crm/microsoft` queues those rows again and marks them reviewed, which allows one recreate when Microsoft returns 404 for a mapped task.

Graph task creation does not accept an application idempotency header. This app does not send one. Before creating a task, and again after a timeout, HTTP 409, or HTTP 5xx, the worker reads up to four pages of 50 tasks from the dedicated list and matches `ab-crm-task:{taskId}` in the body. `nextLink` must stay on `https://graph.microsoft.com`. If the task is found, it is patched and adopted. If the scan cannot be finished, or Microsoft returns 409 and the task still cannot be found, the job becomes `NEEDS_REVIEW` and no further create is sent. A completed scan that finds nothing after a network error or HTTP 5xx is queued for retry.

HTTP 401 refreshes the token once. HTTP 403 fails the job as a missing permission. HTTP 404 on create clears the stored list id so the next attempt can find or create the list. HTTP 429 uses `Retry-After`.

The worker writes only `todoListId`, `lastTaskSyncAt`, and `lastError`, and only while the connection is still `CONNECTED`. It does not turn a disconnected account back on.

## Operations

`/crm/microsoft` shows the connected account, whether task sync is on, whether the outbound engine is on, the last successful task sync, and the waiting, failed, and needs-review counts. The retry button is shown only when there is something to retry, and only for someone who can connect. Tokens and raw Microsoft responses are not shown.

CRM task list and task drawer show `To Do Pending`, `Synced`, `Failed`, or `Review` to the assignee and to users with `crm.manage` or `admin.access`. Other staff do not see that indicator.

The timer in `src/server.ts` calls the worker every 60 seconds, at most five jobs per tick. `SIGTERM` and `SIGINT` stop further ticks. A job already running finishes or its lease expires and another process can recover it. No Graph call is made while the outbound flag is off.

## Environment

```
MICROSOFT_365_CRM_ENABLED=false
MICROSOFT_365_TASK_OUTBOUND_ENABLED=false
```

Both accept only `true`, `1`, `on`, or `yes`. The outbound variable is optional and defaults off. The encryption key, tenant, client id, and client secret are unchanged from `docs/microsoft-365-crm.md`. No new Graph permission is required.

## Deploy

1. Leave `MICROSOFT_365_TASK_OUTBOUND_ENABLED` unset or `false`.
2. Apply the additive migration `20261101120000_microsoft_todo_outbound`. It adds `NEEDS_REVIEW`, `todoListId`, `taskOutboundEnabledAt`, and a unique `dedupeKey`. It does not update or delete CRM rows.
3. Deploy this build and restart the app so the timer is running.
4. Confirm `/crm/microsoft` shows outbound engine **Off** and that no Microsoft task traffic appears.
5. Enable outbound only for a pilot, after `MICROSOFT_365_CRM_ENABLED` is already on, the encryption key is set, and the user has connected and turned task synchronisation on. Do not run a historical import.

## Rollback

1. Set `MICROSOFT_365_TASK_OUTBOUND_ENABLED=false` and restart, or wait for the next minute. The worker stops before claiming jobs or calling Microsoft.
2. CRM tasks are unchanged. Queued work stays queued until the flag is on again, or until the user disconnects, which cancels queued and running rows.
3. Leave the new columns in place. Dropping them is not required and is not part of rollback.
4. Redeploy the previous application build if the code itself must be removed. Do that only after the flag is off and no `NEEDS_REVIEW` job needs to be read by the older build. The older build does not query these jobs.

## Residual risks

- An edit saved while a job has already read the task can be overwritten by that job's patch. A later edit queues again.
- Staff deletion with outbound off, or a Graph failure during deletion, can leave the old To Do text in place after the tokens are removed.
- Two connections can briefly share an advisory lock if `hashtext` collides. That only serialises them.
- A Microsoft id that contains `/` or `\` is refused. The documented To Do id shape, including a trailing `=`, is accepted.
- `linkedResource` is best-effort. Lookup uses the body reference.
- Inbound sync and Outlook appointments are not implemented.
