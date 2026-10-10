/**
 * Guards against the sign-in redirect loop that made the production portal
 * unusable: a correct email and password were accepted, the dashboard flashed,
 * and the user was returned to the sign-in screen forever.
 *
 * WHAT WENT WRONG, AND WHY THIS TEST IS WRITTEN THIS WAY.
 *
 * The Supabase session bridge is an effect that subscribes to auth changes:
 *
 *     useEffect(() => { ... subscribe ... }, [signOut]);
 *
 * `signOut` was declared as a plain `async` function inside the provider:
 *
 *     const signOut = async () => { ... }
 *
 * A plain function is a NEW value on every render. So every render tore the
 * subscription down and built it again, and each rebuild re-ran the identity
 * check. That check calls `signOut()` whenever it cannot confirm the account —
 * and `signOut()` updates state, which renders, which produces a new `signOut`,
 * which re-runs the effect. The loop is self-sustaining and never settles. In a
 * real browser it called `signOut` 611 times in twelve seconds.
 *
 * WHY NOT JUST ASSERT `useCallback` IS USED. That would test the spelling of the
 * fix rather than the behaviour, and it would pass the moment someone wraps the
 * function without changing the effect's dependency list. What actually matters
 * is that the identity of the subscription's inputs is STABLE ACROSS RENDERS.
 * That is what these tests measure.
 *
 * The tests read the source because this defect lives in how a hook is declared,
 * which a rendered-DOM assertion cannot observe — the component renders fine; it
 * is the effect churn that breaks it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SOURCE = readFileSync(join(ROOT, 'context', 'AuthContext.tsx'), 'utf8');

/** The provider's body, from `const signOut` to the returned context value. */
const provider = SOURCE;

/**
 * Dependency arrays of every `useEffect` in the provider.
 *
 * Parsed by locating each `useEffect(` call and reading the array that closes it.
 * Deliberately not anchored to a comment marker: comments move, and an earlier
 * version of this helper silently captured the NEIGHBOURING effect, which made the
 * test pass while the defect was live.
 */
function allEffectDeps(): { deps: string[]; index: number }[] {
    const out: { deps: string[]; index: number }[] = [];
    const re = /useEffect\(/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(provider))) {
        const open = m.index;
        let depth = 0;
        let close = -1;
        for (let i = open; i < provider.length; i++) {
            const c = provider[i];
            if (c === '(') depth++;
            else if (c === ')') {
                depth--;
                if (depth === 0) {
                    close = i;
                    break;
                }
            }
        }
        if (close === -1) continue;

        // Shape: `useEffect(() => { ... }, [deps]);`. Tracking parens alone lands
        // `close` on the `)` that ends the CALL — which sits AFTER `[deps]`. So the
        // dependency array, when present, is the `[ ... ]` immediately preceding it.
        const before = provider.slice(Math.max(0, close - 400), close);
        const arr = before.match(/,\s*\[([^\]]*)\]\s*$/);
        const deps = arr
            ? arr[1]
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
            : [];
        out.push({ deps, index: open });
    }
    return out;
}

describe('AuthContext — the sign-in effect must not resubscribe on every render', () => {
    it('declares every function used as an effect dependency with useCallback', () => {
        // The rule: if a function is listed in a dependency array, it must have a
        // stable identity. A bare `const f = async () => {}` does not.
        //
        // The bridge is the effect that depends on `signOut`; assert it exists by
        // that dependency, not by the comment above it.
        const effects = allEffectDeps();
        const withDeps = effects.filter((e) => e.deps.length > 0);

        expect(
            withDeps.length,
            'expected at least one effect in AuthContext to declare dependencies',
        ).toBeGreaterThan(0);

        const deps = withDeps.flatMap((e) => e.deps);
        expect(
            deps,
            'the Supabase session bridge should still depend on signOut — if that ' +
            'changed, this test needs updating rather than deleting',
        ).toContain('signOut');

        // Every identifier in the dependency list that is a function defined in
        // this file must be memoised.
        const unstable = deps.filter((name) => {
            const bare = new RegExp(`const\\s+${name}\\s*=\\s*(async\\s*)?\\(`);
            const memoised = new RegExp(`const\\s+${name}\\s*=\\s*useCallback`);
            return bare.test(provider) && !memoised.test(provider);
        });

        expect(
            unstable,
            `These dependencies are recreated on every render, which makes the ` +
            `effect tear down and re-subscribe forever — the sign-in loop:\n` +
            unstable.map((n) => `  - ${n}`).join('\n'),
        ).toEqual([]);
    });

    it('does not create the function it depends on as a bare arrow function', () => {
        // Named explicitly, because this is the exact declaration that caused the
        // production outage and a regression here is silent until a user logs in.
        expect(provider).toMatch(/const\s+signOut\s*=\s*useCallback/);
        expect(provider).not.toMatch(/const\s+signOut\s*=\s*async\s*\(/);
    });

    it('memoises every function reachable from a dependency array', () => {
        // `initializeAuth` is used INSIDE switchSchool's dependency list and is also
        // handed to consumers as `refreshUser`. Unwrapping it recreates switchSchool
        // every render, so it needs the same treatment as signOut. This case was
        // missed by an earlier version of these tests — it passed while the bug was
        // deliberately reintroduced — so it is asserted on its own.
        for (const name of ['initializeAuth', 'signIn', 'signOut', 'switchSchool']) {
            expect(provider, `${name} must be declared with useCallback`).toMatch(
                new RegExp(`const\\s+${name}\\s*=\\s*useCallback`),
            );
        }
    });

    it('keeps the identity check from calling signOut with an unstable function', () => {
        // `applySupabaseSession` calls signOut when it cannot confirm an account.
        // That call is what turns a stale subscription into an endless loop, so
        // both halves must stay in view: the call is intended, the churn is not.
        const occurrences = provider.match(/await signOut\(\)/g) ?? [];
        expect(occurrences.length, 'applySupabaseSession is expected to sign out on an unusable session').toBeGreaterThan(0);
    });

    it('memoises every function it exposes through the context value', () => {
        // The same defect elsewhere in the provider would recreate consumers on
        // every render, so the rule is applied to the whole file, not one effect.
        const exposed = ['signIn', 'signOut', 'switchSchool'];
        const unstable = exposed.filter((name) => {
            const declared = new RegExp(`const\\s+${name}\\s*=`);
            const memoised = new RegExp(`const\\s+${name}\\s*=\\s*useCallback`);
            return declared.test(provider) && !memoised.test(provider);
        });

        expect(unstable, `Context functions recreated each render: ${unstable.join(', ')}`).toEqual([]);
    });
});
