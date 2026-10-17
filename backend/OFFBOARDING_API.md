# Offboarding initiation — ELA-19 / ELA-41

This change starts offboarding and snapshots its checklist. It does not add the
offboarding browser UI (ELA-21/42), task completion (ELA-20), email or cloud deployment.
No schema migration or credential change is required.

## HTTP contract

All routes use the existing session cookie. POST additionally requires the
configured Origin and X-CSRF-Token. Responses use Cache-Control: no-store.

### POST /api/employees/:id/offboarding

HR only. Body: `{"end_date":"2026-11-01"}`. No other properties accepted.
The date must be a real YYYY-MM-DD date and on/after the employee's start date.
Past departure dates are allowed for recording historical departures; the date
alone never completes the workflow.

201 response:

```json
{
  "employee": {"id":"employee-uuid","end_date":"2026-11-01","lifecycle_status":"Offboarding"},
  "workflow": {"id":"workflow-uuid","employee_id":"employee-uuid","template_id":"template-uuid","kind":"Offboarding","status":"InProgress"},
  "tasks": [{"id":"task-uuid","workflow_id":"workflow-uuid","title":"Remove access","required":true,"assigned_role":"IT","assignee_user_id":null,"due_date":"2026-10-31","position":0,"status":"Pending"}]
}
```

Location: `/api/employees/:id/offboarding`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid employee UUID, body or end date; date errors include `fields.end_date` |
| 401 | Missing/expired/disabled-user session |
| 403 | Wrong role, Origin or CSRF token |
| 404 | Employee does not exist |
| 409 | Employee is not Active, an active workflow exists, or applicable template configuration is missing/has no required tasks |
| 500 | Unexpected failure; generic error without database details |

### GET /api/employees/:id/offboarding

HR can read any employee; Managers can read only their managed employees. IT is
denied employee-level workflow reads. Returns the same saved shape as POST for
the most recent offboarding workflow, including snapshots ordered by position.
Missing/out-of-scope employee or no offboarding history returns 404.

## Template selection and shared service boundary

`workflow-start.js` exports transaction, date and template-selection primitives
for the onboarding implementation to reuse. For Offboarding templates:

1. Every non-null filter must exactly match (case-sensitive AND).
2. `role_filter` means the employee's `job_title`, not the logged-in HR/IT role.
3. Prefer more non-null filters, then higher version, then name and ID ascending.
4. A template with all filters null is the fallback. No match is a 409.
5. Reject an empty or optional-only checklist. Do not silently fall back from an
   invalid selected template to another template.

Snapshot title, required flag, role, position and computed due date. Due date is
end date plus template offset days. Tasks initially have no individual assignee.
These tasks track access removal/equipment/archive work; they do not call identity
providers or remove real accounts. Template changes do not alter saved tasks.
Date-change recalculation policy remains ELA-23; do not assume editing employment
dates through the existing employee API reschedules snapshots.

## Atomicity and duplicate requests

One transaction locks the employee row, checks Active/no active workflow, locks
template definitions for a consistent snapshot, inserts workflow/tasks, then sets
end date and Offboarding. Production uses a dedicated pg.Pool client for the entire
transaction, never BEGIN/COMMIT on pool.query. Every failure rolls back.
The employee row lock serializes starts and the existing partial unique index
provides an additional database guard. A repeated start returns 409; clients can
GET the saved workflow after an ambiguous network response rather than blindly
creating another one.

## Validation evidence and remaining checks

`npm run lint`, `npm test`, `npm run build`.
27 new tests cover API persistence, date/role/CSRF validation, selection/fallback,
snapshot stability, duplicate/conflicting workflow rejection, forced task/final
update rollback and the dedicated pg-client transaction contract. Total: 73 tests.

Integration tests run on embedded PostgreSQL (PGlite); they are not evidence of
simultaneous requests on independent PostgreSQL connections. Before final
acceptance, use an isolated synthetic PostgreSQL Test Server database to:

- Send two simultaneous POSTs for the same Active employee: require one 201 and
  one 409, exactly one active workflow and one full checklist.
- Confirm GET and a new connection retain the saved end date/state/tasks.
- Confirm rollback under an injected database failure and normal retry afterwards.
- Capture captioned screenshots/raw output and obtain teammate review.

Use synthetic Active employees prepared in the isolated test fixture. The current
seed intentionally creates an Onboarding employee; do not bypass lifecycle rules
or change a real employee's state just to demonstrate this endpoint.
