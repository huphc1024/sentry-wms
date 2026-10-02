# Sentry WMS

This is a multi-application repository.

## Main modules

- `admin/`
- `api/`
- `db/`
- `docs/`
- `jobs/`
- `mobile/`
- `portal/`
- `proxy/`
- `scripts/`
- `tools/`

## Working rules

- Read only files relevant to the current task.
- Do not scan the whole repository by default.
- Make minimal changes.
- Do not refactor unrelated code.
- Reuse existing project patterns and utilities.
- Prefer targeted searches over broad repository scans.
- Run targeted tests/checks first.
- Do not output full files unless requested.
- Keep responses concise.

## Avoid by default

Do not read these unless the task specifically requires them:

- `CHANGELOG.md`
- dependency directories
- generated files
- cache directories
- build artifacts
- coverage output

## Sensitive files

- Do not read `.env` unless absolutely necessary.
- Never expose or repeat secrets.
- Prefer `.env.example` for configuration reference.

## Documentation

Documentation is under `docs/`.

Only read the specific document needed for the task.
Do not load all documentation into context.

## Scope guidance

Start with the module directly related to the task.

Examples:

- Backend/API → `api/`
- Database → `db/`
- Mobile → `mobile/`
- Admin → `admin/`
- Portal → `portal/`

Do not inspect unrelated modules unless required.

## Long tasks

If `PROJECT_STATE.md` exists, read it before continuing previous work.

Use it to recover:
- current goal
- current task
- relevant files
- completed work
- decisions
- blockers
- next step
