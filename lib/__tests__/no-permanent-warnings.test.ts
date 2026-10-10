/**
 * Guards the two permanent warnings that used to sit on every screen.
 *
 * THE PROBLEM THIS PREVENTS.
 *
 * Users saw a constant orange "Live updates unavailable — reconnecting…" banner
 * and a red "Database Connection Error" bar. Neither reported a real fault:
 * the database was healthy and the deployment simply has no realtime server.
 * Both warnings were produced by asking the OLD Express backend whether it was
 * alive — a server this project no longer deploys.
 *
 * The realtime one is the more interesting bug, because the code was already
 * written to avoid it and did so by accident:
 *
 *   - `RealtimeStatusIndicator` hides the banner when the status is
 *     `'unavailable'` (correctly: nothing to reconnect to, the app polls).
 *   - `socketService.isRealtimeSupported()` probes `/health` and, on ANY
 *     failure, set `realtimeSupported = true` with the comment "unknown → let
 *     the socket try".
 *
 * On this deployment `/api/health` is caught by the SPA rewrite and returns
 * index.html, so `r.json()` always throws, so the catch always ran, so the probe
 * always claimed realtime was supported. The socket then tried, failed, and sat
 * in `'connecting'` forever — never reaching `'unavailable'`, so the banner
 * never hid. A probe that cannot be answered had not proved anything, and
 * "unknown" silently became "supported".
 *
 * WHY THESE ASSERTIONS. Reading the source is the right level here: the defect
 * is which branch a fallback takes, which a rendered assertion cannot reach
 * without a live socket server. The tests therefore pin the BEHAVIOUR that
 * matters — an unanswerable probe must not claim support — rather than the
 * spelling of the fix.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Source with comments removed.
 *
 * These tests assert on absent patterns ("must NOT contain a bare
 * `checkBackendHealth()`"), so an explanatory comment that names the removed
 * call would fail them. That happened here — the fix's own comment describing
 * the old code matched the pattern for the old code. Comments are not behaviour,
 * so they are stripped before matching; the code is what is being tested.
 */
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments, keeping `https://`
}

const socket = code(readFileSync(join(ROOT, 'lib', 'socketService.ts'), 'utf8'));
const dashboard = code(readFileSync(join(ROOT, 'components', 'admin', 'AdminDashboard.tsx'), 'utf8'));
const indicator = code(
    readFileSync(join(ROOT, 'components', 'shared', 'RealtimeStatusIndicator.tsx'), 'utf8'),
);

describe('realtime capability probe', () => {
    it('does not claim realtime works when the probe cannot be answered', () => {
        // The exact regression: `unknown → let the socket try`. A failed probe
        // must resolve to false, or the banner sticks forever on a host that has
        // no realtime server.
        expect(
            socket,
            'a failed /health probe must resolve realtime as UNSUPPORTED — ' +
            'treating it as supported leaves the banner pinned to every screen',
        ).not.toMatch(/catch\(\(\)\s*=>\s*\(?realtimeSupported\s*=\s*true/);
    });

    it('checks the response is JSON before parsing it', () => {
        // The SPA rewrite answers /health with index.html, so `.json()` throws on
        // every request. Without a content-type check, that throw is what the
        // fallback mistook for a network blip.
        expect(socket).toMatch(/content-type/i);
        expect(socket).toMatch(/application\/json/);
    });

    it('resolves the probe to a definite answer rather than leaving it pending', () => {
        // Every terminal path must set `realtimeSupported`, otherwise the value
        // stays null, `probe` is cleared, and each call re-probes forever.
        expect(socket).toMatch(/realtimeSupported\s*=\s*j\?\.realtime\s*!==\s*false/);
        expect(socket).toMatch(/realtimeSupported\s*=\s*(false|j)/);
    });

    it('keeps the banner hidden for the unavailable status', () => {
        // The component's own contract — if this is relaxed, the fix above stops
        // mattering because 'connecting' would still be shown.
        expect(indicator).toMatch(/status\s*===\s*'connected'\s*\|\|\s*status\s*===\s*'unavailable'/);
    });

    it('does not start in the connecting state', () => {
        // The third and final cause of the banner, and the one that survived the
        // other fixes. 'connecting' promises an attempt; on this host nothing is
        // attempted, because the socket is only initialised WITH A SCHOOL ID and a
        // Supabase session supplies none. So the status never changed, the banner
        // never hid, and it waited forever for a connection that was never started.
        //
        // 'unavailable' is the honest initial state. A real connection attempt
        // still sets 'connecting' itself inside connect().
        const initial = socket.match(/private\s+status\s*:\s*RealtimeStatus\s*=\s*'(\w+)'/);
        expect(initial, 'the service should declare an initial status').not.toBeNull();
        expect(
            initial![1],
            'the initial socket status must be "unavailable", not "connecting" — ' +
            '"connecting" shows a permanent "reconnecting…" banner on a host with ' +
            'no realtime server',
        ).toBe('unavailable');
    });

    it('still sets connecting when a socket is actually attempted', () => {
        // The counterweight to the test above: 'unavailable' at rest must not
        // become "never reports progress" if a realtime server is added later.
        expect(socket).toMatch(/setStatus\('connecting'\)/);
    });
});

describe('admin database status indicator', () => {
    it('does not report the database as down based on the legacy backend', () => {
        // `api.checkBackendHealth()` asks the Express server this project no
        // longer deploys, so it always failed and the red bar always showed.
        expect(
            dashboard,
            'the database status must not be derived from the removed legacy backend',
        ).not.toMatch(/api\.checkBackendHealth\(\)/);
    });

    it('checks Supabase, with a count that an empty table cannot fail', () => {
        // A row fetch would be ambiguous: the school legitimately has 0 students.
        // `head: true` asks for a count only, so "empty" is a success, not an error.
        expect(dashboard).toMatch(/from\('students'\)/);
        expect(dashboard).toMatch(/count:\s*'exact'/);
        expect(dashboard).toMatch(/head:\s*true/);
    });

    it('still reports an error when the check genuinely fails', () => {
        // The fix must not be "never show the warning". A real failure should
        // still say so, otherwise a broken connection looks like an empty school.
        expect(dashboard).toMatch(/setDbStatus\(error\s*\?\s*'error'\s*:\s*'connected'\)/);
    });
});
