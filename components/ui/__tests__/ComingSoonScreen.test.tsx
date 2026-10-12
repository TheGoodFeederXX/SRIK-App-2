/**
 * The "not built yet" screen must speak the reader's language.
 *
 * WHY THIS EXISTS. 204 screens reach for this component when a feature the school
 * has not switched on. Every one of them passes its own fixed Malay paragraph, and
 * the component's own two strings — the back button and the accessibility label —
 * were hard-coded Malay as well. So a reader who had chosen English still got a
 * Malay screen, with a Malay button on it.
 *
 * The school's rule is that MALAY IS THE DEFAULT and English is selectable. A fixed
 * string cannot follow a choice, so those two strings now come from the locale
 * files, and a caller can move its paragraph across by passing a key.
 *
 * These tests change the language for real and assert what is on the screen. A
 * test that only checked the locale files contain the words would pass while the
 * component ignored them — which is the whole defect being fixed.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../../lib/i18n';
import ComingSoonScreen from '../ComingSoonScreen';

const renderScreen = (props: Partial<React.ComponentProps<typeof ComingSoonScreen>> = {}) =>
    render(
        <ComingSoonScreen
            title="Tajuk Ujian"
            explanation="Sebab ia belum siap."
            handleBack={() => {}}
            {...props}
        />,
    );

afterEach(async () => {
    await i18n.changeLanguage('ms');
});

describe('ComingSoonScreen follows the selected language', () => {
    it('shows the back button in Malay by default', async () => {
        await i18n.changeLanguage('ms');
        renderScreen();
        // Malay is the default language of the school, not a fallback to English.
        expect(screen.getByRole('button', { name: 'Kembali' })).toBeTruthy();
    });

    it('shows the SAME button in English once English is chosen', async () => {
        await i18n.changeLanguage('en');
        renderScreen();
        // THE DEFECT: this used to still read "Kembali", because it was hard-coded.
        expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Kembali' })).toBeNull();
    });

    it('translates the accessibility label too, not just the visible text', async () => {
        // A screen reader user has no other way to learn what the icon is. Leaving
        // this in Malay while the rest of the screen is English is the same defect
        // in a place that is easier to forget.
        await i18n.changeLanguage('en');
        renderScreen();
        const icon = screen.getByRole('img');
        expect(icon.getAttribute('aria-label')).toBe('Not available yet');
    });

    it('still shows a caller\'s own paragraph when no key is given', async () => {
        // 204 callers pass a fixed string. Migrating them is a separate, gradual job,
        // so the component must keep working for the ones not yet moved.
        await i18n.changeLanguage('en');
        renderScreen({ explanation: 'Ini sebab saya.' });
        expect(screen.getByText('Ini sebab saya.')).toBeTruthy();
    });

    it('uses a translation key when the caller provides one', async () => {
        // This is how a screen migrates: pass a key, and the paragraph follows the
        // reader's language.
        await i18n.changeLanguage('en');
        renderScreen({
            title: 'Tajuk Lama',
            titleKey: 'comingSoon.notAvailable',
            explanation: 'Sebab lama',
            explanationKey: 'comingSoon.notAvailable',
        });
        expect(screen.getAllByText('Not available yet').length).toBeGreaterThan(0);
        expect(screen.queryByText('Tajuk Lama')).toBeNull();
    });

    it('falls back to the caller\'s text if a key is missing, never showing the raw key', async () => {
        // A missing translation must not print "some.missing.key" at a teacher.
        await i18n.changeLanguage('ms');
        renderScreen({
            title: 'Tajuk Simpanan',
            titleKey: 'comingSoon.thisKeyDoesNotExist',
        });
        expect(screen.getByText('Tajuk Simpanan')).toBeTruthy();
        expect(screen.queryByText(/comingSoon\.thisKeyDoesNotExist/)).toBeNull();
    });
});
