import React from 'react';
import { screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import DashboardOverview from '../DashboardOverview';
import { renderWithProviders } from '../../../test-utils';
import { api } from '../../../lib/api';

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
});
