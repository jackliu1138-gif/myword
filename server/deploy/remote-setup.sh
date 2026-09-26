#!/usr/bin/env bash
# Sets up (or updates) Lumencraft on this server: installs Node.js if it's missing, fetches the
# game, builds the single-file bundle, installs it as a systemd service, and (best effort) adds a
# card for it to an existing static "game hub" nginx site if one is found. Meant to be copied to
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
CARD_MARKER="lumencraft-card"

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

# ---------------------------------------------------------------- game hub card (best effort)
# Looks for an nginx site whose index.html has a "gameGrid" of game cards (our own convention,
# matched loosely) and, if found, inserts a card linking to this game. Never fatal: the service
# above is already up regardless of whether this succeeds.
HUB_ADDED=0
HUB_ROOT=""
if command -v nginx >/dev/null; then
  HUB_ROOT="$(nginx -T 2>/dev/null | awk '
    /server[ \t]*\{/ { in_server=1; root="" }
    in_server && /listen[ \t]+[^;]*:?1777/ { listens=1 }
    in_server && /root[ \t]+/ { gsub(";", ""); root=$2 }
    in_server && /\}/ { if (listens && root) { print root; exit } in_server=0; listens=0 }
  ')"
fi
if [ -n "$HUB_ROOT" ] && [ -f "$HUB_ROOT/index.html" ] && grep -q 'gameGrid' "$HUB_ROOT/index.html" 2>/dev/null; then
  if grep -q "$CARD_MARKER" "$HUB_ROOT/index.html"; then
    echo "==> the game hub at $HUB_ROOT already has a Lumencraft card, leaving it alone"
    HUB_ADDED=1
  else
    echo "==> found a game hub at $HUB_ROOT, adding a card for Lumencraft"
    cp "$HUB_ROOT/index.html" "$HUB_ROOT/index.html.bak-$(date +%s)"
    if [ -d "$HUB_ROOT/assets/hub" ]; then
      cat > "$HUB_ROOT/assets/hub/lumencraft.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="光影方块世界">
  <defs>
    <linearGradient id="lcSky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#2a2350"/>
      <stop offset=".45" stop-color="#e07a4a"/>
      <stop offset=".62" stop-color="#ffd95c"/>
      <stop offset=".63" stop-color="#215a4e"/>
      <stop offset="1" stop-color="#0f3a34"/>
    </linearGradient>
    <linearGradient id="lcWater" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffd95c" stop-opacity=".85"/>
      <stop offset="1" stop-color="#0c2e2a" stop-opacity=".9"/>
    </linearGradient>
    <filter id="lcShadow" x="-30%" y="-30%" width="180%" height="180%">
      <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#08130f" flood-opacity=".45"/>
    </filter>
  </defs>
  <rect width="640" height="360" fill="url(#lcSky)"/>
  <circle cx="150" cy="120" r="46" fill="#ffe9a8"/>
  <circle cx="150" cy="120" r="46" fill="#ffd95c" opacity=".55"/>
  <rect x="0" y="227" width="640" height="133" fill="url(#lcWater)"/>
  <g transform="translate(60 150)" filter="url(#lcShadow)">
    <g transform="skewY(-17)">
      <path d="M0 128 L252 72 L414 158 L150 230 Z" fill="#173327"/>
      <path d="M0 88 L252 32 L414 118 L150 190 Z" fill="#2f6a3f"/>
      <path d="M0 88 L150 190 L150 230 L0 128 Z" fill="#3c2a1e"/>
      <path d="M150 190 L414 118 L414 158 L150 230 Z" fill="#28190f"/>
    </g>
    <g transform="translate(150 32)">
      <path d="M0 0 L58 -14 L96 8 L36 25 Z" fill="#ffb15c"/>
      <path d="M0 0 L36 25 L36 67 L0 42 Z" fill="#5a3c22"/>
      <path d="M36 25 L96 8 L96 49 L36 67 Z" fill="#3c2814"/>
    </g>
  </g>
  <g transform="translate(340 176)" filter="url(#lcShadow)">
    <path d="M0 40 L64 12 L128 40 L64 68 Z" fill="#7ecbe8"/>
    <path d="M0 40 L64 68 L64 108 L0 80 Z" fill="#4a9fc4"/>
    <path d="M64 68 L128 40 L128 80 L64 108 Z" fill="#357c9c"/>
  </g>
  <g fill="#ffe9a8" opacity=".9">
    <circle cx="470" cy="70" r="2.6"/>
    <circle cx="510" cy="46" r="2"/>
    <circle cx="440" cy="52" r="1.8"/>
    <circle cx="560" cy="90" r="2.4"/>
  </g>
</svg>
SVG
    fi
    IMG_TAG="<img class=\"gameThumb\" src=\"./assets/hub/lumencraft.svg\" alt=\"光影方块世界\">"
    [ -f "$HUB_ROOT/assets/hub/lumencraft.svg" ] || IMG_TAG=""
    CARD=$(cat <<CARDEOF
        <a class="gameCard" href="http://$IP:$PORT/" target="_blank" rel="noopener"><!-- $CARD_MARKER -->
          <span class="preview">
            $IMG_TAG
          </span>
          <span class="gameInfo">
            <strong>光影方块世界</strong>
            <span>写实光影 · 联机生存语音</span>
          </span>
          <span class="play">进入</span>
        </a>
CARDEOF
    )
    awk -v card="$CARD" '
      /class="gameGrid"/ { ingrid=1 }
      ingrid && /<\/section>/ && !done { print card; done=1 }
      { print }
    ' "$HUB_ROOT/index.html" > "$HUB_ROOT/index.html.new" && mv "$HUB_ROOT/index.html.new" "$HUB_ROOT/index.html"
    if grep -q "$CARD_MARKER" "$HUB_ROOT/index.html"; then
      HUB_ADDED=1
      echo "    card added (a .bak copy of the old index.html sits next to it)"
    else
      echo "    could not find where to insert the card automatically; left index.html untouched"
      mv "$HUB_ROOT"/index.html.bak-* "$HUB_ROOT/index.html" 2>/dev/null || true
    fi
  fi
else
  echo "==> no local game hub matching our convention was found; skipping that step"
  echo "    (this is fine — the game still runs on its own at the address below)"
fi

echo
echo "==> Lumencraft is running: http://$IP:$PORT/"
[ "$HUB_ADDED" = 1 ] && echo "    and a card for it was added to the game hub"
echo "    (open TCP port $PORT in the cloud console's security group if it's not reachable)"
