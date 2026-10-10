#!/usr/bin/env bash
#
# SRIK — prove a backup is any good, by restoring it somewhere harmless.
#
# Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
#
# The specification is blunt about this, and it is right: a backup that succeeded
# is not evidence that a restore will. The only evidence is restoring one and
# looking at what came back.
#
# The drill restores into a database that is NOT the school's, then compares row
# counts against the numbers recorded when the backup was taken. A restore that
# completes without error and yields half the rows is a failure, and it is the
# failure a plain "restore finished" message hides.
#
# Restoring OVER the live database is refused, deliberately. This script exists
# to test a copy, not to gamble with the real record.
#
#   export SRIK_RESTORE_URL='postgresql://.../srik_drill'
#   ./scripts/ops/restore-drill.sh backups/srik-20260101T000000Z.dump
#
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
    echo "Guna: $0 <fail-dump>" >&2
    exit 1
fi

if [ -z "${SRIK_RESTORE_URL:-}" ]; then
    echo "RALAT: SRIK_RESTORE_URL tidak ditetapkan." >&2
    echo "  Gunakan pangkalan data BERASINGAN — bukan projek sekolah." >&2
    exit 1
fi

# A guard against the one mistake that matters. If the restore target is the same
# database the backup came from, stop before dropping anything.
LIVE_HOST="$(printf '%s' "${SRIK_DB_URL:-}" | sed -E 's#.*@([^:/]+).*#\1#')"
DRILL_HOST="$(printf '%s' "$SRIK_RESTORE_URL" | sed -E 's#.*@([^:/]+).*#\1#')"
DRILL_DB="$(printf '%s' "$SRIK_RESTORE_URL" | sed -E 's#\?.*$##; s#.*/##')"

echo "Drill ke: ${DRILL_HOST} / ${DRILL_DB}"
if [ -n "$LIVE_HOST" ] && [ "$DRILL_HOST" = "$LIVE_HOST" ]; then
    echo "RALAT: sasaran pulih kelihatan SAMA dengan pangkalan data sekolah." >&2
    echo "  Drill mesti dijalankan pada pangkalan data berasingan." >&2
    exit 1
fi

echo "Membersihkan sasaran…"
# BUG this fixes: dropping only the public TABLES left the `auth` and
# `extensions` SCHEMAS behind, so pg_restore aborted on `CREATE SCHEMA auth`
# with --exit-on-error and the drill reported a mismatch that was really a
# half-finished restore. A drill must start from the same empty state as the
# database it is testing, so the whole schema set is dropped, not just tables.
#
# This runs as the drill database's own owner. The audit log is append-only for
# the APP; rebuilding it here is the entire point of a restore.
psql "$SRIK_RESTORE_URL" -q -v ON_ERROR_STOP=1 -c "
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists extensions cascade;
    create schema public;" 2>&1 | grep -vE "already exists" || true

echo "Memulihkan ${DUMP}…"
pg_restore \
    --dbname="$SRIK_RESTORE_URL" \
    --no-owner \
    --no-privileges \
    --single-transaction \
    --exit-on-error \
    "$DUMP" 2>&1 | grep -vE "^(pg_restore: )?(creating|processing|launching)" || true

# --- Compare what came back against what was recorded -----------------------

COUNTS="${DUMP%.dump}.counts.txt"
if [ ! -f "$COUNTS" ]; then
    echo
    echo "AMARAN: fail kiraan ${COUNTS} tiada, jadi bilangan baris tidak dapat"
    echo "  dibandingkan. Pulih selesai, tetapi TIDAK dibuktikan. Adakah dump ini"
    echo "  dibuat dengan skrip lama?"
    exit 2
fi

echo
echo "Membandingkan bilangan baris…"
FAILED=0
while IFS='|' read -r table expected; do
    [ -z "$table" ] && continue
    actual="$(psql "$SRIK_RESTORE_URL" -At -c "select count(*) from public.${table};" 2>/dev/null || echo 'RALAT')"

    if [ "$actual" = "$expected" ]; then
        printf '  %-22s %8s  sama\n' "$table" "$actual"
    else
        printf '  %-22s %8s  DIJANGKA %s  <-- TIDAK SAMA\n' "$table" "$actual" "$expected"
        FAILED=1
    fi
done < "$COUNTS"

echo
if [ "$FAILED" -eq 0 ]; then
    echo "HASIL: LULUS — sandaran ini boleh dipulihkan dan bilangannya sama."
    echo "  Rekodkan tarikh, masa, fail dan hasil ini dalam IMPLEMENTATION_STATUS.md."
    exit 0
else
    echo "HASIL: GAGAL — pulih selesai tetapi bilangannya berbeza." >&2
    echo "  JANGAN anggap sandaran ini selamat. Siasat sebelum bergantung padanya." >&2
    exit 1
fi
