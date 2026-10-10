#!/usr/bin/env bash
# =============================================================================
# SRIK Phase 4 — local assessment and report card test runner
# =============================================================================
# Stands up a throwaway PostgreSQL 17 instance, applies the Supabase shim, then
# Phases 1 to 4 in order, and runs the assessment/report suite.
#
# The earlier migrations are applied first because Phase 4 depends on them: the
# authorization helpers, the academic core (classes, subjects, enrollments,
# teaching assignments) and the attendance tables are all referenced. Running
# them in order also proves the four migrations compose.
#
# Why local: the tests need superuser DDL and must never run against the remote
# project.
#
# Usage:  ./supabase/tests/run_phase4_tests.sh
# Exit:   0 = all tests passed, non-zero = failure (safe to use in CI)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
WORKDIR="${SRIK_TEST_DIR:-/tmp/srik-phase4-test}"
PGDATA="$WORKDIR/data"
PGSOCK="$WORKDIR/sock"
PGPORT="${SRIK_TEST_PORT:-55435}"
DBNAME="srik_phase4_test"

MIGRATION_P1="$REPO_ROOT/supabase/migrations/20261007000001_phase1_auth_authorization.sql"
MIGRATION_P2="$REPO_ROOT/supabase/migrations/20261008000001_phase2_academic_core.sql"
MIGRATION_P3="$REPO_ROOT/supabase/migrations/20261010000001_phase3_timetable_attendance.sql"
MIGRATION_P4="$REPO_ROOT/supabase/migrations/20261011000001_phase4_assessments_reports.sql"
SHIM="$REPO_ROOT/supabase/tests/00_local_supabase_shim.sql"
SUITE="$REPO_ROOT/supabase/tests/phase4_assessments_reports_test.sql"

if [ ! -x "$PGBIN/initdb" ]; then
    echo "ERROR: PostgreSQL 17 binaries not found at $PGBIN" >&2
    echo "Set PGBIN, or install postgresql-17." >&2
    exit 2
fi

for f in "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$SHIM" "$SUITE"; do
    [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 2; }
done

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

as_runas "PATH=$PGBIN:\$PATH initdb -D $PGDATA -U postgres --auth=trust" >"$WORKDIR/initdb.log" 2>&1
as_runas "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l $WORKDIR/server.log start" >/dev/null 2>&1
sleep 2

cp "$SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$SUITE" "$WORKDIR/sql/"
chmod -R a+rX "$WORKDIR/sql"

psql_as() {
    as_runas "PATH=$PGBIN:\$PATH psql -h $PGSOCK -p $PGPORT -U postgres $1"
}

echo "==> Applying local Supabase shim"
psql_as "-d postgres -q -c 'drop database if exists $DBNAME;' -c 'create database $DBNAME;'" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/00_local_supabase_shim.sql" >/dev/null

echo "==> Applying Phase 1 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261007000001_phase1_auth_authorization.sql" >/dev/null

echo "==> Applying Phase 2 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261008000001_phase2_academic_core.sql" >/dev/null

echo "==> Applying Phase 3 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261010000001_phase3_timetable_attendance.sql" >/dev/null

echo "==> Applying Phase 4 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261011000001_phase4_assessments_reports.sql" >/dev/null

echo "==> Checking Phase 4 idempotency (second apply must be a no-op)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261011000001_phase4_assessments_reports.sql" >/dev/null
TABLES="$(psql_as "-d $DBNAME -tAc \"select count(*) from pg_tables where schemaname='public';\"" | tr -d '[:space:]')"
# Phase 1 created 7 tables; Phase 2 added 12; Phase 3 added 6; Phase 4 adds 4.
if [ "$TABLES" != "29" ]; then
    echo "FAIL: expected 29 tables after re-apply, got $TABLES" >&2
    exit 1
fi
echo "    ok: still 29 tables after re-apply"

echo "==> Verifying RLS is enabled AND forced on every table"
RLS="$(psql_as "-d $DBNAME -tAc \"
    select count(*) || '/' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relrowsecurity and c.relforcerowsecurity;\"" | tr -d '[:space:]')"
if [ "$(echo "$RLS" | cut -d/ -f1)" != "29" ]; then
    echo "FAIL: not every table has RLS enabled and forced (got $RLS)" >&2
    exit 1
fi
echo "    ok: RLS enabled and forced on all 29 tables"

echo "==> Running Phase 4 assessment and report card test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase4_assessments_reports_test.sql" 2>&1)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -q "ALL PHASE 4 ASSESSMENT AND REPORT TESTS PASSED"; then
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
