# Admin user management

## Lifecycle

```
Create & send invite  →  INVITED
        ↓
Set password (/activate)  →  ACTIVE
        ↓
Deactivate  →  DISABLED  →  Reactivate (ACTIVE or INVITED)
```

Hard **Delete** is only for disposable unused invitations (no login / business history).

## Invitation vs password reset

| | Invitation (`USER_INVITATION`) | Password reset (`PASSWORD_RESET`) |
| --- | --- | --- |
| Who | New `INVITED` staff | `ACTIVE` users |
| Goal | First password + activate | Replace forgotten password |
| Token | `UserInvitation` (hashed) | Better Auth verification |
| Admin action | Create / Resend invitation | Send password reset |

Never email plaintext passwords. Emergency “Force set password” shows a password once in the admin UI only.

## Deactivate vs delete

- **Deactivate** — normal removal. Revokes sessions, sets `DISABLED`, keeps Company / Orders / Audit / SalesRep history.
- **Delete** — permanent. Server checks dependencies; blocked when history exists. Audit rows keep (actor/target SetNull).

## Protections

- Cannot deactivate or delete your own account
- Cannot deactivate/delete the last effective `ACTIVE` Super Admin
- Company portal users are invited from Customers (not hard-deleted with Company)

## RBAC

Requires `users.manage` (seeded Super Admin). Sales roles cannot manage staff users.
