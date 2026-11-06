#!/usr/bin/env bash
# Bring up the development stack: PostgreSQL, then the Next dev server.
#
# Written for a container that has PostgreSQL installed but no running cluster
# and no Docker daemon — it initialises the cluster on first run and is safe to
# re-run. On a machine with Docker, `docker compose up -d` is the primary path
# and this script is unnecessary.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/postgresql/marketplace}
PGPORT=${PGPORT:-5432}
DB=${POSTGRES_DB:-marketplace_dev}

if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "No PostgreSQL at $PGBIN. Set PGBIN, or use docker compose up -d." >&2
  exit 1
fi

mkdir -p "$PGDATA" /var/run/postgresql
chown -R postgres:postgres "$PGDATA" /var/run/postgresql 2>/dev/null || true

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "· initialising the cluster"
  su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/tmp/initdb.log 2>&1
fi

if su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  echo "· postgres already running"
else
  echo "· starting postgres on :$PGPORT"
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k /var/run/postgresql -c listen_addresses=127.0.0.1' -l /tmp/pg.log start" >/dev/null
  sleep 2
fi

su postgres -c "psql -h 127.0.0.1 -p $PGPORT -U postgres -c \"ALTER USER postgres PASSWORD 'postgres'\"" >/dev/null 2>&1 || true
su postgres -c "psql -h 127.0.0.1 -p $PGPORT -U postgres -c 'CREATE DATABASE $DB'" >/dev/null 2>&1 || true

echo "· applying migrations"
npx prisma migrate deploy >/dev/null

if [ "${1:-}" = "--with-dev-server" ]; then
  echo "· starting next dev on :3000"
  npm run dev
else
  echo "· ready. Run: npm run dev"
fi
