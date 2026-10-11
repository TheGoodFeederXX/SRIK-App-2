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
    'components/student/StudentChangePasswordScreen.tsx',
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

    it('the minimum length agrees between the screen and the function', () => {
        // A screen that accepts 6 characters while the function refuses anything
        // under 8 tells the user "your new password is too short" AFTER they have
        // typed the current one, which reads as a broken screen.
        const auth = code(read('src/lib/supabase/auth.ts'));
        const fn = auth.slice(
            auth.indexOf('export async function changePassword'),
            auth.indexOf('export async function changePassword') + 900,
        );
        const m = fn.match(/newPassword\.length < (\d+)/);
        expect(m, 'the function has no minimum length').not.toBeNull();
        const min = m![1];

        for (const rel of SCREENS) {
            const src = code(read(rel));
            expect(src, `${rel} uses a different minimum`).toMatch(
                new RegExp(`newPassword\\.length < ${min}`),
            );
        }
    });
});
