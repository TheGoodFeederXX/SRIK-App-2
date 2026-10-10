/**
 * The role system must describe THIS school's three roles.
 *
 * WHY THIS FILE EXISTS. Role codes arrive from the database and are matched
 * against an enum. When the two disagree the match fails silently, and a
 * fallback decides instead — which is how two real defects reached this codebase:
 *
 *   1. `DashboardType` listed ten values, six of which (SUPER_ADMIN, PROPRIETOR,
 *      INSPECTOR, EXAM_OFFICER, COMPLIANCE_OFFICER, COUNSELOR) were not roles at
 *      this school. The database holds exactly three: ADMIN, TEACHER, GUARDIAN.
 *   2. The database calls a parent **GUARDIAN**, but the enum and the UI said
 *      **PARENT**. Nothing reconciled them, so a guardian matched no case and fell
 *      through to a fallback — and the fallbacks were `DashboardType.Admin` in one
 *      path and `DashboardType.Teacher` in another. A parent could therefore be
 *      handed the administration dashboard, or the teacher dashboard, with its
 *      navigation and screens.
 *
 * Neither failure produced an error. Both are exactly the kind of bug a test can
 * hold down, because the correct answer is a fixed, checkable list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { DashboardType } from '../../../types';

const ROOT = join(__dirname, '..', '..', '..');

/** The role codes the live database holds. Verified against the project. */
const DATABASE_ROLES = ['ADMIN', 'TEACHER', 'GUARDIAN'];

/** Names from the product this code was adapted from. None is a role here. */
const FOREIGN_ROLES = [
    'SUPER_ADMIN', 'PROPRIETOR', 'INSPECTOR',
    'EXAM_OFFICER', 'COMPLIANCE_OFFICER', 'COUNSELOR',
];

describe('the role system describes this school', () => {
    it('THE RULE: every database role has a dashboard value', () => {
        const values = Object.values(DashboardType) as string[];
        for (const role of DATABASE_ROLES) {
            expect(values, `no dashboard value for the real role ${role}`).toContain(role);
        }
    });

    it('THE RULE: no vendor role survives in the enum', () => {
        const values = Object.values(DashboardType) as string[];
        for (const role of FOREIGN_ROLES) {
            expect(values, `${role} is not a role at this school`).not.toContain(role);
        }
    });

    it('THE RULE: GUARDIAN and PARENT are both understood', () => {
        // The database says GUARDIAN; the UI speaks of a parent. Both must resolve
        // to something, or a real parent falls through to a fallback.
        expect(DashboardType.Guardian).toBe('GUARDIAN');
        expect(DashboardType.Parent).toBe('PARENT');
    });

    it('THE RULE: an unknown role never opens an admin dashboard', () => {
        // THE FIX THIS GUARDS. The original fallback was `DashboardType.Admin` in
        // `getDashboardTypeFromUserType`, so ANY unrecognised role — including the
        // real GUARDIAN code — opened the most powerful dashboard in the app.
        const ctx = readFileSync(join(ROOT, 'context', 'AuthContext.tsx'), 'utf8');
        const fn = ctx.slice(ctx.indexOf('const getDashboardTypeFromUserType'));
        const body = fn.slice(0, fn.indexOf('};'));
        // The final return must not be Admin.
        const lastReturn = body.lastIndexOf('return DashboardType.');
        expect(body.slice(lastReturn), 'an unknown role is given the Admin dashboard')
            .not.toContain('DashboardType.Admin');
    });

    it('THE RULE: a guardian is never given the teacher dashboard', () => {
        // The real Supabase login path used "ADMIN, else TEACHER", so a GUARDIAN
        // became a TEACHER. It must test for GUARDIAN explicitly.
        const ctx = readFileSync(join(ROOT, 'context', 'AuthContext.tsx'), 'utf8');
        const at = ctx.indexOf("data.roles.includes('ADMIN')");
        expect(at, 'the identity role mapping was not found').toBeGreaterThan(-1);
        const block = ctx.slice(at, at + 600);
        expect(block, 'GUARDIAN is not considered when mapping a real login')
            .toContain("roles.includes('GUARDIAN')");
    });

    it('THE RULE: no shipped file names a vendor role', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'].includes(name)) continue;
                const full = join(dir, name);
                if (statSync(full).isDirectory()) walk(full);
                else if (/\.tsx?$/.test(name)) {
                    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                        // Skip comment lines: several files explain WHY these roles
                        // were removed, and that explanation is worth keeping.
                        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
                        for (const role of FOREIGN_ROLES) {
                            if (new RegExp(`['"\`]${role}['"\`]`).test(line) || line.includes(`DashboardType.${role.replace(/_([A-Z])/g, (_, c) => c)}`)) {
                                offenders.push(`${full.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 80)}`);
                            }
                        }
                    });
                }
            }
        };
        for (const dir of ['components', 'lib', 'src', 'hooks', 'context', 'types']) {
            if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
        }
        expect(offenders, `vendor roles still referenced:\n${offenders.join('\n')}`).toEqual([]);
    });
});
