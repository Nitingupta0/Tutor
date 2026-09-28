#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu server (e.g. AWS EC2). Run from the project folder:
#
#   bash scripts/setup-server.sh
#
# Installs Docker, adds swap memory, creates .env (asking for your Groq key and domain;
# the database password is generated here and never leaves the server), starts everything,
# and fills the database. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="sudo docker compose -f docker-compose.prod.yml"
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

step "Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "Docker already installed."
fi

step "Adding 2 GB of swap memory (helps a small server)"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "Swap already set up."
fi

step "Creating .env"
if [ -f .env ]; then
  echo ".env already exists — keeping it."
else
  read -rp "Paste your Groq API key: " groq_key </dev/tty
  read -rp "Your domain (e.g. tutor-nitin.duckdns.org), or press Enter to use the IP address: " domain </dev/tty
  umask 077
  cat > .env <<EOF
GROQ_API_KEY=${groq_key}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SITE_ADDRESS=${domain:-:80}
EOF
  echo "Saved. The database password was generated randomly."
fi
mkdir -p private-notes

step "Building and starting (the first time takes about 5–10 minutes)"
$COMPOSE up -d --build

step "Waiting for the database"
until $COMPOSE exec -T postgres pg_isready -U rag -d rag_db >/dev/null 2>&1; do sleep 2; done

step "Filling the database with the bundled notes"
$COMPOSE exec -T app python ingest.py

if [ -n "$(ls -A private-notes 2>/dev/null)" ]; then
  step "Adding your own notes from private-notes/"
  $COMPOSE exec -T app python ingest.py private-notes --append
fi

step "Importing Codeforces problems for Fetch mode"
$COMPOSE exec -T app python -m corpus.codeforces --max-rating 2000 \
  || echo "Codeforces import failed (their API may be busy). Re-run later with: bash scripts/update.sh --codeforces"

address=$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)
if [ "$address" = ":80" ] || [ -z "$address" ]; then
  ip=$(curl -fsS --max-time 5 https://checkip.amazonaws.com || echo "<your-server-ip>")
  url="http://${ip}"
else
  url="https://${address}"
fi
step "Done! Open ${url}"
