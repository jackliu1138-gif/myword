#!/usr/bin/env bash
# Deploys Lumencraft to a server over SSH: copies remote-setup.sh up and runs it there.
# Run this from a machine that can actually reach the server (your own computer, or a cloud
# session with network access to it) — not from a sandboxed environment with restricted egress.
#
#   ./deploy.sh <host> [user] [key-file] [port] [branch]
#
# Example:
#   ./deploy.sh 49.235.163.59 ubuntu ~/.ssh/tencent.pem 8080
#
set -euo pipefail
cd "$(dirname "$0")"

HOST="${1:?usage: deploy.sh <host> [user] [key-file] [port] [branch]}"
USER="${2:-ubuntu}"
KEY="${3:-$HOME/.ssh/id_rsa}"
PORT="${4:-8080}"
BRANCH="${5:-claude/browser-minecraft-shaders-qznbst}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

echo "==> copying the setup script to $USER@$HOST"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new remote-setup.sh "$USER@$HOST:/tmp/lumencraft-setup.sh"

echo "==> running it (port $PORT, branch $BRANCH)"
$SSH "$USER@$HOST" "sudo bash /tmp/lumencraft-setup.sh $PORT $BRANCH"
