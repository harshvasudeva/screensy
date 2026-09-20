#!/bin/bash
set -euo pipefail

if [ "${#TURN_AUTH_SECRET}" -lt 24 ]; then
    echo "TURN_AUTH_SECRET must be at least 24 characters" >&2
    exit 1
fi

umask 077
printf '%s' "${TURN_AUTH_SECRET}" > /tmp/turn-auth-secret
exec docker-entrypoint.sh --log-file=stdout --static-auth-secret-file=/tmp/turn-auth-secret
