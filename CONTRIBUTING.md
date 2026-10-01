# Contributing to paddy

> paddy is proprietary software (see [LICENSE](LICENSE)). The repository is public for
> reference only, and **outside contributions aren't accepted** unless the owner has invited
> you. This file describes the internal workflow for the project team and its coding agents.
> To report a security issue, follow [SECURITY.md](SECURITY.md), not a public issue or PR.

## Branch workflow (mandatory convention — not technically enforced yet)

`main` is the source of truth and should always be in a working, tested
state. It is the only long-lived branch: feature branches are deleted once
their PR merges. Follow these rules even where GitHub doesn't enforce them.

1. **Never push directly to `main`.** Always work on a feature branch:
   ```
   git checkout -b feature/short-description
   ```
2. **Open a Pull Request** targeting `main` when the branch is ready.
3. **Wait for CI to pass** (`Backend CI` workflow — runs `manage.py check`
   + the full test suite against a real PostGIS database) before merging.
   Check with `gh pr checks <number>`.
4. **Merge via PR, not by pushing to `main` directly** — even for small
   changes, even if you're confident it's correct. This keeps history
   clean and gives CI a chance to catch issues before they land on `main`.

## Multiple agents working in parallel

For truly simultaneous agents, give each one its own folder with
`git worktree add ../paddy-<task> -b feature/<task>` (and remove it with
`git worktree remove` when done), so agents never share a working copy.

If several agents (Claude Code, etc.) are working on this repo at once:

- **Each agent works on its own branch**, named after the feature/area
  it owns (e.g. `feature/discovery-hub-frontend`,
  `feature/viewing-calendar-ui`). Never share a branch between two
  agents running concurrently — that's how work gets silently
  overwritten.
- **Rebase/merge `main` into your branch before opening a PR** if `main`
  has moved since you started, to catch conflicts early rather than at
  merge time.
- **Keep PRs scoped to one feature/area** — smaller, focused PRs are
  easier to review and less likely to conflict with another agent's
  in-flight work.
- **Never force-push over another agent's branch.** If you need to fix
  something on a branch you don't own, open a PR against THAT branch
  instead, or coordinate first.

## Before opening a PR

- Run the full test suite locally: `cd backend && pipenv run python manage.py test`
- Run `pipenv run python manage.py check` — must report zero issues
- Make sure no `.env` file, API key, or secret is included in your diff
  (`git diff` review before committing, not just trusting `.gitignore`)

## CI

See `.github/workflows/backend-ci.yml`. Runs on every PR targeting
`main` and on every push to `main`. Spins up a real PostGIS-enabled
Postgres database (GeoDjango features — PointField, geospatial
filtering — genuinely need this, not SQLite) and runs the full Django
test suite against it.

CI does not deploy anything — deployment is deliberately not set up yet.
