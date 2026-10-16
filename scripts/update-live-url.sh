#!/usr/bin/env bash
set -euo pipefail
cd /srv/multi-vm-agent/workspace/make_money/work/orbit-garden
LIVE=$(sudo -n journalctl -u vm5-orbit-tunnel.service -n 150 --no-pager --output=cat 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n1)
[[ "$LIVE" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]] || exit 1
curl -fsSL --max-time 10 "$LIVE/api/health" | grep -q '"service":"orbit-garden"' || exit 2
python3 - "$LIVE" <<'PY'
import pathlib, json, sys
p=pathlib.Path('docs/live.json')
content=json.dumps({'url':sys.argv[1]},indent=2)+'\n'
if not p.exists() or p.read_text()!=content: p.write_text(content)
PY
if ! git diff --quiet -- docs/live.json || test -z "$(git ls-files docs/live.json)"; then
  git add docs/live.json
  git commit -m 'Update live Orbit Garden demo server URL'
  git push origin main
fi
