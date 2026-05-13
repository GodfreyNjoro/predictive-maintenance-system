# Git Workflow — Predictive Maintenance System

This document describes the branching strategy and release workflow for the project.

---

## Branching Strategy: GitHub Flow (Trunk-Based)

We use a **simplified trunk-based workflow** (GitHub Flow) with `main` as the single long-lived branch.

```
main ─────●─────●─────●─────●─────●─────●──────
           \         /       \         /
            feature/A        feature/B
```

### Why GitHub Flow?

- Simple and easy to understand.
- `main` is always deployable.
- Features are isolated in short-lived branches.
- Works well with CI/CD and Vercel preview deployments.

---

## Branch Lifecycle

### 1. Start from `main`

```bash
git checkout main
git pull origin main
git checkout -b feature/my-feature
```

### 2. Develop on your branch

- Make small, focused commits following [Conventional Commits](./CONTRIBUTING.md#commit-message-guidelines).
- Push your branch regularly:
  ```bash
  git push origin feature/my-feature
  ```

### 3. Open a Pull Request

- Open a PR against `main`.
- Fill out the PR template completely.
- Request at least one reviewer.
- CI checks must pass before merging.

### 4. Review & Merge

- Address all review feedback.
- Preferred merge method: **Squash and Merge** (keeps `main` history clean).
- Delete the feature branch after merging.

### 5. Deploy

- Merges to `main` trigger automatic deployments (Vercel / CI pipeline).
- Preview deployments are created for open PRs.

---

## Branch Types

| Branch           | Base    | Merges Into | Purpose                        |
| ---------------- | ------- | ----------- | ------------------------------ |
| `main`           | —       | —           | Production-ready code          |
| `feature/*`      | `main`  | `main`      | New features                   |
| `bugfix/*`       | `main`  | `main`      | Non-urgent bug fixes           |
| `hotfix/*`       | `main`  | `main`      | Urgent production fixes        |
| `refactor/*`     | `main`  | `main`      | Code improvements              |
| `docs/*`         | `main`  | `main`      | Documentation updates          |
| `release/vX.Y.Z` | `main` | `main`      | Release prep (optional)        |

---

## Release Process

We use **Git Tags** for versioning releases:

```bash
# After merging all features for a release
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release v1.2.0: Add Oracle connector, fix auth bugs"
git push origin v1.2.0
```

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (`v2.0.0`): Breaking API/schema changes
- **MINOR** (`v1.1.0`): New features, backward compatible
- **PATCH** (`v1.0.1`): Bug fixes, backward compatible

---

## Hotfix Process

For urgent production issues:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-auth-fix
# ... make fix ...
git push origin hotfix/critical-auth-fix
# Open PR → expedited review → squash merge
```

---

## Commit Hygiene

- **Atomic commits**: Each commit should represent one logical change.
- **No WIP commits on `main`**: Use `git rebase -i` to clean up before merging.
- **Commit message template**: Configure locally with:
  ```bash
  git config commit.template .gitmessage
  ```

---

## Protected Branch Rules (Recommended)

Configure these on GitHub for `main`:

- [x] Require pull request reviews before merging (1+ approvals)
- [x] Require status checks to pass before merging
- [x] Require branches to be up to date before merging
- [x] Do not allow force pushes
- [x] Do not allow deletions
- [x] Require linear history (squash or rebase merges only)

---

## CI/CD Integration

| Event                  | Action                               |
| ---------------------- | ------------------------------------ |
| Push to feature branch | Run lint + type-check + tests        |
| Open PR against `main` | Run full CI + create preview deploy  |
| Merge to `main`        | Deploy to production                 |
| Tag `vX.Y.Z`          | Create GitHub Release                |

---

## Quick Reference

```bash
# Start a feature
git checkout main && git pull && git checkout -b feature/my-thing

# Stay up to date
git fetch origin && git rebase origin/main

# Push and create PR
git push -u origin feature/my-thing
# → Open PR on GitHub

# After merge, clean up
git checkout main && git pull
git branch -d feature/my-thing
```
