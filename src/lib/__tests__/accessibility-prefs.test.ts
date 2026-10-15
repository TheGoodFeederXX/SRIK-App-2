/**
 * Accessibility preferences must actually take effect, and must survive leaving
 * the screen that set them.
 *
 * WHY THIS IS TESTED. The settings screen used to own its apply-and-save logic
 * and run it only while that screen was mounted. A text size chosen there was
 * therefore lost the moment the user navigated away, and two of the three
 * switches (`high-contrast`, `reduce-motion`) added classes that had no CSS
 * behind them at all — so they did nothing even on the screen itself. Both
 * faults were invisible: nothing threw, nothing logged, the switch just moved.
 *
 * These tests pin the behaviour that matters to a person: what I choose is what
 * I get, and it is still in force next time the app opens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    DEFAULT_ACCESSIBILITY_SETTINGS,
    accessibilityStorageKey,
    loadAccessibilitySettings,
    saveAccessibilitySettings,
    applyAccessibilitySettings,
    applySavedAccessibilitySettings,
} from '../accessibility';

const USER = 'teacher-1';

beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
    document.documentElement.className = '';
});

afterEach(() => {
    localStorage.clear();
});

describe('accessibility preferences are remembered per person', () => {
    it('starts from the defaults when nothing has been saved', () => {
        expect(loadAccessibilitySettings(USER)).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
    });

    it('reads back exactly what was saved', () => {
        const chosen = { font_size: 150, high_contrast: true, reduce_motion: true };
        saveAccessibilitySettings(USER, chosen);
        expect(loadAccessibilitySettings(USER)).toEqual(chosen);
    });

    it('keeps one person\'s choices away from the next', () => {
        saveAccessibilitySettings('teacher-1', { font_size: 180, high_contrast: true, reduce_motion: false });
        // A different person on the same machine must not inherit them.
        expect(loadAccessibilitySettings('teacher-2')).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
    });

    it('stores under a per-person key, not one global key', () => {
        saveAccessibilitySettings(USER, { font_size: 120, high_contrast: false, reduce_motion: false });
        expect(localStorage.getItem(accessibilityStorageKey(USER))).not.toBeNull();
        expect(localStorage.getItem(accessibilityStorageKey('someone-else'))).toBeNull();
    });

    it('clamps a nonsense stored size back into range instead of breaking the layout', () => {
        localStorage.setItem(
            accessibilityStorageKey(USER),
            JSON.stringify({ font_size: 9999, high_contrast: false, reduce_motion: false }),
        );
        expect(loadAccessibilitySettings(USER).font_size).toBe(200);

        localStorage.setItem(
            accessibilityStorageKey(USER),
            JSON.stringify({ font_size: 1, high_contrast: false, reduce_motion: false }),
        );
        expect(loadAccessibilitySettings(USER).font_size).toBe(100);
    });

    it('survives unreadable stored data rather than crashing the app', () => {
        localStorage.setItem(accessibilityStorageKey(USER), 'not json at all');
        expect(loadAccessibilitySettings(USER)).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
    });
});

describe('the chosen settings are actually put into effect', () => {
    it('scales the interface by setting the root font size', () => {
        applyAccessibilitySettings({ font_size: 175, high_contrast: false, reduce_motion: false });
        expect(document.documentElement.style.fontSize).toBe('175%');
    });

    it('turns high contrast on and off', () => {
        applyAccessibilitySettings({ font_size: 100, high_contrast: true, reduce_motion: false });
        expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

        applyAccessibilitySettings({ font_size: 100, high_contrast: false, reduce_motion: false });
        expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
    });

    it('turns reduced motion on and off', () => {
        applyAccessibilitySettings({ font_size: 100, high_contrast: false, reduce_motion: true });
        expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);

        applyAccessibilitySettings({ font_size: 100, high_contrast: false, reduce_motion: false });
        expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
    });

    it('THE REGRESSION: a saved choice still applies at the NEXT app start', () => {
        // A person sets a larger text size and high contrast, then closes the app.
        saveAccessibilitySettings(USER, { font_size: 150, high_contrast: true, reduce_motion: true });

        // A fresh start: the document is clean, as it would be on a new page load.
        document.documentElement.style.fontSize = '';
        document.documentElement.className = '';

        // App start-up, with the person known.
        applySavedAccessibilitySettings(USER);

        expect(document.documentElement.style.fontSize).toBe('150%');
        expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
        expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    });

    it('applies the defaults before anyone signs in, without throwing', () => {
        expect(() => applySavedAccessibilitySettings()).not.toThrow();
        expect(document.documentElement.style.fontSize).toBe('100%');
    });
});

describe('the CSS classes this depends on are real', () => {
    it('defines styles for high-contrast and reduce-motion in index.css', async () => {
        // A class with no CSS is a switch that does nothing. The settings screen
        // showed exactly that bug, so the stylesheet is checked here rather than
        // assumed. Each class needs a rule with a declaration block that follows
        // it, not just a mention in a comment.
        const css = await import('fs').then(m => m.readFileSync('index.css', 'utf8'));
        expect(css).toMatch(/html\.high-contrast\s+[^{]+\{/);
        expect(css).toMatch(/html\.reduce-motion\s+[^{]+\{/);
        // And the declarations must be real, not empty rules.
        expect(css).toMatch(/html\.high-contrast[\s\S]{0,600}color:\s*#1f2937\s*!important/);
        expect(css).toMatch(/html\.reduce-motion[\s\S]{0,400}animation-duration:\s*0\.01ms\s*!important/);
    });
});
