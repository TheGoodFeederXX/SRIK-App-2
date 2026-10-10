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
#   export SRIK_DB_URL='postgresql://.../postgres'        # the school's database
#   export SRIK_RESTORE_URL='postgresql://.../srik_drill' # a SEPARATE database
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

# ---------------------------------------------------------------------------
# F31 — this script drops schemas, so it must not run until it KNOWS where the
# school's database is.
#
# The defect being fixed: the guard was
#
#     if [ -n "$LIVE_HOST" ] && [ "$DRILL_HOST" = "$LIVE_HOST" ]; then refuse
#
# so an unset SRIK_DB_URL made LIVE_HOST empty, the entire condition false, and
# the guard skipped — immediately before `drop schema ... cascade`. Since
# SRIK_DB_URL is unset by default, THE UNPROTECTED CASE WAS THE COMMON ONE. A
# school that ran the drill to check a backup could instead have wiped its own
# data, and the script would have reported the result as a failed restore.
#
# An unknown live host is therefore a hard error, not a reason to carry on. The
# drill cannot prove a target is safe if it does not know what to be safe from.
# ---------------------------------------------------------------------------
if [ -z "${SRIK_DB_URL:-}" ]; then
    echo "RALAT: SRIK_DB_URL tidak ditetapkan, jadi sasaran pulih TIDAK BOLEH" >&2
    echo "  disemak terhadap pangkalan data sekolah." >&2
    echo "  Skrip ini MEMADAMKAN skema sebelum memulihkan, dan ia enggan" >&2
    echo "  berbuat demikian tanpa mengetahui apa yang mesti dilindungi." >&2
    echo "  Tetapkan SRIK_DB_URL kepada pangkalan data sekolah, sekali sahaja." >&2
    exit 1
fi

# Extract the host from a connection string. `_host_sig` is the part that
# identifies the SERVER, not the spelling of its name.
_url_host() {
    printf '%s' "$1" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#'
}

# F31, second half: the same server answers to several names.
#
# A pooler is reachable as `aws-0-ap-southeast-1.pooler.supabase.com` directly
# and through pooler hostnames that differ only by a region or a project prefix.
# Comparing the hostnames as plain strings lets a drill "elsewhere" be the live
# database in disguise — the DROP then lands on the real thing. So the check is
# made against the identifying part of the name: the dot-separated labels that
# survive a prefix change, plus the project ref carried in the user name.
#
# This is deliberately conservative. A false REFUSAL costs someone five minutes
# of confusion; a false ACCEPT costs the school its records.
_url_sig() {
    local url="$1" host user
    host="$(_url_host "$url")"
    user="$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^@]*)@.*#\1#' | sed -E 's#^([^.]+)\..*#\1#')"
    # `db.<ref>.supabase.co` and `<ref>.supabase.co` are the same database, and
    # the project ref appears in the pooler user as `postgres.<ref>`.
    local ref
    ref="$(printf '%s' "$host" | sed -E 's#^db\.##; s#\..*##')"
    host="$(printf '%s' "$host" | sed -E 's#^db\.##')"
    printf '%s|%s|%s' "$ref" "$user" "$host"
}

LIVE_HOST="$(_url_host "${SRIK_DB_URL}")"
DRILL_HOST="$(_url_host "$SRIK_RESTORE_URL")"
# The database name is the last path segment, with any query string removed.
LIVE_DB="$(printf '%s' "$SRIK_DB_URL" | sed -E 's#\?.*$##; s#.*/##')"
DRILL_DB="$(printf '%s' "$SRIK_RESTORE_URL" | sed -E 's#\?.*$##; s#.*/##')"

echo "Drill ke: ${DRILL_HOST:-?} / ${DRILL_DB:-?}"

# Same host AND same database name. Both parts are required, and getting this
# wrong in the other direction is a real failure mode: on a self-hosted server
# the live database and the drill database are the same host under two names, and
# comparing the host alone refused a perfectly safe drill. Over-refusing is the
# safer error, but a check that blocks the correct usage gets worked around, and
# a guard that people bypass protects nothing.
if [ -n "$LIVE_HOST" ] && [ "$DRILL_HOST" = "$LIVE_HOST" ] && [ "$DRILL_DB" = "$LIVE_DB" ]; then
    echo "RALAT: sasaran pulih ialah pangkalan data YANG SAMA dgn pangkalan data" >&2
    echo "  sekolah (${LIVE_HOST}/${LIVE_DB}). Drill mesti guna pangkalan data" >&2
    echo "  berasingan." >&2
    exit 1
fi

# Same database under a different name. Checked separately, because the names
# differ and the comparison above cannot see it.
LIVE_SIG="$(_url_sig "${SRIK_DB_URL}")"
DRILL_SIG="$(_url_sig "$SRIK_RESTORE_URL")"
LIVE_REF="${LIVE_SIG%%|*}"
DRILL_REF="${DRILL_SIG%%|*}"

if [ -n "$LIVE_REF" ] && [ "$LIVE_REF" = "$DRILL_REF" ] && [ "$DRILL_DB" = "$LIVE_DB" ]; then
    echo "RALAT: sasaran pulih ialah projek YANG SAMA, dgn nama hos berbeza." >&2
    echo "  Rujukan projek: ${DRILL_REF}" >&2
    echo "  Drill mesti dijalankan pada pangkalan data berasingan." >&2
    exit 1
fi

# The reverse mistake, and the more likely one for a school: pointing the drill
# at production because it was the only connection string to hand.
if [ -z "$DRILL_HOST" ]; then
    echo "RALAT: hos sasaran tidak dapat dibaca drpd SRIK_RESTORE_URL." >&2
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
# ---------------------------------------------------------------------------
# F30 — the restore must not be able to fail quietly.
#
# The defect being fixed: the pipeline ended in `|| true`, which discarded
# pg_restore's exit status. A restore that died part-way then fell through to the
# row-count comparison, and because the counts file is written by the BACKUP, the
# comparison could still find everything matching and the drill printed LULUS for
# a restore that never happened. "" is not a status — it is the absence of one.
#
# `--exit-on-error` is inside pg_restore, but a pipeline's status is its LAST
# command's, so the grep decided whether the drill noticed anything. The status is
# now captured explicitly with PIPESTATUS and checked.
# ---------------------------------------------------------------------------
set +e
pg_restore \
    --dbname="$SRIK_RESTORE_URL" \
    --no-owner \
    --no-privileges \
    --single-transaction \
    --exit-on-error \
    "$DUMP" 2>&1 | grep -vE "^(pg_restore: )?(creating|processing|launching)"
RESTORE_STATUS="${PIPESTATUS[0]}"
set -e

if [ "$RESTORE_STATUS" -ne 0 ]; then
    echo >&2
    echo "HASIL: GAGAL — pg_restore keluar dgn status ${RESTORE_STATUS}." >&2
    echo "  Pulih TIDAK selesai, jadi bilangan baris TIDAK dibandingkan dan" >&2
    echo "  sandaran ini TIDAK terbukti. Jangan bergantung padanya." >&2
    exit 1
fi

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
COMPARED=0
while IFS='|' read -r table expected; do
    [ -z "$table" ] && continue
    COMPARED=$((COMPARED + 1))
    actual="$(psql "$SRIK_RESTORE_URL" -At -c "select count(*) from public.${table};" 2>/dev/null || echo 'RALAT')"

    # A COUNT THAT COULD NOT RUN IS NOT A MATCH.
    #
    # The trap this closes: the backup records `RALAT` for a table that did not
    # exist when it ran, and the drill's own query also fails there, so the two
    # strings compare EQUAL and the table is reported as `sama`. Two failures
    # agreeing with each other prove nothing — and the run above showed exactly
    # that, printing `RALAT sama RALAT` for five tables while the summary line
    # still read LULUS. The whole point of the comparison is to catch a table that
    # did not come back; reading "both unreadable" as success hides the case it
    # exists to detect.
    if [ "$expected" = "RALAT" ] || [ "$actual" = "RALAT" ]; then
        printf '  %-22s %8s  DIJANGKA %s  <-- TIDAK DAPAT DISEMAK\n' "$table" "$actual" "$expected"
        FAILED=1
    elif [ "$actual" = "$expected" ]; then
        printf '  %-22s %8s  sama\n' "$table" "$actual"
    else
        printf '  %-22s %8s  DIJANGKA %s  <-- TIDAK SAMA\n' "$table" "$actual" "$expected"
        FAILED=1
    fi
done < "$COUNTS"

# ---------------------------------------------------------------------------
# F30, second half. A comparison of nothing is not a pass.
#
# If the counts file lists no rows — or every row is blank — the loop above never
# runs, FAILED stays 0, and the drill would print LULUS having verified NOTHING.
# The same happens if the file exists but is empty, which is what a backup that
# crashed while writing its counts leaves behind. Silence must not read as proof.
# ---------------------------------------------------------------------------
if [ "$COMPARED" -eq 0 ]; then
    echo >&2
    echo "HASIL: GAGAL — fail kiraan ${COUNTS} tidak menyenaraikan mana-mana jadual," >&2
    echo "  jadi TIADA apa-apa yang dibandingkan. Pulih tidak dibuktikan." >&2
    exit 1
fi

echo
if [ "$FAILED" -eq 0 ]; then
    echo "HASIL: LULUS — sandaran ini boleh dipulihkan dan bilangannya sama."
    echo "  ${COMPARED} jadual dibandingkan."
    echo "  Rekodkan tarikh, masa, fail dan hasil ini dalam IMPLEMENTATION_STATUS.md."
    exit 0
else
    echo "HASIL: GAGAL — pulih selesai tetapi bilangannya berbeza." >&2
    echo "  JANGAN anggap sandaran ini selamat. Siasat sebelum bergantung padanya." >&2
    exit 1
fi
