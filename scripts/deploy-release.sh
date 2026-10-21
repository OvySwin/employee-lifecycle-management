#!/usr/bin/env bash
# Explicitly approved, deferred deployment of a CI-published release. No AWS keys.
set -Eeuo pipefail
umask 077
if [[ $EUID != 0 ]]; then echo 'Run with sudo (preserve TEST_PASSWORD for Test).'; exit 1; fi
if [[ $# -lt 2 || $# -gt 3 ]]; then echo 'Usage: deploy-release.sh test|staging|production ci-<40-character-SHA> [--approve-production]'; exit 1; fi
elmEnvironment=$1
elmTag=$2
case "$elmEnvironment" in test|staging|production) ;; *) echo 'Invalid environment'; exit 1;; esac
[[ $elmTag =~ ^ci-([a-f0-9]{40})$ ]] || { echo 'Use an exact ci-<full-SHA> release tag.'; exit 1; }
elmSha=${BASH_REMATCH[1]}
if [[ $elmEnvironment = production && ${3:-} != --approve-production ]]; then echo 'Production requires --approve-production after reviewing Test/Staging evidence.'; exit 1; fi
if [[ $elmEnvironment = test && -z ${TEST_PASSWORD:-} ]]; then echo 'Enter/export TEST_PASSWORD first; no deployment was attempted.'; exit 1; fi
elmRepo=$(cd "$(dirname "$0")/.." && pwd)
elmConfig=$elmRepo/deployment/app.env
[[ -f $elmConfig ]] || { echo 'Missing private deployment/app.env'; exit 1; }
command -v python3 >/dev/null
command -v curl >/dev/null
command -v flock >/dev/null
exec 9>"/var/lock/elm-deploy-$elmEnvironment.lock"
flock -n 9 || { echo 'Another deployment is running.'; exit 1; }
elmState=/var/lib/elm-deploy/$elmEnvironment
install -d -m 700 "$elmState"
elmRelease=$elmState/$elmSha
install -d -m 700 "$elmRelease"
elmDownload=https://github.com/OvySwin/employee-lifecycle-management/releases/download/$elmTag
for elmFile in manifest.json images.tar.gz compose.app.yaml; do
  curl --fail --silent --show-error --location --retry 2 "$elmDownload/$elmFile" -o "$elmRelease/$elmFile"
done
python3 - "$elmRelease" "$elmSha" "$elmConfig" "$elmEnvironment" <<'PY'
import hashlib,json,pathlib,sys
folder=pathlib.Path(sys.argv[1]); sha=sys.argv[2]
m=json.loads((folder/'manifest.json').read_text())
assert m['source_commit']==sha and m['repository']=='OvySwin/employee-lifecycle-management', 'Release identity mismatch'
for name in ['images.tar.gz','compose.app.yaml']:
 h=hashlib.sha256()
 with (folder/name).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 assert h.hexdigest()==m['sha256'][name], 'Checksum mismatch: '+name
values=dict(line.split('=',1) for line in pathlib.Path(sys.argv[3]).read_text().splitlines() if '=' in line and not line.lstrip().startswith('#'))
assert values.get('DEPLOY_ENV')==sys.argv[4], 'Wrong server/environment config'
if sys.argv[4]=='production':
 assert values.get('NODE_ENV')=='production' and values.get('APP_ORIGIN','').startswith('https://'), 'Production requires production mode and HTTPS'
print('Release identity, checksums and environment verified')
PY
if [[ $elmEnvironment = test ]]; then
  curl --fail --silent --show-error --location --retry 2 "$elmDownload/acceptance.tar.gz" -o "$elmRelease/acceptance.tar.gz"
  python3 - "$elmRelease" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); h=hashlib.sha256()
with (p/'acceptance.tar.gz').open('rb') as f:
 for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
assert h.hexdigest()==json.loads((p/'manifest.json').read_text())['sha256']['acceptance.tar.gz'],'Acceptance image checksum mismatch'
PY
  docker load -i "$elmRelease/acceptance.tar.gz"
fi
docker load -i "$elmRelease/images.tar.gz"
python3 - "$elmRelease/manifest.json" "$elmEnvironment" <<'PY'
import json,subprocess,sys
m=json.load(open(sys.argv[1]))
for name in ['api','web']+(['acceptance'] if sys.argv[2]=='test' else []):
 tag=m['images'][name]['tag']; expected=m['images'][name]['id']
 actual=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip()
 assert actual==expected,'Loaded image ID mismatch: '+name
PY
cp -p "$elmConfig" "$elmRelease/previous.env"
if [[ -f $elmState/current-compose ]]; then elmPreviousCompose=$(cat "$elmState/current-compose"); else elmPreviousCompose=$elmRepo/deployment/compose.app.yaml; fi
elmChanged=0
rollback() {
  elmExit=$?
  trap - ERR
  if [[ $elmChanged = 1 ]]; then
    cp -p "$elmRelease/previous.env" "$elmConfig"
    echo 'Deployment failed; attempting previous images. Database schema is not rolled back.' >&2
    docker compose --env-file "$elmConfig" -f "$elmPreviousCompose" up -d --no-build --wait --wait-timeout 180 || true
  fi
  exit "$elmExit"
}
trap rollback ERR
# Keep a private database backup before changing an existing Production stack.
if [[ $elmEnvironment = production ]]; then
  elmDbUser=$(python3 -c 'import sys; print(next(x.split("=",1)[1].strip() for x in open(sys.argv[1]) if x.startswith("POSTGRES_USER=")))' "$elmConfig")
  elmDbName=$(python3 -c 'import sys; print(next(x.split("=",1)[1].strip() for x in open(sys.argv[1]) if x.startswith("POSTGRES_DB=")))' "$elmConfig")
  docker compose --env-file "$elmConfig" -f "$elmPreviousCompose" exec -T db pg_dump -U "$elmDbUser" -d "$elmDbName" | gzip > "$elmRelease/database-before.sql.gz"
fi
elmChanged=1
python3 - "$elmConfig" "$elmRelease/manifest.json" <<'PY'
import json,os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]); m=json.load(open(sys.argv[2])); st=p.stat()
lines=[x for x in p.read_text().splitlines() if not x.startswith(('API_IMAGE=','WEB_IMAGE='))]
lines+=['API_IMAGE='+m['images']['api']['tag'],'WEB_IMAGE='+m['images']['web']['tag']]
fd,tmp=tempfile.mkstemp(dir=p.parent)
with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
os.chmod(tmp,0o600); os.chown(tmp,st.st_uid,st.st_gid); os.replace(tmp,p)
PY
docker compose --env-file "$elmConfig" -f "$elmRelease/compose.app.yaml" up -d --no-build --wait --wait-timeout 180
elmOrigin=$(python3 -c 'import sys; print(next(x.split("=",1)[1].strip() for x in open(sys.argv[1]) if x.startswith("APP_ORIGIN=")))' "$elmConfig")
curl --fail --silent --show-error --max-time 15 "$elmOrigin/ready"
printf '\n'
curl --fail --silent --show-error --max-time 15 "$elmOrigin/release.json" -o "$elmRelease/live-release.json"
python3 - "$elmRelease/live-release.json" "$elmSha" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['commit']==sys.argv[2], 'Live frontend is not the requested release'
PY
if [[ $elmEnvironment = test ]]; then
  mkdir -p "$elmRelease/browser-report" "$elmRelease/browser-results"
  docker run --rm --network host --ipc=host -e TEST_PASSWORD \
    -e DEPLOYED_BASE_URL="$elmOrigin" -e ALLOW_SYNTHETIC_WRITES=test-only -e EXPECTED_RELEASE_SHA="$elmSha" \
    -v "$elmRelease/browser-report:/app/playwright-report/deployed" \
    -v "$elmRelease/browser-results:/app/test-results/deployed" \
    "elm-acceptance:$elmSha"
fi
printf '%s\n' "$elmRelease/compose.app.yaml" > "$elmState/current-compose"
python3 - "$elmRelease" "$elmEnvironment" "$elmTag" <<'PY'
import datetime,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); m=json.loads((p/'manifest.json').read_text())
receipt={'environment':sys.argv[2],'release':sys.argv[3],'source_commit':m['source_commit'],'time_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readiness':'passed','live_release':'matched','deployed_browser_tests':'passed' if sys.argv[2]=='test' else 'not_run','ci_run':m['ci_run']}
(p/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
PY
trap - ERR
echo "Deployment passed. Private evidence: $elmRelease"
