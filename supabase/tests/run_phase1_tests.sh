#!/usr/bin/env bash
# =============================================================================
# SRIK Phase 1 — local authorization test runner
# =============================================================================
# Stands up a throwaway PostgreSQL 17 instance, applies the Supabase shim and
# the Phase 1 migration, then runs the authorization test suite.
#
# Why local: the tests need superuser DDL and must never run against the remote
# project. This runner proves the migration and its RLS policies before anything
# is applied to a shared database.
#
# Usage:  ./supabase/tests/run_phase1_tests.sh
# Exit:   0 = all tests passed, non-zero = failure (safe to use in CI)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
WORKDIR="${SRIK_TEST_DIR:-/tmp/srik-phase1-test}"
PGDATA="$WORKDIR/data"
PGSOCK="$WORKDIR/sock"
PGPORT="${SRIK_TEST_PORT:-55432}"
DBNAME="srik_test"

MIGRATION="$REPO_ROOT/supabase/migrations/20261007000001_phase1_auth_authorization.sql"
SHIM="$REPO_ROOT/supabase/tests/00_local_supabase_shim.sql"
SUITE="$REPO_ROOT/supabase/tests/phase1_authorization_test.sql"

if [ ! -x "$PGBIN/initdb" ]; then
    echo "ERROR: PostgreSQL 17 binaries not found at $PGBIN" >&2
    echo "Set PGBIN, or install postgresql-17." >&2
    exit 2
fi
for f in "$MIGRATION" "$SHIM" "$SUITE"; do
    [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 2; }
done

# Run psql as an unprivileged user when we are root: PostgreSQL refuses to run
# as root, and the test server must not own the repo files.
RUNAS=""
if [ "$(id -u)" -eq 0 ]; then
    RUNAS="postgres"
    id "$RUNAS" >/dev/null 2>&1 || { echo "ERROR: no 'postgres' user" >&2; exit 2; }
fi

as_runas() {
    if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi
}

cleanup() {
    as_runas "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -m immediate stop" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Resetting test cluster at $WORKDIR"
cleanup
rm -rf "$WORKDIR"
mkdir -p "$PGDATA" "$PGSOCK" "$WORKDIR/sql"
chmod 777 "$WORKDIR"
[ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORKDIR"

# PostgreSQL will not read a data dir owned by root, so hand ownership over.
as_runas "PATH=$PGBIN:\$PATH initdb -D $PGDATA -U postgres --auth=trust" >"$WORKDIR/initdb.log" 2>&1
as_runas "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l $WORKDIR/server.log start" >/dev/null 2>&1
sleep 2

# The server runs as $RUNAS and cannot read files under a root-owned repo.
cp "$SHIM" "$MIGRATION" "$SUITE" "$WORKDIR/sql/"
chmod -R a+rX "$WORKDIR/sql"

psql_as() {
    as_runas "PATH=$PGBIN:\$PATH psql -h $PGSOCK -p $PGPORT -U postgres $1"
}

echo "==> Applying local Supabase shim"
psql_as "-d postgres -q -c 'drop database if exists $DBNAME;' -c 'create database $DBNAME;'" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/00_local_supabase_shim.sql" >/dev/null

echo "==> Applying Phase 1 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261007000001_phase1_auth_authorization.sql" >/dev/null

echo "==> Checking migration idempotency (second apply must be a no-op)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261007000001_phase1_auth_authorization.sql" >/dev/null
COUNTS="$(psql_as "-d $DBNAME -tAc \"select (select count(*) from public.permissions)||'/'||(select count(*) from public.roles)||'/'||(select count(*) from public.role_permissions);\"" | tr -d '[:space:]')"
if [ "$COUNTS" != "39/2/52" ]; then
    echo "FAIL: idempotency check — expected 39/2/52 grants, got $COUNTS" >&2
    exit 1
fi
echo "    ok: 39 permissions, 2 roles, 52 role grants after re-apply"

echo "==> Running authorization test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase1_authorization_test.sql" 2>&1)"
echo "$OUTPUT" | grep -E "PASS|FAIL|ERROR|====" | sed 's/.*NOTICE:  //;s/psql:[^ ]*ERROR:  /ERROR: /' || true

if echo "$OUTPUT" | grep -q "ALL PHASE 1 AUTHORIZATION TESTS PASSED"; then
    echo ""
    echo "RESULT: PASS"
    exit 0
else
    echo ""
    echo "RESULT: FAIL" >&2
    exit 1
fi
