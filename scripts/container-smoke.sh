#!/usr/bin/env bash
set -euo pipefail
compose=(docker compose --env-file deployment/app.env -f deployment/compose.app.yaml)
mkdir -p evidence/ci
"${compose[@]}" up -d --wait --wait-timeout 180
curl --fail --silent http://localhost:8080/ | grep -q '<div id="root">'
curl --fail --silent http://localhost:8080/ready | grep -q 'connected'
code=$(curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:8080/api/employees)
test "$code" = 401
"${compose[@]}" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "CREATE TABLE ci_persistence_probe(value text); INSERT INTO ci_persistence_probe VALUES ('survives');"
"${compose[@]}" up -d --force-recreate db
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT value FROM ci_persistence_probe' | grep -qx survives
"${compose[@]}" stop db
for elmAttempt in $(seq 1 15); do
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:8080/ready)
  if test "$code" = 503; then break; fi
  sleep 1
done
test "$code" = 503
curl --fail --silent http://localhost:8080/health | grep -q 'ok'
"${compose[@]}" start db
"${compose[@]}" up -d --wait --wait-timeout 180
curl --fail --silent http://localhost:8080/ready | grep -q 'connected'
"${compose[@]}" images > evidence/ci/compose-images.txt
printf 'Container smoke passed: UI, readiness, auth, persistence, outage and recovery.\n'
