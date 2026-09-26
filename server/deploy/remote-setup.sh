#!/usr/bin/env bash
# Sets up (or updates) Lumencraft on this server: installs Node.js if it's missing, fetches the
# game, builds the single-file bundle, and installs it as a systemd service. Meant to be copied to
# the server and run there (server/deploy/deploy.sh does that over SSH); can also be run by hand:
#
#   sudo bash remote-setup.sh [port] [branch] [repo-url]
#
set -euo pipefail

PORT="${1:-8080}"
BRANCH="${2:-claude/browser-minecraft-shaders-qznbst}"
REPO="${3:-https://github.com/jackliu1138-gif/myword.git}"
APP_DIR="/opt/games/lumencraft"
SERVICE_USER="${SUDO_USER:-$(id -un)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "run this with sudo: sudo bash remote-setup.sh $PORT $BRANCH" >&2
  exit 1
fi

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -v | sed 's/^v//;s/\..*//')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> fetching Lumencraft (branch $BRANCH)"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R "$SERVICE_USER" "$APP_DIR"

echo "==> building"
sudo -u "$SERVICE_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund && npm run build"

echo "==> systemd service (port $PORT)"
cat > /etc/systemd/system/lumencraft.service <<EOF
[Unit]
Description=Lumencraft multiplayer server
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) server/server.mjs
Restart=on-failure
RestartSec=3
Environment=PORT=$PORT
Environment=SERVER_NAME=Lumencraft

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now lumencraft
sleep 1
systemctl --no-pager status lumencraft | head -8

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp || true
fi

IP="$(curl -fsS -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "==> done: http://$IP:$PORT/"
echo "    (also remember to open TCP port $PORT in the cloud console's security group)"
