# Contributor guidance

## Navigation

Authenticated navigation is a stable product contract. Do not reorganise, rename, remove or relocate existing navigation items as part of unrelated feature work.

Canonical definition: `src/lib/app-nav.ts`. Details: [docs/navigation.md](docs/navigation.md).

## Git

**Work is not considered delivered until the final commit has been successfully pushed to the authoritative GitHub repository and the remote branch has been verified.**

- Authoritative remote: `https://github.com/Ratty1982/ab-b2b.git` (usually the `github` remote — do **not** assume `origin` is GitHub).
- Default production/development branch: `production/phase-1-auth-rbac` (Coolify deploys this GitHub branch).
- Do not force-push the production branch unless explicitly instructed.

After commit, push with `git push github HEAD:production/phase-1-auth-rbac` when that remote points at `Ratty1982/ab-b2b`. Then fetch and confirm local `HEAD` matches `github/production/phase-1-auth-rbac`.

This repo uses `scripts/git-hooks/post-commit` to push the current branch to GitHub (`github` if present) and `origin`. A Cursor temporary `origin` is not delivery.

Enable the hook in a clone:

```bash
git config core.hooksPath scripts/git-hooks
```
