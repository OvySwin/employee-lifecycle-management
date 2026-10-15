# Employee management (ELA-10 / ELA-11)

All routes require an enabled-user session. HR can create/update/read; Managers can read their assigned employees; IT cannot list/read employee records. Manager out-of-scope detail requests return the same 404 as missing records. Every write requires the configured Origin and X-CSRF-Token from login or /api/auth/me.

| Method and path | Purpose | Success |
|---|---|---|
| GET /api/employees?page=1&pageSize=10 | Scoped employee list, stable number/ID order | 200 with employees and pagination |
| GET /api/employees/:id | Full authorised record | 200 with employee |
| POST /api/employees | HR creates a new employee in Onboarding | 201 with employee and Location header |
| PATCH /api/employees/:id | HR updates allowed fields | 200 with employee |
| GET /api/employee-managers | HR selects an enabled Manager user | 200 with managers (id, display_name) |

## Fields

| Field | Rules |
|---|---|
| employee_number | Required at creation; 1–40 letters/numbers/hyphens/underscores, first character alphanumeric; trimmed and uppercase; unique; immutable afterward |
| full_name | Required; trimmed, 1–200 characters |
| job_title | Required employee role/title; trimmed, 1–120 characters; distinct from application permission role |
| department, location | Required; trimmed, 1–120 characters each |
| start_date | Required valid YYYY-MM-DD calendar date |
| end_date | Optional/null; valid date on/after start_date |
| manager_user_id | Optional/null; UUID of an enabled Manager user |

Dates are returned as YYYY-MM-DD strings, avoiding timezone conversion. Reads also return id, lifecycle_status and manager_name. No password/session fields are selected. PATCH is partial; optional fields can be cleared with null. IDs, lifecycle_status and all other unsupported write fields are rejected; employee editing cannot activate/offboard an employee. No deletion endpoint is included.

List response: `{ employees: [...], pagination: { page, pageSize, total, totalPages } }`. Defaults: page 1, pageSize 10; pageSize max 100 and page max 100000. Counts use the same manager scope as rows; out-of-range valid pages return an empty list.

Errors: 400 contains `{ error, fields }` for actionable validation; 401 invalid/missing session; 403 role/origin/CSRF denial; 404 missing/out-of-scope record; 409 duplicate employee number; 500 generic unexpected error without SQL/credentials. Database date constraints remain the final guard against conflicting partial edits.

## Local verification

Use the existing backend/.env and running Docker PostgreSQL. No new migration is added by ELA-2; run db:migrate if the foundations schema has not yet been applied. Restart backend/frontend after switching branches.

1. Log in as HR, choose Add employee and use a unique synthetic employee number.
2. Fill the required fields, optionally select Demo Manager, and save.
3. Refresh the detail URL, edit the title/location and save; refresh again.
4. Try an existing employee number; verify feedback appears and your typed values remain.
5. Verify pagination when the list exceeds ten records.
6. Log in as Manager: only assigned records and no create/edit controls. Log in as IT: no employee controls.
7. Capture safe screenshots/output and ask a teammate to review the PR before closing Jira.

Automated checks: npm run lint, npm test, npm run build, npm audit. Browser tests: `npx playwright install chromium` once, then `npm run test:e2e`. The browser runner uses its own ports 3101/5175, synthetic data and in-memory PGlite database; it does not modify the local Docker database. API/embedded PostgreSQL tests and Chromium browser tests do not replace the later Test Server verification against the deployed PostgreSQL service.

Browser test failures retain reports in playwright-report/ and test-results/ (gitignored). The optional CHROMIUM_EXECUTABLE_PATH setting supports a custom headless binary in authoring containers; normal student/CI runs use the installed Playwright browser.
