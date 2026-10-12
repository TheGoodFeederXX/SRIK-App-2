/**
 * AUDIT F34 — the status document must not describe a system that does not exist.
 *
 * THE DEFECT. `CODEBASE_AUDIT.md` carried a table claiming "196 jadual", "99 daripada 196
 * jadual tiada RLS", "65 fail route, ~300+ endpoint", "medan multi-tenant hadir" and
 * "Setiap sekolah mesti ditambah school_id". Every one of those describes the Express + Prisma
 * backend that was deleted and is NOT deployed — the live site has no `api/` at all, and
 * `/api` returns `index.html` rather than JSON. The document was even titled for a different
 * project and dated months earlier.
 *
 * WHY A TEST AND NOT JUST A DELETION. A deleted lie grows back: somebody re-reads an old
 * branch, pastes the table in again, and the next reader has no way to tell it is stale. These
 * checks fail the moment a superseded claim returns, so the correction survives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC = resolve(__dirname, '../../CODEBASE_AUDIT.md');

describe('F34 — the status document is about THIS project', () => {
    it('exists and states the real table count, not the legacy one', () => {
        expect(existsSync(DOC)).toBe(true);
        const text = readFileSync(DOC, 'utf8');

        // The legacy figures. Each described the deleted Express/Prisma system.
        expect(text).not.toContain('196 jadual');
        expect(text).not.toContain('99 daripada 196');
        expect(text).not.toContain('65 fail route');
        expect(text).not.toContain('300+ endpoint');
        expect(text).not.toContain('multi-tenant fields present');

        // And it says what is actually true: 37 real tables, all forced-RLS.
        expect(text).toContain('37 jadual');
        expect(text).toContain('37 daripada 37');
    });

    it('does not claim the project is multi-tenant or needs a school_id', () => {
        const text = readFileSync(DOC, 'utf8');

        // SRIK is ONE school. A recommendation to add tenant columns is advice for a
        // different product, and following it would corrupt a schema with no such concept.
        //
        // The patterns below match a CLAIM that the columns exist or ought to be added —
        // not a denial of them. The document is allowed, and expected, to say "there is no
        // `school_id`", because that denial is the correction. Matching the bare token would
        // fail the very sentence that fixes the problem.
        expect(text).not.toMatch(/mesti ditambah/i);
        expect(text).not.toMatch(/medan multi-tenant/i);
        expect(text).not.toMatch(/hadir.*school_id|school_id.*hadir/i);
        expect(text).toMatch(/satu sekolah sahaja/i);
        expect(text).toMatch(/tiada `school_id`/i);
    });

    it('records the blockers that are real rather than quietly dropping them', () => {
        const text = readFileSync(DOC, 'utf8');

        // The leaked-password protection genuinely cannot be enabled on this plan. A status
        // document that omits it would be the same failure in the opposite direction.
        expect(text).toMatch(/HaveIBeenPwned/);
        expect(text).toMatch(/pelan Pro/);

        // The undeployed Edge Functions, and the empty people data.
        expect(text).toMatch(/provision-teacher-account/);
        expect(text).toMatch(/Belum dimuatkan|belum dimuatkan/);
    });

    it('warns the next writer to separate old evidence from current claims', () => {
        const text = readFileSync(DOC, 'utf8');
        expect(text).toMatch(/bukti lama/i);
        expect(text).toMatch(/lebih buruk daripada tiada dokumen/i);
    });
});
