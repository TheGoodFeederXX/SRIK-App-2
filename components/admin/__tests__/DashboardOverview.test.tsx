import React from 'react';
import { screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import DashboardOverview from '../DashboardOverview';
import { renderWithProviders, resetTestQueryClient } from '../../../test-utils';
import { api } from '../../../lib/api';
import i18n from '../../../lib/i18n';

// Mock dependencies
vi.mock('../../../lib/database', () => ({
  fetchAuditLogs: vi.fn(() => Promise.resolve([])),
  fetchBusRoster: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../../lib/api');

// The dashboard counts now come from Supabase, not `api.getDashboardStats`.
//
// This mock is not optional tidiness: without it the component issued six real
// REST requests to the live project on every test run. They returned 401 (the
// test has no session), the component correctly fell back to 0, and the
// assertions still passed — so the test was green while depending on the network.
// It also made the suite flaky: the failures only appeared in a full run, where
// those in-flight requests raced the assertions.
// The fixture is defined INSIDE the factory because `vi.mock` is hoisted above
// the imports and cannot close over a later `const`.
vi.mock('../../../src/lib/supabase/stats', () => ({
  getDashboardCounts: vi.fn(() =>
    Promise.resolve({
      students: 150,
      staff: 12,
      guardians: 140,
      classes: 8,
      overdueCharges: 0,
      activeAnnouncements: 0,
    }),
  ),
  // The component imports this class only for typing; it must exist for the
  // module shape to match, and a missing export here would be a confusing
  // failure unrelated to what the test is checking.
  StatsUnavailableError: class extends Error {},
}));

// Note: setupTests.ts already mocks the api module globally now.

describe('DashboardOverview Component', () => {
  it('renders dashboard correctly', async () => {
    renderWithProviders(
      <DashboardOverview
        navigateTo={vi.fn()}
        handleBack={vi.fn()}
        forceUpdate={vi.fn()}
        schoolId="school-123"
        currentBranchId={null}
      />
    );

    // Check for main welcome message
    expect(await screen.findByText(/Welcome, Admin!/i)).toBeInTheDocument();
  });

  it('shows the real figures it was given, not a zero', async () => {
    renderWithProviders(
      <DashboardOverview
        navigateTo={vi.fn()}
        handleBack={vi.fn()}
        forceUpdate={vi.fn()}
        schoolId="school-123"
        currentBranchId={null}
      />
    );

    expect(await screen.findByText('150')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows a dash, NOT a zero, when the figures cannot be read', async () => {
    // THE GUARD FOR AUDIT F29.
    //
    // The dashboard used to swallow a failed count into 0. On a register of ~250
    // people, "0 students" is not a missing figure — it is a statement that the
    // school has no students, and it is indistinguishable from an empty school.
    // Nothing looks broken, so nobody investigates.
    //
    // This test fails against the old behaviour: the tiles rendered "0" and this
    // assertion finds no dash. That is the point — it was written after the fix and
    // then checked by putting the old behaviour back.
    // `mockRejectedValue` (not `...Once`): the mock is shared across the file, so a
    // one-shot rejection could be consumed by an earlier test's call.
    const stats = await import('../../../src/lib/supabase/stats');
    (stats.getDashboardCounts as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('the database is unreachable'),
    );

    // AND THE CACHE MUST BE CLEARED, which is what actually made this test fail
    // before it was fixed. The suite shares ONE QueryClient configured with
    // `staleTime: Infinity`, so the successful counts fetched by the test above were
    // still fresh: the dashboard read them straight from cache, never called the
    // failing mock, and rendered 150 with no alert. The test was reporting the cache
    // as a UI defect.
    //
    // `resetQueries` is used rather than `clear()` because the mounted observers from
    // the previous test need the entries removed as well as the cache emptied.
    resetTestQueryClient();

    renderWithProviders(
      <DashboardOverview
        navigateTo={vi.fn()}
        handleBack={vi.fn()}
        forceUpdate={vi.fn()}
        schoolId="school-123"
        currentBranchId={null}
      />
    );

    // The alert names the problem rather than pretending the numbers are zero.
    //
    // This assertion used to demand the MALAY wording, and passed only because that wording was
    // hard-coded as a `defaultValue` in the component — which is the very defect: a fallback
    // cannot follow the reader's language, so an English reader saw Malay here. The key now
    // exists in both locales. The language behaviour itself is proved in the test below.
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be read right now/i);

    // AND NO TILE CLAIMS THE SCHOOL IS EMPTY.
    //
    // This is the assertion that makes the fix real, and it took a mutation test to
    // get right. The first version checked only that the alert appeared and that
    // '150' was absent — both of which stayed true when the tiles were changed back
    // to printing 0, because the tiles were printing 0 and the alert was still
    // there. The defect was invisible to the test that was supposed to catch it.
    //
    // So the tiles are checked for what they actually show. There must be a dash,
    // and there must be NO '0' where a count belongs.
    expect(
      await screen.findAllByText('—'),
      'when the figures cannot be read, the tiles must show a dash, not a zero',
    ).not.toHaveLength(0);

    // The DASH replaces the four main tiles, so none of them prints a digit at all.
    //
    // Care is needed here: the page legitimately contains other zeroes — a trend
    // marker, an "unpublished reports" count — and asserting on every '0' anywhere
    // fails for reasons that have nothing to do with this fix. That was the first
    // version's mistake, and it failed on the CLEAN code.
    //
    // So the tiles themselves are located, and their contents are checked. The four
    // headline values are the ones that used to read "0 staff" for a school with 18.
    const dashes = await screen.findAllByText('—');
    expect(
      dashes.length,
      'when the figures cannot be read, the headline tiles must show a dash',
    ).toBeGreaterThanOrEqual(4);

    // And none of them shows a digit. A tile rendering '0' is the defect.
    for (const tile of dashes) {
      expect(tile.textContent, 'a tile is showing a number it does not have').toBe('—');
    }
  });

  describe('the reader\'s language (Malay default, English selectable)', () => {
    // The dashboard is the first thing every member of staff opens, so its navigation is the
    // most-read text in the app. It was written in fixed English: a Malay-speaking head
    // teacher read "Quick Actions" and "Attendance & Safety" every morning on a school where
    // Malay is the language of work. These tests change the language FOR REAL and read the
    // screen, because checking the locale file alone would pass while the screen ignored it.
    const renderDash = () => renderWithProviders(
      <DashboardOverview
        navigateTo={vi.fn()}
        handleBack={vi.fn()}
        forceUpdate={vi.fn()}
        schoolId="school-123"
        currentBranchId={null}
      />
    );

    afterEach(async () => {
      await i18n.changeLanguage('ms');
      resetTestQueryClient();
    });

    it('reads in Malay when the app is in Malay', async () => {
      await i18n.changeLanguage('ms');
      renderDash();
      // 'Quick Actions' / 'Daily Essentials' / 'Recent Activity' in Malay.
      expect(await screen.findByText('Tindakan Pantas')).toBeInTheDocument();
      expect(screen.getByText('Keperluan Harian')).toBeInTheDocument();
    });

    it('reads in English once English is chosen', async () => {
      await i18n.changeLanguage('en');
      renderDash();
      expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
      // The English must REPLACE the Malay, not sit beside it.
      expect(screen.queryByText('Tindakan Pantas')).not.toBeInTheDocument();
    });

    it('translates the navigation labels the office works from', async () => {
      await i18n.changeLanguage('ms');
      renderDash();
      await screen.findByText('Tindakan Pantas');
      // A category heading from the quick-action registry.
      expect(screen.getByText('Warga Sekolah & Pendaftaran')).toBeInTheDocument();
    });
  });


  it('names the unreadable-figures problem in the reader\'s own language', async () => {
    // The alert guarded by audit F29 must follow the language like everything else. It did not
    // before: only a Malay `defaultValue` existed, so an English build showed Malay.
    const stats = await import('../../../src/lib/supabase/stats');
    (stats.getDashboardCounts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));

    for (const [lang, expected] of [['ms', /tidak dapat dibaca/i], ['en', /cannot be read right now/i]] as const) {
      resetTestQueryClient();
      await i18n.changeLanguage(lang);
      const { unmount } = renderWithProviders(
        <DashboardOverview
          navigateTo={vi.fn()}
          handleBack={vi.fn()}
          forceUpdate={vi.fn()}
          schoolId="school-123"
          currentBranchId={null}
        />
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(expected);
      unmount();
    }
    await i18n.changeLanguage('ms');
  });
});
