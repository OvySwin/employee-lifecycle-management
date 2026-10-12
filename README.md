# Employee Lifecycle Management
SWE40006 team project: employee onboarding/offboarding with a three-tier web application and demonstrated DevOps pipeline.

## Current scope
ELA-7 bootstrap: React/Vite frontend, Express API, PostgreSQL local configuration, lint/build scripts and health/readiness tests. Employee schema, authentication, workflows, image packaging and AWS delivery are later tickets.

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

The tests check health/readiness behaviour with a simulated database. They do not verify a real PostgreSQL connection. Capture a successful /ready response and browser screenshot with your running local database before closing ELA-7.

## Stop and troubleshoot
Ctrl+C stops development servers. `docker compose --env-file deployment/.env -f deployment/compose.yaml down` stops PostgreSQL while retaining its volume.
If /ready returns 503, check Docker status, matching credentials and port 5432. Changing POSTGRES_PASSWORD after first initialization does not reset the existing database password.
Do not use `down -v` unless you intentionally want to delete all local database data.
Vite's development proxy forwards /health, /ready and /api to port 3000. Production routing will be configured in ELA-21/23.

## Team workflow and evidence
Use branches such as feature/ELA-8-database, commits containing the Jira key, and reviewed pull requests.
Keep captioned screenshots, raw console output, errors/fixes/retests and contributor references for every performed subtask. Store sensitive evidence privately and redact credentials.
Jira: https://shape-up.atlassian.net/browse/ELA-7

