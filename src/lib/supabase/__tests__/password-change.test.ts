/**
 * Guards for changing a password.
 *
 * Four screens — office, teacher, parent, student — each posted the current and new
 * password to an Express endpoint that is not deployed, so nobody could change
 * their password at all. They now share one function.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREENS = [
    'components/admin/ChangePasswordScreen.tsx',
    'components/teacher/TeacherChangePasswordScreen.tsx',
    'components/parent/ParentChangePasswordScreen.tsx',
];

describe('changing a password', () => {
    it('every screen uses the one function, not the undeployed client', () => {
        for (const rel of SCREENS) {
            const src = code(read(rel));
            expect(src, `${rel} still imports lib/api`).not.toMatch(/from\s+['"][^'"]*lib\/api['"]/);
            expect(src, `${rel} does not use changePassword`).toMatch(/changePassword\s*\(/);
        }
    });

    it('the current password is re-checked before the new one is applied', () => {
        // Supabase's updateUser will set a password for whoever holds the session.
        // In a staffroom that means an unlocked laptop could be used to LOCK THE
        // OWNER OUT. The check exists so the person typing must already know the
        // current password, and so a wrong one never reaches the update.
        const auth = code(read('src/lib/supabase/auth.ts'));
        const fn = auth.slice(auth.indexOf('export async function changePassword'));
        expect(fn, 'changePassword does not check the current password').toMatch(
            /signInWithEmail\(email,\s*currentPassword\)/,
        );
        // And it must STOP on a wrong password rather than continuing.
        expect(fn, 'a wrong current password does not stop the change').toMatch(
            /if \(!check\.success\)[\s\S]{0,200}return/,
        );
    });

    it('the minimum length is stated ONCE and agrees with the server (audit F39)', () => {
        // A screen that accepts 6 characters while the function refuses anything under 10
        // tells the user "too short" AFTER they have typed the current one, which reads as a
        // broken screen.
        //
        // THE OLD SHAPE OF THIS TEST pinned a hard-coded `/newPassword\.length < N/` inside
        // `changePassword` and required every screen to repeat the same number. That is how
        // the number DRIFTED: four screens, one function, and nothing tying them to the
        // server. The check now lives once — `describePasswordProblem`, which reads
        // `PASSWORD_MIN_LENGTH` — and every screen calls `changePassword` instead of
        // re-implementing the rule. So this test asserts the SINGLE SOURCE rather than
        // four copies of a magic number.
        const raw = read('src/lib/supabase/auth.ts');
        const auth = code(raw);

        // The rule is defined once, at the server's real minimum of 10.
        const defs = auth.match(/export const PASSWORD_MIN_LENGTH = (\d+);/g) ?? [];
        expect(defs, 'PASSWORD_MIN_LENGTH must be defined exactly once').toHaveLength(1);
        const min = defs[0].match(/(\d+)/)![1];
        expect(min, 'the minimum must match the server, which requires 10').toBe('10');

        // And no screen re-implements it. A second copy is how the two disagree again.
        for (const rel of SCREENS) {
            const src = code(read(rel));
            expect(src, `${rel} re-implements the length rule`).not.toMatch(
                /newPassword\.length\s*</,
            );
            expect(src, `${rel} does not use changePassword`).toMatch(/changePassword\s*\(/);
        }
    });
});
