#!/usr/bin/env bash
# Update the running server to the latest code on main. Run from the project folder:
#
#   bash scripts/update.sh                # pull + rebuild + restart
#   bash scripts/update.sh --reindex      # …and rebuild the notes index
#   bash scripts/update.sh --codeforces   # …and re-import Codeforces problems
set -euo pipefail
cd "$(dirname "$0")/.."

# Use docker directly when this user may (setup-server.sh arranges that), else fall back to sudo.
if docker info >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi
COMPOSE="$DOCKER compose -f docker-compose.prod.yml"

git pull --ff-only origin main
$COMPOSE up -d --build --remove-orphans

for arg in "$@"; do
  case "$arg" in
    --reindex)
      until $COMPOSE exec -T postgres pg_isready -U rag -d rag_db >/dev/null 2>&1; do sleep 2; done
      $COMPOSE exec -T app python ingest.py
      if [ -n "$(ls -A private-notes 2>/dev/null)" ]; then
        $COMPOSE exec -T app python ingest.py private-notes --append
      fi
      ;;
    --codeforces)
      $COMPOSE exec -T app python -m corpus.codeforces --max-rating 2000
      ;;
  esac
done

$DOCKER image prune -f >/dev/null   # free disk space from old builds
echo "Updated."
