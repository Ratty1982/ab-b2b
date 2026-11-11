# GitHub Actions CI

## Why this exists

Before PR #110 the repository had **no** Actions workflows, so PR check rollups were empty even when local typecheck/tests/build passed. Local green is not GitHub CI.

## Workflow

`.github/workflows/ci.yml` runs on:

- `pull_request` (opened / synchronize / reopened / ready_for_review) — covers pushes, rebases, and force-pushes that update the PR head
- `push` to `production/phase-1-auth-rbac` (and `main` / `master` if used)
- `workflow_dispatch` for manual runs

Job `typecheck-test-build`: Bun 1.2.23 install (matches Coolify), Postgres 16 service, `prisma migrate deploy`, typecheck, full vitest, production build.

## Enabling checks on feature PRs

Until this workflow is on the **merge base** (normally after merging this CI PR into `production/phase-1-auth-rbac`), open feature PRs that do not contain `.github/workflows/ci.yml` will not get Actions runs.

Recommended sequence:

1. Land the CI workflow on `production/phase-1-auth-rbac`.
2. Update / rebase feature PRs onto that base (or push any commit) so `pull_request` synchronize fires with the workflow present in the merge commit.
3. Optionally mark `typecheck-test-build` as a **required** status in branch protection (needs repo admin; the agent token cannot read/set protection).

## Lockfile note

Do not switch this workflow to `cache: npm` / `npm ci` without adding `package-lock.json`. The canonical install is `bun.lock` + Bun 1.2.23.
