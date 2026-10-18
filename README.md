# Employee Lifecycle Management
SWE40006 team project: employee onboarding/offboarding with a three-tier web application and demonstrated DevOps pipeline.

## Current scope
ELA-7 bootstrap, ELA-8/9 foundations and ELA-2 employee management: React/Vite frontend, Express API, local PostgreSQL, migrations/seeds, session login, HR employee create/edit, paginated lists and scoped detail views. Workflow generation/completion, image packaging and AWS delivery remain later tickets.

## Architecture
React browser UI → Express REST API → PostgreSQL. Frontend does not connect directly to the database.
GitHub → GitHub Actions → Testing → Staging → Production on AWS EC2; CloudWatch production monitoring is planned.

## Prerequisites
Git, Node.js 24.x with npm, and Docker Desktop (Compose v2). Use .nvmrc if your version manager supports it.

## Local setup (VS Code terminal / PowerShell)
1. Clone this repository and open its folder in VS Code.
2. Run `npm ci`.
3. Copy `deployment/.env.example` to `deployment/.env` and `backend/.env.example` to `backend/.env`. PowerShell: `Copy-Item deployment/.env.example deployment/.env` and `Copy-Item backend/.env.example backend/.env`.
4. Replace both password placeholders with the same local-only password. Keep database/user values consistent. These files are ignored by git.
5. Start PostgreSQL: `docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --wait`.
6. In one terminal run `npm run dev:backend`.
7. In another terminal run `npm run dev:frontend` and open the URL Vite prints (normally http://localhost:5173).
8. Check http://localhost:3000/health (API liveness) and http://localhost:3000/ready (database connectivity). The page should show API and database connected.

## Checks
`npm run lint`
`npm test`
`npm run build`

The original health/readiness tests simulate database success/failure; additional foundations tests exercise an embedded PostgreSQL engine. Neither replaces verification of the real node-postgres connection to Docker PostgreSQL. Capture a successful /ready response and browser screenshot with your running local database before closing ELA-7.

## Stop and troubleshoot
Ctrl+C stops development servers. `docker compose --env-file deployment/.env -f deployment/compose.yaml down` stops PostgreSQL while retaining its volume.
If /ready returns 503, check Docker status, matching credentials and port 5432. Changing POSTGRES_PASSWORD after first initialization does not reset the existing database password.
Do not use `down -v` unless you intentionally want to delete all local database data.
Vite's development proxy forwards /health, /ready and /api to port 3000. Production routing will be configured in ELA-21/23.

## Team workflow and evidence
Use branches such as feature/ELA-8-database, commits containing the Jira key, and reviewed pull requests.
Keep captioned screenshots, raw console output, errors/fixes/retests and contributor references for every performed subtask. Store sensitive evidence privately and redact credentials.
Jira: https://shape-up.atlassian.net/browse/ELA-7

## Database and login foundations (ELA-8 / ELA-9)

After installing updated dependencies with `npm ci` and starting the existing PostgreSQL container:

1. Add `APP_ORIGIN=http://localhost:5173` to backend/.env if missing. Open exactly this frontend origin; if Vite chooses another port, update APP_ORIGIN and restart the API.
2. Add `SEED_PASSWORD=` followed by your own local-only demo-login password of 12–128 characters to backend/.env. This differs from PGPASSWORD, which authenticates the API to PostgreSQL. Do not commit or share either password.
3. Run `npm run db:migrate` then `npm run db:seed`. Rerunning both is safe; seed reruns preserve existing user passwords. Changing SEED_PASSWORD after the first seed does not reset existing accounts.
4. Restart the backend and frontend using the existing dev commands. Sign in as `hr@example.test`, `it@example.test` or `manager@example.test` with the password chosen in step 2.
5. Verify HR sees Sample Employee; Manager sees only their assigned employee; IT sees only their assigned tasks. Logout and refresh must show the login form. Templates exist but generated workflow tasks are implemented later.
6. Run lint, tests and build. Capture migration/seed outputs, masked login screens, role views and verification results. Do not capture passwords or cookies.

Database tables/constraints and recovery notes: database/ARCHITECTURE.md. Permission matrix, session/CSRF behaviour and the unimplemented MFA boundary: backend/AUTHENTICATION.md.

Automated foundations tests use PGlite's embedded PostgreSQL engine, exercising SQL constraints, migration/seed reruns, transaction rollback, persisted data after restart, login/permissions/CSRF and session expiry. They do not replace deployed node-postgres concurrency tests or browser acceptance tests required for Level 3. Verify migration/readiness/login against your Docker PostgreSQL 17 instance before closing these tickets.

## Employee management (ELA-2)

HR can choose Add employee, fill the form and save. New records start in Onboarding. Open View/Edit to change employee details; refresh to verify persistence. Employee number stays fixed; lifecycle status changes only through future workflow actions. Managers can read only their assigned employees; IT retains its task-only view. See backend/EMPLOYEE_API.md for fields, API contracts and manual verification.

Run `npx playwright install chromium` once, then `npm run test:e2e` for isolated browser create/edit, validation, pagination, permission, error and keyboard tests. These use synthetic embedded PostgreSQL data on ports 3101/5175 and do not touch your Docker data. Browser reports/test outputs are gitignored. Development Vite now fails clearly if its selected port is occupied, rather than silently choosing a different Origin and breaking login.

