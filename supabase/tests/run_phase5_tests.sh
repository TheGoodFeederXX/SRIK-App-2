#!/usr/bin/env bash
# =============================================================================
# SRIK Phase 5 — local school fee test runner
# =============================================================================
# Stands up a throwaway PostgreSQL 17 instance, applies the Supabase shim, then
# Phases 1 to 5 in order, and runs the school fee suite.
#
# The earlier migrations are applied first because Phase 5 depends on them: the
# authorization helpers, the academic core (classes, subjects, enrollments) and
# the student/guardian records are all referenced. Running them in order also
# proves the six migrations compose.
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
WORKDIR="${SRIK_TEST_DIR:-/tmp/srik-phase5b-test}"
PGDATA="$WORKDIR/data"
PGSOCK="$WORKDIR/sock"
PGPORT="${SRIK_TEST_PORT:-55437}"
DBNAME="srik_phase5_test"

MIGRATION_P1="$REPO_ROOT/supabase/migrations/20261007000001_phase1_auth_authorization.sql"
MIGRATION_P2="$REPO_ROOT/supabase/migrations/20261008000001_phase2_academic_core.sql"
MIGRATION_P3="$REPO_ROOT/supabase/migrations/20261010000001_phase3_timetable_attendance.sql"
MIGRATION_P4="$REPO_ROOT/supabase/migrations/20261011000001_phase4_assessments_reports.sql"
MIGRATION_P5="$REPO_ROOT/supabase/migrations/20261012000001_phase5_finance.sql"
MIGRATION_P5B="$REPO_ROOT/supabase/migrations/20261013000001_phase5b_guardian_access.sql"
MIGRATION_P5C="$REPO_ROOT/supabase/migrations/20261014000001_phase5c_guardian_onboarding.sql"
SHIM="$REPO_ROOT/supabase/tests/00_local_supabase_shim.sql"
STORAGE_SHIM="$REPO_ROOT/supabase/tests/00b_local_storage_shim.sql"
SUITE="$REPO_ROOT/supabase/tests/phase5_finance_test.sql"
GUARDIAN_SUITE="$REPO_ROOT/supabase/tests/phase5b_guardian_access_test.sql"
# Phase 5c and Phase 6 were added after this runner was written, and neither was
# copied or run here — so two whole suites existed but were never exercised by
# the command anyone would actually type. Both are wired in now.
ONBOARDING_SUITE="$REPO_ROOT/supabase/tests/phase5c_guardian_onboarding_test.sql"
MIGRATION_P6="$REPO_ROOT/supabase/migrations/20261015000001_phase6_operations_release.sql"
MIGRATION_P6B="$REPO_ROOT/supabase/migrations/20261016000001_phase6_storage_buckets.sql"
STORAGE_SUITE="$REPO_ROOT/supabase/tests/phase6b_storage_test.sql"
OPERATIONS_SUITE="$REPO_ROOT/supabase/tests/phase6_operations_test.sql"

if [ ! -x "$PGBIN/initdb" ]; then
    echo "ERROR: PostgreSQL 17 binaries not found at $PGBIN" >&2
    echo "Set PGBIN, or install postgresql-17." >&2
    exit 2
fi

for f in "$STORAGE_SUITE" "$STORAGE_SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$MIGRATION_P5" "$MIGRATION_P5B" "$SHIM" "$STORAGE_SHIM" "$SUITE" "$GUARDIAN_SUITE" "$MIGRATION_P5C" "$ONBOARDING_SUITE" "$MIGRATION_P6" "$OPERATIONS_SUITE"; do
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

cp "$SHIM" "$STORAGE_SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$MIGRATION_P5" "$MIGRATION_P5B" "$SUITE" "$GUARDIAN_SUITE" "$MIGRATION_P5C" "$ONBOARDING_SUITE" "$MIGRATION_P6" "$MIGRATION_P6B" "$OPERATIONS_SUITE" "$STORAGE_SUITE" "$WORKDIR/sql/"
chmod -R a+rX "$WORKDIR/sql"

psql_as() {
    as_runas "PATH=$PGBIN:\$PATH psql -h $PGSOCK -p $PGPORT -U postgres $1"
}

echo "==> Applying local Supabase shim"
psql_as "-d postgres -q -c 'drop database if exists $DBNAME;' -c 'create database $DBNAME;'" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/00_local_supabase_shim.sql" >/dev/null

# The storage stand-in must exist before Phase 6b, which puts a bucket in it.
# It is a test fixture, not a migration.
echo "==> Applying local Storage stand-in"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/00b_local_storage_shim.sql" >/dev/null

echo "==> Applying Phase 1 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261007000001_phase1_auth_authorization.sql" >/dev/null

echo "==> Applying Phase 2 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261008000001_phase2_academic_core.sql" >/dev/null

echo "==> Applying Phase 3 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261010000001_phase3_timetable_attendance.sql" >/dev/null

echo "==> Applying Phase 4 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261011000001_phase4_assessments_reports.sql" >/dev/null

echo "==> Applying Phase 5 migration"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261012000001_phase5_finance.sql" >/dev/null

echo "==> Applying Phase 5b migration (guardian access)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261013000001_phase5b_guardian_access.sql" >/dev/null

echo "==> Applying Phase 5c migration (guardian onboarding)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261014000001_phase5c_guardian_onboarding.sql" >/dev/null

echo "==> Applying Phase 6 migration (operations, audit, documents, announcements)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261015000001_phase6_operations_release.sql" >/dev/null

echo "==> Applying Phase 6b migration (private storage bucket)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261016000001_phase6_storage_buckets.sql" >/dev/null

echo "==> Checking Phase 5, 5b, 5c and 6 idempotency (second apply must be a no-op)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261012000001_phase5_finance.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261013000001_phase5b_guardian_access.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261014000001_phase5c_guardian_onboarding.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261015000001_phase6_operations_release.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261016000001_phase6_storage_buckets.sql" >/dev/null
TABLES="$(psql_as "-d $DBNAME -tAc \"select count(*) from pg_tables where schemaname='public';\"" | tr -d '[:space:]')"
# Phase 1 created 7 tables; Phase 2 added 12; Phase 3 added 6; Phase 4 added 4;
# Phase 5 added 4; Phase 6 added 3 (audit_log, documents, announcements).
if [ "$TABLES" != "36" ]; then
    echo "FAIL: expected 36 tables after re-apply, got $TABLES" >&2
    exit 1
fi
echo "    ok: all migrations re-applied cleanly (idempotent)"

echo "==> Verifying RLS is enabled AND forced on every table"
RLS="$(psql_as "-d $DBNAME -tAc \"
    select count(*) || '/' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relrowsecurity and c.relforcerowsecurity;\"" | tr -d '[:space:]')"
if [ "$(echo "$RLS" | cut -d/ -f1)" != "36" ]; then
    echo "FAIL: not every table has RLS enabled and forced (got $RLS)" >&2
    exit 1
fi
echo "    ok: RLS enabled and forced on all 36 tables"

echo "==> Running Phase 5 school fee test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase5_finance_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if ! echo "$OUTPUT" | grep -q "ALL PHASE 5 SCHOOL FEE TESTS PASSED"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (phase 5 fees)" >&2
    exit 1
fi
FEE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS:" || true)"

echo
echo "==> Running Phase 5b guardian access test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase5b_guardian_access_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if ! echo "$OUTPUT" | grep -q "ALL PHASE 5B GUARDIAN ACCESS TESTS PASSED"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (phase 5b guardian access)" >&2
    exit 1
fi
GUARDIAN_CHECKS="$(echo "$OUTPUT" | grep -c "PASS:" || true)"

echo
echo "==> Running Phase 5c guardian onboarding test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase5c_guardian_onboarding_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if ! echo "$OUTPUT" | grep -q "ALL PHASE 5C GUARDIAN ONBOARDING TESTS PASSED"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (phase 5c guardian onboarding)" >&2
    exit 1
fi
ONBOARDING_CHECKS="$(echo "$OUTPUT" | grep -c "PASS:" || true)"

echo
echo "==> Running Phase 6 operations test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase6_operations_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if ! echo "$OUTPUT" | grep -q "ALL PHASE 6 OPERATIONS TESTS PASSED"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (phase 6 operations)" >&2
    exit 1
fi
OPERATIONS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS:" || true)"

echo
echo "==> Running Phase 6b storage test suite"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/phase6b_storage_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL): .*" | sed 's/^/    /' || true

if ! echo "$OUTPUT" | grep -q "ALL PHASE 6B STORAGE TESTS PASSED"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (phase 6b storage)" >&2
    exit 1
fi
STORAGE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS:" || true)"

echo ""
echo "RESULT: PASS ($FEE_CHECKS fee checks, $GUARDIAN_CHECKS guardian checks, $ONBOARDING_CHECKS onboarding checks, $OPERATIONS_CHECKS operations checks, $STORAGE_CHECKS storage checks)"
exit 0
