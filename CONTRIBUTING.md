# Contributing to Predictive Maintenance System

Thank you for your interest in contributing! This guide outlines our conventions and processes to keep the codebase clean and collaboration smooth.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Code Review Guidelines](#code-review-guidelines)
- [Issue Reporting](#issue-reporting)

---

## Getting Started

1. **Fork** the repository (or create a feature branch if you have write access).
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/predictive-maintenance-system.git
   cd predictive-maintenance-system/nextjs_space
   ```
3. **Install dependencies**:
   ```bash
   yarn install
   ```
4. **Copy the environment file** and configure it:
   ```bash
   cp .env.example .env.local
   ```
5. **Run the development server**:
   ```bash
   yarn dev
   ```

---

## Branch Naming Conventions

Use the following prefixes for branch names:

| Prefix       | Purpose                          | Example                              |
| ------------ | -------------------------------- | ------------------------------------ |
| `feature/`   | New features                     | `feature/add-alert-notifications`    |
| `bugfix/`    | Bug fixes                        | `bugfix/fix-login-redirect`          |
| `hotfix/`    | Urgent production fixes          | `hotfix/patch-auth-vulnerability`    |
| `refactor/`  | Code refactoring (no new features) | `refactor/simplify-ml-pipeline`    |
| `docs/`      | Documentation only               | `docs/update-api-reference`          |
| `test/`      | Adding or updating tests         | `test/add-connector-unit-tests`      |
| `chore/`     | Tooling, CI, dependencies        | `chore/upgrade-next-to-15`           |
| `release/`   | Release preparation              | `release/v1.2.0`                     |

### Rules

- Use **lowercase** and **hyphens** (not underscores or camelCase).
- Keep names short but descriptive.
- Include a ticket/issue number when applicable: `feature/GH-42-add-export`.

---

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <short summary>

<optional body>

<optional footer(s)>
```

### Types

| Type       | Description                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation only changes                       |
| `style`    | Formatting, missing semicolons (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                          |
| `test`     | Adding or correcting tests                       |
| `build`    | Changes to build system or dependencies          |
| `ci`       | Changes to CI configuration                      |
| `chore`    | Other changes that don't modify src or test files |
| `revert`   | Reverts a previous commit                        |

### Scopes (optional but encouraged)

Use the module or area being changed:

- `auth`, `db`, `prisma`, `api`, `ui`, `ml`, `connectors`, `scheduler`, `intelligence`, `mappers`, `config`

### Examples

```
feat(connectors): add Oracle database connector support

fix(auth): resolve session expiry race condition on token refresh

docs(api): document rate limiting headers for /api/predictions

refactor(ml): extract feature normalization into standalone utility

chore(deps): bump next from 14.1.0 to 14.2.3
```

### Breaking Changes

Append `!` after the type/scope and add a `BREAKING CHANGE:` footer:

```
feat(api)!: change prediction response format to v2 schema

BREAKING CHANGE: The `predictions` field is now an array of objects
instead of a flat array of numbers.
```

---

## Code Style

- **TypeScript** is mandatory for all new code.
- **ESLint** and **Prettier** rules must pass before committing.
- Follow existing patterns in the codebase (component structure, API route patterns).
- Use **named exports** for components and utilities.
- Keep files focused — one component or module per file.
- Maximum file length guideline: ~400 lines. Split larger files into modules.

---

## Pull Request Process

1. **Create a branch** from `main` following naming conventions.
2. **Make your changes** with meaningful, atomic commits.
3. **Self-review** your code before requesting review.
4. **Open a Pull Request** using the PR template.
5. **Fill out all sections** of the PR template completely.
6. **Request reviewers** — at least one approval is required.
7. **Address feedback** promptly. Push fixes as new commits (don't force-push during review).
8. **Squash and merge** is the preferred merge strategy.

### PR Checklist

Before submitting, ensure:

- [ ] Code compiles without errors (`yarn build`)
- [ ] No new TypeScript/ESLint warnings
- [ ] New features have corresponding tests (when test infra is set up)
- [ ] Documentation is updated if needed
- [ ] Database schema changes include a migration
- [ ] No secrets or credentials are committed

---

## Code Review Guidelines

### For Reviewers

- Be respectful and constructive.
- Focus on logic, security, performance, and maintainability.
- Approve with minor nits using "Approve with comments."
- Block merges only for significant issues.

### For Authors

- Keep PRs small and focused (< 400 lines changed ideally).
- Provide context in the PR description.
- Respond to all review comments before re-requesting review.

---

## Issue Reporting

When creating issues, please include:

1. **Clear title** describing the problem or feature.
2. **Environment details** (Node version, OS, browser if relevant).
3. **Steps to reproduce** (for bugs).
4. **Expected vs. actual behavior** (for bugs).
5. **Screenshots or logs** when applicable.

Use the issue templates provided in `.github/ISSUE_TEMPLATE/`.

---

## Questions?

Open a Discussion or reach out to the maintainers. We're happy to help!
