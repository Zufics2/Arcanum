#!/usr/bin/env bash
# Runs Arcanum in Docker and exposes it through a Cloudflare quick tunnel:
# a public https://<random>.trycloudflare.com address, free, no account needed.
# HTTPS is required: browsers only allow Web Crypto (crypto.subtle) in secure contexts.
set -euo pipefail
cd "$(dirname "$0")/.."

# Docker Desktop does not always put its CLI on PATH.
if ! command -v docker >/dev/null 2>&1; then
  if [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  else
    echo "Docker не найден. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
    exit 1
  fi
fi
docker info >/dev/null 2>&1 || { echo "Docker не запущен: откройте Docker Desktop и повторите." >&2; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { echo "Не найден cloudflared. Установите: brew install cloudflared" >&2; exit 1; }
[ -f .env ] || { echo "Нет файла .env: cp .env.example .env и заполните SECRET_KEY и POSTGRES_PASSWORD." >&2; exit 1; }

PORT="$(grep -E '^HTTP_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-80}"

echo "▶ Собираем и запускаем контейнеры…"
docker compose up -d --build

echo "▶ Ждём, пока бэкенд будет готов…"
for _ in $(seq 1 90); do
  curl -fs "http://localhost:${PORT}/api/health/" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://localhost:${PORT}/api/health/" >/dev/null 2>&1 || {
  echo "Бэкенд не ответил. Смотрите логи: docker compose logs backend" >&2
  exit 1
}

cat <<MSG

✔ Arcanum работает на http://localhost:${PORT}
▶ Открываем туннель. Публичный адрес https://….trycloudflare.com появится ниже.
  Ctrl+C закрывает туннель; контейнеры продолжат работать (остановить: docker compose down).

MSG
exec cloudflared tunnel --url "http://localhost:${PORT}"
