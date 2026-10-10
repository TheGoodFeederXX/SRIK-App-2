#!/usr/bin/env bash
# =============================================================================
# SRIK Phase 3 — local timetable and attendance test runner
# =============================================================================
# Stands up a throwaway PostgreSQL 17 instance, applies the Supabase shim, then
# Phases 1, 2 and 3 in order, and runs the timetable/attendance test suite.
#
# The earlier migrations are applied first because Phase 3 depends on them: the
# authorization helpers and the academic core (classes, subjects, enrollments,
# teaching assignments) are all referenced by the new tables and RPCs. This
# runner therefore also proves the three migrations compose in the intended
# order.
#
# Why local: the tests need superuser DDL and must never run against the remote
# project.
#
# Usage:  ./supabase/tests/run_phase3_tests.sh
# Exit:   0 = all tests passed, non-zero = failure (safe to use in CI)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
WORKDIR="${SRIK_TEST_DIR:-/tmp/srik-phase3-test}"
PGDATA="$WORKDIR/data"
PGSOCK="$WORKDIR/sock"
PGPORT="${SRIK_TEST_PORT:-55434}"
DBNAME="srik_phase3_test"

MIGRATION_P1="$REPO_ROOT/supabase/migrations/20261007000001_phase1_auth_authorization.sql"
MIGRATION_P2="$REPO_ROOT/supabase/migrations/20261008000001_phase2_academic_core.sql"
MIGRATION_P3="$REPO_ROOT/supabase/migrations/20261010000001_phase3_timetable_attendance.sql"
SHIM="$REPO_ROOT/supabase/tests/00_local_supabase_shim.sql"
SUITE="$REPO_ROOT/supabase/tests/phase3_timetable_attendance_test.sql"

if [ ! -x "$PGBIN/initdb" ]; then
    echo "ERROR: PostgreSQL 17 binaries not found at $PGBIN" >&2
    echo "Set PGBIN, or install postgresql-17." >&2
    exit 2
fi
for f in "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$SHIM" "$SUITE"; do
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
cp "$SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$SUITE" "$WORKDIR/sql/"
chmod -R a+rX "$WORKDIR/sql"

psql_as() {
    as_runas "PATH=$PGBIN:\$PATH psql -h $PGSOCK -p $PGPORT -U postgres $1"
}

echo "==> Applying local Supabase shim"
psql_as "-d postgres -q -c 'drop database if exists $DBNAME;' -c 'create database $DBNAME;'" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/00_local_supabase_shim.sql" >/dev/null

echo "==> Applying Phase 1 migration (Phase 2 depends on it)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261007000001_phase1_auth_authorization.sql" >/dev/null

echo "==> Applying Phase 2 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261008000001_phase2_academic_core.sql" >/dev/null

echo "==> Applying Phase 3 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261010000001_phase3_timetable_attendance.sql" >/dev/null

echo "==> Checking Phase 3 idempotency (second apply must be a no-op)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261010000001_phase3_timetable_attendance.sql" >/dev/null
TABLES="$(psql_as "-d $DBNAME -tAc \"select count(*) from pg_tables where schemaname='public';\"" | tr -d '[:space:]')"
# Phase 1 created 7 tables; Phase 2 added 12; Phase 3 adds 6.
if [ "$TABLES" != "25" ]; then
    echo "FAIL: expected 25 tables after re-apply, got $TABLES" >&2
    exit 1
fi
echo "    ok: still 25 tables after re-apply"

echo "==> Verifying RLS is enabled AND forced on every table"
RLS="$(psql_as "-d $DBNAME -tAc \"
    select count(*) || '/' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relrowsecurity and c.relforcerowsecurity;\"" | tr -d '[:space:]')"
if [ "$(echo "$RLS" | cut -d/ -f1)" != "25" ]; then
    echo "FAIL: not every table has RLS enabled and forced (got $RLS)" >&2
    exit 1
fi
echo "    ok: RLS enabled and forced on all 25 tables"

echo "==> Running Phase 3 timetable and attendance test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase3_timetable_attendance_test.sql" 2>&1)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -q "ALL PHASE 3 TIMETABLE AND ATTENDANCE TESTS PASSED"; then
    PASSED="$(echo "$OUTPUT" | grep -c "PASS:" || true)"
    echo ""
    echo "RESULT: PASS ($PASSED checks)"
    exit 0
else
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL" >&2
    exit 1
fi
