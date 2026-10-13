import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import StudentCBTPlayerScreen from '../cbt/StudentCBTPlayerScreen';

/**
 * This suite used to test an exam-playback screen: resuming an attempt, holding an absolute
 * deadline, submitting answers, showing the score the server returned.
 *
 * THE SCREEN IS GONE, AND THE POINT OF THIS FILE CHANGED WITH IT. It played a computer-based
 * test whose questions came from an undeployed server and whose submitted answers went to
 * nothing — no question table, no submission table. A child could have sat a test, submitted
 * it, and seen it acknowledged, while the school received nothing. The most misleading thing
 * the old screen could do was the thing its tests cared about most: recovering an attempt.
 *
 * Those requirements are still real, and they now belong to a screen the school will build
 * deliberately. What this file guards today is that the placeholder does not quietly become
 * a test again, and does not pretend a child has been examined.
 */
describe('StudentCBTPlayerScreen — no examination can be sat here', () => {
    beforeEach(() => localStorage.clear());

    it('offers no way to take, submit or resume a test', () => {
        localStorage.clear();
        render(<StudentCBTPlayerScreen handleBack={() => {}} />);

        // No controls that imply work is being collected. Each of these was on the old
        // screen, and each would tell a child their answers had been received.
        expect(screen.queryByRole('button', { name: /start exam|submit|i am ready|next question/i })).toBeNull();

        // Nothing is persisted: an attempt that cannot be sent must not survive a reload and
        // look like progress.
        expect(localStorage.length).toBe(0);
    });

    it('says plainly that computer-based tests are not available', () => {
        render(<StudentCBTPlayerScreen handleBack={() => {}} />);

        expect(screen.getByText(/computer-based test/i)).toBeTruthy();
        // And it points at the route that DOES record a mark, so a teacher is not left
        // without a way to enter one.
        expect(screen.getByText(/menu Penilaian/i)).toBeTruthy();
    });
});
