#!/usr/bin/env bash
# Gives the villagers their language model: writes the API key (and, if given, another endpoint or
# model) where only root can read it, restarts the game, and asks a villager something to show the
# model answers. The key never goes into the repository, the game's files or anyone's browser.
#
#   sudo ATRIA_API_KEY=atr_xxx bash set-llm-key.sh                    (ATRIA, international endpoint)
#   sudo ATRIA_API_KEY=xxx LLM_BASE_URL=https://discovery-api.intern-ai.org.cn/v1 bash set-llm-key.sh
#                                                                     (ATRIA, mainland China endpoint)
#   sudo bash set-llm-key.sh                                          (asks for the key, hidden)
#   sudo bash set-llm-key.sh --remove                                 (back to scripted villagers)
#
# Optional: LLM_MODEL (default Atria-Dawn-Preview), LLM_REASONING (none | low | medium | high;
# default none: the quickest answers), LLM_RPM / LLM_DAILY (requests a minute / a day).
set -euo pipefail

DIR=/etc/lumencraft
FILE="$DIR/secrets.env"
PORT="${LUMENCRAFT_PORT:-8080}"

if [ "$(id -u)" -ne 0 ]; then
  echo "run this with sudo" >&2
  exit 1
fi
mkdir -p "$DIR"
chmod 700 "$DIR"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$FILE"
  echo "key removed: villagers go back to simple scripted talk"
else
  KEY="${ATRIA_API_KEY:-${1:-}}"
  if [ -z "$KEY" ]; then
    read -r -s -p "API key: " KEY
    echo
  fi
  if [ -z "$KEY" ]; then
    echo "no key given" >&2
    exit 1
  fi
  umask 077
  {
    echo "ATRIA_API_KEY=$KEY"
    for v in LLM_BASE_URL LLM_MODEL LLM_REASONING LLM_RPM LLM_DAILY; do
      if [ -n "${!v:-}" ]; then echo "$v=${!v}"; fi
    done
  } > "$FILE"
  chmod 600 "$FILE"
  echo "key saved to $FILE (${#KEY} characters)"
fi

systemctl restart lumencraft
sleep 2
echo "the game says its villagers are: $(curl -fsS "http://127.0.0.1:$PORT/lumen-server.json" | sed -n 's/.*"ai":"\([a-z]*\)".*/\1/p')"
if [ -s "$FILE" ]; then
  # one question to a villager: offline:false means the model answered
  ANSWER="$(curl -fsS -m 60 -X POST "http://127.0.0.1:$PORT/api/talk" -H 'Content-Type: application/json' \
    -d '{"u":"probe.check","j":"farmer","l":"zh","name":"管理员","x":"你好！你是谁呀？","day":0}' || true)"
  echo "a villager answers: $ANSWER"
  case "$ANSWER" in
    *'"offline":false'*) echo "OK: the language model is answering" ;;
    *) echo "the model did not answer (wrong key or endpoint?): see journalctl -u lumencraft -n 20" ;;
  esac
fi
