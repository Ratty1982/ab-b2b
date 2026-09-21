# Automotive Brands — agent notes

This repository is an independent Automotive Brands production codebase.

- Do **not** couple this project to AlphaOps, WordPress, WooCommerce, Shopify, or unapproved Supabase usage.
- Preserve the approved UI in `src/components/ab` and existing routes unless a phase explicitly changes them.
- Authenticated navigation is a stable product contract. Do **not** reorganise, rename, remove, or relocate navigation during unrelated work. Canonical tree: `src/lib/app-nav.ts`.
- Bun (`bun.lock`) is the package manager. Do not introduce `package-lock.json`.
- Private secrets belong in server env (never `VITE_*`).
- Production database changes use Prisma migrations only. Do **not** manually modify the production database.
- Do **not** expose exact customer-facing stock quantities.
- Phase 0 established foundations only — mock data remains until later phases.

Git history from the Lovable prototype era should be preserved. Do **not** force-push the production branch (`git push --force` / `--force-with-lease`) unless the user explicitly instructs it.

## Git delivery (permanent)

**Work is not considered delivered until the final commit has been successfully pushed to the authoritative GitHub repository and the remote branch has been verified.**

A local commit alone is **not** delivery. Do not report “pushed”, “deployed”, “ready for Coolify”, or similar unless the GitHub push succeeded and the remote branch contains the commit.

### Authoritative remote

- Repository: `https://github.com/Ratty1982/ab-b2b.git`
- Default branch for production/development: `production/phase-1-auth-rbac`
- Coolify deploys from that GitHub branch.

Do **not** assume `origin` is GitHub. This project has previously had a Cursor temporary repository configured as `origin`.

Before every push, inspect `git remote -v`. Use the remote whose URL is `https://github.com/Ratty1982/ab-b2b.git` (typically named `github`). If that remote exists:

```bash
git push github HEAD:production/phase-1-auth-rbac
```

Do **not** push production work only to a Cursor temporary repository. Do **not** change or delete remotes unnecessarily.

### Branch

Unless a task explicitly instructs otherwise, stay on `production/phase-1-auth-rbac`. Before commit/push, verify `git branch --show-current`. Do **not** silently switch development back to `main`.

### Required sequence for every coding task

1. Complete the requested work.
2. Run the tests / typecheck / build appropriate to the task.
3. Check `git status`.
4. Commit intended changes with a meaningful message.
5. Push the commit to **GitHub** (`Ratty1982/ab-b2b`), not only a Cursor temp remote.
6. Verify the remote GitHub branch contains the new commit.
7. Only then report the task as delivered.

Example verification:

```bash
git fetch github production/phase-1-auth-rbac
git rev-parse HEAD
git rev-parse github/production/phase-1-auth-rbac
```

Those SHAs must match after a successful delivery.

### If push fails

Preserve local work. Do **not** claim delivery. Do **not** force-push. Do **not** discard remote changes. Report the exact Git error, the local commit SHA, and what needs resolving.
