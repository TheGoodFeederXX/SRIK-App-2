/**
 * The failure banner a parent sees when a child's notes could not be checked.
 *
 * WHY THIS TEST EXISTS. The behaviour being protected is an ABSENCE that used to be
 * a lie. This banner is the only place a parent learns that a teacher has raised a
 * concern about their child. When the request failed, the component returned null —
 * no banner — and no banner is indistinguishable from "no concern has been raised".
 * A parent was reassured by a message that never arrived.
 *
 * So the test does not check "it renders". It checks that a FAILED request produces
 * a visible statement, and that the statement explicitly refuses to be read as
 * "there is nothing to know".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import ms from '../../../lib/i18n/locales/ms.json';
import en from '../../../lib/i18n/locales/en.json';

// The component calls the legacy client. Stub only that, so the real behaviour under
// test — what is rendered on failure — is untouched.
const getMyChildrenRisk = vi.fn();
vi.mock('../../../lib/api', () => ({
    api: { getMyChildrenRisk: (...a: any[]) => getMyChildrenRisk(...a) },
}));

import ChildRiskBanner from '../ChildRiskBanner';

const boot = (lng: string) => {
    i18n.addResourceBundle('ms', 'translation', ms, true, true);
    i18n.addResourceBundle('en', 'translation', en, true, true);
    i18n.changeLanguage(lng);
};

describe('a parent is told when their child\'s notes could not be checked', () => {
    beforeEach(() => {
        // Clear BEFORE each test: the component hides a note it has already shown
        // for seven days, so a marker left by an earlier test would suppress the
        // concern this test is checking for.
        localStorage.clear();
        boot('ms');
        getMyChildrenRisk.mockReset();
    });
    afterEach(() => {
        // The suite has no global cleanup, so without this the DOM from one test
        // remains in the next and getByText matches a previous render.
        cleanup();
        localStorage.clear();
    });

    it('says so when the request fails, instead of rendering nothing', async () => {
        getMyChildrenRisk.mockRejectedValue(new Error('boom'));

        const { container } = render(<ChildRiskBanner />);

        await waitFor(() => {
            expect(screen.getByText(i18n.t('childRiskBanner.weCouldNotCheckTheNotesAboutYourChild'))).toBeTruthy();
        });
        // The crucial part: not a blank render. A blank render is the old bug.
        expect(container.textContent ?? '').not.toBe('');
    });

    it('refuses to let the failure read as "nothing to know"', async () => {
        getMyChildrenRisk.mockRejectedValue(new Error('boom'));

        render(<ChildRiskBanner />);

        await waitFor(() => {
            expect(screen.getByText(i18n.t('childRiskBanner.thisDoesNotMeanThereIsNothingToKnow'))).toBeTruthy();
        });
        // The wording must actively deny the reassuring reading, not merely be present.
        const text = i18n.t('childRiskBanner.thisDoesNotMeanThereIsNothingToKnow');
        expect(text).toMatch(/tidak bermakna|does not mean/i);
    });

    it('still shows a real concern, and shows no failure banner when it worked', async () => {
        getMyChildrenRisk.mockResolvedValue([
            { student_id: 'aminah-1', student_name: 'Aminah', message: 'Cikgu ingin berbincang.' },
        ]);

        render(<ChildRiskBanner />);

        await waitFor(() => expect(screen.getByText(/Aminah/)).toBeTruthy());
        expect(screen.queryByText(i18n.t('childRiskBanner.weCouldNotCheckTheNotesAboutYourChild'))).toBeNull();
    });

    it('shows nothing at all when the request succeeds with no concerns', async () => {
        // The quiet case must stay quiet — the failure banner must not leak into it.
        getMyChildrenRisk.mockResolvedValue([]);

        const { container } = render(<ChildRiskBanner />);

        await new Promise(r => setTimeout(r, 50));
        await waitFor(() => expect(getMyChildrenRisk).toHaveBeenCalled());
        expect(container.textContent ?? '').toBe('');
    });

    it('the failure message exists in both languages', () => {
        for (const lng of ['ms', 'en']) {
            boot(lng);
            const a = i18n.t('childRiskBanner.weCouldNotCheckTheNotesAboutYourChild');
            expect(a, `${lng} first line`).not.toBe('childRiskBanner.weCouldNotCheckTheNotesAboutYourChild');
            expect(a.length, `${lng} first line too short`).toBeGreaterThan(20);
        }
    });
});