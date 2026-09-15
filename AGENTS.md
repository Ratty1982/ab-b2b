# Automotive Brands — agent notes

This repository is an independent Automotive Brands production codebase.

- Do **not** couple this project to AlphaOps, WordPress, WooCommerce, Shopify, or unapproved Supabase usage.
- Preserve the approved UI in `src/components/ab` and existing routes unless a phase explicitly changes them.
- Bun (`bun.lock`) is the package manager. Do not introduce `package-lock.json`.
- Private secrets belong in server env (never `VITE_*`).
- Phase 0 established foundations only — mock data remains until later phases.

Git history from the Lovable prototype era should be preserved (avoid force-pushing rewritten published history without an explicit decision).
