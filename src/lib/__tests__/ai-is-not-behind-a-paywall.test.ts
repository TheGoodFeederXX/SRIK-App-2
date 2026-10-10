/**
 * AI tools are NOT behind a vendor paywall.
 *
 * WHY THIS IS TESTED. AI used to be sold as an "Advanced plan" add-on: a module
 * flag defaulted to FALSE, and the only thing that ever set it TRUE was the
 * subscription gate. Two consequences make this worth a permanent test:
 *
 *   1. Removing the billing layer WITHOUT noticing that wiring leaves the flag
 *      permanently FALSE — every AI tool then fails as though it were broken,
 *      which looks like a bug in the feature rather than a missing payment.
 *   2. The screens carried their own lock: a frosted overlay with a real payment
 *      button priced at RM2,000/term, charged in NAIRA through the vendor's
 *      gateway. A parent's AI tip screen was a checkout page for another company.
 *
 * The school runs its own system and bills its own families in Ringgit at the
 * office. Nothing in the app should ask anyone to pay a third party.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sourceFiles(full, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
}

describe('AI is available to the school, not sold to it', () => {
    it('THE RULE: the AI flag defaults to open', () => {
        const ai = readFileSync(join(ROOT, 'lib', 'ai.ts'), 'utf8');
        const m = ai.match(/let __aiAllowed = (true|false)/);
        expect(m, '__aiAllowed not found in lib/ai.ts').not.toBeNull();
        // FALSE here would silently disable every AI tool in the app.
        expect(m![1], 'AI defaults to off — every AI tool will fail').toBe('true');
    });

    it('THE RULE: no AI screen is wrapped in a payment lock', () => {
        for (const screen of [
            'components/teacher/AIGameCreatorScreen.tsx',
            'components/student/StudyBuddy.tsx',
            'components/parent/AIParentingTips.tsx',
        ]) {
            const text = readFileSync(join(ROOT, screen), 'utf8');
            expect(text, `${screen} still references a lock`).not.toMatch(/AIFeatureLock|AIUnlockCard/);
        }
    });

    it('THE RULE: the lock components are gone', () => {
        expect(existsSync(join(ROOT, 'components/shared/AIFeatureLock.tsx'))).toBe(false);
        expect(existsSync(join(ROOT, 'components/shared/AIUnlockCard.tsx'))).toBe(false);
    });

    it('THE RULE: nothing charges a parent or teacher for AI', () => {
        // A payment call anywhere in an AI screen means the paywall came back.
        const offenders: string[] = [];
        for (const file of [
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'src')),
        ]) {
            const text = readFileSync(file, 'utf8');
            if (/usePaystackPayment|PaystackButton/.test(text)) {
                offenders.push(file.replace(ROOT + '/', ''));
            }
        }
        expect(offenders, `payment gateway still wired up:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('THE RULE: the whole billing layer is gone', () => {
        // Every file in this list existed only to sell access to the app.
        for (const path of [
            'components/subscription/SubscriptionPage.tsx',
            'components/subscription/DemoCheckoutModal.tsx',
            'components/shared/PlanLockScreen.tsx',
            'components/shared/SubscriptionLockScreen.tsx',
            'components/shared/RenewalBanner.tsx',
            'components/ui/TrialBanner.tsx',
            'components/admin/TermBillingStatus.tsx',
            'components/admin/saas',
            'hooks/useSubscriptionGate.ts',
            'lib/hooks/usePlanStatus.ts',
        ]) {
            expect(existsSync(join(ROOT, path)), `${path} still exists`).toBe(false);
        }
    });

    it('THE RULE: nothing tells a user to pay a third party', () => {
        const offenders: string[] = [];
        for (const file of [
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'src')),
            ...sourceFiles(join(ROOT, 'hooks')),
            join(ROOT, 'App.tsx'),
        ]) {
            const text = readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                if (/Renew your subscription|Upgrade to Advanced|Upgrade to the .*plan|payment required|cannot be deleted.*Demo/i.test(line)) {
                    offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 90)}`);
                }
            });
        }
        expect(offenders, `vendor billing copy still shown:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('THE RULE: the school keeps its own fee screens', () => {
        // Removing the VENDOR billing must not remove the school's own finance
        // screens, which handle RM150/200/30 charged by the office.
        for (const path of [
            'components/admin/FeeCollectionScreen.tsx',
            'components/admin/FeeManagementScreen.tsx',
            'components/admin/StudentFeesScreen.tsx',
            'src/lib/supabase/finance.ts',
            'src/lib/supabase/parentFees.ts',
        ]) {
            expect(existsSync(join(ROOT, path)), `${path} was removed by mistake`).toBe(true);
        }
    });
});
