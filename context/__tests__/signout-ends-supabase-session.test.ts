import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard test for audit finding F04: signing out did not end the Supabase session.
//
// WHAT WENT WRONG. `signOut()` in AuthContext cleared an exhaustive list of local
// state — sessionStorage tokens, localStorage tokens, the persisted IndexedDB
// query cache, the offline write store, and every React state field. It then
// relied on "user/role is null, so App.tsx shows the login screen".
//
// That is a UI sign-out, not an authentication sign-out. The Supabase session and
// its refresh token stayed valid, so the credential was still live server-side.
// The screen said "logged out" while the account was still signed in — which is
// precisely the state a shared staffroom device must never be left in.
//
// Considered and dismissed as the cause: whether the tokens were cleared. They
// were, thoroughly. The clearing was never the problem — it was the thing done
// INSTEAD of ending the session, which made the gap easy to miss.
const ROOT = join(__dirname, '..', '..');

function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => (line.trim().startsWith('//') ? '' : line))
        .join('\n');
}

const body = code(readFileSync(join(ROOT, 'context', 'AuthContext.tsx'), 'utf8'));

describe('signOut ends the Supabase session (F04)', () => {
    it('calls the Supabase sign-out helper', () => {
        expect(body).toMatch(/supabaseSignOut\s*\(/);
    });

    it('does not leave the helper imported but unused', () => {
        // The defect in its most literal form: the import was there, the call was
        // not. An unused import is not harmless here — it looked like the work had
        // been done, so nobody re-checked whether the session was actually ended.
        expect(body).toMatch(/import[\s\S]{0,200}?signOut as supabaseSignOut/);
        const importLine = body.split('\n').find((l) => l.includes('signOut as supabaseSignOut')) ?? '';
        expect(importLine).not.toBe('');
        // Counted as CALLS, so the import itself is not mistaken for a use.
        const calls = (body.match(/supabaseSignOut\s*\(/g) ?? []).length;
        expect(calls).toBeGreaterThanOrEqual(1);
    });

    it('ends the session as part of signOut, not somewhere unrelated', () => {
        // Ordering matters for a reason the code cannot state: the remote call is
        // awaited BEFORE local state is torn down, so the request still carries the
        // access token it needs to identify the session. Clearing state first would
        // leave nothing to revoke.
        const signOutAt = body.indexOf('const signOut = useCallback');
        expect(signOutAt).toBeGreaterThan(-1);
        const remoteAt = body.indexOf('supabaseSignOut(', signOutAt);
        expect(remoteAt).toBeGreaterThan(signOutAt);
        // And the token clearing must come after it. Anchored on the FIRST
        // sessionStorage removal inside this function, which is the start of the
        // teardown. Two weaker anchors were tried first and both failed to catch a
        // reordering: `setUser(null)` matched a different branch further down, and
        // `startTransition` is separated from the token clearing by enough lines
        // that a block move still landed before it.
        const teardownAt = body.indexOf('sessionStorage.removeItem', signOutAt);
        expect(teardownAt).toBeGreaterThan(remoteAt);
    });

    it('still clears local state, so a failed remote call cannot trap the user', () => {
        // The remote sign-out must not be able to leave someone stuck in a
        // signed-in UI: if the network is down, the local teardown still has to
        // run. This asserts the earlier, correct work was not traded away.
        expect(body).toMatch(/setUser\(null\)/);
        expect(body).toMatch(/queryClient\.clear\(\)/);
        expect(body).toMatch(/removeClient\(\)/);
        expect(body).toMatch(/clearAll\(\)/);
    });
});
