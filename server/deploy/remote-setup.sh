#!/usr/bin/env bash
# Sets up (or updates) Lumencraft on this server: installs Node.js if it's missing, fetches the
# game, builds the single-file bundle, installs it as a systemd service, and — when an nginx site
# matching our "game hub" convention is found — serves it from there too, at ./games/lumencraft/
# alongside the hub's other games on the SAME port, with only /ws and /lumen-server.json proxied
# back to this game's own process. No hub found: falls back to serving directly on its own port.
# Meant to be copied to the server and run there (server/deploy/deploy.sh does that over SSH); can
# also be run by hand:
#
#   sudo bash remote-setup.sh [port] [branch] [repo-url]
#
set -euo pipefail

PORT="${1:-${LUMENCRAFT_PORT:-8080}}"
BRANCH="${2:-${LUMENCRAFT_BRANCH:-claude/browser-minecraft-shaders-qznbst}}"
REPO="${3:-${LUMENCRAFT_REPO:-https://github.com/jackliu1138-gif/myword.git}}"
APP_DIR="/opt/games/lumencraft"
SERVICE_USER="${SUDO_USER:-$(id -un)}"
CARD_MARKER="lumencraft-card"
WS_MARKER="games/lumencraft/ws"
GAME_PATH="games/lumencraft"
LOG="/var/log/lumencraft-deploy.log"

if [ "$(id -u)" -ne 0 ]; then
  echo "run this with sudo: sudo bash remote-setup.sh $PORT $BRANCH" >&2
  exit 1
fi

: > "$LOG"
echo "full output of every command below is also kept in $LOG"

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -v | sed 's/^v//;s/\..*//')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >>"$LOG" 2>&1
  apt-get install -y nodejs >>"$LOG" 2>&1
fi
node -v

echo "==> fetching Lumencraft (branch $BRANCH)"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" >>"$LOG" 2>&1
  git -C "$APP_DIR" checkout "$BRANCH" >>"$LOG" 2>&1
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" >>"$LOG" 2>&1
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR" >>"$LOG" 2>&1
fi
chown -R "$SERVICE_USER" "$APP_DIR"
echo "    $(git -C "$APP_DIR" log -1 --format='%h %s')"

echo "==> building (npm install + build; a minute or two)"
# esbuild (needed to build) is the project's only dependency, and it's listed as a devDependency
# (the built game itself has none at runtime) — so this must NOT use --omit=dev.
sudo -u "$SERVICE_USER" bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund && npm run build" >>"$LOG" 2>&1
tail -3 "$LOG"

# ---------------------------------------------------------------- the game's own service
# Starts bound to every interface first, so the game is reachable on its own port right away
# regardless of what the hub-integration step below finds; if that step fully succeeds, it tightens
# this to loopback-only at the end (nginx becomes the only way in, on the hub's existing port).
write_service() {
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
Environment=HOST=$1
Environment=SERVER_NAME=Lumencraft

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

echo "==> systemd service (port $PORT)"
write_service 0.0.0.0
systemctl enable --now lumencraft
sleep 1
systemctl --no-pager status lumencraft | head -8

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp || true
fi

IP="$(curl -fsS -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"

# ---------------------------------------------------------------- game hub integration (best effort)
# Looks for an nginx site listening on 1777 whose index.html has a "gameGrid" of game cards (our
# own convention, matched loosely) and, if found: copies the built game into its games/lumencraft/
# folder, proxies just its two dynamic endpoints back to this service, and adds a card for it.
# Never fatal and always leaves a working nginx config: every edit is validated with `nginx -t`
# before it's kept, and reverted otherwise — the systemd service above is already reachable on its
# own port either way.
HUB_DONE=0
HUB_CONF=""
if command -v nginx >/dev/null; then
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -f "$f" ] || continue
    if grep -Eq 'listen[ \t]+([^;]*:)?1777([ \t]|;)' "$f"; then HUB_CONF="$f"; break; fi
  done
fi
if [ -n "$HUB_CONF" ]; then
  HUB_ROOT="$(grep -m1 -E '^\s*root[ \t]' "$HUB_CONF" | awk '{gsub(";", "", $2); print $2}')"
fi
if [ -n "${HUB_ROOT:-}" ] && [ -f "$HUB_ROOT/index.html" ] && grep -q 'gameGrid' "$HUB_ROOT/index.html" 2>/dev/null; then
  echo "==> found a game hub at $HUB_ROOT (nginx site: $HUB_CONF)"

  echo "    copying the built game to $HUB_ROOT/$GAME_PATH/"
  mkdir -p "$HUB_ROOT/$GAME_PATH"
  cp -r "$APP_DIR/dist/." "$HUB_ROOT/$GAME_PATH/"

  if grep -q "$WS_MARKER" "$HUB_CONF"; then
    echo "    the nginx site already proxies this game's endpoints, leaving it alone"
    NGINX_OK=1
  else
    NGINX_OK=0
    NGINX_BAK="$HUB_CONF.bak-$(date +%s)"
    cp "$HUB_CONF" "$NGINX_BAK"
    LOCS="$(mktemp)"
    trap 'rm -f "$LOCS"' EXIT
    cat > "$LOCS" <<EOF
    location = /$GAME_PATH/ {
        try_files /$GAME_PATH/index.html =404;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
    }

    location = /$GAME_PATH/index.html {
        try_files \$uri =404;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
    }

    location = /$GAME_PATH/ws {
        proxy_pass http://127.0.0.1:$PORT/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }

    location = /$GAME_PATH/lumen-server.json {
        proxy_pass http://127.0.0.1:$PORT/lumen-server.json;
        proxy_set_header Host \$host;
    }
EOF
    # inserted just before the closing brace of the specific server{} block that listens on 1777,
    # tracking brace depth so it lands in the right place regardless of what else is in the file
    awk -v addfile="$LOCS" '
      BEGIN { depth = 0; sawListen = 0; done = 0 }
      {
        o = gsub(/\{/, "{", $0); c = gsub(/\}/, "}", $0)
        newDepth = depth + o - c
        if ($0 ~ /listen[ \t]+([^;]*:)?1777([ \t]|;)/ && depth >= 1) sawListen = 1
        if (newDepth == 0 && depth >= 1 && sawListen && !done) {
          while ((getline line < addfile) > 0) print line
          close(addfile)
          done = 1
        }
        print $0
        depth = newDepth
      }
    ' "$HUB_CONF" > "$HUB_CONF.new"
    cp "$HUB_CONF.new" "$HUB_CONF"
    rm -f "$HUB_CONF.new"
    if nginx -t >>"$LOG" 2>&1; then
      systemctl reload nginx
      echo "    added /$GAME_PATH/ws and /$GAME_PATH/lumen-server.json to $HUB_CONF (backup: $NGINX_BAK)"
      NGINX_OK=1
    else
      echo "    the edited nginx config didn't pass 'nginx -t'; restoring the original (see $LOG)"
      cp "$NGINX_BAK" "$HUB_CONF"
      nginx -t >>"$LOG" 2>&1 && systemctl reload nginx || true
    fi
  fi

  if [ "$NGINX_OK" = 1 ]; then
    HUB_DONE=1
    echo "    switching the service to listen on 127.0.0.1 only (nginx is now the only way in)"
    write_service 127.0.0.1
    systemctl restart lumencraft
    sleep 1
  fi

  if [ "$HUB_DONE" = 1 ]; then
    echo "    adding a card for it to the hub (replacing any earlier one first, so re-running this always leaves the current version)"
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
    CARD="$(mktemp)"
    cat > "$CARD" <<CARDEOF
        <a class="gameCard" href="./$GAME_PATH/"><!-- $CARD_MARKER -->
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
    awk -v addfile="$CARD" -v marker="$CARD_MARKER" '
      BEGIN { skip = 0 }
      index($0, marker) { skip = 1; next }
      skip && /<\/a>/ { skip = 0; next }
      skip { next }
      /class="gameGrid"/ { ingrid=1 }
      ingrid && /<\/section>/ && !done { while ((getline line < addfile) > 0) print line; close(addfile); done=1 }
      { print }
    ' "$HUB_ROOT/index.html" > "$HUB_ROOT/index.html.new"
    rm -f "$CARD"
    if grep -q "$CARD_MARKER" "$HUB_ROOT/index.html.new"; then
      mv "$HUB_ROOT/index.html.new" "$HUB_ROOT/index.html"
      echo "    card added (a .bak copy of the previous index.html sits next to it)"
    else
      rm -f "$HUB_ROOT/index.html.new"
      echo "    could not find where to insert the card automatically; left index.html untouched"
    fi
  fi
elif command -v nginx >/dev/null; then
  echo "==> no local game hub matching our convention was found; running Lumencraft on its own port"
else
  echo "==> nginx isn't installed here; running Lumencraft on its own port"
fi

echo
if [ "$HUB_DONE" = 1 ]; then
  echo "==> Lumencraft is running at http://$IP:1777/$GAME_PATH/ (added to the game hub there)"
else
  echo "==> Lumencraft is running: http://$IP:$PORT/"
  echo "    (open TCP port $PORT in the cloud console's security group if it's not reachable)"
fi
