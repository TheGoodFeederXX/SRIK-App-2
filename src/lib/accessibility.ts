/**
 * Accessibility preferences — ONE place that both saves and applies them.
 *
 * WHY THIS FILE EXISTS. The "Accessibility Settings" screen used to hold its own
 * copy of this logic and call it only while that screen was open, so the moment
 * a user navigated away — or closed the app and came back — every choice was
 * silently reverted. Worse, two of the three effects it tried to produce
 * (`high-contrast` and `reduce-motion` classes on <body>) had no CSS behind
 * them at all, so those switches did nothing even on the screen itself.
 *
 * Now the settings are read and applied at app start, from one module, and the
 * classes they toggle are defined in index.css. A preference a user sets is a
 * preference that stays set.
 *
 * There is deliberately NO language option here. The app's language is chosen
 * through the language switcher and stored under `app_language`; a second,
 * competing control that wrote a value nothing read was how "which language am
 * I in?" became unanswerable.
 */

export interface AccessibilitySettings {
    /** Page text scale, in percent. 100 is the design's own size. */
    font_size: number;
    high_contrast: boolean;
    reduce_motion: boolean;
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
    font_size: 100,
    high_contrast: false,
    reduce_motion: false,
};

/** Per-person, per-device: these preferences are not school data. */
export function accessibilityStorageKey(userId?: string): string {
    return `accessibility_settings:${userId || 'anonymous'}`;
}

function readRaw(userId?: string): Partial<AccessibilitySettings> {
    try {
        const raw = localStorage.getItem(accessibilityStorageKey(userId));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        // Corrupt or unavailable storage must not stop the app from starting.
        return {};
    }
}

/** Read a person's saved preferences, falling back to the defaults. */
export function loadAccessibilitySettings(userId?: string): AccessibilitySettings {
    const saved = readRaw(userId);
    const merged = { ...DEFAULT_ACCESSIBILITY_SETTINGS, ...saved };
    // Guard against a hand-edited or out-of-range stored value.
    const size = Number(merged.font_size);
    merged.font_size = Number.isFinite(size) ? Math.min(200, Math.max(100, size)) : 100;
    merged.high_contrast = Boolean(merged.high_contrast);
    merged.reduce_motion = Boolean(merged.reduce_motion);
    return merged;
}

/** Write preferences to this device. */
export function saveAccessibilitySettings(
    userId: string | undefined,
    settings: AccessibilitySettings,
): void {
    try {
        localStorage.setItem(accessibilityStorageKey(userId), JSON.stringify(settings));
    } catch {
        // Storage may be full or blocked; the settings still apply for this session.
    }
}

/**
 * Put the preferences into effect on the document.
 *
 * `font_size` scales the root font size, which is what every rem-based size in
 * the app is measured from, so one value moves the whole interface. The two
 * classes are defined in index.css.
 */
export function applyAccessibilitySettings(settings: AccessibilitySettings): void {
    const root = document.documentElement;
    root.style.fontSize = `${settings.font_size}%`;
    root.classList.toggle('high-contrast', settings.high_contrast);
    root.classList.toggle('reduce-motion', settings.reduce_motion);
}

/**
 * Apply whatever is already saved. Called once when the app starts — and again
 * when the signed-in person is known, since preferences are stored per person.
 */
export function applySavedAccessibilitySettings(userId?: string): AccessibilitySettings {
    const settings = loadAccessibilitySettings(userId);
    applyAccessibilitySettings(settings);
    return settings;
}
