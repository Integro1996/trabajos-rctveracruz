#!/bin/sh
# Run on the Linux VPS from any directory. Brief maintenance window required.
set -eu
umask 077
cd "$(dirname "$0")/.."
env_file=${VPS_ENV_FILE:-.env.vps}
compose() { docker compose --env-file "$env_file" -f compose.vps.yml "$@"; }
for service in web api db; do
    if [ -z "$(compose ps --status running -q "$service")" ]; then
        echo "Backup requires running service: $service" >&2
        exit 1
    fi
done
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="backups/$stamp"
mkdir "$target.partial"
resume() { compose start api web >&2; }
trap resume EXIT
trap 'exit 1' HUP INT TERM
# Drain requests before copying the database and private files together.
compose stop -t 160 web api
compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' > "$target.partial/database.sql"
compose run --rm --no-deps -T --entrypoint tar api czf - -C /srv/private . > "$target.partial/private-storage.tar.gz"
test -s "$target.partial/database.sql"
test -s "$target.partial/private-storage.tar.gz"
(cd "$target.partial" && sha256sum database.sql private-storage.tar.gz > SHA256SUMS)
mv "$target.partial" "$target"
echo "Backup complete: $target (copy it off the VPS)."
