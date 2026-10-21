#!/usr/bin/env python3
"""Run a bounded ELM deployment through SSM, or verify an existing promotion receipt."""
import argparse
import json
import re
import shlex
import subprocess
import sys
import time

INSTANCES = {
    "test": "i-0cfc581325319f50a",
    "staging": "i-0e3ed2cf0b500813e",
    "production": "i-0e2e6e9a1d80fc482",
}

def aws(*args):
    result = subprocess.run(
        ["aws", *args, "--output", "json"], capture_output=True, text=True, timeout=60
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=INSTANCES)
    parser.add_argument("sha")
    parser.add_argument("--verify-only", action="store_true")
    options = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", options.sha):
        parser.error("A full lowercase source SHA is required")
    env, sha = options.environment, options.sha
    # All substitutions below are restricted choices or validated hexadecimal SHA.
    if options.verify_only:
        remote = f"""set -eu
python3 - '{env}' '{sha}' <<'PY'
import json,pathlib,sys,urllib.request
environment,sha=sys.argv[1:]
receipt=json.loads(pathlib.Path('/var/lib/elm-deploy/'+environment+'/'+sha+'/receipt.json').read_text())
assert receipt['environment']==environment and receipt['source_commit']==sha
assert receipt['readiness']=='passed' and receipt['live_release']=='matched'
if environment=='test': assert receipt['deployed_browser_tests']=='passed'
config=dict(line.split('=',1) for line in pathlib.Path('/home/ec2-user/employee-lifecycle-management/deployment/app.env').read_text().splitlines() if '=' in line and not line.lstrip().startswith('#'))
assert config['DEPLOY_ENV']==environment
origin=config['APP_ORIGIN']
with urllib.request.urlopen(origin+'/ready',timeout=15) as response:
 assert json.load(response)['database']=='connected'
with urllib.request.urlopen(origin+'/release.json',timeout=15) as response:
 assert json.load(response)['commit']==sha
print(json.dumps(receipt,indent=2))
PY
"""
    else:
        remote = f"""set -eu
umask 077
work=/var/lib/elm-deploy/automation/{sha}
mkdir -p "$work/scripts"
if [ ! -e "$work/deployment" ]; then
  ln -s /home/ec2-user/employee-lifecycle-management/deployment "$work/deployment"
fi
"""
        if env == "test":
            remote += """test -s /etc/elm/test-password || { echo 'Missing private /etc/elm/test-password on Test; no deployment attempted.'; exit 1; }
export TEST_PASSWORD="$(cat /etc/elm/test-password)"
"""
        remote += f"""curl --fail --silent --show-error --location --max-time 60 --retry 2 https://raw.githubusercontent.com/OvySwin/employee-lifecycle-management/{sha}/scripts/deploy-release.sh -o "$work/scripts/deploy-release.sh"
bash "$work/scripts/deploy-release.sh" {env} ci-{sha}"""
        if env == "production":
            remote += " --approve-production"
        remote += "\n"
    parameters = {"commands": ["bash -c " + shlex.quote(remote)], "executionTimeout": ["1500"]}
    response = aws(
        "ssm", "send-command", "--instance-ids", INSTANCES[env],
        "--document-name", "AWS-RunShellScript", "--timeout-seconds", "120",
        "--comment", f"ELM {env} {'verify' if options.verify_only else 'deploy'} {sha[:12]}",
        "--parameters", json.dumps(parameters),
    )
    command_id = response["Command"]["CommandId"]
    print(f"SSM command {command_id}: {env} {sha}", flush=True)
    deadline = time.monotonic() + 1620
    while time.monotonic() < deadline:
        try:
            result = aws("ssm", "get-command-invocation",
                         "--command-id", command_id, "--instance-id", INSTANCES[env])
        except RuntimeError as error:
            if "InvocationDoesNotExist" not in str(error):
                raise
            time.sleep(5)
            continue
        status = result["Status"]
        if status in ("Pending", "InProgress", "Delayed"):
            time.sleep(10)
            continue
        print(result.get("StandardOutputContent", ""))
        print(result.get("StandardErrorContent", ""), file=sys.stderr)
        if status != "Success" or result.get("ResponseCode") != 0:
            raise RuntimeError(f"{env} command failed: {status}; later promotion must stop")
        print(f"{env}: passed", flush=True)
        return
    # Server command has its own execution deadline; do not retry a possibly running deploy.
    raise RuntimeError("SSM polling deadline exceeded; inspect the command before retrying")

if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        sys.exit(str(error))
