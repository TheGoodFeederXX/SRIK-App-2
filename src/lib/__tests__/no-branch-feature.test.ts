/**
 * There is ONE school, and no branch feature.
 *
 * WHY THIS FILE EXISTS. This codebase was adapted from a product where a school
 * group could have several branches. That idea was threaded through the whole app:
 * a context for switching branches, a switcher button in three headers, screens for
 * creating branches and moving people between them, a "select branch" picker on
 * forms, and a per-branch curriculum setting.
 *
 * CRITICALLY: this school's database has **no `branches` table at all**. So every one
 * of those features was calling an endpoint that could only return an empty list, and
 * every picker was rendered from a list that was always empty. None of it produced an
 * error — it just quietly did nothing, while making the code harder to reason about
 * and, in one case, BLOCKING a real task: the "Add Parent" form had a `required`
 * branch field with no options, so the browser refused to submit and the office could
 * not add a guardian.
 *
 * These tests hold the removal down at the level that matters: the features are gone,
 * and the one thing that must NOT be gone — the school's own identity, which the
 * header displays and screens pass to the server as a scope — still resolves.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** Files that existed only to run the multi-branch feature. */
const REMOVED_FILES = [
    'context/BranchContext.tsx',
    'components/shared/BranchSwitcher.tsx',
    'components/admin/BranchTransferScreen.tsx',
    'components/admin/BranchAcademicsScreen.tsx',
    'components/admin/AddBranchAdminScreen.tsx',
    'components/admin/SchoolManagementScreen.tsx',
    'components/shared/RoleBasedNavigation.tsx',
];

/** Wording that offered a branch choice to a user. */
const FORBIDDEN_UI_TEXT = [
    'All Branches',
    'Branch Transfers',
    'Manage Branches',
    'Branch Admin',
    'Select Branch',
    'Select branch',
    'Main Campus',
    'Semua Cawangan',
];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

describe('the branch feature is gone', () => {
    it('THE RULE: every branch-only file is deleted', () => {
        const stillThere = REMOVED_FILES.filter((f) => existsSync(join(ROOT, f)));
        expect(stillThere, `these still exist:\n${stillThere.join('\n')}`).toEqual([]);
    });

    it('THE RULE: no screen offers a branch choice', () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(join(ROOT, 'components'))) {
            const text = readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                // Comment lines are allowed: several files explain WHY the branch
                // code was removed, and that reasoning is worth keeping.
                if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;
                for (const phrase of FORBIDDEN_UI_TEXT) {
                    if (line.includes(phrase)) {
                        offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 70)}`);
                    }
                }
            });
        }
        expect(offenders, `branch choices still offered:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('THE RULE: the school identity still resolves', () => {
        // THE THING THAT MUST NOT BREAK. Removing branches must not take away the
        // school's own record — its name in the header, and the id screens pass to
        // the server as a scope parameter. That is the one job the old
        // branch-resolution code was really doing.
        const service = join(ROOT, 'backend', 'src', 'services', 'branchTransfer.service.ts');
        const controller = join(ROOT, 'backend', 'src', 'controllers', 'branch.controller.ts');
        const route = join(ROOT, 'backend', 'src', 'routes', 'branch.routes.ts');
        for (const f of [service, controller, route]) {
            expect(existsSync(f), `${f} must still exist`).toBe(true);
        }
        // The service must read the SCHOOL table, not a branch table.
        expect(readFileSync(service, 'utf8')).toMatch(/school/i);
        // The route must still expose the one scope lookup the app needs.
        expect(readFileSync(route, 'utf8')).toContain("/authorized");
    });

    it('THE RULE: no backend endpoint can create or delete a branch', () => {
        const route = readFileSync(join(ROOT, 'backend', 'src', 'routes', 'branch.routes.ts'), 'utf8');
        // A write route would be `router.post` / `router.put` / `router.delete`.
        expect(route, 'a branch write route survives').not.toMatch(/router\.(post|put|delete|patch)\s*\(/);
        const controller = readFileSync(join(ROOT, 'backend', 'src', 'controllers', 'branch.controller.ts'), 'utf8');
        for (const gone of ['createBranch', 'updateBranch', 'deleteBranch', 'transferUser']) {
            expect(controller, `${gone} still exported`).not.toContain(`export const ${gone}`);
        }
    });

    it('THE RULE: the school-scope context resolves one school, not a list to switch', () => {
        const ctx = join(ROOT, 'context', 'SchoolScopeContext.tsx');
        expect(existsSync(ctx), 'the school-scope context must exist').toBe(true);
        const text = readFileSync(ctx, 'utf8');
        // The switching API must be gone.
        expect(text).not.toContain('switchBranch');
        expect(text).not.toContain('canSwitchBranches');
        expect(text).not.toContain('allowAllOption');
        // The identity values must remain.
        expect(text).toContain('currentBranch');
        expect(text).toContain('activeBranchGeneratedId');
    });
});
