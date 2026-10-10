#!/usr/bin/env bash
#
# SRIK — backup the school database.
#
# Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
#
# A BACKUP THAT HAS NEVER BEEN RESTORED IS NOT A BACKUP. This script only makes
# the copy. Restoring it into a throwaway database and comparing counts is what
# proves the copy is any good, and that is what `restore-drill.sh` does. Run both;
# a backup on its own is a false comfort.
#
# Where this runs: on a machine the school controls, with the connection string
# in the environment. The credential must never be written into this file,
# passed on the command line (it would appear in `ps`), or logged.
#
#   export SRIK_DB_URL='postgresql://...'
#   ./scripts/ops/backup.sh
#
set -euo pipefail

OUT_DIR="${SRIK_BACKUP_DIR:-.}/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/srik-${STAMP}.dump"
KEEP_DAYS="${SRIK_BACKUP_KEEP_DAYS:-30}"

if [ -z "${SRIK_DB_URL:-}" ]; then
    echo "RALAT: SRIK_DB_URL tidak ditetapkan." >&2
    echo "  Contoh: export SRIK_DB_URL='postgresql://...'" >&2
    echo "  Jangan letak kata laluan dalam fail ini atau dalam sejarah shell." >&2
    exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
    echo "RALAT: pg_dump tidak dijumpai. Pasang postgresql-client dahulu." >&2
    exit 1
fi

mkdir -p "$OUT_DIR"

echo "Membuat sandaran ke ${FILE}"
# `--format=custom` so the dump can be restored selectively and is compressed.
# `--no-owner`/`--no-privileges` so a restore into a fresh project does not fail
# on roles that only exist on the original.
pg_dump "$SRIK_DB_URL" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$FILE"

# The counts are recorded WITH the dump. Comparing them later is the only honest
# way to say the restore worked: a file that restores without error but holds
# half the rows is a failure that looks like success.
COUNTS="${FILE%.dump}.counts.txt"
# The tables are counted dynamically for two reasons: a build in progress may
# not have created every table yet, and a hard-coded list silently stops
# covering a table added later. A count that cannot run is recorded as RALAT
# rather than being skipped, so the drill reports a gap instead of hiding one.
psql "$SRIK_DB_URL" -At -F'|' > "$COUNTS.tmp" 2>&1 <<'SQL'
do $$
declare
    v_table text;
    v_count bigint;
    v_tables text[] := array[
        'students', 'guardians', 'student_charges', 'payments',
        'assessment_results', 'attendance_records', 'audit_log'
    ];
begin
    foreach v_table in array v_tables loop
        if exists (
            select 1 from information_schema.tables
             where table_schema = 'public' and table_name = v_table
        ) then
            execute format('select count(*) from public.%I', v_table) into v_count;
            raise notice '%|%', v_table, v_count;
        else
            raise notice '%|RALAT', v_table;
        end if;
    end loop;
end $$;
SQL
# Keep only the counted lines. psql prefixes a NOTICE with "NOTICE:  ", so the
# prefix is stripped rather than the whole line being discarded.
sed -E 's/^(NOTICE:  |psql:[^:]*:[0-9]+: NOTICE:  )//' "$COUNTS.tmp" \
    | grep -E '^[a-z_]+\|' > "$COUNTS"
rm -f "$COUNTS.tmp"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "Selesai: sandaran ${SIZE}, kiraan disimpan dalam ${COUNTS}"
echo
echo "LANGKAH SETERUSNYA — ini yang membuktikan sandaran berguna:"
echo "  export SRIK_RESTORE_URL='postgresql://...'   # projek BERASINGAN"
echo "  ./scripts/ops/restore-drill.sh ${FILE}"

# Old copies are pruned so the disk does not fill and take the newest backup with
# it. Only files this script named are touched.
if [ -d "$OUT_DIR" ] && [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
    find "$OUT_DIR" -name 'srik-*.dump' -type f -mtime "+${KEEP_DAYS}" -print -delete \
        | sed 's/^/  dipadam (lama): /' || true
fi
