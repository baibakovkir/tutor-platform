#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep the SSH destination in the caller's environment or private SSH config.
: "${TUTOR_TARGET:?Set TUTOR_TARGET to your private SSH host alias}"
TUTOR_REMOTE_ROOT="${TUTOR_REMOTE_ROOT:-tutor-platform}"
if [[ "$TUTOR_TARGET" == -* || "$TUTOR_TARGET" =~ [[:space:]] ]] || [[ ! "$TUTOR_REMOTE_ROOT" =~ ^[a-zA-Z0-9_./-]+$ ]] || [[ "$TUTOR_REMOTE_ROOT" == -* ]]; then
    echo 'Invalid SSH target or remote directory' >&2; exit 1
fi
TUTOR_VERSION="$(date -u +%Y%m%dT%H%M%SZ)"
if [ "${1:-}" != "--prepared" ]; then npm run build; fi
node ops/package.mjs
tar -C .release -czf "/tmp/tutor-release-$TUTOR_VERSION.tar.gz" .
ssh "$TUTOR_TARGET" "mkdir -p $TUTOR_REMOTE_ROOT/releases/$TUTOR_VERSION $TUTOR_REMOTE_ROOT/ops"
scp "/tmp/tutor-release-$TUTOR_VERSION.tar.gz" "$TUTOR_TARGET:$TUTOR_REMOTE_ROOT/releases/$TUTOR_VERSION.tar.gz"
scp compose.yaml "$TUTOR_TARGET:$TUTOR_REMOTE_ROOT/compose.yaml"
scp ops/deploy-remote.sh ops/backup.sh ops/nginx.conf ops/nginx-http.conf ops/tutor-platform.service ops/tutor-platform-backup.service ops/tutor-platform-backup.timer ops/reload-nginx.sh "$TUTOR_TARGET:$TUTOR_REMOTE_ROOT/ops/"
ssh "$TUTOR_TARGET" "tar -xzf $TUTOR_REMOTE_ROOT/releases/$TUTOR_VERSION.tar.gz -C $TUTOR_REMOTE_ROOT/releases/$TUTOR_VERSION && rm $TUTOR_REMOTE_ROOT/releases/$TUTOR_VERSION.tar.gz && bash $TUTOR_REMOTE_ROOT/ops/deploy-remote.sh $TUTOR_VERSION"
rm "/tmp/tutor-release-$TUTOR_VERSION.tar.gz"
