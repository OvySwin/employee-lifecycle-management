# Foundations data model

| Table | Responsibility |
|---|---|
| roles / app_users | Application users and HR/IT/Manager permissions; users differ from employees |
| employees | Employee identity, employment dates, lifecycle state and manager association |
| checklist_templates / template_tasks | Versioned onboarding/offboarding definitions and date offsets |
| workflows | Employee-specific workflow history; at most one InProgress workflow per employee |
| workflow_tasks | Snapshot of generated task details, due date, assignment and completion |
| auth_sessions | Hashed session token, CSRF hash and absolute expiry |
| schema_migrations | Applied filenames and checksums |

Foreign keys enforce relationships, role-consistent assignment and template/workflow kind consistency. Check constraints enforce dates, lifecycle/status values and completion metadata. A partial unique index prevents multiple active workflows even if concurrent requests race. Standard PostgreSQL concurrency needs verification with the deployed pg driver; embedded tests validate index enforcement but are not multi-process concurrency tests.

The backend will own lifecycle transitions and atomic task generation/completion in ELA-12/13/15/16. Database constraints alone do not implement those business workflows. Templates may change while generated tasks retain their snapshot; generation is implemented later.

## Migrations and recovery

`npm run db:migrate` obtains a transaction-scoped advisory lock, checks migration checksums and applies unapplied SQL in one transaction. Re-running is safe; editing an applied file is rejected. Add a new numbered migration for future changes. Failed migrations roll back; inspect connectivity/schema state privately and rerun after correcting the cause. No automatic destructive down migration is supplied.

Before a deployment schema change, capture a backup and rehearse restoration in an isolated target (ELA-24/36). Application rollback requires backward-compatible schema changes; do not assume rolling back an image undoes database changes. Do not delete volumes as a routine repair.

Seeds use a transaction and lock; rerunning inserts missing synthetic records without resetting passwords or overwriting existing employee records. Demo accounts use reserved example.test addresses. Seed data is disabled when NODE_ENV=production. Never seed a database containing real employee data.
