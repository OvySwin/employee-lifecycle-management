# Deferred deployment without AWS federation

AWS account restrictions prevent configuring GitHub OIDC. This route uses GitHub-hosted CI and public GitHub Release downloads. No AWS access key, SSH private key, GitHub personal token, or demo password is published or stored in the release. SSM remains available for operations but is not required by this deployment route.

## What runs automatically

Pull requests run verification. Pushes to main run verification and, only on success, publish a draft release, upload all assets, and publish the complete release as ci-<full-commit-SHA>. Failed verification skips publication. Existing release tags are never overwritten. Publishing uses GitHub's short-lived job token with contents:write restricted to the separate publish job, not the test job. Fork and branch PRs do not publish.

CI now builds a reusable acceptance-test image and runs it against the packaged web/API/PostgreSQL stack before export. The two app images and acceptance image are identified in manifest.json by Docker image ID. All downloaded archives and the exact Compose definition have SHA-256 checksums. The frontend exposes /release.json and displays “Deployment pipeline demo” as a visible source-change demonstration.

## What an operator approves

This is deferred deployment, not fully automatic continuous deployment. An operator starts the deployment script on each server, first Test, then Staging, then Production. The script automatically downloads, verifies and loads the release, changes only API_IMAGE/WEB_IMAGE in the existing private config, starts services/migrations, checks HTTPS/readiness and the live frontend commit, and records a receipt. Test additionally runs the deployed browser acceptance suite. Test and Staging receipts must be reviewed before authorizing Production. Cross-server ordering is an operator gate, not a machine-enforced GitHub environment gate; do not describe it as fully automatic promotion.

## One-time preparation per server

Use a clean main checkout in ~/employee-lifecycle-management and pull the merged deployment changes. Keep deployment/app.env with independent environment, origin and database settings. Never replace that private file with an example. Python 3, curl, flock, Docker and Compose must be installed (Amazon Linux 2023 setup). Use the existing configured HTTPS proxy on Production.

The deployment script uses sudo. Invoke it from the repository root and specify a full release tag shown on the successful main CI run. No image rebuilding or SCP is involved.

### Test

Run the password prompt separately to avoid pasted command text being consumed as a password:

```bash
read -rs -p 'Existing Test HR password: ' TEST_PASSWORD; echo
```

Then:

```bash
export TEST_PASSWORD
sudo --preserve-env=TEST_PASSWORD bash scripts/deploy-release.sh test ci-REPLACE_WITH_40_CHARACTER_SHA
unset TEST_PASSWORD
```

Existing HR/IT/Manager accounts must share the synthetic Test password as configured earlier. The tests add one uniquely numbered synthetic employee per run. Reports stay private under /var/lib/elm-deploy/test/<SHA>/browser-report and browser-results. The browser binary is already in the downloaded acceptance image; it is not installed afresh on the server.

### Staging

After reviewing Test's successful receipt:

```bash
sudo bash scripts/deploy-release.sh staging ci-REPLACE_WITH_40_CHARACTER_SHA
```

### Production

After reviewing Staging readiness/version and manual business-flow evidence:

```bash
sudo bash scripts/deploy-release.sh production ci-REPLACE_WITH_40_CHARACTER_SHA --approve-production
```

The script requires NODE_ENV=production and an HTTPS APP_ORIGIN. It saves a private pg_dump before changes. It never seeds accounts, creates demo data in Production, deletes volumes or automatically restores a database.

## Failure handling and limits

A host/environment mismatch, missing Test password, invalid release tag, checksum mismatch or loaded image ID mismatch stops deployment before config changes. The per-host lock prevents concurrent deployments. A failure after config changes triggers a best-effort previous-image restart using a saved private config. This is not a schema rollback: migrations must remain backward compatible, and database restore must be rehearsed separately. Existing active requests can be interrupted during Compose replacement; this is not zero-downtime deployment.

Keep /var/lib/elm-deploy private; it contains database backups and copies of private environment settings. After automated releases begin, use this script for promotions rather than running the old repository Compose file against a newer release definition. Retain successful receipts, browser report and CI logs as evidence, with secrets redacted. Certificates/DNS still depend on the current Production public IP.

## Demonstration and assessment

Show a visible source change, the automatic push-triggered CI run, publication of tested images, then approve and execute the exact release on Test, Staging and Production, ending with the visible change and matching /release.json on the live HTTPS site. This demonstrates automated release preparation and operator-triggered automated deployment. Lecturer interpretation of the end-to-end/deferred-deployment requirement should be confirmed; do not claim all Level 4 acceptance criteria merely because the scripts exist.
