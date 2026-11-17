#!/usr/bin/env bash
# Slagpit game server deploy to the dev server. Build on this Mac -> send the build -> install the
# Node runtime and dependencies in the install folder on the server -> restart.
# Usage: deploy/dev/deploy_server.sh
# The server has no Node.js, so the official build sits inside the install folder (as the
# monwar ops-tool deploy does). The user has no systemd user session there (no linger), so the
# server runs under a small restart loop started with nohup; the deploy stops and starts it.
# The page and the WebSocket share one port over HTTPS, as https://ai-games-qa.qpyou.cn:2201 (the *.qpyou.cn
# certificate). The certificate and key sit in ${install}/tls, copied there by someone with sudo from
# /data/ssl/nodejs (key 600, owned by the deploy user); the server reads them only at start, so after a
# renewal copy them again and rerun this script. Port 443 needs root, so the game keeps its own port.
set -euo pipefail

remote_host=jinseungim@43.133.250.99
port=2201
install=/home/jinseungim/slagpit
node_version=v24.22.3
domain=ai-games-qa.qpyou.cn
root="$(cd "$(dirname "$0")/../.." && pwd)"

remote() { ssh -o BatchMode=yes -o ConnectTimeout=10 "${remote_host}" "$@"; }
# A shell that reads no start files, so set -e scripts run as written.
remote_script() { remote 'bash --norc --noprofile -s'; }
sync_files() { rsync -az -e "ssh -o BatchMode=yes -o ConnectTimeout=10" "$@"; }

echo "== build =="
(cd "${root}" && npm run build > /dev/null && npm run build:server > /dev/null)

echo "== runtime =="
remote_script <<SH
set -e
[ -r ${install}/tls/cert.pem ] && [ -r ${install}/tls/key.pem ] || { echo "No certificate in ${install}/tls: copy it from /data/ssl/nodejs first." >&2; exit 1; }
mkdir -p ${install}/dist ${install}/server-dist ${install}/logs
cd ${install}
if [ "\$(node/bin/node --version 2>/dev/null)" != "${node_version}" ]; then
  tmp=\$(mktemp -d .node.XXXXXX)
  trap 'rm -rf "${install}/\$tmp"' EXIT
  file=node-${node_version}-linux-x64.tar.gz
  curl -fsS --max-time 300 -o "\$tmp/\$file" https://nodejs.org/dist/${node_version}/\$file
  curl -fsS --max-time 30 https://nodejs.org/dist/${node_version}/SHASUMS256.txt | grep " \$file\\\$" > "\$tmp/sum"
  (cd "\$tmp" && sha256sum --quiet -c sum)
  mkdir "\$tmp/node"
  tar -xzf "\$tmp/\$file" -C "\$tmp/node" --strip-components=1
  rm -rf node
  mv "\$tmp/node" node
fi
node/bin/node --version
SH

echo "== files =="
sync_files "${root}/package.json" "${root}/package-lock.json" "${remote_host}:${install}/"
sync_files --delete "${root}/dist/" "${remote_host}:${install}/dist/"
sync_files --delete "${root}/server-dist/" "${remote_host}:${install}/server-dist/"

echo "== dependencies =="
remote_script <<SH
set -e
cd ${install}
export PATH="${install}/node/bin:\$PATH"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
SH

echo "== restart =="
remote_script <<SH
set -e
cd ${install}
if [ -f run.pid ] && kill -0 "\$(cat run.pid)" 2>/dev/null; then
  pkill -P "\$(cat run.pid)" 2>/dev/null || true
  kill "\$(cat run.pid)" 2>/dev/null || true
fi
cat > run.sh <<'RUN'
#!/usr/bin/env bash
# Keeps the game server up: restarts it two seconds after it stops.
cd "\$(dirname "\$0")"
while true; do
  PORT=${port} DIST=${install}/dist TLS_CERT_FILE=${install}/tls/cert.pem TLS_KEY_FILE=${install}/tls/key.pem \\
    node/bin/node server-dist/server.js >> logs/server.out 2>&1
  echo "\$(date -u +%FT%TZ) server stopped (\$?), restarting" >> logs/server.out
  sleep 2
done
RUN
chmod +x run.sh
nohup ./run.sh > /dev/null 2>&1 < /dev/null &
echo \$! > run.pid
SH

python3 -c "import time; time.sleep(3)"

echo "== check =="
remote "ss -ltn | grep -E ':${port} ' | awk '{print \$4}'
curl -s -o /dev/null -w 'GET / %{http_code}\n' --max-time 5 --resolve ${domain}:${port}:127.0.0.1 https://${domain}:${port}/
tail -2 ${install}/logs/server.out | cut -c1-200"
echo "Play: https://${domain}:${port}/"
