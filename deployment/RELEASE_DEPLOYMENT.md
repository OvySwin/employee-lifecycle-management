# GitHub Actions deployment

## Normal release path

A push to main triggers ELM CI: lint, coverage, browser tests, packaged-image verification and release publication. After successful main push CI, ELM Deploy automatically deploys the exact published images to Test, runs deployed browser acceptance tests, and only then deploys to Staging. Staging checks readiness and the live release SHA. Failed required jobs prevent later jobs from running.

Deployment runs on GitHub-hosted workers using AWS Systems Manager Run Command. No public SSH access from GitHub is required. The IAM deployment user can send shell commands to the three specified ELM instances and read command results. Its long-lived access key is stored in AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY repository secrets; delete or rotate it when project deployment access ends. OIDC is unavailable in this account. Test's existing synthetic-account password stays in the root-readable /etc/elm/test-password file and is not sent as an SSM parameter.

Production is deferred. In Actions, select ELM Deploy, Run workflow, main, the full successful release SHA, and approve_production=true. This is an explicit manual workflow launch, not a separate required-reviewer environment gate. The run validates successful main push CI and a published release, then verifies Test and Staging receipts and their current live readiness/version before deploying Production. Production takes a private database backup and verifies HTTPS readiness and the live SHA. Browser tests run on Test; the Production job does not run them.

## Host configuration and evidence

Keep the existing independent deployment/app.env on each host; never overwrite it with examples. Required host tools are Python 3, curl, flock, Docker and Compose. SSM must be connected and permitted by the instance role. Test and Staging web ports remain loopback-only; Production uses its existing Caddy HTTPS proxy.

scripts/ssm-deploy.py sends bounded commands and polls their result. It downloads the deployment script at the exact release source SHA into /var/lib/elm-deploy/automation/<SHA>/scripts and uses the host's existing private configuration. No on-host git checkout or image rebuild is required.

The underlying scripts/deploy-release.sh verifies release identity, archive/Compose SHA-256 checksums, loaded image IDs and environment settings. It updates only API_IMAGE/WEB_IMAGE, applies migrations, starts services and checks readiness/version. Test additionally runs the packaged acceptance image using existing synthetic HR/IT/Manager accounts. Each browser run creates a uniquely numbered synthetic employee.

Private evidence is in /var/lib/elm-deploy/<environment>/<SHA>/: receipt.json, browser reports on Test, and database-before.sql.gz on Production. This directory also contains private configuration backups: do not publish it wholesale. Retain selected redacted reports and console logs for assessment.

## Failure handling

A missing Test password stops deployment before changing containers. Per-host locks prevent overlapping deployment scripts; Actions serializes promotions. Failure after changing app configuration attempts to restore previous images. This is best-effort image rollback, not database-schema rollback. Migrations must be backward compatible. An isolated database restoration rehearsal and controlled failed-health rollback exercise still need separate evidence.

Do not delete database volumes to repair a deployment. Repeating the same SHA can overwrite its prior backup/config evidence, so inspect before retrying a partially completed deployment. Production never runs demo seeds or automatically restores its database. Compose replacement may briefly interrupt requests. DNS/certificates depend on the current Production public IP.

## Demonstration

Show the old form label, then a source change from Job title to Position / job title. Follow the source commit through ELM CI and ELM Deploy Test/Staging. Show the successful Test browser suite and identical release SHA. Launch the approved Production run, then refresh the live application to show the new label. Updating a synthetic employee's title afterwards demonstrates application behaviour and persistence; that database edit itself does not trigger CI.

This proves the tested release's delivery path. It does not prove unfinished onboarding/offboarding features, every assessment criterion, or unexecuted recovery tests. Manual SSH execution of scripts/deploy-release.sh remains an operations fallback, not the normal demo path.
