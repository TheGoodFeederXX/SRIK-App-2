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
# Security hardening (audit findings F01, F02, F03): revokes anon EXECUTE and
# replaces record_class_attendance so the actor cannot be supplied by the caller.
MIGRATION_HARDEN="$REPO_ROOT/supabase/migrations/20261017000001_security_hardening_rpc_anon.sql"
HARDEN_SUITE="$REPO_ROOT/supabase/tests/security_hardening_test.sql"
MIGRATION_SCOPE="$REPO_ROOT/supabase/migrations/20261018000001_access_scope_policies.sql"
SCOPE_SUITE="$REPO_ROOT/supabase/tests/access_scope_test.sql"
MIGRATION_DOCS="$REPO_ROOT/supabase/migrations/20261019000001_document_scope_policy.sql"
DOCS_SUITE="$REPO_ROOT/supabase/tests/document_scope_test.sql"
MIGRATION_ADMIN="$REPO_ROOT/supabase/migrations/20261020000001_last_admin_guard.sql"
ADMIN_SUITE="$REPO_ROOT/supabase/tests/last_admin_guard_test.sql"
MIGRATION_PROV="$REPO_ROOT/supabase/migrations/20261021000001_provisioning_and_temporary_password.sql"
PROV_SUITE="$REPO_ROOT/supabase/tests/provisioning_test.sql"
MIGRATION_FIN="$REPO_ROOT/supabase/migrations/20261022000001_finance_integrity.sql"
MIGRATION_FIN2="$REPO_ROOT/supabase/migrations/20261022000002_record_payment_lock.sql"
FIN_SUITE="$REPO_ROOT/supabase/tests/finance_integrity_test.sql"
MIGRATION_STORAGE_SCOPE="$REPO_ROOT/supabase/migrations/20261016000001_phase6_storage_buckets.sql"
STORAGE_SCOPE_SUITE="$REPO_ROOT/supabase/tests/storage_scope_test.sql"
MIGRATION_REGISTRY="$REPO_ROOT/supabase/migrations/20261023000001_migration_registry.sql"
REGISTRY_SUITE="$REPO_ROOT/supabase/tests/migration_registry_test.sql"
MIGRATION_BULK="$REPO_ROOT/supabase/migrations/20261023000002_bulk_charge_balances.sql"
BULK_SUITE="$REPO_ROOT/supabase/tests/bulk_balances_test.sql"
MIGRATION_REMARK="$REPO_ROOT/supabase/migrations/20261023000003_attendance_remark_only.sql"
REMARK_SUITE="$REPO_ROOT/supabase/tests/attendance_remark_test.sql"
MIGRATION_ENROLL="$REPO_ROOT/supabase/migrations/20261023000004_enrollment_dates.sql"
ENROLL_SUITE="$REPO_ROOT/supabase/tests/enrollment_dates_test.sql"
MIGRATION_TTVERSION="$REPO_ROOT/supabase/migrations/20261024000001_timetable_version_protection.sql"
TTVERSION_SUITE="$REPO_ROOT/supabase/tests/timetable_version_test.sql"
MIGRATION_GUARDLINK="$REPO_ROOT/supabase/migrations/20261024000002_guardian_reads_own_links.sql"
GUARDLINK_SUITE="$REPO_ROOT/supabase/tests/guardian_own_links_test.sql"
MIGRATION_TEACHSELF="$REPO_ROOT/supabase/migrations/20261024000003_teacher_self_attendance.sql"
TEACHSELF_SUITE="$REPO_ROOT/supabase/tests/teacher_self_attendance_test.sql"
MIGRATION_SETTINGS="$REPO_ROOT/supabase/migrations/20261025000001_merge_school_settings.sql"
SETTINGS_SUITE="$REPO_ROOT/supabase/tests/school_settings_merge_test.sql"
MIGRATION_PREFS="$REPO_ROOT/supabase/migrations/20261025000002_user_preferences.sql"
PREFS_SUITE="$REPO_ROOT/supabase/tests/user_preferences_test.sql"
MIGRATION_OFFICEATT="$REPO_ROOT/supabase/migrations/20261025000003_office_staff_attendance.sql"
OFFICEATT_SUITE="$REPO_ROOT/supabase/tests/office_staff_attendance_test.sql"
MIGRATION_ROLEPERM="$REPO_ROOT/supabase/migrations/20261025000004_role_permissions.sql"
ROLEPERM_SUITE="$REPO_ROOT/supabase/tests/role_permissions_test.sql"
MIGRATION_GUARD_RC="$REPO_ROOT/supabase/migrations/20261025000005_guardian_report_cards.sql"
MIGRATION_STU_SELF="$REPO_ROOT/supabase/migrations/20261025000006_student_own_record.sql"
MIGRATION_ANALYTICS="$REPO_ROOT/supabase/migrations/20261025000007_academic_analytics.sql"
MIGRATION_PROFILE_SELF="$REPO_ROOT/supabase/migrations/20261025000008_profile_self_update.sql"
SUBJECT_MARKS_SUITE="$REPO_ROOT/supabase/tests/subject_marks_test.sql"
MIGRATION_AUDIT_FORGERY="$REPO_ROOT/supabase/migrations/20261025000010_audit_forgery.sql"
AUDIT_FORGERY_SUITE="$REPO_ROOT/supabase/tests/audit_forgery_test.sql"
MIGRATION_SUBJ_SCOPE="$REPO_ROOT/supabase/migrations/20261025000011_teacher_subject_scope.sql"
SUBJ_SCOPE_SUITE="$REPO_ROOT/supabase/tests/teacher_subject_scope_test.sql"
MIGRATION_ATT_SCOPE="$REPO_ROOT/supabase/migrations/20261025000012_attendance_assignment_scope.sql"
ATT_SCOPE_SUITE="$REPO_ROOT/supabase/tests/attendance_assignment_scope_test.sql"
MIGRATION_SUBJECT_MARKS="$REPO_ROOT/supabase/migrations/20261025000009_subject_marks.sql"
PROFILE_SELF_SUITE="$REPO_ROOT/supabase/tests/profile_self_update_test.sql"
ANALYTICS_SUITE="$REPO_ROOT/supabase/tests/academic_analytics_test.sql"
STU_SELF_SUITE="$REPO_ROOT/supabase/tests/student_own_record_test.sql"
GUARD_RC_SUITE="$REPO_ROOT/supabase/tests/guardian_report_cards_test.sql"
STORAGE_SUITE="$REPO_ROOT/supabase/tests/phase6b_storage_test.sql"
OPERATIONS_SUITE="$REPO_ROOT/supabase/tests/phase6_operations_test.sql"

if [ ! -x "$PGBIN/initdb" ]; then
    echo "ERROR: PostgreSQL 17 binaries not found at $PGBIN" >&2
    echo "Set PGBIN, or install postgresql-17." >&2
    exit 2
fi

for f in "$STORAGE_SUITE" "$STORAGE_SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$MIGRATION_P5" "$MIGRATION_P5B" "$SHIM" "$STORAGE_SHIM" "$SUITE" "$GUARDIAN_SUITE" "$MIGRATION_P5C" "$ONBOARDING_SUITE" "$MIGRATION_P6" "$MIGRATION_HARDEN" "$HARDEN_SUITE" "$MIGRATION_SCOPE" "$SCOPE_SUITE" "$MIGRATION_DOCS" "$DOCS_SUITE" "$MIGRATION_ADMIN" "$ADMIN_SUITE" "$MIGRATION_PROV" "$PROV_SUITE" "$MIGRATION_FIN" "$MIGRATION_FIN2" "$FIN_SUITE" "$MIGRATION_STORAGE_SCOPE" "$STORAGE_SCOPE_SUITE" "$MIGRATION_REGISTRY" "$REGISTRY_SUITE" "$MIGRATION_BULK" "$BULK_SUITE" "$MIGRATION_REMARK" "$REMARK_SUITE" "$MIGRATION_ENROLL" "$ENROLL_SUITE" "$MIGRATION_TTVERSION" "$TTVERSION_SUITE" "$MIGRATION_GUARDLINK" "$GUARDLINK_SUITE" "$MIGRATION_TEACHSELF" "$TEACHSELF_SUITE" "$MIGRATION_SETTINGS" "$SETTINGS_SUITE" "$MIGRATION_PREFS" "$PREFS_SUITE" "$MIGRATION_OFFICEATT" "$OFFICEATT_SUITE" "$MIGRATION_ROLEPERM" "$ROLEPERM_SUITE" "$MIGRATION_GUARD_RC" "$GUARD_RC_SUITE" "$MIGRATION_STU_SELF" "$STU_SELF_SUITE" "$MIGRATION_ANALYTICS" "$ANALYTICS_SUITE" "$MIGRATION_PROFILE_SELF" "$PROFILE_SELF_SUITE" "$MIGRATION_SUBJECT_MARKS" "$SUBJECT_MARKS_SUITE" "$MIGRATION_AUDIT_FORGERY" "$AUDIT_FORGERY_SUITE" "$MIGRATION_SUBJ_SCOPE" "$SUBJ_SCOPE_SUITE" "$MIGRATION_ATT_SCOPE" "$ATT_SCOPE_SUITE" "$OPERATIONS_SUITE"; do
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

cp "$SHIM" "$STORAGE_SHIM" "$MIGRATION_P1" "$MIGRATION_P2" "$MIGRATION_P3" "$MIGRATION_P4" "$MIGRATION_P5" "$MIGRATION_P5B" "$SUITE" "$GUARDIAN_SUITE" "$MIGRATION_P5C" "$ONBOARDING_SUITE" "$MIGRATION_P6" "$MIGRATION_P6B" "$MIGRATION_HARDEN" "$HARDEN_SUITE" "$MIGRATION_SCOPE" "$SCOPE_SUITE" "$MIGRATION_DOCS" "$DOCS_SUITE" "$MIGRATION_ADMIN" "$ADMIN_SUITE" "$MIGRATION_PROV" "$PROV_SUITE" "$MIGRATION_FIN" "$MIGRATION_FIN2" "$FIN_SUITE" "$MIGRATION_STORAGE_SCOPE" "$STORAGE_SCOPE_SUITE" "$MIGRATION_REGISTRY" "$REGISTRY_SUITE" "$MIGRATION_BULK" "$BULK_SUITE" "$MIGRATION_REMARK" "$REMARK_SUITE" "$MIGRATION_ENROLL" "$ENROLL_SUITE" "$MIGRATION_TTVERSION" "$TTVERSION_SUITE" "$MIGRATION_GUARDLINK" "$GUARDLINK_SUITE" "$MIGRATION_TEACHSELF" "$TEACHSELF_SUITE" "$MIGRATION_SETTINGS" "$SETTINGS_SUITE" "$MIGRATION_PREFS" "$PREFS_SUITE" "$MIGRATION_OFFICEATT" "$OFFICEATT_SUITE" "$MIGRATION_ROLEPERM" "$ROLEPERM_SUITE" "$MIGRATION_GUARD_RC" "$GUARD_RC_SUITE" "$MIGRATION_STU_SELF" "$STU_SELF_SUITE" "$MIGRATION_ANALYTICS" "$ANALYTICS_SUITE" "$MIGRATION_PROFILE_SELF" "$PROFILE_SELF_SUITE" "$OPERATIONS_SUITE" "$STORAGE_SUITE" "$MIGRATION_SUBJECT_MARKS" "$SUBJECT_MARKS_SUITE" "$MIGRATION_AUDIT_FORGERY" "$AUDIT_FORGERY_SUITE" "$MIGRATION_SUBJ_SCOPE" "$SUBJ_SCOPE_SUITE" "$MIGRATION_ATT_SCOPE" "$ATT_SCOPE_SUITE" "$WORKDIR/sql/"
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
echo "==> Applying security hardening (anon RPC revokes, F01/F02/F03)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261017000001_security_hardening_rpc_anon.sql" >/dev/null

echo "==> Checking Phase 5, 5b, 5c and 6 idempotency (second apply must be a no-op)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261012000001_phase5_finance.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261013000001_phase5b_guardian_access.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261014000001_phase5c_guardian_onboarding.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261015000001_phase6_operations_release.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261016000001_phase6_storage_buckets.sql" >/dev/null
# The hardening is re-applied LAST, and that is the point rather than a tidiness
# detail. Phase 5 re-defines `charge_balance` and re-grants it to `authenticated`;
# applying it after the hardening silently restored the F03 exposure. This is
# finding F38 — a migration history that can be re-run needs its security
# migration to be the last thing that touches the schema.
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261017000001_security_hardening_rpc_anon.sql" >/dev/null
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
echo "==> Running security hardening suite (audit F01, F02, F03)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/security_hardening_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

# The suite proves itself: every guarded check raises. An uncaught exception here
# means a hole is open, so the failure is reported rather than the count.
if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (security hardening)" >&2
    exit 1
fi
HARDEN_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# The scope policies come LAST, after the hardening, for the same reason the
# hardening does: `create policy` and `drop policy` are the final word on what a
# row-level check is, and an earlier migration re-creating a permissive policy
# would otherwise undo them. F38 again — the security migration has to be able to
# say it is the last thing that touched the schema.
echo ""
echo "==> Applying access-scope policies (audit F05, F06, F07)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261018000001_access_scope_policies.sql" >/dev/null

echo ""
echo "==> Running access scope suite (audit F05, F06, F07)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/access_scope_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (access scope)" >&2
    exit 1
fi
SCOPE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# The document policy goes last for the same reason as the others: `drop policy`
# and `create policy` are the final word, so a later re-apply of an earlier
# migration would undo it (F38).
echo ""
echo "==> Applying document scope policy (audit F10)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261019000001_document_scope_policy.sql" >/dev/null

echo ""
echo "==> Running document scope suite (audit F10)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/document_scope_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (document scope)" >&2
    exit 1
fi
DOCS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying last-admin guard (audit F12)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261020000001_last_admin_guard.sql" >/dev/null

echo ""
echo "==> Running last-admin guard suite (audit F12)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/last_admin_guard_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (last-admin guard)" >&2
    exit 1
fi
ADMIN_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying provisioning and temporary-password policies (audit F13, F14, F15, F16)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261021000001_provisioning_and_temporary_password.sql" >/dev/null

echo ""
echo "==> Running provisioning suite (audit F13, F14, F15, F16)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/provisioning_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (provisioning)" >&2
    exit 1
fi
PROV_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# The lock migration goes AFTER the integrity one: it replaces record_payment, and
# the integrity migration's invariant inspects that function.
echo ""
echo "==> Applying finance integrity policies (audit F18, F19, F20, F21, F22)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261022000001_finance_integrity.sql" >/dev/null
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261022000002_record_payment_lock.sql" >/dev/null

echo ""
echo "==> Running finance integrity suite (audit F18, F19, F20, F21, F22)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/finance_integrity_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|FAIL|SKIP|FAIL F[0-9]+): .*" | sed 's/^/    /' || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo ""
    echo "$OUTPUT" | grep -E "ERROR|FAIL" | sed 's/^/    /' || true
    echo "RESULT: FAIL (finance integrity)" >&2
    exit 1
fi
FIN_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F37: the Storage policies are in the buckets migration, so it is applied here.
echo ""
echo "==> Applying storage bucket + policy definitions (audit F37)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261016000001_phase6_storage_buckets.sql" >/dev/null

echo ""
echo "==> Running storage scope suite (audit F37)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/storage_scope_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -20 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (storage scope)" >&2
    exit 1
fi
STORAGE_SCOPE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F38: the migration registry is added last, because it RECORDS the state after
# every other migration has been applied.
echo ""
echo "==> Applying migration registry (audit F38)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261023000001_migration_registry.sql" >/dev/null

echo ""
echo "==> Running migration registry suite (audit F38)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/migration_registry_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -20 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (migration registry)" >&2
    exit 1
fi
REGISTRY_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F28: the bulk balance function, added after the registry records the rest.
echo ""
echo "==> Applying bulk charge balances (audit F28)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261023000002_bulk_charge_balances.sql" >/dev/null

echo ""
echo "==> Running bulk balances suite (audit F28)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/bulk_balances_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -20 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (bulk balances)" >&2
    exit 1
fi
BULK_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F26: a remark-only attendance change was silently dropped.
echo ""
echo "==> Applying attendance remark fix (audit F26)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261023000003_attendance_remark_only.sql" >/dev/null

echo ""
echo "==> Running attendance remark suite (audit F26)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/attendance_remark_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -20 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (attendance remark)" >&2
    exit 1
fi
REMARK_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F23/F24/F25: which class is a child in, and when.
echo ""
echo "==> Applying enrollment date resolution (audit F23/F24/F25)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261023000004_enrollment_dates.sql" >/dev/null

echo ""
echo "==> Running enrollment dates suite (audit F23/F24/F25)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/enrollment_dates_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -24 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (enrollment dates)" >&2
    exit 1
fi
ENROLL_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F36: publishing a timetable must not cut the school off early.
echo ""
echo "==> Applying timetable version protection (audit F36)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261024000001_timetable_version_protection.sql" >/dev/null

echo ""
echo "==> Running timetable version suite (audit F36)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/timetable_version_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (timetable version)" >&2
    exit 1
fi
TTVERSION_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F17: a guardian reading their own child links.
echo ""
echo "==> Applying guardian self-read (audit F17)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261024000002_guardian_reads_own_links.sql" >/dev/null

echo ""
echo "==> Running guardian own-links suite (audit F17)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/guardian_own_links_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (guardian own links)" >&2
    exit 1
fi
GUARDLINK_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: a teacher recording their own attendance.
echo ""
echo "==> Applying teacher self-attendance (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261024000003_teacher_self_attendance.sql" >/dev/null

echo ""
echo "==> Running teacher self-attendance suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/teacher_self_attendance_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (teacher self-attendance)" >&2
    exit 1
fi
TEACHSELF_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: two settings screens must not erase each other's save.
echo ""
echo "==> Applying school settings merge (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000001_merge_school_settings.sql" >/dev/null

echo ""
echo "==> Running school settings merge suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/school_settings_merge_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (school settings merge)" >&2
    exit 1
fi
SETTINGS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: a person's own preferences.
echo ""
echo "==> Applying user preferences (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000002_user_preferences.sql" >/dev/null

echo ""
echo "==> Running user preferences suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/user_preferences_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (user preferences)" >&2
    exit 1
fi
PREFS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: the office's staff attendance register.
echo ""
echo "==> Applying office staff attendance (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000003_office_staff_attendance.sql" >/dev/null

echo ""
echo "==> Running office staff attendance suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/office_staff_attendance_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (office staff attendance)" >&2
    exit 1
fi
OFFICEATT_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: role permissions, and the ADMIN lock-out rule.
echo ""
echo "==> Applying role permissions (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000004_role_permissions.sql" >/dev/null

echo ""
echo "==> Running role permissions suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/role_permissions_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (role permissions)" >&2
    exit 1
fi
ROLEPERM_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: a parent could not read their OWN child's report card.
echo ""
echo "==> Applying guardian report card access (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000005_guardian_report_cards.sql" >/dev/null

echo ""
echo "==> Running guardian report card suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/guardian_report_cards_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (guardian report cards)" >&2
    exit 1
fi
GUARD_RC_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: a student could not read their own record, attendance or report card.
echo ""
echo "==> Applying student self-access (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000006_student_own_record.sql" >/dev/null

echo ""
echo "==> Running student self-access suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/student_own_record_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (student self-access)" >&2
    exit 1
fi
STU_SELF_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: academic analytics, computed by the database.
echo ""
echo "==> Applying academic analytics (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000007_academic_analytics.sql" >/dev/null

echo ""
echo "==> Running academic analytics suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/academic_analytics_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (academic analytics)" >&2
    exit 1
fi
ANALYTICS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

# F27: nobody could edit their own profile.
echo ""
echo "==> Applying profile self-update (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000008_profile_self_update.sql" >/dev/null

echo ""
echo "==> Running profile self-update suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/profile_self_update_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (profile self-update)" >&2
    exit 1
fi
PROFILE_SELF_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying subject-marks migration (audit F27)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000009_subject_marks.sql" >/dev/null

echo ""
echo "==> Running subject-marks suite (audit F27)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/subject_marks_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (subject marks)" >&2
    exit 1
fi
SUBJECT_MARKS_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying audit-forgery migration (audit F11)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000010_audit_forgery.sql" >/dev/null

echo ""
echo "==> Running audit-forgery suite (audit F11)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/audit_forgery_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (audit forgery)" >&2
    exit 1
fi
AUDIT_FORGERY_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying teacher subject-scope migration (audit F09)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000011_teacher_subject_scope.sql" >/dev/null

echo ""
echo "==> Running teacher subject-scope suite (audit F09)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/teacher_subject_scope_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (teacher subject scope)" >&2
    exit 1
fi
SUBJ_SCOPE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "==> Applying attendance assignment-scope migration (audit F08)"
psql_as "-d $DBNAME -v ON_ERROR_STOP=1 -q -f $WORKDIR/sql/20261025000012_attendance_assignment_scope.sql" >/dev/null

echo ""
echo "==> Running attendance assignment-scope suite (audit F08)"
OUTPUT="$(psql_as "-d $DBNAME -f $WORKDIR/sql/attendance_assignment_scope_test.sql" 2>&1 || true)"
echo "$OUTPUT" | grep -oE "(PASS|SKIP|FAIL|ERROR|FAIL F[0-9]+): .*" | sed 's/^/    /' | head -12 || true

if echo "$OUTPUT" | grep -qE "FAIL|ERROR"; then
    echo "RESULT: FAIL (attendance assignment scope)" >&2
    exit 1
fi
ATT_SCOPE_CHECKS="$(echo "$OUTPUT" | grep -c "PASS" || true)"

echo ""
echo "RESULT: PASS ($FEE_CHECKS fee checks, $GUARDIAN_CHECKS guardian checks, $ONBOARDING_CHECKS onboarding checks, $OPERATIONS_CHECKS operations checks, $STORAGE_CHECKS storage checks, $HARDEN_CHECKS security checks, $SCOPE_CHECKS access-scope checks, $DOCS_CHECKS document-scope checks, $ADMIN_CHECKS last-admin checks, $PROV_CHECKS provisioning checks, $FIN_CHECKS finance-integrity checks, $STORAGE_SCOPE_CHECKS storage-scope checks, $REGISTRY_CHECKS registry checks, $BULK_CHECKS bulk-balance checks, $REMARK_CHECKS attendance-remark checks, $ENROLL_CHECKS enrollment-date checks, $TTVERSION_CHECKS timetable-version checks, $GUARDLINK_CHECKS guardian-own-link checks, $TEACHSELF_CHECKS teacher-self-attendance checks, $SETTINGS_CHECKS school-settings-merge checks, $PREFS_CHECKS user-preferences checks, $OFFICEATT_CHECKS office-staff-attendance checks, $ROLEPERM_CHECKS role-permission checks, $GUARD_RC_CHECKS guardian-report-card checks, $STU_SELF_CHECKS student-self-access checks, $ANALYTICS_CHECKS analytics checks, $PROFILE_SELF_CHECKS profile-self-update checks, $SUBJECT_MARKS_CHECKS subject-marks checks, $AUDIT_FORGERY_CHECKS audit-forgery checks, $SUBJ_SCOPE_CHECKS teacher-subject-scope checks, $ATT_SCOPE_CHECKS attendance-assignment-scope checks)"
exit 0
