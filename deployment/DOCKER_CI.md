# ELA-25 / ELA-26: packaged application and continuous integration

## Architecture

Browser -> localhost:8080 (or a later HTTPS reverse proxy) -> nginx web container -> api:3000 -> db:5432.
React uses relative /api URLs. nginx forwards API and health requests by Docker service name, so the same frontend image can be promoted without rebuilding for each server. Only the web port is published, bound to loopback; API and PostgreSQL stay on the Compose network. The API defaults to loopback for existing local development and uses HOST=0.0.0.0 only inside its container.

Both application images use multi-stage builds. The API runtime is non-root, has production dependencies and migration SQL, and receives credentials only at runtime. nginx serves compiled files as a non-root user. Base images have explicit version tags; tags are not immutable digests. CI records image IDs, source commit and a checksum of the exported archive. Promote that verified archive (or registry digests in the later deployment work), rather than rebuilding from a mutable tag.

## Start a separate Test stack

Run from the repository root. Existing deployment/compose.yaml remains the local database setup. This new stack has its own named project and volume. Never point the CI integration tests at an existing database.

1. Copy deployment/app.env.example to deployment/app.env. This file is ignored by Git and Docker builds.
2. Replace POSTGRES_PASSWORD privately with a long random value. APP_ORIGIN must exactly match the browser's URL. For an SSH tunnel exposing localhost:8080, leave the example origin unchanged.
3. Run:

```bash
docker compose --env-file deployment/app.env -f deployment/compose.app.yaml build
docker compose --env-file deployment/app.env -f deployment/compose.app.yaml up -d --wait
docker compose --env-file deployment/app.env -f deployment/compose.app.yaml ps -a
curl --fail http://localhost:8080/ready
```

The migration job must exit successfully before the API starts. Re-running migrations verifies checksums and skips applied files. Before deploying future schema changes to an existing environment, back up and rehearse restoration; image rollback does not reverse a database migration.

For Test only, use an interactive private environment variable to supply a seed password of 12-128 characters, then run:

```bash
read -rs -p 'Test demo password: ' SEED_PASSWORD; echo
export SEED_PASSWORD
docker compose --env-file deployment/app.env -f deployment/compose.app.yaml run --rm -e SEED_PASSWORD migrate node backend/src/db-cli.js seed
unset SEED_PASSWORD
```

Existing accounts are not reset by reseeding. Do not seed Production. Existing local database contents are not automatically copied to this new stack.

Stop without deleting data:

```bash
docker compose --env-file deployment/app.env -f deployment/compose.app.yaml down
```

Never use `down -v` on a persistent environment as a routine repair. That command is confined to disposable CI cleanup.

## Production configuration

Use a distinct server and DEPLOY_ENV=production, NODE_ENV=production, and an HTTPS APP_ORIGIN. The API rejects a Production origin without HTTPS and uses secure session cookies. HTTPS termination and deployment automation are ELA-27/44; the supplied loopback HTTP web binding is for private verification behind a tunnel or a configured TLS proxy. Do not expose the development configuration publicly or disable the HTTPS guard. Configure secrets independently per environment. No AWS credentials or PEM files belong in CI image builds.

## CI checks and artifacts

ELM CI runs on pushes, pull requests and manual dispatch. It performs a locked install, lint, coverage tests, frontend build, Chromium acceptance tests, image builds, and a packaged stack smoke test. Each subsequent step requires the preceding step to succeed. Reports and diagnostics are retained even on failure; image exports only exist after successful container verification. The workflow uses no AWS credentials and does not deploy.

Coverage includes every backend/src JavaScript file except the process entrypoints server.js and db-cli.js. These entrypoints connect environment/process lifecycle to the application and are exercised through container startup and migration smoke checks. Routes, validation, permissions, password handling, migrations, seed logic and transaction helpers are included. Every aggregate dimension (lines/statements/functions/branches) must be >=80%; there is no reduced threshold or automatic threshold update.

The normal suite uses independent embedded PostgreSQL databases. CI additionally starts a disposable PostgreSQL 17 service and opts into postgres.integration.test.js using RUN_POSTGRES_TESTS=1. This verifies migration reruns and two simultaneous API requests through the real pg driver (one creation, one conflict, exactly one complete checklist). It is not a multi-host load test.

The packaged stack smoke checks compiled UI delivery, API routing, unauthenticated denial, data surviving DB container recreation, readiness returning 503 during DB outage while liveness stays 200, and readiness recovery. The separate Playwright suite currently uses its isolated embedded database/server; deployed Test Server browser acceptance remains ELA-27, not fulfilled by runner tests alone.

Download the run artifact under GitHub Actions. It contains coverage reports, browser reports, diagnostic logs, source commit, image IDs, and images.tar.gz with its SHA-256 checksum. Retention is seven days: download report evidence before it expires. The archive contains the exact two tested application images and can be loaded with `docker load -i images.tar.gz`. No registry push is required to retain tested images. Deploy jobs must only consume artifacts from successful trusted runs; ELA-27/44 implements that gate.

CI records total elapsed seconds against the <=300-second target. It does not silently treat a longer measured run as meeting that target; browser installation, image pulls and archive upload can exceed it. The 15-minute timeout is an execution ceiling, not the performance target.

## Evidence and remaining acceptance

Retain one successful Actions run, coverage percentages, Docker health/status output, persistence/outage/recovery results and image identifiers. Demonstrate a failed test on a disposable branch and preserve the failed run showing image export/deployment cannot advance, then remove the intentional failure. Never merge the failing test. Review the PR and record actual CI duration before closing either ticket. Do not mark these tickets Done based on source inspection alone.
