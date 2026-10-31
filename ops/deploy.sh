#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TUTOR_TARGET="${TUTOR_TARGET:-user@176.123.163.174}"
TUTOR_VERSION="$(date -u +%Y%m%dT%H%M%SZ)"
if [ "${1:-}" != "--prepared" ]; then npm run build; fi
node ops/package.mjs
tar -C .release -czf "/tmp/tutor-release-$TUTOR_VERSION.tar.gz" .
ssh -F /dev/null "$TUTOR_TARGET" "mkdir -p /home/user/tutor-platform/releases/$TUTOR_VERSION /home/user/tutor-platform/ops"
scp -F /dev/null "/tmp/tutor-release-$TUTOR_VERSION.tar.gz" "$TUTOR_TARGET:/home/user/tutor-platform/releases/$TUTOR_VERSION.tar.gz"
scp -F /dev/null compose.yaml "$TUTOR_TARGET:/home/user/tutor-platform/compose.yaml"
scp -F /dev/null ops/deploy-remote.sh ops/backup.sh ops/nginx.conf ops/nginx-http.conf ops/tutor-platform.service ops/tutor-platform-backup.service ops/tutor-platform-backup.timer ops/reload-nginx.sh "$TUTOR_TARGET:/home/user/tutor-platform/ops/"
ssh -F /dev/null "$TUTOR_TARGET" "tar -xzf /home/user/tutor-platform/releases/$TUTOR_VERSION.tar.gz -C /home/user/tutor-platform/releases/$TUTOR_VERSION && rm /home/user/tutor-platform/releases/$TUTOR_VERSION.tar.gz && bash /home/user/tutor-platform/ops/deploy-remote.sh $TUTOR_VERSION"
rm "/tmp/tutor-release-$TUTOR_VERSION.tar.gz"
