import '@testing-library/jest-dom';
import { vi } from 'vitest';
import i18n, { ensureLanguageLoaded } from './lib/i18n';
import en from './lib/i18n/locales/en.json';

// The tests assert against English strings, so the suite pins English EXPLICITLY.
// This line used to read "initialize translations so t() resolves to English in tests"
// and relied on the detector reading `navigator`, which jsdom reports as en-US. That was
// the app's own defect — the desktop opened in English because of the DEVICE language — so
// the moment the app stopped consulting the device, the whole suite flipped to Malay and
// 178 assertions failed at once. Pinning it here makes the test language a decision of the
// tests, not a side effect of a bug.
//
// The bundle is added and the language set SYNCHRONOUSLY: `changeLanguage` is async, and a
// promise nobody awaits would leave the first assertions reading Malay.
i18n.addResourceBundle('en', 'translation', en, true, true);
i18n.changeLanguage('en');
void ensureLanguageLoaded;

// Global API mock
vi.mock('./lib/api', () => {
    // Chainable REST query-builder stub (mirrors api.from('table')...).
    const mockDb = {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                ilike: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                then: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            insert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
    };

    const mockApi = {
        ...mockDb,
        getStudents: vi.fn().mockResolvedValue([]),
        getTeacherAnalytics: vi.fn().mockResolvedValue([]),
        getClasses: vi.fn().mockResolvedValue([]),
        fetchClasses: vi.fn().mockResolvedValue([]),
        getSubjects: vi.fn().mockResolvedValue([]),
        fetchSubjects: vi.fn().mockResolvedValue([]),
        initializeStandardClasses: vi.fn().mockResolvedValue(undefined),
        getSchoolSettings: vi.fn().mockResolvedValue({}),
        getBranches: vi.fn().mockResolvedValue([]),
        getDashboardStats: vi.fn().mockResolvedValue({}),
        getBuses: vi.fn().mockResolvedValue([]),
        createClass: vi.fn().mockResolvedValue({}),
        updateClass: vi.fn().mockResolvedValue({}),
        deleteClass: vi.fn().mockResolvedValue(undefined),
        fetchStudentsByClassId: vi.fn().mockResolvedValue([]),
        getTeacherDashboardStats: vi.fn().mockResolvedValue({}),
        getTeacherById: vi.fn().mockResolvedValue({ id: 't1', name: 'Test Teacher', school_id: 'school-123' }),
        getAssignments: vi.fn().mockResolvedValue([]),
    };

    return {
        api: mockApi,
        default: mockApi,
    };
});

// Mock MatchMedia (needed by many UI libraries)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock indexedDB for happy-dom/jsdom
const indexedDBMock = {
    open: vi.fn().mockReturnValue({
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
    }),
    deleteDatabase: vi.fn().mockReturnValue({
        onsuccess: null,
        onerror: null,
    }),
};

Object.defineProperty(window, 'indexedDB', {
    value: indexedDBMock,
});
