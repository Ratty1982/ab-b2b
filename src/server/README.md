# Server layer

TanStack Start server boundary for Automotive Brands.

## Responsibilities

- Server functions (`createServerFn`)
- Request context (session, active company, actor)
- Authentication / session cookies (Phase 1)
- RBAC enforcement (Phase 1)
- Input validation at the trust boundary (Zod)
- CSRF protection (already wired in `src/start.ts`)

## Hard rules

- Never trust the client for: prices, discounts, VAT, credit limits, stock, permissions
- Authorise on the server before every mutation
- Prefer HttpOnly secure cookies for sessions (Phase 1)
- Log security-relevant actions via `AuditEvent` once persistence is live

## Layout

- `auth/` — Better Auth (or equivalent) adapters — Phase 1
- `rbac/` — permission checks — Phase 1
- `context/` — per-request actor / company context
- `validation/` — shared Zod schemas for server inputs
- `functions/` — `createServerFn` handlers
