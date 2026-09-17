# Contributor guidance

## Navigation

Authenticated navigation is a stable product contract. Do not reorganise, rename, remove or relocate existing navigation items as part of unrelated feature work.

Canonical definition: `src/lib/app-nav.ts`. Details: [docs/navigation.md](docs/navigation.md).

## Git

This repo uses `scripts/git-hooks/post-commit` to push the current branch to `origin` and, when present, `github` after every commit.

Enable it in a clone:

```bash
git config core.hooksPath scripts/git-hooks
```
