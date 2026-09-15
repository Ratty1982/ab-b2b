# Infrastructure layer

Side-effectful adapters. Domain and server call into these; routes should not.

## Layout

- `database/` — Prisma client singleton
- `repositories/` — data access wrappers (Phase 1+)
- `storage/` — object storage for documents / SDS (later)
- `email/` — transactional email provider (later)
- `integrations/` — Autopart and other external systems (Phase 9)

## Rules

- Keep secrets in server-only env (never `VITE_*`)
- Autopart is eventually a source of truth for stock/invoices — design adapters, do not couple UI to Autopart
- Repositories translate Prisma models to domain-friendly shapes
