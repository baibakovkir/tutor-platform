#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
TUTOR_ROOT="$(pwd -P)"
export TUTOR_ROOT
TUTOR_RELEASE="$PWD/releases/$1"
if [[ ! "$1" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || [ ! -f "$TUTOR_RELEASE/server.js" ]; then
    echo 'Invalid or missing release' >&2; exit 1
fi
mkdir -p storage/uploads backups
if [ ! -f .env ]; then
    python3 - <<'PY'
import secrets
from pathlib import Path
password=secrets.token_hex(32)
Path('.env').write_text('POSTGRES_PASSWORD='+password+'\nDATABASE_URL=postgresql://tutor:'+password+'@127.0.0.1:15440/tutor\nAUTH_SECRET='+secrets.token_hex(48)+'\nAUTH_URL=https://tutor.baibakovkir.space\nNEXT_PUBLIC_APP_URL=https://tutor.baibakovkir.space\nAUTH_TRUST_HOST=true\n')
Path('.env').chmod(0o600)
PY
fi
docker compose up -d --wait
if [ -L current ]; then bash ops/backup.sh; fi
node --env-file=.env "$TUTOR_RELEASE/migrate.cjs"
node --env-file=.env "$TUTOR_RELEASE/bootstrap.cjs"
TUTOR_OLD="$(readlink -f current || true)"
ln -sfn "$TUTOR_RELEASE" current.next
mv -Tf current.next current
# Render host-specific identity and paths only on the destination host.
TUTOR_UNITS="$(mktemp -d)"
trap 'rm -rf "$TUTOR_UNITS"' EXIT
python3 - "$TUTOR_ROOT" "$TUTOR_UNITS" "$(id -un)" "$(id -gn)" <<'PYRENDER'
import pathlib, re, sys
root, output, user, group = sys.argv[1:]
if not re.fullmatch(r"/[a-zA-Z0-9_./-]+", root):
    raise SystemExit("Install path must contain only letters, digits, _, ., / and -")
for name in ("tutor-platform.service", "tutor-platform-backup.service"):
    text = pathlib.Path("ops", name).read_text()
    for token, value in {"@TUTOR_ROOT@": root, "@TUTOR_USER@": user, "@TUTOR_GROUP@": group}.items():
        text = text.replace(token, value)
    pathlib.Path(output, name).write_text(text)
PYRENDER
sudo -n install -m 644 "$TUTOR_UNITS/tutor-platform.service" /etc/systemd/system/tutor-platform.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable tutor-platform.service
sudo -n systemctl restart tutor-platform.service
TUTOR_READY=false
for attempt in {1..20}; do
    if curl --max-time 5 -fsS http://127.0.0.1:13003/api/healthz >/dev/null; then TUTOR_READY=true; break; fi
    sleep 2
done
if [ "$TUTOR_READY" != true ]; then
    if [ -n "$TUTOR_OLD" ] && [ -d "$TUTOR_OLD" ]; then
        ln -sfn "$TUTOR_OLD" current.next
        mv -Tf current.next current
        sudo -n systemctl restart tutor-platform.service
    fi
    echo 'Deployment failed health check; previous release restored when available.' >&2
    exit 1
fi
sudo -n mkdir -p /var/www/tutor-acme
if ! sudo -n test -f /etc/letsencrypt/live/tutor.baibakovkir.space/fullchain.pem; then
    sudo -n install -m 644 ops/nginx-http.conf /etc/nginx/conf.d/tutor-platform.conf
    sudo -n nginx -t
    sudo -n systemctl reload nginx
    sudo -n certbot certonly --webroot -w /var/www/tutor-acme -d tutor.baibakovkir.space --non-interactive --agree-tos --register-unsafely-without-email
fi
sudo -n install -m 644 ops/nginx.conf /etc/nginx/conf.d/tutor-platform.conf
sudo -n nginx -t
sudo -n systemctl reload nginx
sudo -n install -m 644 "$TUTOR_UNITS/tutor-platform-backup.service" /etc/systemd/system/tutor-platform-backup.service
sudo -n install -m 644 ops/tutor-platform-backup.timer /etc/systemd/system/tutor-platform-backup.timer
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now tutor-platform-backup.timer
# Certbot runs hooks after successful renewals.
sudo -n install -m 755 ops/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/tutor-platform-reload.sh
curl --max-time 15 --resolve tutor.baibakovkir.space:443:127.0.0.1 -fsS https://tutor.baibakovkir.space/api/healthz
printf '\nPublished https://tutor.baibakovkir.space\n'
