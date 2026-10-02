# Sentry WMS Repository

## Repository structure

- `admin/` - admin application
- `api/` - backend API
- `db/` - database code and migrations
- `docs/` - project documentation
- `jobs/` - background jobs/workers
- `mobile/` - mobile application
- `portal/` - web portal
- `proxy/` - proxy/reverse proxy configuration
- `scripts/` - maintenance/development scripts
- `tools/` - internal development tools

## General rules

- Work only on files relevant to the current task.
- Do not scan the entire repository unless necessary.
- Make the smallest reasonable change.
- Do not refactor unrelated code.
- Reuse existing patterns and utilities.
- Prefer targeted searches over repository-wide searches.
- Prefer targeted tests over full test suites.
- Do not print complete files after editing unless requested.
- Keep final responses concise.

## Large / low-priority files

Do not read unless specifically required:

- `CHANGELOG.md`
- generated files
- dependency directories
- cache directories
- build artifacts
- coverage output

## Sensitive files

- Do not read `.env` unless absolutely necessary.
- Never display, copy, or expose secrets.
- Prefer `.env.example` when configuration structure is needed.

## Documentation

- Documentation is under `docs/`.
- Only open the specific document relevant to the current task.
- Do not read all documentation by default.

## Task workflow

1. Identify the affected module.
2. Inspect only relevant files.
3. Determine the root cause or required change.
4. Make a minimal patch.
5. Run relevant tests/checks only.
6. Summarize:
   - files changed
   - what changed
   - tests/checks run

## Scope guidance

When a task is clearly limited to one module, start there.

Examples:

- Backend task → start in `api/`
- Database task → start in `db/`
- Mobile task → start in `mobile/`
- Admin task → start in `admin/`
- Portal task → start in `portal/`

Do not inspect unrelated applications unless the task requires cross-module changes.

## Long-running tasks

If `PROJECT_STATE.md` exists, read it first when continuing previous work.
