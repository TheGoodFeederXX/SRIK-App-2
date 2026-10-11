/**
 * Guards for a teacher's own attendance.
 *
 * The screen called an Express endpoint that is not deployed, so checking in did
 * nothing while telling the teacher it had worked. These checks pin the two things
 * that make the replacement trustworthy: the teacher is never named by the caller
 * (the database resolves them from the session), and the today calculation is the
 * school's day rather than the device's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Strips comments so an explanatory mention is not mistaken for a call. */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODULE = read('src/lib/supabase/staffAttendance.ts');
const SELF = read('components/teacher/TeacherSelfAttendance.tsx');
const HISTORY = read('components/teacher/TeacherAttendanceHistoryScreen.tsx');

describe('teacher self-attendance', () => {
    it('reads and writes through the database functions, not the legacy client', () => {
        for (const [name, src] of [
            ['staffAttendance.ts', MODULE],
            ['TeacherSelfAttendance.tsx', SELF],
            ['TeacherAttendanceHistoryScreen.tsx', HISTORY],
        ] as const) {
            expect(code(src), `${name} still imports lib/api`).not.toMatch(
                /from\s+['"][^'"]*lib\/api['"]/,
            );
        }

        expect(code(MODULE)).toMatch(/rpc\('my_attendance_history'/);
        expect(code(MODULE)).toMatch(/rpc\('record_my_attendance'/);
        expect(code(MODULE)).toMatch(/rpc\('record_my_checkout'/);
    });

    it('never names a teacher: the database resolves them from the session', () => {
        // A `p_teacher_id` argument is the whole danger. The function has no such
        // parameter, so passing one would fail — but passing one would also mean
        // someone believed they could mark another teacher present.
        //
        // Scoped to `rpc(...)` calls on purpose. The module DOES carry a
        // `teacher_id` field, because the two screens render a row shape that has
        // one; an assertion over the whole file would fail on that display field
        // and teach the reader to loosen the check, which is how a real guard gets
        // abandoned.
        // The SELF-SERVICE calls only. `record_staff_attendance` and the office
        // readers DO take a teacher id, and should: the office is recording someone
        // else's day, which is the entire point of a register. The danger this guard
        // exists for is a teacher-facing screen naming the teacher, because passing
        // an id there means someone believed they could mark a COLLEAGUE present.
        //
        // Named explicitly rather than filtered by a pattern, so adding a third
        // teacher-facing call is a decision someone has to make here.
        const SELF_SERVICE = [
            'record_my_attendance',
            'record_my_checkout',
            'my_attendance_history',
        ];
        const allCalls: string[] = [...code(MODULE).matchAll(/rpc\([^)]*\)/g)].map(m => m[0]);
        expect(allCalls.length).toBeGreaterThan(0);

        const rpcCalls = allCalls.filter(c => SELF_SERVICE.some(n => c.includes(n)));
        expect(
            rpcCalls.length,
            'none of the self-service calls were found — this guard is checking nothing',
        ).toBe(SELF_SERVICE.length);

        for (const call of rpcCalls) {
            expect(call, `an rpc call names a teacher: ${call}`).not.toMatch(/teacher_id/);
            expect(call, `an rpc call names a teacher: ${call}`).not.toMatch(/p_teacher_id/);
        }
    });

    it('counts today at the school, not on the device', () => {
        // A teacher checking in late at night from a device set to another
        // timezone must still land on the school's day, or the row lands on the
        // wrong date.
        //
        // This asserts the DELEGATION rather than the timezone string. The module
        // must not carry its own copy of "what day is it at school": two copies can
        // disagree, and the disagreement would be a teacher and the register
        // naming different days with nothing to point at. The school's own helper
        // is the single definition, and the branding suite pins it to
        // Asia/Kuala_Lumpur.
        expect(code(MODULE)).toMatch(/from '\.\/attendance'|require\('\.\/attendance'\)/);
        expect(code(MODULE)).toMatch(/todayInKualaLumpur/);
        // And it must not build its own formatter, which is how a stray timezone
        // would creep back in.
        expect(code(MODULE)).not.toMatch(/new Intl\.DateTimeFormat/);
    });

    it('surfaces a refusal instead of reporting success', () => {
        // The database declines when the office already recorded today — a leave
        // approval, a medical certificate. Toast-ing "success" regardless is the
        // original defect in a new costume.
        const self = code(SELF);
        expect(self).toMatch(/result\.recorded/);
        expect(self).toMatch(/toast\.error/);
    });

    it('keeps one definition of how a day is displayed', () => {
        // Two screens showing the same day differently is the drift this avoids.
        expect(code(SELF)).toMatch(/toAttendanceView/);
        expect(code(HISTORY)).toMatch(/toAttendanceView/);
        expect(code(SELF)).not.toMatch(/function toView/);
    });
});
