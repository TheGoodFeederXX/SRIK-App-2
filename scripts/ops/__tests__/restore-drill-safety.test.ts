import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard tests for audit findings F30 and F31 in `restore-drill.sh`.
//
// These are read as TEXT rather than executed, deliberately. The script's failure
// mode is DESTRUCTIVE: run it with the wrong arguments and it drops the school's
// live schemas. A test that invoked it would have to point it at a real database,
// and a mistake in the test would then destroy real data. Asserting on the source
// proves the guard is present without giving the test that power.
//
// Comments are stripped before matching, because the fix's own explanatory
// comment quotes the very code that was removed — a trap that has caught this
// repository more than once.
const ROOT = join(__dirname, '..', '..', '..');

function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
}

const body = code(readFileSync(join(ROOT, 'scripts', 'ops', 'restore-drill.sh'), 'utf8'));

// Each property is checked as "the refusal exists AND it happens before the
// destructive statement". Ordering is the protection, so it is asserted rather
// than assumed from reading order.
function refusesBefore(needle: string, before: string): void {
    const at = body.indexOf(needle);
    const boundary = body.indexOf(before);
    expect(at, `penolakan "${needle}" mesti wujud`).toBeGreaterThan(-1);
    expect(boundary, `sempadan "${before}" mesti wujud`).toBeGreaterThan(-1);
    expect(at, `penolakan mesti berlaku SEBELUM ${before}`).toBeLessThan(boundary);
}

const DROP = 'drop schema if exists public cascade';

describe('restore drill safety (F30, F31)', () => {
    it('F31: refuses to run when the live database URL is unknown', () => {
        // The defect: the guard was `[ -n "$LIVE_HOST" ] && [ .. = .. ]`, so an
        // unset SRIK_DB_URL made LIVE_HOST empty, the condition false, and the
        // guard skipped — immediately before the cascade drop. SRIK_DB_URL is
        // unset by default, so the UNPROTECTED case was the common one.
        //
        // The fix is a separate, earlier refusal on the variable itself. The old
        // same-host condition may still exist for the obvious case; what must be
        // present is an unconditional stop when the live host is unknown.
        expect(body).toMatch(/-z\s+"\$\{?SRIK_DB_URL/);
        refusesBefore('-z "${SRIK_DB_URL', DROP);
    });

    it('F31: never drops a schema before the target has been validated', () => {
        // The target must be named before anything destructive runs: both the
        // SRIK_RESTORE_URL requirement and the live-DB checks precede the drop.
        refusesBefore('SRIK_RESTORE_URL tidak ditetapkan', DROP);
        refusesBefore('SRIK_DB_URL tidak ditetapkan', DROP);
    });

    it('F31: refuses a DIFFERENT-SPELLED host that is the same database', () => {
        // Comparing hostnames as plain strings lets a drill "elsewhere" be the
        // live database under another name — a pooler answers to several. Rewriting
        // the host is not enough on its own; the fix derives an identifying
        // signature and refuses a target carrying the live one's identity.
        expect(body).toMatch(/_url_sig|_host_sig|_normalise_host/);
        // The signature must be compared, and the refusal must precede the drop.
        expect(body).toMatch(/LIVE_REF[\s\S]{0,200}?DRILL_REF|DRILL_REF[\s\S]{0,200}?LIVE_REF/);
        refusesBefore('ialah projek YANG SAMA', DROP);
    });

    it('F30: does not swallow a failed pg_restore', () => {
        // The defect: `pg_restore ... | grep ... || true` discarded the exit
        // status, so a restore that failed part-way fell through to the row-count
        // comparison and the script could still print LULUS.
        expect(body).not.toMatch(/pg_restore[\s\S]{0,500}?\|\|\s*true/);
        // A pipeline's status is its LAST command's, so `$?` after a pipe would
        // read grep's status. PIPESTATUS is what actually carries pg_restore's.
        expect(body).toMatch(/PIPESTATUS\[0\]|RESTORE_STATUS/);
        // And the failure must stop the run before any success is printed.
        refusesBefore('RESTORE_STATUS" -ne 0', 'HASIL: LULUS');
    });

    it('F30: cannot report LULUS unless every table was actually compared', () => {
        // An unreadable count compares as a plain string, and a missing counts
        // file exits 2 — but a restore that produced no rows left the loop with
        // nothing to compare, FAILED stayed 0, and the drill printed LULUS having
        // verified nothing. Silence must not read as proof.
        expect(body).toMatch(/COMPARED/);
        refusesBefore('COMPARED" -eq 0', 'HASIL: LULUS');
    });

    it('F30: an unreadable count is a FAILURE, never a match', () => {
        // Found by RUNNING the drill, not by reading it, and it is the subtlest
        // defect in the script. The backup records `RALAT` for a table that did
        // not exist when it ran; the drill's own query fails there too; the two
        // strings compare EQUAL and the table is reported as `sama`. A run showed
        // `RALAT sama RALAT` for five tables while the summary still read LULUS.
        // Two failures agreeing prove nothing, and it hides precisely the case the
        // comparison exists to catch: a table that did not come back.
        expect(body).toMatch(/expected"\s*=\s*"RALAT"|actual"\s*=\s*"RALAT"/);
        // The unreadable branch must set the failure flag.
        const branch = body.slice(
            body.indexOf('TIDAK DAPAT DISEMAK') - 400,
            body.indexOf('TIDAK DAPAT DISEMAK') + 200,
        );
        expect(branch).toMatch(/RALAT/);
        expect(branch).toMatch(/FAILED=1/);
    });

    it('F31: a same-host, different-database drill is ALLOWED', () => {
        // The counterpart to the refusal: on a self-hosted server the live and
        // drill databases share a host and differ only by name. Refusing on the
        // host alone blocked the correct usage, and a guard people work around
        // protects nothing. Both parts must be compared.
        // Asserted as a single unit — the whole condition, not two loose
        // patterns that can each be satisfied by different lines. The earlier
        // version matched the header line alone and passed even after the
        // database-name comparison was removed.
        expect(body).toMatch(
            /\$DRILL_HOST"\s*=\s*"\$LIVE_HOST"\s*\]\s*&&\s*\[\s*"\$DRILL_DB"\s*=\s*"\$LIVE_DB"/,
        );
        expect(body).toMatch(/LIVE_DB="\$\(printf/);
    });

    it('F30: reports a failure when the dump could not be read at all', () => {
        // The counts check must come BEFORE the success branch, so a mismatch is
        // always reached before anything positive is printed.
        refusesBefore('FAILED" -eq 0', 'HASIL: LULUS');
        // The failure branch must exist and actually exit non-zero.
        expect(body).toMatch(/HASIL: GAGAL/);
        expect(body).toMatch(/exit 1/);
    });
});
