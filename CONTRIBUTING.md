# Contributing to paddy

## Branch workflow (mandatory convention — not technically enforced yet)

`main` is the source of truth and should always be in a working, tested
state. Branch protection is not enabled yet (requires a paid GitHub plan
for private repos) — this is a **convention every contributor and every
agent must follow manually** until that's turned on.

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
