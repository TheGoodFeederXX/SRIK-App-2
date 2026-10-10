/**
 * The loading screen — SRIK.
 *
 * Two things matter here and both are easy to get wrong.
 *
 * The name must be the SCHOOL's, not a vendor's. This screen was the last place
 * in the app that still said "Oliskey School App", and a loading screen is the
 * first thing anyone sees, so a wrong name there is the most visible wrong name
 * there is.
 *
 * A missing logo file must not show a broken image. The crest is supplied as a
 * file, and a file can be absent; on a school's phone a broken-image icon on the
 * very first screen looks like the app is broken.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PremiumLoader, { BOOT_MESSAGE } from '../PremiumLoader';
import { SCHOOL_NAME } from '../../../src/lib/branding';

describe('PremiumLoader', () => {
    it('THE RULE: says the school name, never the old vendor name', () => {
        render(<PremiumLoader />);
        expect(screen.getByText(SCHOOL_NAME)).toBeTruthy();
        // The vendor this app was originally built for has nothing to do with
        // this school, and its name does not appear on the loading screen.
        expect(screen.queryByText(/Oliskey/i)).toBeNull();
    });

    it('shows the school crest', () => {
        render(<PremiumLoader />);
        const logo = document.querySelector('img');
        expect(logo).toBeTruthy();
        expect(logo?.getAttribute('src')).toBe('/school-logo.png');
    });

    it('marks the crest as decorative, so it is not announced twice', () => {
        render(<PremiumLoader />);
        // The name is already written below it; a screen reader reading both
        // would say the school twice.
        expect(document.querySelector('img')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('THE RULE: a missing logo file falls back, never a broken image', () => {
        render(<PremiumLoader />);
        const logo = document.querySelector('img')!;
        fireEvent.error(logo);

        // The image is gone and the monogram has taken its place.
        expect(document.querySelector('img')).toBeNull();
        expect(screen.getByText('SRIK')).toBeTruthy();
    });

    it('shows the boot message, so every start-up gate reads as one wait', () => {
        render(<PremiumLoader />);
        expect(screen.getByText(BOOT_MESSAGE)).toBeTruthy();
    });

    it('accepts a plain-language message in Malay', () => {
        render(<PremiumLoader message="Memuatkan markah..." />);
        expect(screen.getByText('Memuatkan markah...')).toBeTruthy();
    });

    it('THE RULE: the coin-turn stops when the device asks for less motion', () => {
        render(<PremiumLoader />);
        // The keyframes are scoped to srik- names AND carry a reduced-motion
        // escape hatch. A continuously turning element is what that setting
        // exists for.
        const css = document.querySelector('style')?.textContent ?? '';
        expect(css).toContain('srikCoinTurn');
        expect(css).toContain('prefers-reduced-motion: reduce');
        expect(css).toContain('.srik-coin, .srik-dot { animation: none; }');
    });

    it('THE RULE: its keyframes cannot affect another component', () => {
        render(<PremiumLoader />);
        const css = document.querySelector('style')?.textContent ?? '';
        // This file once redefined Tailwind's own `@keyframes ping`, so merely
        // mounting the loader changed every animate-ping in the app.
        expect(css).not.toMatch(/@keyframes\s+ping\b/);
        expect(css).toContain('@keyframes srikCoinTurn');
        expect(css).toContain('@keyframes srikBreathe');
    });
});
