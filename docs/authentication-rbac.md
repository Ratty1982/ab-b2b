# Authentication & RBAC (Phase 1)

## Decision

Automotive Brands owns authentication via **Better Auth** + **PostgreSQL / Prisma**.

- Server-side sessions
- HttpOnly cookies (`Secure` in production, `SameSite=lax`)
- Existing TanStack Start CSRF middleware on server functions
- No localStorage auth, no client-owned JWTs, no Supabase/Firebase/Auth0/Clerk/AlphaOps auth

## Models

| Prisma model | Better Auth | Notes |
| --- | --- | --- |
| `User` | user | Person; additional `actorType`, `status`, MFA-ready fields |
| `AuthSession` | session | Mapped via `session.modelName` |
| `AuthAccount` | account | Credential passwords live here |
| `AuthVerification` | verification | Password-reset tokens — never log `value` |

Roles are **relational** (`Role` / `Permission` / `UserRole`). There is no `user.role` string.

Trade access uses `CompanyUser.role` (`TRADE_ADMIN` enum = product `TRADE_ACCOUNT_ADMIN`).

## Company isolation

**Never trust** `?companyId=`, form `companyId`, or client state without verifying:

1. `CompanyUser` membership for trade users, or
2. Authorised sales access via `CompanyAssignment` (+ team for managers)

Helpers: `requireCompanyAccess`, `requireCompanyPermission`.

Navigation hiding is **not** security — route `beforeLoad` guards and server helpers are authoritative.

## Acting context (order-for-customer)

Not classic impersonation. The salesperson remains themselves.

`ActingContext` tracks `actorUserId`, `onBehalfOfCompanyId`, lifetime. Requires:

1. `impersonation.order_for_customer`
2. Sales access to the company
3. Active acting context for mutations that are “on behalf of”

Audit events capture both actor and company.

## MFA (planned enforcement)

Schema is MFA-ready (`mfaEnabled`, encrypted secret fields). Better Auth TOTP can be added without redesign.

Future policy:

- `SUPER_ADMIN` → MFA required
- `ACCOUNTS` → MFA required
- Anyone who can `credit.edit` → MFA required
- Trade MFA initially optional

## Email

`src/infra/email` adapter interface. Development uses `dev-log`. Production without a configured provider **refuses** to pretend mail was sent.

Transactional mail (Admin → System → Settings → Email) covers password reset, staff invitations, trade application notices, and order confirmations.

## Admin-created user lifecycle

```
CREATED / INVITED
  → USER_INVITATION email (set password link)
  → SET PASSWORD on /activate
  → ACTIVE
  → optional DISABLED (deactivate)
  → optional Reactivate
```

| Concept | When | Email |
| --- | --- | --- |
| **Invitation** | New user who has never set a password (`INVITED`) | `USER_INVITATION` |
| **Password reset** | Existing `ACTIVE` user forgot / admin-assisted reset | `PASSWORD_RESET` |
| **Deactivate** | Established user must lose access | No email — sessions revoked, history kept |
| **Hard delete** | Disposable unused invite, **or** established user after transferring sales/CRM ownership to another internal user | N/A |

Hard delete without transfer is blocked when the user has meaningful history (orders, CRM ownership, imports, login, sales assignments, etc.). Prefer **Deactivate**, or use **Transfer & delete** to reassign CompanyAssignment / assigned applications / CRM ownership / imports / tasks / notes to another staff user first. Order snapshots and AuditEvent rows remain. Self-delete / self-deactivate and last effective Super Admin removal are blocked server-side.

Trade company portal invites continue to use `COMPANY_USER_INVITED` + the same `/activate` token accepter (`InvitationKind`).

## Development seed

```bash
bun run db:seed
```

Uses `@example.invalid` addresses. Password from `DEV_SEED_PASSWORD` or a console-printed default. Refuses production unless `ALLOW_PRODUCTION_SEED=true`.

**Production** uses a separate path — never `db:seed`:

```bash
bun run db:migrate:deploy
bun run db:bootstrap:production
```

See [deployment-coolify.md](./deployment-coolify.md).

## Route protection

| Area | Guard |
| --- | --- |
| `/portal/*` | Trade user + company membership |
| `/sales/*` | Internal + sales/CRM permissions |
| `/crm/*` | Internal + CRM/sales permissions |
| `/admin/*` | Internal + admin/CMS/product/credit admin permissions |

Anonymous → `/login?returnTo=…` (safe relative paths only).
